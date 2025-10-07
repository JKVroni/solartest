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
setTimeout(()=> map.invalidateSize(), 0);

/* ===== 베이스맵 3종 ===== */
const vKeyX = window.VWORLD_API_KEY || window.VWORLD_KEY || "";
let baseLayer, satLayer, hybridLayer;

if (vKeyX) {
  baseLayer = L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${vKeyX}/Base/{z}/{y}/{x}.png`,     { maxZoom:19, attribution:"&copy; Vworld" });
  satLayer  = L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${vKeyX}/Satellite/{z}/{y}/{x}.jpeg`, { maxZoom:19, attribution:"&copy; Vworld" });
  const hy  = L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${vKeyX}/Hybrid/{z}/{y}/{x}.png`,     { maxZoom:19, attribution:"&copy; Vworld" });
  hybridLayer = L.layerGroup([satLayer, hy]);
} else {
  baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:"&copy; OpenStreetMap" });
  satLayer  = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom:19, attribution:"Tiles © Esri" });
  hybridLayer = satLayer;
}
baseLayer.addTo(map);

// 베이스맵 스위처
(function bindBasemapSwitcher(){
  const bmBtns = {
    base:   document.getElementById('bm-base'),
    sat:    document.getElementById('bm-sat'),
    hybrid: document.getElementById('bm-hybrid'),
  };
  function setBasemap(mode){
    [baseLayer, satLayer, hybridLayer].forEach(l=>{ if(l && map.hasLayer(l)) map.removeLayer(l); });
    if(mode==='base') baseLayer.addTo(map);
    else if(mode==='sat') satLayer.addTo(map);
    else if(mode==='hybrid') hybridLayer.addTo(map);
  }
  Object.entries(bmBtns).forEach(([mode,btn])=>{
    if(!btn) return;
    btn.addEventListener('click', ()=>{
      Object.values(bmBtns).forEach(b=>b?.classList.remove('active'));
      btn.classList.add('active');
      setBasemap(mode);
      log(`Basemap → ${mode}`);
    });
  });
})();

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
    const type = /\d+-\d+/.test(q) || /동|리/.test(q) ? 'PARCEL' : 'ROAD';
    const res  = await fetch(`/api/geocode/?q=${encodeURIComponent(q)}&type=${type}`);
    const data = await res.json();
    const result = Array.isArray(data?.response?.result)
      ? data.response.result[0]
      : data?.response?.result;
    if(!res.ok || !result){ alert(`검색 실패: ${data?.error || '검색 결과가 없습니다.'}`); return; }

    const y = parseFloat(result.point?.y), x = parseFloat(result.point?.x);
    const label = data?.response?.refined?.text || q;

    if(window._marker) map.removeLayer(window._marker);
    window._marker = L.marker([y,x]).addTo(map).bindPopup(label).openPopup();
    map.setView([y,x], 16);
  }catch(e){ console.error(e); alert('네트워크 오류가 발생했습니다.'); }
  finally{ btnSearch.disabled = false; btnSearch.textContent = oldLabel; }
}
btnSearch?.addEventListener('click', doSearch);
qEl?.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') doSearch(); });
document.getElementById('btnHelp')?.addEventListener('click', ()=> log('도움말'));

/* ========= 필지 경계 (VWorld WMS) ========= */
const vKey = window.VWORLD_API_KEY || window.VWORLD_KEY || "";
let parcelLayer = null;
const parcelURL = "https://api.vworld.kr/req/wms";
const parcelParams = { service:"WMS", request:"GetMap", version:"1.1.1", layers:"lp_pa_cbnd", styles:"", format:"image/png", transparent:true, key:vKey };
document.getElementById('chkParcel')?.addEventListener('change', (e)=>{
  if(e.target.checked){ if(!parcelLayer) parcelLayer = L.tileLayer.wms(parcelURL, parcelParams); parcelLayer.addTo(map); }
  else{ if(parcelLayer) map.removeLayer(parcelLayer); }
});

/* ========= 필터 설정(원본 유지) ========= */
const FILTER_CONFIG = {
  landuse:   { group:'A', baseOpacity:1.0 },
  owner:     { group:'A', baseOpacity:1.0 },

  zoning:    { group:'B', bmode:'single', baseOpacity:0.55, colorVar:'--b-zoning' },
  eco:       { group:'B', bmode:'scale',  baseOpacity:0.55 },
  landslide: { group:'B', bmode:'scale',  baseOpacity:0.55 },
  vegetation:{ group:'B', bmode:'scale',  baseOpacity:0.55 },
  biotope:   { group:'B', bmode:'scale',  baseOpacity:0.55 },
  buffer:    { group:'B', bmode:'single', baseOpacity:0.55, colorVar:'--b-buffer' },

  protection:{ group:'B', bmode:'forbid', baseOpacity:0.55 },
  river:     { group:'B', bmode:'forbid', baseOpacity:0.55 },
  mountain:  { group:'B', bmode:'forbid', baseOpacity:0.55 }
};

const panes = {};
const groups = {};
let lastActiveB = null;
let zCounter = 200;
const B_KEYS = Object.keys(FILTER_CONFIG).filter(k => FILTER_CONFIG[k].group === 'B');

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

/* 아코디언 애니메이션 */
function animateOpen(el){ el.style.display='block'; const h = el.scrollHeight; el.style.maxHeight='0px'; el.offsetHeight; el.style.maxHeight=h+'px'; }
function animateClose(el){ el.style.maxHeight=el.scrollHeight+'px'; el.offsetHeight; el.style.maxHeight='0px'; setTimeout(()=>{ el.style.display='none'; }, 220); }
function openAccordion(sec){ if(sec.classList.contains('open')) return; sec.classList.add('open'); sec.querySelector('.acc-head')?.setAttribute('aria-expanded','true'); const body=sec.querySelector('.acc-body'); if(body) animateOpen(body); }
function closeAccordion(sec){ if(!sec.classList.contains('open')) return; sec.classList.remove('open'); sec.querySelector('.acc-head')?.setAttribute('aria-expanded','false'); const body=sec.querySelector('.acc-body'); if(body) animateClose(body); }
document.querySelectorAll('.sidebar-accordion .acc-item .acc-head').forEach(h=>{
  h.addEventListener('click', (ev)=>{
    const isControl = ev.target.closest('label.head-switch, input, .range, .head-icon');
    if(isControl) return;
    const item = h.closest('.acc-item');
    if(item.classList.contains('open')) closeAccordion(item); else openAccordion(item);
  });
});

/* A tint 유틸 */
function tintPill(label, colorVar){ if(!label) return; if(colorVar) label.style.setProperty('--swatch', `var(${colorVar})`); label.classList.add('tinted'); }
function untintPill(label){ if(!label) return; label.classList.remove('tinted'); label.style.removeProperty('--swatch'); }
function applyTintFromState(sec){ sec.querySelectorAll('input.opt').forEach(chk=>{ const label = chk.closest('.pill'); if(chk.checked) tintPill(label, chk.dataset.color); else untintPill(label); }); }
function setAllOptions(sec, checked){ sec.querySelectorAll('input.opt').forEach(chk=> chk.checked = checked); applyTintFromState(sec); }

/* B dimming & z-index */
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
function bringPaneToFront(key){ const paneEl = map.getPane(panes[key]); if(!paneEl) return; zCounter += 1; paneEl.style.zIndex = 300 + zCounter; }

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

  if (cfg.group === 'A') setAllOptions(sec, !!isOn);

  if(isOn && cfg.group === 'B' && cfg.bmode !== 'forbid'){ bringPaneToFront(key); updateBDimming(); }
  else if (cfg.group === 'B') { updateBDimming(); }
}

/* 레이어 placeholder */
function refreshLayerForKey(key){ const g = groups[key]; g.clearLayers(); const active = document.querySelector(`.acc-item[data-key="${key}"] .layer-toggle`)?.checked; if(!active) return; }

/* Info popover */
const INFO_CONTENT = {
  landuse:{ title:'지목', body:['포함: 농지, 산지, 잡종지, 구거, 목장용지, 염전, 양어장','표시: 필지별 색(“필지 단위 보기” ON 시 경계선)'],
    legend:[['농지','--a-land-farmland'],['산지','--a-land-forest'],['잡종지','--a-land-misc'],['구거','--a-land-ditch'],['목장용지','--a-land-ranch'],['염전','--a-land-salt'],['양어장','--a-land-fish']]},
  owner:{ title:'소유자', body:['포함: 국유지, 공유지, 개인, 법인','표시: 필지별 색(경계선 별도)'],
    legend:[['국유지','--a-own-public'],['공유지','--a-own-shared'],['개인','--a-own-private'],['법인','--a-own-corp']]},
  zoning:{ title:'용도지역', body:['생산·자연녹지, 계획/생산/보전관리, 농업보호, 자연환경보전 등'], legend:[['가능2 톤','--b-zoning']]},
  eco:{ title:'생태자연도', body:['1~3등급, 별도관리','1등급=회색(제척), 2·3·별도관리=스케일'], legend:[['2','--b-eco-2'],['3','--b-eco-3'],['별도','--b-eco-sp'],['1(제척)','FORBID']]},
  landslide:{ title:'산사태위험등급', body:['1~5등급','1·2=회색(제척), 3~5=스케일'], legend:[['3','--b-slide-3'],['4','--b-slide-4'],['5','--b-slide-5'],['1·2(제척)','FORBID']]},
  vegetation:{ title:'식생보전등급', body:['Ⅰ~Ⅲ','Ⅰ=회색(제척), Ⅱ·Ⅲ=스케일'], legend:[['Ⅱ','--b-veg-2'],['Ⅲ','--b-veg-3'],['Ⅰ(제척)','FORBID']]},
  biotope:{ title:'도시생태현황지도', body:['1~5등급','1·2=회색(제척), 3~5=스케일'], legend:[['3','--b-bio-3'],['4','--b-bio-4'],['5','--b-bio-5'],['1·2(제척)','FORBID']]},
  buffer:{ title:'이격거리', body:['대상(주거/정온/문화재/도로 등)과의 거리 제한 미리보기'], legend:[['미리보기','--b-buffer']]},
  protection:{ title:'보호지역', body:['초지, 사방지, 자연공원, 휴양림, 상수원·습지·야생생물 보호구역'], legend:[['제척','FORBID']]},
  river:{ title:'하천', body:['하천/소하천 구역'], legend:[['제척','FORBID']]},
  mountain:{ title:'산지', body:['보전산지, 백두대간보호지역, 산림보호구역'], legend:[['제척','FORBID']]}
};

let currentPopover = null;
let currentOwner = null;
let docHandler = null;
function hidePopover(){ if(currentPopover){ currentPopover.remove(); currentPopover = null; } currentOwner = null; if(docHandler){ document.removeEventListener('mousedown', docHandler); docHandler = null; } }
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

/* ===== 사이드바 바인딩 ===== */
document.querySelectorAll('.sidebar-accordion .acc-item').forEach(sec=>{
  const key = sec.dataset.key;
  const cfg = FILTER_CONFIG[key] || {};
  const headToggle = sec.querySelector('.layer-toggle');

  if(headToggle) headToggle.checked = false;
  if (cfg.group === 'A') setAllOptions(sec, false);

  const opEl   = sec.querySelector('input.op');
  const opText = sec.querySelector('.op-val');
  if(opEl && opText) opText.textContent = `${opEl.value}%`;

  sec.querySelector('.head-switch')?.addEventListener('click', ()=> openAccordion(sec));

  headToggle?.addEventListener('change', ()=>{
    const on = headToggle.checked;
    on ? openAccordion(sec) : closeAccordion(sec);
    if (cfg.group === 'B' && on) { lastActiveB = key; bringPaneToFront(key); }
    setSectionActive(sec, on);
    refreshLayerForKey(key);
    updateBDimming();
    log(`[${key}] layer`, on);
    if(key === 'landuse'){ on ? addLanduseMVT() : removeLanduseMVT(); }
  });

  const onOpacityInput = (e)=>{
    const on = headToggle?.checked;
    const v = parseInt(e.target.value,10);
    if(opText) opText.textContent = `${v}%`;
    if(on) setSectionActive(sec, true);
  };
  opEl?.addEventListener('input', onOpacityInput);
  opEl?.addEventListener('change', onOpacityInput);

  closeAccordion(sec);
  setSectionActive(sec, false);
});

/* ===== 맵 컨트롤 ===== */
document.getElementById('btnZoomIn')?.addEventListener('click', ()=> map.zoomIn());
document.getElementById('btnZoomOut')?.addEventListener('click', ()=> map.zoomOut());

let _locMarker = null;
document.getElementById('btnLocate')?.addEventListener('click', ()=>{
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

/* ===== 탭 & Report/UI ===== */
const main = document.querySelector('.app-main');
function setMainMode(key){ if(!main) return; main.classList.toggle('report-wide', key==='report'); }
const selectionBadges = L.layerGroup().addTo(map);
let REPORT_ROWS = [];

/* ======= 프로젝트 저장/로드 (DB 탭 연계) ======= */
const LS_KEY = 'autosolar_projects_v1';
let PROJECTS = [];

function loadProjects(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    PROJECTS = raw ? JSON.parse(raw) : [];
  }catch(_){ PROJECTS = []; }
}
function persistProjects(){
  try{ localStorage.setItem(LS_KEY, JSON.stringify(PROJECTS)); }catch(_){}
}
function calcTotalArea(rows){ return rows.reduce((a,r)=>a+(r?.area_m2||0),0); }
function deepCopyRows(rows){ return rows.map(r=>({ ...r, _latlng: r._latlng ? {lat:r._latlng.lat, lng:r._latlng.lng} : null })); }

function showProjectOnMap(project){
  selectionBadges.clearLayers();
  const latlngs = [];
  project.rows.forEach((row, i)=>{
    if(row._latlng){
      latlngs.push([row._latlng.lat, row._latlng.lng]);
      addNumberBadge(i+1, row._latlng);
    }
  });
  if(latlngs.length){
    const bounds = L.latLngBounds(latlngs);
    map.fitBounds(bounds, { padding:[40,40] });
  }
}

/* Report 탭 DOM (X 아이콘 제거됨) */
const reportEl = (()=>{
  const d=document.createElement('div');
  d.className='sidebar report-wrap';
  d.innerHTML = `
    <div class="report-toolbar card">
      <div class="report-actions">
        <button id="btnProjectSave" class="icon-square" title="저장"><i data-lucide="save"></i></button>
        <button id="btnProjectDelete" class="icon-square" title="삭제"><i data-lucide="trash-2"></i></button>
        <button id="btnDeedIssue" class="btn btn-primary btn-xs">등본 조회</button>
      </div>
      <div class="summary">
        <span>선택 면적 합: <b id="selSum">0</b> ㎡</span>
        <span style="margin:0 6px;color:#d1d5db">|</span>
        <span><b id="selCount">0</b>개 선택됨</span>
      </div>
    </div>
    <div class="report-table card">
      <div class="report-scroll">
        <table class="tbl compact">
          <colgroup>
            <col style="width:28px">
            <col style="width:52px">
            <col style="width:92px">
            <col>
            <col style="width:68px">
          </colgroup>
          <thead>
            <tr>
              <th><label class="chk"><input type="checkbox" id="chkAll"><i></i></label></th>
              <th>No.</th>
              <th>면적(㎡)</th>
              <th>검토 결과</th>
              <th>등본</th>
            </tr>
          </thead>
          <tbody id="reportBody"></tbody>
        </table>
      </div>
    </div>

    <!-- 저장 모달 (X 제거) -->
    <div class="modal" id="modalSave" hidden>
      <div class="modal-card">
        <div class="modal-head">
          <div class="modal-icon"><i data-lucide="folder-plus"></i></div>
        </div>
        <div class="modal-title">프로젝트 저장</div>
        <div class="modal-sub">프로젝트 이름을 입력해주세요.</div>
        <div class="modal-body">
          <label class="field">
            <input id="projName" type="text" placeholder="예) 청주_서남_1차" />
          </label>
        </div>
        <div class="modal-foot">
          <button class="btn btn-outline btn-sm" data-modal-close>취소</button>
          <button id="btnModalSave" class="btn btn-primary btn-sm">저장</button>
        </div>
      </div>
    </div>

    <!-- 등본 요약 모달 (X 제거) -->
    <div class="modal" id="modalDeedView" hidden>
      <div class="modal-card">
        <div class="modal-head">
          <div class="modal-icon"><i data-lucide="file-text"></i></div>
        </div>
        <div class="modal-title">등본 요약</div>
        <div class="modal-sub">발급 후 요약 정보를 확인하세요.</div>
        <div class="modal-body" id="deedSummary">로딩…</div>
        <div class="modal-foot">
          <button class="btn btn-primary btn-sm" data-modal-close>닫기</button>
        </div>
      </div>
    </div>
  `;
  return d;
})();

/* ===== DB 탭 DOM ===== */
function makeDbSidebar(){
  const d=document.createElement('div');
  d.className='sidebar db-wrap';
  d.innerHTML = `
    <div class="db-toolbar card">
      <div class="db-actions">
        <button id="btnDbDeleteSel" class="btn btn-sm">선택 삭제</button>
      </div>
      <div class="summary small">총 <b id="dbCount">0</b>개 프로젝트</div>
    </div>
    <div class="db-list" id="dbList"></div>
  `;
  return d;
}
const dbEl = makeDbSidebar();

/* 탭 */
const tabs = {
  filter: document.getElementById('panel-filter'),
  report: reportEl,
  db:     dbEl,
  auth:   (()=>{ const d=document.createElement('div'); d.className='sidebar'; d.innerHTML='<div class="acc-item open"><div class="acc-body"><p class="muted">로그인/SSO(추가 예정)</p></div></div>'; return d;})(),
};
document.querySelectorAll('#leftbar .i').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#leftbar .i').forEach(x=>x.classList.remove('active'));
    btn.classList.add('active');
    [...main.children].forEach(el=>{ if(el.classList && el.classList.contains('sidebar')) el.remove(); });
    const key = btn.dataset.tab;
    main.insertBefore(tabs[key], document.querySelector('.map-wrap'));
    if (window.lucide?.createIcons) { window.lucide.createIcons(); }
    setMainMode(key);
    if(key==='report') refreshTable();
    if(key==='db') renderDB();
  });
});

/* ======== MVT(지목) ======== */
function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }
function landuseColorByJimok(jimok){
  const m = { '전':'--a-land-farmland','답':'--a-land-farmland','과':'--a-land-farmland',
    '임':'--a-land-forest','임야':'--a-land-forest','잡':'--a-land-misc','잡종지':'--a-land-misc',
    '구':'--a-land-ditch','구거':'--a-land-ditch','목':'--a-land-ranch','목장':'--a-land-ranch',
    '염':'--a-land-salt','염전':'--a-land-salt','양':'--a-land-fish','양어장':'--a-land-fish', };
  const v = m[jimok] || '--a-land-misc'; return cssVar(v);
}
let landuseMVT = null;
function ensureLanduseMVT(){
  if(landuseMVT) return landuseMVT;
  const paneName = panes['landuse'];
  landuseMVT = L.vectorGrid.protobuf('/land/{z}/{x}/{y}.pbf', {
    pane: paneName,
    vectorTileLayerStyles: {
      landcategory: (props)=>{ const c = landuseColorByJimok(props?.jimok); return { fill:true, fillColor:c, fillOpacity:0.35, stroke:true, color:c, weight:0.6, opacity:0.9 }; }
    },
    interactive: true,
    maxNativeZoom: 19
  }).on('mouseover', e=>{
    const p = e.layer?.properties || {};
    const label = p.jibun || p.pnu || '지목';
    if(e.layer && e.layer.bindTooltip){ e.layer.bindTooltip(label, {sticky:true, direction:'top'}).openTooltip(); }
  });
  return landuseMVT;
}
function addLanduseMVT(){ const g = groups['landuse']; if(!g) return; const layer = ensureLanduseMVT(); layer.addTo(g); }
function removeLanduseMVT(){ const g = groups['landuse']; if(!g || !landuseMVT) return; try{ g.removeLayer(landuseMVT); }catch(_){ } }

/* ===========================
   Report 탭: 데모 로직
   =========================== */
map.on('click', (e)=>{
  const order = REPORT_ROWS.length + 1;
  const area = Math.round(400 + Math.random()*4000);
  const warnings = Math.random()>0.6 ? [{key:'eco',label:'생태 2등급'}] : [];
  const forbid   = Math.random()>0.8 ? [{key:'river',label:'하천구역'}] : [];

  REPORT_ROWS.push({
    order,
    area_m2: area,
    result:{forbid, warnings},
    _latlng: e.latlng
  });

  addNumberBadge(order, e.latlng);
  if(activeTabKey()==='report') refreshTable();
});

/* 지도 번호 배지 */
function addNumberBadge(no, latlng){
  const html = `<div class="badge">${no}</div>`;
  const icon = L.divIcon({ className:'badge-wrap', html, iconSize:[24,24], iconAnchor:[12,12] });
  L.marker(latlng, { icon }).addTo(selectionBadges);
}
function redrawBadges(){ selectionBadges.clearLayers(); REPORT_ROWS.forEach((row, idx)=>{ if(row._latlng) addNumberBadge(idx+1, row._latlng); }); }

/* 테이블 렌더링 */
function rowStatusPill(r){
  return r.result?.forbid?.length
    ? `<span class="pill-sm warn" title="${r.result.forbid.map(x=>x.label).join(', ')}"><i data-lucide="triangle-alert"></i> 불가: ${r.result.forbid.map(x=>x.label).join(', ')}</span>`
    : `<span class="pill-sm ok"><i data-lucide="check-circle"></i> 적합</span>`;
}
function makeReportTableHTML(rows){
  return rows.map((r,i)=>{
    const forbid = rowStatusPill(r);
    const deedBtns = (r.deed?.pdf_url || r.deed?.summary_url)
      ? `<div class="deed-actions">
           ${r.deed?.summary_url ? `<button class="icon-btn" data-act="view" data-idx="${i}" title="요약 보기"><i data-lucide="eye"></i></button>`:''}
           ${r.deed?.pdf_url ? `<a class="icon-btn" href="${r.deed.pdf_url}" download title="PDF 다운로드"><i data-lucide="arrow-down-to-line"></i></a>`:''}
         </div>`
      : `<span class="muted">-</span>`;
    return `
      <tr>
        <td><label class="chk"><input type="checkbox" data-row="${i}"><i></i></label></td>
        <td class="mono">${i+1}</td>
        <td class="num">${(r.area_m2||0).toLocaleString()}</td>
        <td>${forbid}</td>
        <td class="deed-cell">${deedBtns}</td>
      </tr>`;
  }).join('');
}
function refreshTable(){
  const tbody = document.getElementById('reportBody');
  if(!tbody) return;
  REPORT_ROWS.forEach((r, i)=> r.order = i+1);
  tbody.innerHTML = makeReportTableHTML(REPORT_ROWS);
  if (window.lucide?.createIcons) { window.lucide.createIcons(); }
  updateSelSummary();
}

/* 선택 요약(면적 합 + 개수) */
function updateSelSummary(){
  const body = document.getElementById('reportBody');
  if(!body) return;
  const idxs = [...body.querySelectorAll('input[type="checkbox"]:checked')].map(ch=> +ch.dataset.row);
  const sum = idxs.reduce((acc,i)=> acc + (REPORT_ROWS[i]?.area_m2||0), 0);
  const elCnt = document.getElementById('selCount');
  const elSum = document.getElementById('selSum');
  if(elCnt) elCnt.textContent = idxs.length.toString();
  if(elSum) elSum.textContent = sum.toLocaleString();
}

/* ===== DB 탭 렌더링 ===== */
function renderDB(){
  const list = document.getElementById('dbList');
  const cnt = document.getElementById('dbCount');
  if(!list || !cnt) return;
  cnt.textContent = PROJECTS.length.toString();

  if(PROJECTS.length===0){
    list.innerHTML = `<div class="empty muted">저장된 프로젝트가 없습니다.</div>`;
    return;
  }

  list.innerHTML = PROJECTS.map((p, idx)=>{
    const total = calcTotalArea(p.rows).toLocaleString();
    return `
    <div class="db-card" data-pidx="${idx}">
      <div class="db-head">
        <label class="chk"><input type="checkbox" class="db-chk" data-pidx="${idx}"><i></i></label>
        <div class="db-title">
          <div class="proj-name">${p.name}</div>
          <div class="proj-sub muted">총 면적 ${total} ㎡ · ${p.rows.length}개 필지</div>
        </div>
        <button class="db-toggle" title="열기/닫기"><i data-lucide="chevron-down"></i></button>
      </div>
      <div class="db-body" hidden>
        <div class="report-table card">
          <div class="report-scroll">
            <table class="tbl compact">
              <colgroup>
                <col style="width:28px">
                <col style="width:52px">
                <col style="width:92px">
                <col>
                <col style="width:68px">
              </colgroup>
              <thead>
                <tr>
                  <th></th>
                  <th>No.</th>
                  <th>면적(㎡)</th>
                  <th>검토 결과</th>
                  <th>등본</th>
                </tr>
              </thead>
              <tbody>${makeReportTableHTML(p.rows)}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  if (window.lucide?.createIcons) { window.lucide.createIcons(); }
}

