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
const btnSearch = document.getElementById('btnSearch');
const qEl = document.getElementById('q');
async function doSearch() {
  const q = qEl.value.trim();
  if(!q) return alert('주소를 입력하세요.');
  btnSearch.disabled = true;
  const oldLabel = btnSearch.textContent;
  btnSearch.textContent = '검색 중…';
  try{
    const res = await fetch(`/search_address/?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if(!res.ok){ alert(`검색 실패: ${data?.error || '검색 실패'}`); return; }
    const {x,y,label} = data;
    if(window._marker) map.removeLayer(window._marker);
    window._marker = L.marker([y,x]).addTo(map).bindPopup(label||q).openPopup();
    map.setView([y,x], 16);
  }catch(e){ console.error(e); alert('네트워크 오류가 발생했습니다.'); }
  finally{ btnSearch.disabled = false; btnSearch.textContent = oldLabel; }
}
btnSearch.addEventListener('click', doSearch);
qEl.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') doSearch(); });
document.getElementById('btnHelp').addEventListener('click', ()=> log('도움말'));

/* ========= 필지 경계 (VWorld WMS) ========= */
const vKey = window.VWORLD_API_KEY || "";
let parcelLayer = null;
const parcelURL = "https://api.vworld.kr/req/wms";
const parcelParams = { service:"WMS", request:"GetMap", version:"1.1.1", layers:"lp_pa_cbnd", styles:"", format:"image/png", transparent:true, key:vKey };
document.getElementById('chkParcel').addEventListener('change', (e)=>{
  if(e.target.checked){ if(!parcelLayer) parcelLayer = L.tileLayer.wms(parcelURL, parcelParams); parcelLayer.addTo(map); }
  else{ if(parcelLayer) map.removeLayer(parcelLayer); }
});

/* ========= 필터 설정 ========= */
const FILTER_CONFIG = {
  // A
  landuse:   { group:'A', baseOpacity:1.0 },
  owner:     { group:'A', baseOpacity:1.0 },

  // B
  zoning:    { group:'B', bmode:'single', baseOpacity:0.55, colorVar:'--b-zoning' },
  eco:       { group:'B', bmode:'scale',  baseOpacity:0.55 },
  landslide: { group:'B', bmode:'scale',  baseOpacity:0.55 },
  vegetation:{ group:'B', bmode:'scale',  baseOpacity:0.55 },
  biotope:   { group:'B', bmode:'scale',  baseOpacity:0.55 },
  buffer:    { group:'B', bmode:'single', baseOpacity:0.55, colorVar:'--b-buffer' },

  // 제척 (C pane)
  protection:{ group:'B', bmode:'forbid', baseOpacity:0.55 },
  river:     { group:'B', bmode:'forbid', baseOpacity:0.55 },
  mountain:  { group:'B', bmode:'forbid', baseOpacity:0.55 }
};

const panes = {};
const groups = {};
let lastActiveB = null;
let zCounter = 200;
const B_KEYS = Object.keys(FILTER_CONFIG).filter(k => FILTER_CONFIG[k].group === 'B');

/* Pane 생성 */
function createPaneForKey(key){
  const cfg = FILTER_CONFIG[key];
  const base = cfg.group === 'A' ? 'pane-A' : (cfg.bmode === 'forbid' ? 'pane-C' : 'pane-B');
  const paneName = `${base}-${key}`;
  if (panes[key]) return panes[key];
  map.createPane(paneName);
  const el = map.getPane(paneName);
  el.classList.add(base);
  el.style.opacity = 0;
  el.style.zIndex = base === 'pane-A' ? 210 : base === 'pane-B' ? 310 : 900;
  panes[key] = paneName;
  groups[key] = L.layerGroup([], { pane: paneName }).addTo(map);
  return paneName;
}
Object.keys(FILTER_CONFIG).forEach(createPaneForKey);

/* 아코디언 열고/닫기 */
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
document.querySelectorAll('.sidebar-accordion .acc-item .acc-head').forEach(h=>{
  h.addEventListener('click', (ev)=>{
    const isControl = ev.target.closest('label.head-switch, input, .range, .head-icon');
    if(isControl) return;
    const item = h.closest('.acc-item');
    const open = item.classList.toggle('open');
    h.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
});

/* ===== A: pill 틴트 유틸 ===== */
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
function applyTintFromState(sec){
  sec.querySelectorAll('input.opt').forEach(chk=>{
    const label = chk.closest('.pill');
    if(chk.checked) tintPill(label, chk.dataset.color);
    else            untintPill(label);
  });
}
function setAllOptions(sec, checked){
  sec.querySelectorAll('input.opt').forEach(chk=> chk.checked = checked);
  applyTintFromState(sec);
}

/* B 딤 & z-index 올리기 */
function updateBDimming(){
  B_KEYS.forEach(key=>{
    const paneEl = map.getPane(panes[key]);
    if(!paneEl) return;
    const isActive = document.querySelector(`.acc-item[data-key="${key}"] .layer-toggle`)?.checked;
    if(!isActive){ paneEl.classList.remove('dimmed'); return; }
    if(lastActiveB && key !== lastActiveB) paneEl.classList.add('dimmed');
    else paneEl.classList.remove('dimmed');
  });
}
function bringPaneToFront(key){
  const paneEl = map.getPane(panes[key]);
  if(!paneEl) return;
  zCounter += 1;
  paneEl.style.zIndex = 300 + zCounter;
}

/* 섹션 활성/불투명도 */
function setSectionActive(sec, isOn){
  const key = sec.dataset.key;
  const cfg = FILTER_CONFIG[key];
  const opEl = sec.querySelector('input.op');
  const want = isOn ? ((parseInt(opEl?.value || String(cfg.baseOpacity*100),10))/100) : 0;

  const paneEl = map.getPane(panes[key]);
  if(!paneEl) return;

  paneEl.style.opacity = want;
  sec.classList.toggle('is-on', !!isOn);

  // A그룹: 토글 상태에 맞춰 틴트/체크 일괄 동기화
  if (cfg.group === 'A') {
    setAllOptions(sec, !!isOn);
  }

  if(isOn && cfg.group === 'B' && cfg.bmode !== 'forbid'){
    bringPaneToFront(key);
    updateBDimming();
  } else if (cfg.group === 'B') {
    updateBDimming();
  }
}

/* 데이터 레이어 연결 (TODO) */
function refreshLayerForKey(key){
  const g = groups[key];
  g.clearLayers();
  const active = document.querySelector(`.acc-item[data-key="${key}"] .layer-toggle`)?.checked;
  if(!active) return;
  // TODO: 실제 데이터 연결
}

/* ===== 말풍선 ===== */
const INFO_CONTENT = {
  landuse:{ title:'지목',
    body:['포함: 농지, 산지, 잡종지, 구거, 목장용지, 염전, 양어장','표시: 필지별 색(“필지 단위 보기” ON 시 경계선)'],
    legend:[['농지','--a-land-farmland'],['산지','--a-land-forest'],['잡종지','--a-land-misc'],['구거','--a-land-ditch'],['목장용지','--a-land-ranch'],['염전','--a-land-salt'],['양어장','--a-land-fish']]},
  owner:{ title:'소유자',
    body:['포함: 국유지, 공유지, 개인, 법인','표시: 필지별 색(경계선 별도)'],
    legend:[['국유지','--a-own-public'],['공유지','--a-own-shared'],['개인','--a-own-private'],['법인','--a-own-corp']]},
  zoning:{ title:'용도지역',
    body:['포함: 생산·자연녹지, 생산·계획관리, 농업보호, 자연환경보전, 개발진흥지구 등','색: 녹색 단일톤(가능2 미리보기)'],
    legend:[['가능2 톤','--b-zoning']]},
  eco:{ title:'생태자연도',
    body:['포함: 1~3등급, 별도관리','색: 1등급=회색(제척), 2·3·별도관리=스케일'],
    legend:[['2','--b-eco-2'],['3','--b-eco-3'],['별도','--b-eco-sp'],['1(제척)','FORBID']]},
  landslide:{ title:'산사태위험등급',
    body:['포함: 1~5등급','색: 1·2=회색(제척), 3~5=스케일'],
    legend:[['3','--b-slide-3'],['4','--b-slide-4'],['5','--b-slide-5'],['1·2(제척)','FORBID']]},
  vegetation:{ title:'식생보전등급',
    body:['포함: Ⅰ~Ⅲ','색: Ⅰ=회색(제척), Ⅱ·Ⅲ=스케일'],
    legend:[['Ⅱ','--b-veg-2'],['Ⅲ','--b-veg-3'],['Ⅰ(제척)','FORBID']]},
  biotope:{ title:'도시생태현황지도',
    body:['포함: 1~5등급','색: 1·2=회색(제척), 3~5=스케일'],
    legend:[['3','--b-bio-3'],['4','--b-bio-4'],['5','--b-bio-5'],['1·2(제척)','FORBID']]},
  buffer:{ title:'이격거리',
    body:['대상(주거/정온/문화재/도로 등)과의 거리 제한 미리보기','색: 회색 단일색'],
    legend:[['미리보기','--b-buffer']]},
  protection:{ title:'보호지역', body:['초지, 사방지, 자연공원, 휴양림, 상수원·습지·야생생물 보호구역'], legend:[['제척','FORBID']]},
  river:{ title:'하천', body:['하천/소하천 구역'], legend:[['제척','FORBID']]},
  mountain:{ title:'산지', body:['보전산지, 백두대간보호지역, 산림보호구역'], legend:[['제척','FORBID']]}
};

let currentPopover = null;
let currentOwner = null;
let docHandler = null;
function hidePopover(){
  if(currentPopover){ currentPopover.remove(); currentPopover = null; }
  currentOwner = null;
  if(docHandler){ document.removeEventListener('mousedown', docHandler); docHandler = null; }
}
function showPopover(btn){
  if(currentOwner === btn){ hidePopover(); return; }
  hidePopover();
  const key = btn.dataset.info;
  const data = INFO_CONTENT[key];
  if(!data) return;
  const pop = document.createElement('div');
  pop.className = 'bubble';
  const legendHTML = (data.legend||[]).map(([name, varname])=>{
    if(varname==='FORBID') return `<span class="legend-pill forbid">${name}</span>`;
    return `<span class="legend-pill" style="--legend:var(${varname})">${name}</span>`;
  }).join('');
  pop.innerHTML = `
    <h4>${data.title}</h4>
    ${data.body.map(t=>`<p class="muted">${t}</p>`).join('')}
    ${legendHTML ? `<div class="legend-pills">${legendHTML}</div>` : '' }
  `;
  document.body.appendChild(pop);
  const rect = btn.getBoundingClientRect();
  const spacing = 10;
  const preferBottom = rect.bottom + spacing + pop.offsetHeight <= window.innerHeight;
  let top = preferBottom ? (window.scrollY + rect.bottom + spacing) : (window.scrollY + rect.top - pop.offsetHeight - spacing);
  let left = window.scrollX + rect.left + rect.width/2 - pop.offsetWidth/2;
  left = Math.max(8, Math.min(left, window.scrollX + window.innerWidth - pop.offsetWidth - 8));
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
  if(!preferBottom) pop.setAttribute('data-placement','top');
  currentPopover = pop;
  currentOwner = btn;
  docHandler = (e)=>{ if(pop.contains(e.target) || btn.contains(e.target)) return; hidePopover(); };
  setTimeout(()=> document.addEventListener('mousedown', docHandler), 0);
}
document.querySelectorAll('.head-icon').forEach(el=>{
  el.addEventListener('click', (e)=>{ e.stopPropagation(); showPopover(e.currentTarget); });
  el.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); showPopover(e.currentTarget); } });
});
window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') hidePopover(); });

/* ===== 사이드바 이벤트 바인딩 ===== */
document.querySelectorAll('.sidebar-accordion .acc-item').forEach(sec=>{
  const key = sec.dataset.key;
  const cfg = FILTER_CONFIG[key] || {};
  const headToggle = sec.querySelector('.layer-toggle');

  /* 강제 디폴트 OFF(브라우저 복원 방지) */
  if(headToggle) headToggle.checked = false;

  /* A그룹: 하위 옵션을 초기값 OFF로 강제 */
  if (cfg.group === 'A') {
    setAllOptions(sec, false);          // 체크 해제 + 틴트 제거
  }

  /* 투명도 표기 */
  const opEl   = sec.querySelector('input.op');
  const opText = sec.querySelector('.op-val');
  if(opEl && opText) opText.textContent = `${opEl.value}%`;

  /* 토글 라벨 클릭 → 펼치기 */
  sec.querySelector('.head-switch')?.addEventListener('click', ()=> openAccordion(sec));

  /* 토글 변경 */
  headToggle?.addEventListener('change', ()=>{
    const on = headToggle.checked;
    on ? openAccordion(sec) : closeAccordion(sec);

    if (cfg.group === 'B' && on) { lastActiveB = key; bringPaneToFront(key); }

    setSectionActive(sec, on);   // 여기서 A 그룹 하위 옵션 일괄 ON/OFF + 틴트 동기화
    refreshLayerForKey(key);
    updateBDimming();
    log(`[${key}] layer`, on);
  });

  /* 투명도 변경 */
  const onOpacityInput = (e)=>{
    const on = headToggle?.checked;
    const v = parseInt(e.target.value,10);
    if(opText) opText.textContent = `${v}%`;
    if(on) setSectionActive(sec, true);
  };
  opEl?.addEventListener('input', onOpacityInput);
  opEl?.addEventListener('change', onOpacityInput);

  /* A 옵션 개별 변경 시 틴트 동기화 */
  if (cfg.group === 'A') {
    sec.querySelectorAll('input.opt').forEach(chk=>{
      chk.addEventListener('change', ()=> applyTintFromState(sec));
    });
  }

  /* 초기 상태: 모두 닫힘 + OFF */
  closeAccordion(sec);
  setSectionActive(sec, false);
});

/* ===== 맵 컨트롤 ===== */
document.getElementById('btnZoomIn').addEventListener('click', ()=>{ map.zoomIn();  log('지도 확대'); });
document.getElementById('btnZoomOut').addEventListener('click', ()=>{ map.zoomOut(); log('지도 축소'); });

let _locMarker = null;
document.getElementById('btnLocate').addEventListener('click', ()=>{
  if(!navigator.geolocation) return alert('브라우저가 위치를 지원하지 않습니다.');
  navigator.geolocation.getCurrentPosition(
    pos=>{
      const { latitude:y, longitude:x } = pos.coords;
      if(_locMarker) map.removeLayer(_locMarker);
      _locMarker = L.marker([y,x]).addTo(map).bindPopup('현재 위치').openPopup();
      map.setView([y,x], 15);
    },
    err=>{ console.error(err); alert('위치 권한을 허용해주세요.'); }
  );
});
document.getElementById('btnPrimaryCTA').addEventListener('click', ()=> log('메인 CTA: 선택 시작'));

/* 탭 전환 */
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
    if (window.lucide?.createIcons) { window.lucide.createIcons(); }
  });
});
