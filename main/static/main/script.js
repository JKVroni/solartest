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
  
  /* ========= 검색 ========= */
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
  
  /* ========= 레이어/섹션 ========= */
  const groups = {}; const panes  = {};
  const sections = {
    landuse:{}, zoning:{}, elevation:{}, slope:{}, eco:{}, river:{},
    park:{}, protection:{}, heritage:{}, buffer:{}, grid:{}
  };
  Object.keys(sections).forEach(key=>{
    const pane = `pane_${key}`;
    panes[key] = pane;
    map.createPane(pane);
    map.getPane(pane).classList.add('pane-mask');
    map.getPane(pane).style.opacity = 0;
    groups[key] = L.layerGroup([], { pane }).addTo(map);
  });
  
  /* ========= Accordion 열고닫기 ========= */
  document.querySelectorAll('.sidebar-accordion .acc-item .acc-head').forEach(h=>{
    h.addEventListener('click', (ev)=>{
      // 토글, range 클릭 등 컨트롤 클릭은 열고닫기와 분리
      const isControl = ev.target.closest('label.head-switch, .acc-body, input, .range, .pill');
      if(isControl) return;
      const item = h.closest('.acc-item');
      const open = item.classList.toggle('open');
      h.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });
  
  /* ========= 옵션 틴트 ========= */
  function tintPill(label, colorVar){
    if(!label) return;
    if(colorVar) label.style.setProperty('--swatch', `var(${colorVar})`);
    label.classList.add('tinted');
  }
  function untintPill(label){
    if(!label) return;
    label.classList.remove('tinted');
    label.style.removeProperty('--swatch');
  }
  
  /* 섹션의 모든 하위 옵션 체크/해제 */
  function setAllOptions(sec, checked){
    const opts = [...sec.querySelectorAll('input.opt')];
    opts.forEach(chk=>{
      const label = chk.closest('.pill');
      chk.checked = checked;
      checked ? tintPill(label, chk.dataset.color) : untintPill(label);
    });
    if(opts.length){
      log(`[${sec.dataset.key}] sub-options ${checked ? 'ALL ON' : 'ALL OFF'}`);
    }
  }
  
  /* 섹션 활성 표시 & pane opacity */
  function setSectionActive(sec, isOn){
    const key = sec.dataset.key;
    const opEl = sec.querySelector('input.op');
    const baseOpacity = isOn ? (parseInt(opEl?.value||'0',10)/100) : 0;
    map.getPane(panes[key]).style.opacity = baseOpacity;
    sec.classList.toggle('active', !!isOn);
  }
  
  /* 임계 로직(표고/경사) – 0이면 제한 없음 */
  function updateThresholdBehavior(sec){
    const key = sec.dataset.key;
    const slider = sec.querySelector('input.val');
    const threshold = Number(slider?.value || 0);
    const on = sec.querySelector('.layer-toggle')?.checked;
    const mode = (key==='elevation') ? 'min_elev_gte' : (key==='slope' ? 'max_slope_lte' : null);
    log('임계 적용', {layer:key, mode, threshold, active:on});
  
    // TODO: 서버 타일/WMS/벡터 쿼리 파라미터 연결
    // fetch(`/tiles/${key}?${mode}=${threshold}`)
    //   .then(...) → groups[key] 업데이트
  }
  
  /* ========= 사이드바 이벤트 ========= */
  document.querySelectorAll('.sidebar-accordion .acc-item').forEach(sec=>{
    const key = sec.dataset.key;
    const headToggle = sec.querySelector('.layer-toggle');
  
    // 레이어 토글 → 하위 옵션 일괄 체크/해제 + 투명도 반영
    headToggle?.addEventListener('change', ()=>{
      const on = headToggle.checked;
      setSectionActive(sec, on);
      // 하위 옵션이 있는 섹션은 자동 처리
      const hasChildren = sec.querySelector('input.opt') !== null;
      if(hasChildren) setAllOptions(sec, on);
      updateThresholdBehavior(sec);
      log(`[${key}] layer`, on);
    });
  
    // 투명도 변경
    sec.querySelector('input.op')?.addEventListener('input', e=>{
      const on = headToggle?.checked;
      map.getPane(panes[key]).style.opacity = on ? (parseInt(e.target.value,10)/100) : 0;
    });
  
    // 개별 옵션 틴트
    sec.querySelectorAll('input.opt').forEach(chk=>{
      const label = chk.closest('.pill');
      const colorVar = chk.dataset.color;
      if(chk.checked) tintPill(label, colorVar);
      chk.addEventListener('change', ()=>{
        chk.checked ? tintPill(label, colorVar) : untintPill(label);
        log(`[${key}] option`, chk.value, chk.checked);
      });
    });
  
    // 임계 슬라이더(표고/경사)
    const val = sec.querySelector('input.val');
    if(val){
      const label = sec.querySelector('.valText');
      val.addEventListener('input', ()=>{
        label.textContent = val.value;
        updateThresholdBehavior(sec);
      });
    }
  
    // 초기 상태
    setSectionActive(sec, headToggle?.checked);
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
    report: (()=>{ const d=document.createElement('div'); d.className='sidebar'; d.innerHTML='<div class="acc-item open"><div class="acc-body"><p>프로젝트 & 보고서(추가 예정)</p></div></div>'; return d;})(),
    db:     (()=>{ const d=document.createElement('div'); d.className='sidebar'; d.innerHTML='<div class="acc-item open"><div class="acc-body"><p>프로젝트 DB(추가 예정)</p></div></div>'; return d;})(),
    auth:   (()=>{ const d=document.createElement('div'); d.className='sidebar'; d.innerHTML='<div class="acc-item open"><div class="acc-body"><p>로그인/SSO(추가 예정)</p></div></div>'; return d;})(),
  };
  const main = document.querySelector('.app-main');
  document.querySelectorAll('#leftbar .i').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#leftbar .i').forEach(x=>x.classList.remove('active'));
      btn.classList.add('active');
      [...main.children].forEach(el=>{ if(el.classList && el.classList.contains('sidebar')) el.remove(); });
      const key = btn.dataset.tab;
      main.insertBefore(tabs[key], document.querySelector('.map-wrap'));
    });
  });
  
  /* ===== 사이드바 휠 버블 방지 ===== */
  document.querySelector('.sidebar')?.addEventListener('wheel', (e)=>{ e.stopPropagation(); }, { passive:true });
  