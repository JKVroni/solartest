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

/* ========= 레이어/섹션 세팅 ========= */
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

/* ===== 아코디언 열기/닫기 유틸 ===== */
function openAccordion(sec){
  if(!sec.classList.contains('open')){
    sec.classList.add('open');
    sec.querySelector('.acc-head')?.setAttribute('aria-expanded','true');
  }
}
function closeAccordion(sec){
  if(sec.classList.contains('open')){
    sec.classList.remove('open');
    sec.querySelector('.acc-head')?.setAttribute('aria-expanded','false');
  }
}

/* ========= 아코디언 헤더 클릭 ========= */
document.querySelectorAll('.sidebar-accordion .acc-item .acc-head').forEach(h=>{
  h.addEventListener('click', (ev)=>{
    const isControl = ev.target.closest('label.head-switch, input, .range');
    if(isControl) return; // 토글/슬라이더는 여기서 처리하지 않음
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

/* 하위 옵션 일괄 제어 */
function setAllOptions(sec, checked){
  const opts = [...sec.querySelectorAll('input.opt')];
  opts.forEach(chk=>{
    const label = chk.closest('.pill');
    chk.checked = checked;
    checked ? tintPill(label, chk.dataset.color) : untintPill(label);
  });
  if(opts.length) log(`[${sec.dataset.key}] sub-options ${checked ? 'ALL ON' : 'ALL OFF'}`);
}

/* 레이어 활성/불투명도 */
function setSectionActive(sec, isOn){
  const key = sec.dataset.key;
  const opEl = sec.querySelector('input.op');
  const baseOpacity = isOn ? (parseInt(opEl?.value||'0',10)/100) : 0;
  map.getPane(panes[key]).style.opacity = baseOpacity;
}

/* 임계 로직(표고/경사) */
function updateThresholdBehavior(sec){
  const key = sec.dataset.key;
  const slider = sec.querySelector('input.val');
  const threshold = Number(slider?.value || 0);
  const on = sec.querySelector('.layer-toggle')?.checked;
  const mode = (key==='elevation') ? 'min_elev_gte' : (key==='slope' ? 'max_slope_lte' : null);
  log('임계 적용', {layer:key, mode, threshold, active:on});
  // TODO: 서버 타일/WMS/벡터 쿼리 연결
}

/* ========= 사이드바 이벤트 바인딩 ========= */
document.querySelectorAll('.sidebar-accordion .acc-item').forEach(sec=>{
  const key = sec.dataset.key;
  const headToggle = sec.querySelector('.layer-toggle');

  // 투명도 초기 % 표기
  const opEl   = sec.querySelector('input.op');
  const opText = sec.querySelector('.op-val');
  if(opEl && opText) opText.textContent = `${opEl.value}%`;

  // 토글 라벨 클릭 → 반드시 펼치기
  sec.querySelector('.head-switch')?.addEventListener('click', ()=>{
    openAccordion(sec);
  });

  // ✅ 토글 상태 변경 → 켜면 펼치기, 끄면 접기 + 하위 옵션 일괄 제어 + opacity 반영
  headToggle?.addEventListener('change', ()=>{
    const on = headToggle.checked;

    // 핵심: ON이면 열고, OFF면 닫는다
    on ? openAccordion(sec) : closeAccordion(sec);

    setSectionActive(sec, on);

    const hasChildren = sec.querySelector('input.opt') !== null;
    if(hasChildren) setAllOptions(sec, on);  // 끄면 하위 옵션도 모두 해제

    updateThresholdBehavior(sec);
    log(`[${key}] layer`, on);
  });

  // 투명도 변경 → % 텍스트 즉시 갱신(오른쪽) + pane opacity 반영
  const onOpacityInput = (e)=>{
    const on = headToggle?.checked;
    const v = parseInt(e.target.value,10);
    if(opText) opText.textContent = `${v}%`;
    map.getPane(panes[key]).style.opacity = on ? (v/100) : 0;
  };
  opEl?.addEventListener('input', onOpacityInput);
  opEl?.addEventListener('change', onOpacityInput);  // 일부 브라우저 대비

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

  // 임계 슬라이더
  const val = sec.querySelector('input.val');
  if(val){
    const label = sec.querySelector('.valText');
    val.addEventListener('input', ()=>{
      label.textContent = val.value;
      updateThresholdBehavior(sec);
    });
    val.addEventListener('change', ()=>{
      label.textContent = val.value;
      updateThresholdBehavior(sec);
    });
  }

  // 초기 상태(모두 닫힘, 토글 OFF 가정)
  closeAccordion(sec);
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
  report: (()=>{ const d=document.createElement('div'); d.className='sidebar'; d.innerHTML='<div class="acc-item open"><div class="acc-body"><p class="muted">프로젝트 & 보고서(추가 예정)</p></div></div>'; return d;})(),
  db:     (()=>{ const d=document.createElement('div'); d.className='sidebar'; d.innerHTML='<div class="acc-item open"><div class="acc-body"><p class="muted">프로젝트 DB(추가 예정)</p></div></div>'; return d;})(),
  auth:   (()=>{ const d=document.createElement('div'); d.className='sidebar'; d.innerHTML='<div class="acc-item open"><div class="acc-body"><p class="muted">로그인/SSO(추가 예정)</p></div></div>'; return d;})(),
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