/* 테이블/모달/DB 이벤트 */
document.addEventListener('change',(e)=>{
  if(e.target.id==='chkAll'){
    document.querySelectorAll('#reportBody input[type="checkbox"]').forEach(ch=> ch.checked = e.target.checked);
    updateSelSummary();
  }
  if(e.target.matches('#reportBody input[type="checkbox"]')) updateSelSummary();
});

document.addEventListener('click',(e)=>{
  // ===== Report: 삭제 =====
  if(e.target.closest('#btnProjectDelete')){
    const ids = [...document.querySelectorAll('#reportBody input[type="checkbox"]:checked')].map(ch=>+ch.dataset.row);
    if(!ids.length) return alert('삭제할 필지를 선택하세요.');
    REPORT_ROWS = REPORT_ROWS.filter((_, idx)=> !ids.includes(idx));
    refreshTable();
    redrawBadges();
  }

  // ===== Report: 저장 모달 열기 =====
  if(e.target.closest('#btnProjectSave')){
    openModal('modalSave');
    setTimeout(()=> document.getElementById('projName').focus(), 50);
  }

  // ===== Report: 저장 실행 → DB에 추가 =====
  if(e.target.closest('#btnModalSave')){
    const name = document.getElementById('projName').value.trim();
    if(!name) return alert('프로젝트 이름을 입력해주세요.');
    const rowsCopy = deepCopyRows(REPORT_ROWS);
    const proj = {
      id: Date.now(),
      name,
      rows: rowsCopy,
      createdAt: new Date().toISOString()
    };
    PROJECTS.push(proj);
    persistProjects();
    log('프로젝트 저장(프론트 더미)', {name, items:rowsCopy.length});
    closeModal('modalSave');
    alert('저장되었습니다.');
    // DB 탭이 열려있다면 즉시 갱신
    if(activeTabKey()==='db') renderDB();
  }

  // ===== Report: 등본 조회(발급 연결 지점) =====
  if(e.target.closest('#btnDeedIssue')){
    const idxs = [...document.querySelectorAll('#reportBody input[type="checkbox"]:checked')].map(ch=>+ch.dataset.row);
    if(!idxs.length) return alert('등본을 조회할 필지를 선택하세요.');
    idxs.forEach(i=>{
      REPORT_ROWS[i].deed = { pdf_url:'#', summary_url:'#summary' };
    });
    refreshTable();
  }

  // ===== Report: 요약 보기 =====
  const btnView = e.target.closest('.icon-btn[data-act="view"]');
  if(btnView){
    const idx = +btnView.dataset.idx;
    const row = REPORT_ROWS[idx];
    const html = `
      <div class="kv"><span class="k">면적</span><span class="v">${row.area_m2.toLocaleString()} ㎡</span></div>
      <div class="kv"><span class="k">검토</span><span class="v">${row.result?.forbid?.length ? '불가: '+row.result.forbid.map(x=>x.label).join(', ') : '적합'}</span></div>
    `;
    document.getElementById('deedSummary').innerHTML = html;
    openModal('modalDeedView');
  }

  // ===== 공통: 모달 닫기 =====
  if(e.target.matches('[data-modal-close]')) {
    const modal = e.target.closest('.modal');
    if(modal) modal.hidden = true;
  }

  // ===== DB: 카드 토글 / 지도 재표시 =====
  const card = e.target.closest('.db-card');
  if(card && (e.target.closest('.db-toggle') || e.target.closest('.db-head .proj-name') || e.target.closest('.db-head') )){
    const body = card.querySelector('.db-body');
    const pidx = +card.dataset.pidx;
    const opened = body.hasAttribute('hidden') ? false : true;
    if(opened){ body.setAttribute('hidden',''); }
    else { body.removeAttribute('hidden'); showProjectOnMap(PROJECTS[pidx]); }
  }

  // ===== DB: 선택 삭제 =====
  if(e.target.closest('#btnDbDeleteSel')){
    const ids = [...document.querySelectorAll('.db-chk:checked')].map(ch=> +ch.dataset.pidx);
    if(!ids.length) return alert('삭제할 프로젝트를 선택하세요.');
    const keep = PROJECTS.filter((_, idx)=> !ids.includes(idx));
    PROJECTS = keep;
    persistProjects();
    renderDB();
    // 지도 배지 정리
    selectionBadges.clearLayers();
  }
});

/* 모달 유틸 */
function openModal(id){ const el = document.getElementById(id); if(el) el.hidden = false; }
function closeModal(id){ const el = document.getElementById(id); if(el) el.hidden = true; }

/* 유틸 */
function activeTabKey(){ const btn = document.querySelector('#leftbar .i.active'); return btn?.dataset?.tab || 'filter'; }

/* 초기화: 프로젝트 불러오기 */
loadProjects();
