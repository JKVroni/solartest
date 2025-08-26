/* ========= 공통 ========= */
const log = (msg, data) => {
    const t = new Date().toISOString();
    data !== undefined
      ? console.log(`[AutoSolar][${t}] ${msg}`, data)
      : console.log(`[AutoSolar][${t}] ${msg}`);
  };
  
  /* ========= Leaflet ========= */
  const map = L.map('map', { zoomControl:false }).setView([36.5,127.8], 8);
  L.control.zoom({ position:'topleft' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  setTimeout(()=> map.invalidateSize(), 0);
  
  /* ========= 색상 유틸 ========= */
  function cssVarHex(name){
    // name could be "var(--c-xxx)"; compute style resolves it
    const el = document.documentElement;
    let v = getComputedStyle(el).getPropertyValue(name.replace(/^var\((.+)\)$/, '$1')).trim();
    if(!v){ v = getComputedStyle(el).getPropertyValue(name).trim(); }
    return v || '#999999';
  }
  function hexToHsl(hex){
    hex = hex.replace('#','');
    if(hex.length===3) hex = hex.split('').map(c=>c+c).join('');
    const r=parseInt(hex.substr(0,2),16)/255;
    const g=parseInt(hex.substr(2,2),16)/255;
    const b=parseInt(hex.substr(4,2),16)/255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    let h,s,l=(max+min)/2;
    if(max===min){ h=s=0; }
    else{
      const d = max-min;
      s = l>0.5 ? d/(2-max-min) : d/(max+min);
      switch(max){
        case r: h=(g-b)/d+(g<b?6:0); break;
        case g: h=(b-r)/d+2; break;
        case b: h=(r-g)/d+4; break;
      }
      h/=6;
    }
    return {h:Math.round(h*360), s:Math.round(s*100), l:Math.round(l*100)};
  }
  function hslToHex(h,s,l){
    s/=100; l/=100;
    const c=(1-Math.abs(2*l-1))*s;
    const x=c*(1-Math.abs((h/60)%2-1));
    const m=l-c/2;
    let r=0,g=0,b=0;
    if(0<=h&&h<60){r=c;g=x;}
    else if(60<=h&&h<120){r=x;g=c;}
    else if(120<=h&&h<180){g=c;b=x;}
    else if(180<=h&&h<240){g=x;b=c;}
    else if(240<=h&&h<300){r=x;b=c;}
    else{r=c;b=x;}
    const to255=v=>Math.round((v+m)*255).toString(16).padStart(2,'0');
    return `#${to255(r)}${to255(g)}${to255(b)}`;
  }
  function gradFromBase(cssVarName, lightness){ // lightness: 0~100
    const base = cssVarHex(cssVarName);
    const hsl = hexToHsl(base);
    return hslToHex(hsl.h, hsl.s, lightness);
  }
  
  /* ========= 주소 검색 ========= */
  document.getElementById('btnSearch').addEventListener('click', async () => {
    const q = document.getElementById('q').value.trim();
    if(!q) return alert('주소를 입력하세요.');
    try{
      const res = await fetch(`/search_address/?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if(!res.ok){ alert(data?.error ? `검색 실패: ${data.error}` : '검색 실패'); return; }
      const {x,y,label} = data;
      if(window._marker) map.removeLayer(window._marker);
      window._marker = L.marker([y,x]).addTo(map).bindPopup(label||q).openPopup();
      map.setView([y,x], 16);
    }catch(e){ console.error(e); alert('검색 중 오류'); }
  });
  document.getElementById('btnHelp').addEventListener('click', ()=> log('도움말'));
  
  /* ========= 필지 경계 (VWorld WMS) ========= */
  const vKey = window.VWORLD_API_KEY || "";
  let parcelLayer = null;
  const parcelURL = "https://api.vworld.kr/req/wms";
  const parcelParams = {
    service:"WMS", request:"GetMap", version:"1.3.0",
    layers:"lp_pa_cbnd", styles:"", format:"image/png", transparent:true, crs:"EPSG:3857", key:vKey
  };
  document.getElementById('chkParcel').addEventListener('change', (e)=>{
    if(e.target.checked){
      if(!parcelLayer) parcelLayer = L.tileLayer.wms(parcelURL, parcelParams);
      parcelLayer.addTo(map);
    }else{
      if(parcelLayer) map.removeLayer(parcelLayer);
    }
  });
  
  /* ========= 레이어/섹션 구조 ========= */
  const groups = {}; // key -> LayerGroup
  const panes  = {}; // key -> pane
  const sections = {
    landuse:{ title:'지목' },
    zoning:{ title:'용도지역', sectionColor:'--c-zoning' },
    elevation:{ title:'표고', sectionColor:'--c-elevation', gradient:true },
    slope:{ title:'경사', sectionColor:'--c-slope', gradient:true },
    eco:{ title:'생태자연도', sectionColor:'--c-eco' },
    river:{ title:'하천' },
    park:{ title:'자연공원', sectionColor:'--c-park' },
    protection:{ title:'보호구역' },
    heritage:{ title:'문화재', sectionColor:'--c-heritage' },
    buffer:{ title:'이격거리' },
    grid:{ title:'계통', sectionColor:'--c-grid' },
  };
  Object.keys(sections).forEach(key=>{
    const pane = `pane_${key}`;
    panes[key] = pane;
    map.createPane(pane);
    map.getPane(pane).classList.add('pane-mask');
    map.getPane(pane).style.opacity = 0; // 시작은 숨김
    groups[key] = L.layerGroup([], { pane }).addTo(map);
  });
  
  /* ========= 체크 UI: 칩 대신 '틴트' 적용 ========= */
  function applyOptionTint(chk){
    const label = chk.closest('label');
    const sw = label.querySelector('.swatch');
    const cssVar = chk.dataset.color; // --c-...
    const color = `var(${cssVar})`;
    if(sw) sw.style.background = color;
    label.classList.add('row','opt-pill');
    if(chk.checked){
      label.classList.add('tinted');
      label.style.setProperty('--swatch', color);
    }else{
      label.classList.remove('tinted');
      label.style.removeProperty('--swatch');
    }
  }
  
  /* ========= 섹션 활성 바 ========= */
  function setSectionActive(sec, isOn){
    const key = sec.dataset.key;
    const baseMap = {
      elevation:'--c-elevation', slope:'--c-slope', zoning:'--c-zoning',
      eco:'--c-eco', park:'--c-park', heritage:'--c-heritage', grid:'--c-grid'
    };
    const base = baseMap[key] || '--c-zoning';
    sec.style.setProperty('--base', `var(${base})`);
    sec.classList.toggle('active', !!isOn);
  }
  
  /* ========= 그라데이션 바 (표고/경사) ========= */
  function updateGradientBar(sec){
    const baseName = sec.dataset.base || (sec.dataset.key==='slope' ? '--c-slope' : '--c-elevation');
    const g1 = gradFromBase(`var(${baseName})`, 30);
    const g2 = gradFromBase(`var(${baseName})`, 80);
    const bar = sec.querySelector('.gradbar');
    const gradOn = sec.querySelector('.grad')?.checked;
    if(bar){
      bar.style.display = gradOn ? 'block' : 'none';
      if(gradOn) bar.style.background = `linear-gradient(90deg, ${g1}, ${g2})`;
    }
  }
  
  /* ========= 사이드바 이벤트 ========= */
  document.querySelectorAll('.sec').forEach(sec=>{
    const key = sec.dataset.key;
  
    // base color data attr
    const baseMap = {
      elevation:'--c-elevation', slope:'--c-slope', zoning:'--c-zoning',
      eco:'--c-eco', park:'--c-park', heritage:'--c-heritage', grid:'--c-grid'
    };
    sec.dataset.base = baseMap[key] || sec.dataset.base || '--c-zoning';
  
    // 투명도 → pane opacity
    const op = sec.querySelector('input.op');
    if(op){
      op.addEventListener('input', e=>{
        const val = (+e.target.value)/100;
        // 섹션 토글형은 off면 0, on이면 슬라이더 값
        const toggle = sec.querySelector('.section-toggle');
        const targetOpacity = (toggle && !toggle.checked) ? 0 : val;
        map.getPane(panes[key]).style.opacity = targetOpacity;
      });
    }
  
    // 옵션 체크박스(다중) → 컬러 틴트
    sec.querySelectorAll('input.opt').forEach(chk=>{
      applyOptionTint(chk);
      chk.addEventListener('change', ()=>{
        applyOptionTint(chk);
        log(`[${key}] option`, chk.value, chk.checked);
        // TODO: 레이어 add/remove
      });
    });
  
    // 섹션 자체 토글
    const toggle = sec.querySelector('.section-toggle');
    if(toggle){
      setSectionActive(sec, toggle.checked);
      // 초기 opacity 반영
      const v = toggle.checked ? (parseInt(op.value,10)/100) : 0;
      map.getPane(panes[key]).style.opacity = v;
  
      toggle.addEventListener('change', ()=>{
        setSectionActive(sec, toggle.checked);
        const v2 = toggle.checked ? (parseInt(op.value,10)/100) : 0;
        map.getPane(panes[key]).style.opacity = v2;
        log(`[${key}] section toggle`, toggle.checked);
      });
    }
  
    // 값 슬라이더(표고/경사)
    sec.querySelectorAll('input.val').forEach(r=>{
      const label = sec.querySelector('.valText');
      const isSlope = key==='slope';
      r.addEventListener('input', ()=>{
        label.textContent = r.value;
        log(`[${key}] threshold`, r.value + (isSlope ? '%' : 'm'));
        // TODO: 서버/타일 파라미터 반영
      });
    });
  
    // 표고/경사 그라데이션 바
    if(key==='elevation' || key==='slope'){
      updateGradientBar(sec);
      const grad = sec.querySelector('.grad');
      if(grad){
        grad.addEventListener('change', ()=> updateGradientBar(sec));
      }
    }
  });
  
  /* ===== 맵 컨트롤 ===== */
  document.getElementById('btnZoomIn').addEventListener('click', ()=>{ map.zoomIn();  log('지도 확대'); });
  document.getElementById('btnZoomOut').addEventListener('click', ()=>{ map.zoomOut(); log('지도 축소'); });
  document.getElementById('btnLocate').addEventListener('click', ()=>{
    if(!navigator.geolocation) return alert('브라우저가 위치를 지원하지 않습니다.');
    navigator.geolocation.getCurrentPosition(
      pos=>{
        const { latitude:y, longitude:x } = pos.coords;
        L.marker([y,x]).addTo(map).bindPopup('현재 위치').openPopup();
        map.setView([y,x], 15);
      },
      err=>{ console.error(err); alert('위치 권한을 허용해주세요.'); }
    );
  });
  document.getElementById('btnPrimaryCTA').addEventListener('click', ()=> log('메인 CTA: 선택 시작'));
  
  /* ===== 탭 전환 ===== */
  const tabs = {
    filter: document.getElementById('panel-filter'),
    report: (()=>{ const d=document.createElement('div'); d.className='sidebar'; d.innerHTML='<div class="card"><h4>프로젝트 & 보고서</h4><p>다음 스프린트에서 목록/양식 연결.</p></div>'; return d;})(),
    db:     (()=>{ const d=document.createElement('div'); d.className='sidebar'; d.innerHTML='<div class="card"><h4>프로젝트 DB</h4><p>검색/테이블 뷰 예정.</p></div>'; return d;})(),
    auth:   (()=>{ const d=document.createElement('div'); d.className='sidebar'; d.innerHTML='<div class="card"><h4>로그인</h4><p>OAuth/사내 SSO 연동 예정.</p></div>'; return d;})(),
  };
  const main = document.querySelector('.app-main');
  document.querySelectorAll('#leftbar .i').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#leftbar .i').forEach(x=>x.classList.remove('active'));
      btn.classList.add('active');
      // 기존 사이드바 제거
      [...main.children].forEach(el=>{ if(el.classList && el.classList.contains('sidebar')) el.remove(); });
      // 새 사이드바 삽입
      const key = btn.dataset.tab;
      main.insertBefore(tabs[key], document.querySelector('.map-wrap'));
    });
  });
  
  /* ===== 사이드바 휠 스크롤 맵으로 전파 방지 ===== */
  document.querySelector('.sidebar')?.addEventListener('wheel', (e)=>{
    e.stopPropagation();
  }, { passive:true });  