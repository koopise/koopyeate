/* ===== Koopyeate Whiteboard — app.js ===== */
(function(){

/* ============================================================
   MODE TRACKING (for per-mode undo history routing)
   ============================================================ */
let currentMode = 'board'; // 'board' | 'doc' | 'slides' | 'photobooth'

document.querySelectorAll('.app-tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.app-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.app-view').forEach(v=>v.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.view).classList.add('active');
    const viewToMode = {'board-view':'board','doc-view':'doc','slides-view':'slides','photobooth-view':'photobooth'};
    currentMode = viewToMode[tab.dataset.view] || 'board';
    if(tab.dataset.view==='photobooth-view'){ initPhotoboothCamera(); }
    else { stopPhotoboothCamera(); }
  });
});

/* ============================================================
   KEYBINDS
   ============================================================ */
const DEFAULT_KEYBINDS = {
  select:'v', pen:'p', eraser:'e', sticky:'n', image:'i', camera:'c',
  table:'t', rect:'r', diamond:'d', circle:'o', connector:'l', mindmap:'m',
  undo:'ctrl+z', duplicate:'ctrl+d', clear:'ctrl+shift+x', save:'ctrl+s', load:'ctrl+o', png:'ctrl+e', pdf:'ctrl+p'
};
const ACTION_LABELS = {
  select:'Select / Move', pen:'Pen', eraser:'Eraser', sticky:'Sticky note', image:'Add image',
  camera:'Open Photobooth tab', table:'Add table', rect:'Flowchart rectangle', diamond:'Flowchart diamond',
  circle:'Flowchart circle', connector:'Connector arrow', mindmap:'Mind map node',
  undo:'Undo (current tab)', duplicate:'Duplicate selected', clear:'Clear board', save:'Export .json', load:'Import .json', png:'Export PNG', pdf:'Export PDF'
};
let keybinds = JSON.parse(localStorage.getItem('wb_keybinds')||'null') || Object.assign({}, DEFAULT_KEYBINDS);
function saveKeybinds(){ localStorage.setItem('wb_keybinds', JSON.stringify(keybinds)); }
function normalizeKeyEvent(e){
  const parts=[];
  if(e.ctrlKey||e.metaKey) parts.push('ctrl');
  if(e.shiftKey) parts.push('shift');
  if(e.altKey) parts.push('alt');
  let k = e.key.toLowerCase();
  if(k===' ') k='space';
  if(!['control','shift','alt','meta'].includes(k)) parts.push(k);
  return parts.join('+');
}
function renderKeybindPanel(){
  const list = document.getElementById('keybind-list');
  list.innerHTML='';
  Object.keys(ACTION_LABELS).forEach(action=>{
    const row=document.createElement('div'); row.className='keybind-row';
    const label=document.createElement('span'); label.textContent=ACTION_LABELS[action];
    const input=document.createElement('input');
    input.value=(keybinds[action]||'').toUpperCase(); input.readOnly=true;
    input.addEventListener('click', ()=>{
      document.querySelectorAll('.keybind-row input').forEach(i=>i.classList.remove('listening'));
      input.classList.add('listening'); input.value='...';
      function onKey(e){
        e.preventDefault();
        const combo = normalizeKeyEvent(e);
        if(!combo) return;
        keybinds[action]=combo; input.value=combo.toUpperCase();
        input.classList.remove('listening'); saveKeybinds();
        document.removeEventListener('keydown', onKey, true);
      }
      document.addEventListener('keydown', onKey, true);
    });
    row.appendChild(label); row.appendChild(input); list.appendChild(row);
  });
}
document.getElementById('settings-btn').addEventListener('click', ()=>{ renderKeybindPanel(); document.getElementById('settings-overlay').classList.add('active'); });
document.getElementById('settings-close').addEventListener('click', ()=>document.getElementById('settings-overlay').classList.remove('active'));
document.getElementById('settings-reset').addEventListener('click', ()=>{ keybinds=Object.assign({},DEFAULT_KEYBINDS); saveKeybinds(); renderKeybindPanel(); });
function actionForCombo(combo){ return Object.keys(keybinds).find(a=>keybinds[a]===combo); }

/* ============================================================
   TOOL GROUP FLYOUTS
   ============================================================ */
['draw','content','flow','actions','file'].forEach(g=>{
  const toggle = document.getElementById('grp-'+g+'-toggle');
  const flyout = document.getElementById('grp-'+g+'-flyout');
  toggle.addEventListener('click', e=>{
    e.stopPropagation();
    const isOpen = flyout.classList.contains('open');
    document.querySelectorAll('.group-flyout').forEach(f=>f.classList.remove('open'));
    document.querySelectorAll('.group-toggle').forEach(t=>t.classList.remove('expanded'));
    if(!isOpen){ flyout.classList.add('open'); toggle.classList.add('expanded'); }
  });
});
document.addEventListener('click', ()=>{
  document.querySelectorAll('.group-flyout').forEach(f=>f.classList.remove('open'));
  document.querySelectorAll('.group-toggle').forEach(t=>t.classList.remove('expanded'));
  document.getElementById('table-ctx-menu').classList.remove('open');
});

/* ============================================================
   BOARD CORE
   ============================================================ */
const boardWrap = document.getElementById('board-wrap');
const canvasLayer = document.getElementById('canvas-layer');
const drawCanvas = document.getElementById('draw-canvas');
const ctx = drawCanvas.getContext('2d');
const zoomLabel = document.getElementById('zoomLabel');
const hint = document.getElementById('hint');
const selectionBox = document.getElementById('selection-box');
const tableCtxMenu = document.getElementById('table-ctx-menu');

let scale = 1, panX = 0, panY = 0;
let currentTool = 'select';
let items = [];
let connectors = [];
let strokes = [];
let selectedIds = [];
let idCounter = 1;
let history = []; // BOARD history
let connectorPending = null;
let pendingTablePos = null;
let ctxMenuTableId = null;

const STORAGE_KEY = 'wb_board_state_v4';

function pushHistory(){ history.push(JSON.stringify({items, strokes, connectors})); if(history.length>50) history.shift(); }
function saveLocal(){ localStorage.setItem(STORAGE_KEY, JSON.stringify({items, strokes, connectors, panX, panY, scale})); }
function loadLocal(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw) return;
  try{
    const data = JSON.parse(raw);
    items = data.items || []; strokes = data.strokes || []; connectors = data.connectors || [];
    panX = data.panX || 0; panY = data.panY || 0; scale = data.scale || 1;
    idCounter = items.reduce((m,it)=>Math.max(m, parseInt((it.id.split('_')[1]||0))+1), 1);
    renderAll(); applyTransform();
  }catch(e){ console.warn('load failed', e); }
}
function applyTransform(){
  canvasLayer.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  zoomLabel.textContent = Math.round(scale*100) + '%';
}
function redrawStrokes(){
  ctx.clearRect(0,0,drawCanvas.width, drawCanvas.height);
  strokes.forEach(s=>{
    if(s.points.length < 2) return;
    ctx.strokeStyle = s.color; ctx.lineWidth = s.size;
    ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(s.points[0].x, s.points[0].y);
    for(let i=1;i<s.points.length;i++) ctx.lineTo(s.points[i].x, s.points[i].y);
    ctx.stroke();
  });
  connectors.forEach(c=>{
    const a = items.find(i=>i.id===c.fromId), b = items.find(i=>i.id===c.toId);
    if(!a||!b) return;
    const ax=a.x+a.w/2, ay=a.y+a.h/2, bx=b.x+b.w/2, by=b.y+b.h/2;
    ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by); ctx.stroke();
    const angle = Math.atan2(by-ay, bx-ax); const hs=10;
    ctx.beginPath(); ctx.moveTo(bx, by);
    ctx.lineTo(bx-hs*Math.cos(angle-0.4), by-hs*Math.sin(angle-0.4));
    ctx.lineTo(bx-hs*Math.cos(angle+0.4), by-hs*Math.sin(angle+0.4));
    ctx.closePath(); ctx.fillStyle='#555'; ctx.fill();
  });
}

function renderAll(){
  document.querySelectorAll('.item').forEach(el=>el.remove());
  items.filter(i=>i.type==='sheet').forEach(renderItem);
  items.filter(i=>i.type!=='sheet').forEach(renderItem);
  redrawStrokes();
  if(typeof layersPanel!=='undefined' && layersPanel.classList.contains('open')) renderLayersPanel();
}

function renderItem(item){
  const el = document.createElement('div');
  el.dataset.id = item.id;
  el.style.left = item.x+'px'; el.style.top = item.y+'px';
  el.style.width = item.w+'px'; el.style.height = item.h+'px';

  if(item.type==='sheet'){
    el.className='item board-sheet';
    const label=document.createElement('div'); label.className='sheet-label'; label.textContent=item.label||'Sheet';
    el.appendChild(label);
  } else if(item.type==='sticky'){
    el.className='item sticky';
    el.style.background = item.color || '#fff8b0';
    el.contentEditable=false; el.innerText = item.text||'';
    el.addEventListener('dblclick', e=>{ el.contentEditable=true; el.focus(); e.stopPropagation(); });
    el.addEventListener('blur', ()=>{ el.contentEditable=false; item.text=el.innerText; saveLocal(); });
  } else if(item.type==='image'){
    el.className='item img-item';
    const img=document.createElement('img'); img.src=item.src; img.draggable=false;
    el.appendChild(img);
  } else if(item.type==='table'){
    el.className='item table-item';
    buildTable(el, item);
  } else if(item.type==='flow'){
    el.className='item flow-node shape-'+item.shape;
    el.contentEditable=false; el.innerText = item.text||'';
    el.addEventListener('dblclick', e=>{ el.contentEditable=true; el.focus(); e.stopPropagation(); });
    el.addEventListener('blur', ()=>{ el.contentEditable=false; item.text=el.innerText; saveLocal(); });
    ['t','b','l','r'].forEach(pos=>{
      const anchor=document.createElement('div');
      anchor.className='flow-anchor anchor-'+pos;
      anchor.addEventListener('mousedown', e=>{ e.stopPropagation(); startConnectorDrag(item.id); });
      el.appendChild(anchor);
    });
  }

  if(item.type!=='sheet'){
    const delH = document.createElement('div');
    delH.className='del-handle'; delH.innerHTML='&times;';
    delH.addEventListener('mousedown', e=>e.stopPropagation());
    delH.addEventListener('click', e=>{
      e.stopPropagation();
      deleteItemsToTrash([item.id]);
    });
    el.appendChild(delH);

    const dupH = document.createElement('div');
    dupH.className='dup-handle'; dupH.innerHTML='&#10697;';
    dupH.title='Duplicate';
    dupH.addEventListener('mousedown', e=>e.stopPropagation());
    dupH.addEventListener('click', e=>{ e.stopPropagation(); duplicateItems([item.id]); });
    el.appendChild(dupH);

    const resizeH = document.createElement('div');
    resizeH.className='resize-handle';
    resizeH.addEventListener('mousedown', e=>startResizeItem(e,item,el));
    el.appendChild(resizeH);
  } else {
    const resizeH = document.createElement('div');
    resizeH.className='resize-handle';
    resizeH.style.display='block';
    resizeH.addEventListener('mousedown', e=>startResizeItem(e,item,el));
    el.appendChild(resizeH);
  }

  el.addEventListener('mousedown', e=>startDragItem(e,item,el));
  canvasLayer.appendChild(el);
}

/* ---------- TABLE: click = context menu, dblclick cell = edit ---------- */
function buildTable(el, item){
  el.innerHTML='';
  const tbl = document.createElement('table');
  for(let r=0;r<item.rows;r++){
    const tr = document.createElement('tr');
    for(let c=0;c<item.cols;c++){
      const td = document.createElement('td');
      td.contentEditable = false;
      td.innerText = (item.data && item.data[r] && item.data[r][c]) ? item.data[r][c] : '';
      td.addEventListener('mousedown', e=>e.stopPropagation());
      td.addEventListener('dblclick', e=>{
        e.stopPropagation();
        tableCtxMenu.classList.remove('open');
        td.contentEditable = true;
        td.classList.add('cell-editing');
        td.focus();
        document.execCommand('selectAll', false, null);
      });
      td.addEventListener('blur', ()=>{
        td.contentEditable = false;
        td.classList.remove('cell-editing');
        if(!item.data) item.data=[];
        if(!item.data[r]) item.data[r]=[];
        item.data[r][c]=td.innerText;
        pushHistory(); saveLocal();
      });
      td.addEventListener('keydown', e=>{
        if(e.key==='Escape'){ td.blur(); }
      });
      tr.appendChild(td);
    }
    tbl.appendChild(tr);
  }
  el.appendChild(tbl);

  // Single click on the table (not while dragging, not on a cell being edited) opens the context menu.
  el.addEventListener('click', e=>{
    if(e.target.tagName==='TD' && e.target.isContentEditable) return;
    if(currentTool!=='select') return;
    e.stopPropagation();
    openTableContextMenu(item.id, e.clientX, e.clientY);
  });
}

function openTableContextMenu(tableId, clientX, clientY){
  ctxMenuTableId = tableId;
  setSelection([tableId]);
  tableCtxMenu.style.left = Math.min(clientX, window.innerWidth-190) + 'px';
  tableCtxMenu.style.top = Math.min(clientY, window.innerHeight-260) + 'px';
  tableCtxMenu.classList.add('open');
}

tableCtxMenu.addEventListener('mousedown', e=>e.stopPropagation());
tableCtxMenu.addEventListener('click', e=>{
  const btn = e.target.closest('button[data-tact]');
  if(!btn) return;
  e.stopPropagation();
  const item = items.find(i=>i.id===ctxMenuTableId);
  if(!item){ tableCtxMenu.classList.remove('open'); return; }
  const act = btn.dataset.tact;
  if(act==='addRow'){ item.rows++; if(item.data) item.data.push([]); }
  else if(act==='delRow'){ if(item.rows>1){ item.rows--; if(item.data) item.data.pop(); } }
  else if(act==='addCol'){ item.cols++; }
  else if(act==='delCol'){ if(item.cols>1){ item.cols--; if(item.data) item.data.forEach(row=>row.pop()); } }
  else if(act==='duplicate'){ duplicateItems([item.id]); tableCtxMenu.classList.remove('open'); return; }
  else if(act==='delete'){ deleteItemsToTrash([item.id]); tableCtxMenu.classList.remove('open'); return; }
  tableCtxMenu.classList.remove('open');
  pushHistory(); renderAll(); saveLocal();
});

function setSelection(ids){
  selectedIds = ids;
  document.querySelectorAll('.item').forEach(el=>{
    el.classList.toggle('selected', selectedIds.length===1 && el.dataset.id===selectedIds[0]);
    el.classList.toggle('multi-selected', selectedIds.length>1 && selectedIds.includes(el.dataset.id));
  });
  if(typeof layersPanel!=='undefined' && layersPanel.classList.contains('open')) renderLayersPanel();
}
function deselectAll(){ setSelection([]); }

function duplicateItems(ids){
  const newIds = [];
  ids.forEach(id=>{
    const orig = items.find(i=>i.id===id);
    if(!orig) return;
    const copy = JSON.parse(JSON.stringify(orig));
    copy.id = 'item_'+idCounter++;
    copy.x += 24; copy.y += 24;
    items.push(copy); newIds.push(copy.id);
  });
  pushHistory(); renderAll(); saveLocal();
  setSelection(newIds);
}

function startDragItem(e, item, el){
  if(currentTool!=='select') return;
  e.stopPropagation();

  if(e.altKey){
    duplicateItems(selectedIds.includes(item.id) ? selectedIds : [item.id]);
    const dragIds = selectedIds;
    const startX=e.clientX, startY=e.clientY;
    const origins = dragIds.map(id=>{ const it=items.find(i=>i.id===id); return {id, x:it.x, y:it.y}; });
    function onMove(ev){
      const dx=(ev.clientX-startX)/scale, dy=(ev.clientY-startY)/scale;
      origins.forEach(o=>{ const it=items.find(i=>i.id===o.id); it.x=o.x+dx; it.y=o.y+dy; });
      renderAll();
    }
    function onUp(){ document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); pushHistory(); saveLocal(); }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
    return;
  }

  if(!selectedIds.includes(item.id)) setSelection([item.id]);
  const dragIds = selectedIds.length ? selectedIds : [item.id];
  const startX=e.clientX, startY=e.clientY;
  const origins = dragIds.map(id=>{ const it=items.find(i=>i.id===id); return {id, x:it.x, y:it.y}; });
  let moved = false;
  function onMove(ev){
    const dx=(ev.clientX-startX)/scale, dy=(ev.clientY-startY)/scale;
    if(Math.abs(dx)>2||Math.abs(dy)>2) moved = true;
    origins.forEach(o=>{
      const it=items.find(i=>i.id===o.id);
      it.x=o.x+dx; it.y=o.y+dy;
      const domEl = document.querySelector(`.item[data-id="${o.id}"]`);
      if(domEl){ domEl.style.left=it.x+'px'; domEl.style.top=it.y+'px'; }
    });
    redrawStrokes();
  }
  function onUp(){
    document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
    if(moved){ pushHistory(); saveLocal(); }
  }
  document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
}

function startResizeItem(e, item, el){
  e.stopPropagation(); e.preventDefault();
  const startX=e.clientX, startY=e.clientY, origW=item.w, origH=item.h;
  const aspect = origW/origH;
  function onMove(ev){
    const dx=(ev.clientX-startX)/scale, dy=(ev.clientY-startY)/scale;
    if(ev.shiftKey){
      const delta = Math.abs(dx)>Math.abs(dy) ? dx : dy;
      item.w=Math.max(60, origW+delta);
      item.h=Math.max(40, item.w/aspect);
    } else {
      item.w=Math.max(60, origW+dx); item.h=Math.max(40, origH+dy);
    }
    el.style.width=item.w+'px'; el.style.height=item.h+'px';
    if(item.type==='table') buildTable(el, item);
  }
  function onUp(){ document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); pushHistory(); saveLocal(); }
  document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
}

function startConnectorDrag(fromId){
  connectorPending = fromId;
  hint.textContent = 'Click a target node to connect...'; hint.style.opacity='1';
}

function screenToCanvas(clientX, clientY){
  const rect = boardWrap.getBoundingClientRect();
  return { x:(clientX-rect.left-panX)/scale, y:(clientY-rect.top-panY)/scale };
}

function addSticky(x,y){
  const item={id:'item_'+idCounter++, type:'sticky', x:x-90,y:y-60,w:180,h:120,text:'New note...',color:'#fff8b0'};
  items.push(item); pushHistory(); renderAll(); saveLocal();
  setTimeout(()=>{ const el=document.querySelector(`.item[data-id="${item.id}"]`);
    if(el){ el.contentEditable=true; el.focus(); document.execCommand('selectAll',false,null); } },30);
}

function addImage(src,x,y,natW,natH){
  const maxDim=360; let w=natW,h=natH;
  if(w>maxDim||h>maxDim){ const ratio=Math.min(maxDim/w,maxDim/h); w*=ratio; h*=ratio; }
  const item={id:'item_'+idCounter++, type:'image', x:x-w/2,y:y-h/2,w,h,src};
  items.push(item); pushHistory(); renderAll(); saveLocal();
}

function addTable(x,y,rows,cols){
  const w = Math.max(200, cols*90), h = Math.max(100, rows*36+30);
  const item={id:'item_'+idCounter++, type:'table', x:x-w/2,y:y-h/2,w,h,rows,cols,data:[]};
  items.push(item); pushHistory(); renderAll(); saveLocal();
}

function addFlowNode(shape,x,y,text){
  const w = shape==='mindnode'?140:120, h= shape==='mindnode'?60:80;
  const item={id:'item_'+idCounter++, type:'flow', shape, x:x-w/2, y:y-h/2, w, h, text: text||(shape==='mindnode'?'Idea':'Step')};
  items.push(item); pushHistory(); renderAll(); saveLocal();
}

function loadImageFile(file, dropX, dropY){
  const reader = new FileReader();
  reader.onload = e=>{
    const img=new Image();
    img.onload=()=>addImage(e.target.result, dropX, dropY, img.width, img.height);
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

/* ============================================================
   PLACEABLE SHEETS
   ============================================================ */
const SHEET_SIZES = {
  'presentation': {w:1600, h:900, label:'Presentation 16:9'},
  'a4-portrait': {w:1240, h:1754, label:'A4 Portrait'},
  'a4-landscape': {w:1754, h:1240, label:'A4 Landscape'},
  'square': {w:1200, h:1200, label:'Square 1:1'}
};
document.getElementById('btn-place-sheet').addEventListener('click', ()=>{
  const key = document.getElementById('board-size-select').value;
  let size;
  if(key==='custom'){
    const w = parseInt(prompt('Sheet width (px):','1200'))||1200;
    const h = parseInt(prompt('Sheet height (px):','800'))||800;
    size = {w,h,label:'Custom '+w+'\u00d7'+h};
  } else size = SHEET_SIZES[key];
  const c = screenToCanvas(innerWidth/2, innerHeight/2);
  const item = {id:'item_'+idCounter++, type:'sheet', x:c.x-size.w/2, y:c.y-size.h/2, w:size.w, h:size.h, label:size.label};
  items.push(item); pushHistory(); renderAll(); saveLocal();
});

/* ============================================================
   TABLE SIZE PROMPT
   ============================================================ */
const tablePromptOverlay = document.getElementById('table-prompt-overlay');
document.getElementById('tool-table').addEventListener('click', () => tablePromptOverlay.classList.add('active'));
document.getElementById('table-prompt-create').addEventListener('click', () => {
  const rows = Math.max(1, parseInt(document.getElementById('table-rows-input').value)||3);
  const cols = Math.max(1, parseInt(document.getElementById('table-cols-input').value)||3);
  tablePromptOverlay.classList.remove('active');
  const c = pendingTablePos || screenToCanvas(innerWidth/2, innerHeight/2);
  addTable(c.x, c.y, rows, cols);
  resetToSelect();
});

/* ============================================================
   ACTIONS
   ============================================================ */
function runAction(action){
  switch(action){
    case 'select': case 'pen': case 'eraser': case 'sticky': case 'image':
    case 'table': case 'rect': case 'diamond': case 'circle': case 'connector': case 'mindmap':
      setTool(action); break;
    case 'camera':
      document.querySelector('.app-tab[data-view="photobooth-view"]').click();
      break;
    case 'undo': undoForMode(currentMode); break;
    case 'duplicate': if(selectedIds.length) duplicateItems(selectedIds); break;
    case 'clear':
      if(confirm('Clear the entire board?')){ pushHistory(); items=[]; strokes=[]; connectors=[]; renderAll(); saveLocal(); }
      break;
    case 'save': exportJSON(); break;
    case 'load': document.getElementById('fileInput').click(); break;
    case 'png': exportPNG(); break;
    case 'pdf': exportPDF(); break;
    case 'pptx': exportBoardPPTX(); break;
  }
}

function exportBoardPPTX(){
  renderToCanvas(out=>{
    const pptx = new PptxGenJS();
    const wIn = out.width/96, hIn = out.height/96;
    pptx.defineLayout({name:'BOARD', width:wIn, height:hIn});
    pptx.layout='BOARD';
    const slide = pptx.addSlide();
    slide.addImage({data: out.toDataURL('image/png'), x:0, y:0, w:wIn, h:hIn});
    pptx.writeFile({fileName:'whiteboard-export.pptx'});
  });
}

function setTool(tool){
  if(tool==='image'){ document.getElementById('imageInput').click(); return; }
  if(tool==='table'){ document.getElementById('tool-table').click(); return; }
  currentTool = tool;
  document.querySelectorAll('#toolbar .tool-btn').forEach(b=>b.classList.remove('active'));
  const btn = document.getElementById('tool-'+tool);
  if(btn) btn.classList.add('active');
  boardWrap.style.cursor = tool==='select' ? 'grab' : (['pen','eraser'].includes(tool)?'crosshair':'copy');
  if(tool!=='connector'){ connectorPending=null; hint.textContent='Paste image (Ctrl/Cmd+V) \u2022 Drag empty space to pan \u2022 Shift+drag to box-select \u2022 Alt+drag or Ctrl+D to duplicate'; }
}

document.querySelectorAll('#toolbar .tool-btn[data-action]').forEach(btn=>{
  btn.addEventListener('click', ()=>runAction(btn.dataset.action));
});

document.getElementById('imageInput').addEventListener('change', e=>{
  const file=e.target.files[0];
  if(file){ const c=screenToCanvas(innerWidth/2, innerHeight/2); loadImageFile(file, c.x, c.y); }
  e.target.value='';
});

function exportJSON(){
  const data=JSON.stringify({items,strokes,connectors,panX,panY,scale},null,2);
  const blob=new Blob([data],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='whiteboard-'+new Date().toISOString().slice(0,10)+'.json'; a.click();
}

document.getElementById('fileInput').addEventListener('change', e=>{
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const data=JSON.parse(ev.target.result);
      items=data.items||[]; strokes=data.strokes||[]; connectors=data.connectors||[];
      panX=data.panX||0; panY=data.panY||0; scale=data.scale||1;
      idCounter = items.reduce((m,it)=>Math.max(m, parseInt((it.id.split('_')[1]||0))+1), 1);
      renderAll(); applyTransform(); saveLocal();
    }catch(err){ alert('Invalid board file.'); }
  };
  reader.readAsText(file); e.target.value='';
});

function computeBounds(){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  items.forEach(it=>{ minX=Math.min(minX,it.x); minY=Math.min(minY,it.y); maxX=Math.max(maxX,it.x+it.w); maxY=Math.max(maxY,it.y+it.h); });
  strokes.forEach(s=>s.points.forEach(p=>{ minX=Math.min(minX,p.x); minY=Math.min(minY,p.y); maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y); }));
  if(minX===Infinity){ minX=0;minY=0;maxX=800;maxY=600; }
  const pad=40; return {minX:minX-pad, minY:minY-pad, maxX:maxX+pad, maxY:maxY+pad};
}

function renderToCanvas(callback){
  const b = computeBounds();
  const w=b.maxX-b.minX, h=b.maxY-b.minY;
  const out=document.createElement('canvas'); out.width=w; out.height=h;
  const octx=out.getContext('2d');
  octx.fillStyle='#f4f4f2'; octx.fillRect(0,0,w,h);
  items.filter(it=>it.type==='sheet').forEach(it=>{
    octx.fillStyle='#fff'; octx.fillRect(it.x-b.minX, it.y-b.minY, it.w, it.h);
  });
  octx.drawImage(drawCanvas, b.minX, b.minY, w, h, 0, 0, w, h);
  const imgItems = items.filter(it=>it.type==='image');
  let pending = imgItems.length;
  items.filter(it=>it.type==='sticky'||it.type==='flow').forEach(it=>{
    octx.fillStyle = it.color || (it.type==='flow'?'#e8f0ff':'#fff8b0');
    octx.fillRect(it.x-b.minX, it.y-b.minY, it.w, it.h);
    octx.fillStyle='#222'; octx.font='14px sans-serif';
    wrapText(octx, it.text||'', it.x-b.minX+8, it.y-b.minY+18, it.w-16, 18);
  });
  items.filter(it=>it.type==='table').forEach(it=>{
    octx.strokeStyle='#ccc'; octx.strokeRect(it.x-b.minX, it.y-b.minY, it.w, it.h);
  });
  if(pending===0){ callback(out); return; }
  imgItems.forEach(it=>{
    const im=new Image();
    im.onload=()=>{ octx.drawImage(im, it.x-b.minX, it.y-b.minY, it.w, it.h); pending--; if(pending===0) callback(out); };
    im.src=it.src;
  });
}

function wrapText(ctx,text,x,y,maxWidth,lineHeight){
  const words=text.split(' '); let line='';
  for(let n=0;n<words.length;n++){
    const testLine=line+words[n]+' ';
    if(ctx.measureText(testLine).width>maxWidth && n>0){ ctx.fillText(line,x,y); line=words[n]+' '; y+=lineHeight; }
    else line=testLine;
  }
  ctx.fillText(line,x,y);
}

function exportPNG(){
  renderToCanvas(out=>{ const a=document.createElement('a'); a.href=out.toDataURL('image/png'); a.download='whiteboard-export.png'; a.click(); });
}
function exportPDF(){
  renderToCanvas(out=>{
    const { jsPDF } = window.jspdf;
    const orientation = out.width>out.height ? 'l':'p';
    const pdf = new jsPDF({orientation, unit:'px', format:[out.width, out.height]});
    pdf.addImage(out.toDataURL('image/png'), 'PNG', 0, 0, out.width, out.height);
    pdf.save('whiteboard-export.pdf');
  });
}

/* ---------- BOARD UNDO ---------- */
function undoBoard(){
  if(history.length<2) return;
  history.pop();
  const prev=JSON.parse(history[history.length-1]);
  items=prev.items; strokes=prev.strokes; connectors=prev.connectors||[];
  renderAll(); saveLocal();
}

/* ============================================================
   TRASH BIN (board only)
   ============================================================ */
let trashBin = JSON.parse(localStorage.getItem('wb_trash')||'[]');
function saveTrash(){ localStorage.setItem('wb_trash', JSON.stringify(trashBin)); }

function deleteItemsToTrash(ids){
  ids.forEach(id=>{
    const it = items.find(i=>i.id===id);
    if(it) trashBin.unshift({item: JSON.parse(JSON.stringify(it)), deletedAt: Date.now()});
  });
  if(trashBin.length>50) trashBin = trashBin.slice(0,50);
  saveTrash();
  items = items.filter(it=>!ids.includes(it.id));
  connectors = connectors.filter(c=>!ids.includes(c.fromId) && !ids.includes(c.toId));
  selectedIds = selectedIds.filter(id=>!ids.includes(id));
  pushHistory(); renderAll(); saveLocal();
  if(typeof trashListEl!=='undefined') renderTrashList();
}

function restoreFromTrash(trashIdx){
  const entry = trashBin[trashIdx];
  if(!entry) return;
  const copy = JSON.parse(JSON.stringify(entry.item));
  copy.id = 'item_'+idCounter++;
  items.push(copy);
  trashBin.splice(trashIdx,1);
  saveTrash(); pushHistory(); renderAll(); saveLocal(); renderTrashList();
}

function itemLabel(it){
  if(it.type==='sticky') return '\ud83d\uddd2\ufe0f '+(it.text||'Note').slice(0,20);
  if(it.type==='image') return '\ud83d\uddbc\ufe0f Image';
  if(it.type==='table') return '\ud83d\udd22 Table '+it.rows+'x'+it.cols;
  if(it.type==='flow') return '\u25ad '+(it.text||it.shape);
  if(it.type==='sheet') return '\ud83d\udcc4 '+(it.label||'Sheet');
  return it.type;
}

/* ============================================================
   LAYERS PANEL
   ============================================================ */
const layersBtn = document.getElementById('layers-btn');
const layersPanel = document.getElementById('layers-panel');
const layersList = document.getElementById('layers-list');
layersBtn.addEventListener('click', ()=>{ layersPanel.classList.toggle('open'); renderLayersPanel(); });

function renderLayersPanel(){
  layersList.innerHTML='';
  items.slice().reverse().forEach((it, revIdx)=>{
    const realIdx = items.length-1-revIdx;
    const row=document.createElement('div');
    row.className='layer-row'+(selectedIds.includes(it.id)?' active':'');
    row.draggable=true;
    row.dataset.idx=realIdx;
    const label=document.createElement('span'); label.className='layer-label'; label.textContent=itemLabel(it);
    row.appendChild(label);
    const upBtn=document.createElement('button'); upBtn.textContent='\u2b06\ufe0f'; upBtn.title='Bring forward';
    upBtn.addEventListener('click', e=>{ e.stopPropagation(); moveLayer(realIdx, 1); });
    const downBtn=document.createElement('button'); downBtn.textContent='\u2b07\ufe0f'; downBtn.title='Send backward';
    downBtn.addEventListener('click', e=>{ e.stopPropagation(); moveLayer(realIdx, -1); });
    const delBtn=document.createElement('button'); delBtn.textContent='\ud83d\uddd1\ufe0f'; delBtn.title='Delete';
    delBtn.addEventListener('click', e=>{
      e.stopPropagation();
      deleteItemsToTrash([it.id]);
      renderLayersPanel();
    });
    row.appendChild(upBtn); row.appendChild(downBtn); row.appendChild(delBtn);
    row.addEventListener('click', ()=>{ setSelection([it.id]); renderLayersPanel(); });
    row.addEventListener('dragstart', ()=>{ row.classList.add('dragging'); });
    row.addEventListener('dragend', ()=>{ row.classList.remove('dragging'); });
    row.addEventListener('dragover', e=>e.preventDefault());
    row.addEventListener('drop', e=>{
      e.preventDefault();
      const draggingRow = layersList.querySelector('.dragging');
      if(!draggingRow || draggingRow===row) return;
      const fromIdx = parseInt(draggingRow.dataset.idx);
      const toIdx = parseInt(row.dataset.idx);
      const moved = items.splice(fromIdx,1)[0];
      items.splice(toIdx,0,moved);
      pushHistory(); renderAll(); saveLocal(); renderLayersPanel();
    });
    layersList.appendChild(row);
  });
}

function moveLayer(idx, dir){
  const newIdx = idx+dir;
  if(newIdx<0 || newIdx>=items.length) return;
  const [moved] = items.splice(idx,1);
  items.splice(newIdx,0,moved);
  pushHistory(); renderAll(); saveLocal(); renderLayersPanel();
}

/* ============================================================
   HISTORY + TRASH PANEL (multi-mode aware)
   ============================================================ */
const historyBtn = document.getElementById('history-btn');
const historyPanel = document.getElementById('history-panel');
const historyListEl = document.getElementById('history-list');
const trashListEl = document.getElementById('trash-list');
historyBtn.addEventListener('click', ()=>{ historyPanel.classList.toggle('open'); renderHistoryList(); renderTrashList(); });

document.querySelectorAll('#history-tabs button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#history-tabs button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.htab;
    historyListEl.style.display = tab==='versions' ? 'block':'none';
    trashListEl.style.display = tab==='trash' ? 'block':'none';
  });
});

/* renderHistoryList shows the history stack for the CURRENTLY ACTIVE mode only,
   but none of the other modes' stacks are ever cleared when you switch — see
   boardHistory/docHistory/slidesHistory/pbHistory below, each independent. */
function renderHistoryList(){
  historyListEl.innerHTML='';
  const stack = getHistoryStackForMode(currentMode);
  const modeLabel = {board:'Board', doc:'Doc', slides:'Slides', photobooth:'Photobooth'}[currentMode];
  const tag=document.createElement('div'); tag.style.padding='8px 12px'; tag.style.fontSize='11px'; tag.style.color='#999';
  tag.textContent = 'Showing history for: '+modeLabel+' (switch tabs to see others)';
  historyListEl.appendChild(tag);
  stack.slice().reverse().forEach((snapshot, revIdx)=>{
    const idx = stack.length-1-revIdx;
    const row=document.createElement('div'); row.className='history-row';
    const span = document.createElement('span'); span.className='hist-mode-tag'; span.textContent=modeLabel;
    row.appendChild(span);
    const label=document.createElement('span'); label.textContent = 'Version '+(idx+1);
    row.appendChild(label);
    row.addEventListener('click', ()=>{
      if(!confirm('Restore this version? Current state will be saved to history first.')) return;
      restoreHistorySnapshot(currentMode, idx);
    });
    historyListEl.appendChild(row);
  });
}

function renderTrashList(){
  trashListEl.innerHTML='';
  if(!trashBin.length){ trashListEl.innerHTML='<div class="trash-row">Trash is empty</div>'; return; }
  trashBin.forEach((entry, idx)=>{
    const row=document.createElement('div'); row.className='trash-row';
    const label=document.createElement('span'); label.textContent=itemLabel(entry.item);
    const btn=document.createElement('button'); btn.textContent='Restore';
    btn.addEventListener('click', ()=>restoreFromTrash(idx));
    row.appendChild(label); row.appendChild(btn);
    trashListEl.appendChild(row);
  });
}

/* ============================================================
   DRAWING / PAN (default drag) / SHIFT+DRAG MARQUEE SELECT
   ============================================================ */
let drawing=false, currentStroke=null;
let marqueeActive=false, marqueeStart=null;
let isPanning=false, panStart=null, panOrigin=null;

boardWrap.addEventListener('mousedown', e=>{
  const onEmptyCanvas = e.target===boardWrap || e.target===canvasLayer || e.target===drawCanvas;

  if(currentTool==='pen' || currentTool==='eraser'){
    drawing=true;
    const p=screenToCanvas(e.clientX,e.clientY);
    currentStroke={points:[p], color: currentTool==='eraser'?'#f4f4f2':document.getElementById('penColor').value, size: currentTool==='eraser'?25:parseInt(document.getElementById('penSize').value)};
    strokes.push(currentStroke);
    return;
  }
  if(currentTool==='sticky' && onEmptyCanvas){
    const p=screenToCanvas(e.clientX,e.clientY);
    addSticky(p.x,p.y); resetToSelect(); return;
  }
  if(currentTool==='table' && onEmptyCanvas){
    pendingTablePos=screenToCanvas(e.clientX,e.clientY);
    tablePromptOverlay.classList.add('active'); return;
  }
  if(currentTool==='rect' && onEmptyCanvas){
    const p=screenToCanvas(e.clientX,e.clientY);
    addFlowNode('rect',p.x,p.y); resetToSelect(); return;
  }
  if(currentTool==='diamond' && onEmptyCanvas){
    const p=screenToCanvas(e.clientX,e.clientY);
    addFlowNode('diamond',p.x,p.y); resetToSelect(); return;
  }
  if(currentTool==='circle' && onEmptyCanvas){
    const p=screenToCanvas(e.clientX,e.clientY);
    addFlowNode('circle',p.x,p.y); resetToSelect(); return;
  }
  if(currentTool==='mindmap' && onEmptyCanvas){
    const p=screenToCanvas(e.clientX,e.clientY);
    addFlowNode('mindnode',p.x,p.y); resetToSelect(); return;
  }
  if(currentTool==='select' && onEmptyCanvas){
    if(e.shiftKey){
      deselectAll();
      marqueeActive=true;
      const rect=boardWrap.getBoundingClientRect();
      marqueeStart={x:e.clientX-rect.left, y:e.clientY-rect.top};
      selectionBox.style.left=marqueeStart.x+'px'; selectionBox.style.top=marqueeStart.y+'px';
      selectionBox.style.width='0px'; selectionBox.style.height='0px';
      selectionBox.style.display='block';
    } else {
      deselectAll();
      isPanning=true;
      panStart={x:e.clientX,y:e.clientY}; panOrigin={x:panX,y:panY};
      boardWrap.classList.add('panning');
    }
  }
});

canvasLayer.addEventListener('click', e=>{
  if(currentTool!=='connector') return;
  const el = e.target.closest('.item');
  if(!el) return;
  const id = el.dataset.id;
  if(!connectorPending){
    connectorPending=id; hint.textContent='Now click the target node...'; hint.style.opacity='1';
  } else if(connectorPending!==id){
    connectors.push({fromId:connectorPending, toId:id});
    connectorPending=null;
    pushHistory(); renderAll(); saveLocal();
    hint.textContent='Connector added.'; setTimeout(()=>hint.style.opacity='0',1500);
  }
});

boardWrap.addEventListener('mousemove', e=>{
  if(drawing && currentStroke){
    const p=screenToCanvas(e.clientX,e.clientY);
    currentStroke.points.push(p);
    redrawStrokes();
  }
  if(marqueeActive){
    const rect=boardWrap.getBoundingClientRect();
    const curX=e.clientX-rect.left, curY=e.clientY-rect.top;
    const x=Math.min(marqueeStart.x,curX), y=Math.min(marqueeStart.y,curY);
    const w=Math.abs(curX-marqueeStart.x), h=Math.abs(curY-marqueeStart.y);
    selectionBox.style.left=x+'px'; selectionBox.style.top=y+'px';
    selectionBox.style.width=w+'px'; selectionBox.style.height=h+'px';
  }
  if(isPanning){
    panX=panOrigin.x+(e.clientX-panStart.x); panY=panOrigin.y+(e.clientY-panStart.y);
    applyTransform();
  }
});

window.addEventListener('mouseup', e=>{
  if(drawing){ drawing=false; currentStroke=null; pushHistory(); saveLocal(); }
  if(marqueeActive){
    marqueeActive=false;
    const rect=boardWrap.getBoundingClientRect();
    const boxLeft=parseFloat(selectionBox.style.left), boxTop=parseFloat(selectionBox.style.top);
    const boxW=parseFloat(selectionBox.style.width), boxH=parseFloat(selectionBox.style.height);
    selectionBox.style.display='none';
    if(boxW>4 || boxH>4){
      const c1 = screenToCanvas(rect.left+boxLeft, rect.top+boxTop);
      const c2 = screenToCanvas(rect.left+boxLeft+boxW, rect.top+boxTop+boxH);
      const hits = items.filter(it => it.type!=='sheet' && it.x < c2.x && it.x+it.w > c1.x && it.y < c2.y && it.y+it.h > c1.y).map(it=>it.id);
      setSelection(hits);
    }
  }
  if(isPanning){ isPanning=false; boardWrap.classList.remove('panning'); saveLocal(); }
});

boardWrap.addEventListener('mousedown', e=>{
  if(e.button===1){ isPanning=true; panStart={x:e.clientX,y:e.clientY}; panOrigin={x:panX,y:panY}; boardWrap.classList.add('panning'); }
});

boardWrap.addEventListener('wheel', e=>{
  if(e.ctrlKey || e.metaKey){
    e.preventDefault();
    const delta = e.deltaY<0?0.1:-0.1;
    const newScale = Math.min(4, Math.max(0.2, scale+delta));
    const rect=boardWrap.getBoundingClientRect();
    const cx=e.clientX-rect.left, cy=e.clientY-rect.top;
    panX = cx-(cx-panX)*(newScale/scale);
    panY = cy-(cy-panY)*(newScale/scale);
    scale=newScale; applyTransform(); saveLocal();
  } else {
    panX -= e.deltaX; panY -= e.deltaY; applyTransform();
  }
}, {passive:false});

function resetToSelect(){
  currentTool='select';
  document.querySelectorAll('#toolbar .tool-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('tool-select').classList.add('active');
}

window.addEventListener('paste', e=>{
  if(!document.getElementById('board-view').classList.contains('active')) return;
  const cbItems = e.clipboardData.items;
  for(let i=0;i<cbItems.length;i++){
    if(cbItems[i].type.indexOf('image')!==-1){
      const file=cbItems[i].getAsFile();
      const c=screenToCanvas(innerWidth/2, innerHeight/2);
      loadImageFile(file, c.x, c.y);
      e.preventDefault(); return;
    }
  }
  const text=e.clipboardData.getData('text');
  if(text && document.activeElement.contentEditable!=='true'){
    const c=screenToCanvas(innerWidth/2, innerHeight/2);
    const item={id:'item_'+idCounter++, type:'sticky', x:c.x-90,y:c.y-60,w:220,h:140,text:text.slice(0,500),color:'#c9f0ff'};
    items.push(item); pushHistory(); renderAll(); saveLocal();
  }
});

boardWrap.addEventListener('dragover', e=>e.preventDefault());
boardWrap.addEventListener('drop', e=>{
  e.preventDefault();
  const p=screenToCanvas(e.clientX,e.clientY);
  const files=e.dataTransfer.files;
  for(let i=0;i<files.length;i++){
    if(files[i].type.indexOf('image')!==-1) loadImageFile(files[i], p.x+i*30, p.y+i*30);
  }
});

window.addEventListener('keydown', e=>{
  if(document.activeElement.contentEditable==='true') return;
  if(document.getElementById('settings-overlay').classList.contains('active')) return;
  const combo = normalizeKeyEvent(e);
  const action = actionForCombo(combo);
  if(action){
    if(combo.includes('ctrl')||combo.includes('meta')) e.preventDefault();
    runAction(action); return;
  }
  if((e.key==='Delete'||e.key==='Backspace') && selectedIds.length && currentMode==='board') deleteItemsToTrash(selectedIds);
});

panX = innerWidth/2 - 3000; panY = innerHeight/2 - 2000;
pushHistory();
loadLocal();
applyTransform();
setTimeout(()=>{ if(hint.textContent.startsWith('Paste')) hint.style.opacity='0'; }, 7000);

/* ============================================================
   TIMER WIDGET
   ============================================================ */
let timerMode='countdown', timerSeconds=300, timerInterval=null, stopwatchSeconds=0;
const timerDisplay=document.getElementById('timer-display');
const timerPreset=document.getElementById('timer-preset');
const timerCustom=document.getElementById('timer-custom');
function fmt(s){ const m=Math.floor(Math.abs(s)/60), sec=Math.abs(s)%60; return (s<0?'-':'')+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0'); }
function renderTimer(){ timerDisplay.textContent = timerMode==='countdown' ? fmt(timerSeconds) : fmt(stopwatchSeconds); }
timerPreset.addEventListener('change', ()=>{
  timerCustom.style.display = timerPreset.value==='custom' ? 'inline-block' : 'none';
  if(timerPreset.value!=='custom'){ timerSeconds=parseInt(timerPreset.value); renderTimer(); }
});
timerCustom.addEventListener('input', ()=>{ timerSeconds=parseFloat(timerCustom.value)*60||0; renderTimer(); });
document.getElementById('timer-mode').addEventListener('click', function(){
  timerMode = timerMode==='countdown' ? 'stopwatch' : 'countdown';
  this.textContent = timerMode==='countdown' ? '\u23f1\ufe0f Stopwatch' : '\u23f1\ufe0f Countdown';
  clearInterval(timerInterval); timerInterval=null; renderTimer();
});
document.getElementById('timer-start').addEventListener('click', ()=>{
  if(timerInterval) return;
  timerInterval=setInterval(()=>{
    if(timerMode==='countdown'){
      timerSeconds--;
      if(timerSeconds<=0){ clearInterval(timerInterval); timerInterval=null; alert('Time up!'); }
    } else { stopwatchSeconds++; }
    renderTimer();
  },1000);
});
document.getElementById('timer-pause').addEventListener('click', ()=>{ clearInterval(timerInterval); timerInterval=null; });
document.getElementById('timer-reset').addEventListener('click', ()=>{
  clearInterval(timerInterval); timerInterval=null;
  if(timerMode==='countdown'){ timerSeconds = timerPreset.value==='custom' ? (parseFloat(timerCustom.value)*60||0) : parseInt(timerPreset.value); }
  else { stopwatchSeconds=0; }
  renderTimer();
});
renderTimer();

/* ============================================================
   PHOTOBOOTH — own tab, presets, custom interval/shots/size,
   extra frames, reorder, pick mode, fonts, grid layouts, crop,
   post-capture filter, and its own undo history.
   ============================================================ */
const pbVideo=document.getElementById('pb-video');
const pbCanvas=document.getElementById('pb-canvas');
const pbStripCanvas=document.getElementById('pb-strip-canvas');
const pbCountdownEl=document.getElementById('pb-countdown');
const pbShotsPreview=document.getElementById('pb-shots-preview');
const pbPickerGrid=document.getElementById('pb-picker-grid');
const pbPickHint=document.getElementById('pb-pick-hint');
const pbStripPreview=document.getElementById('pb-strip-preview');
const pbStripPhotos=document.getElementById('pb-strip-photos');
const pbStripCaption=document.getElementById('pb-strip-caption');
const pbReorderStrip=document.getElementById('pb-reorder-strip');
const pbShotCountSel=document.getElementById('pb-shot-count');
const pbShotCountCustom=document.getElementById('pb-shot-count-custom');
const pbIntervalInput=document.getElementById('pb-interval');
const pbLayoutSelect=document.getElementById('pb-layout-select');
const pbCustomSizePanel=document.getElementById('pb-custom-size-panel');
const pbCustomW=document.getElementById('pb-custom-w');
const pbCustomH=document.getElementById('pb-custom-h');
const pbCustomCols=document.getElementById('pb-custom-cols');
const pbCustomGap=document.getElementById('pb-custom-gap');

let pbStream=null;
let pbAllShots=[];
let pbSelectedShots=[];
let pbShotTarget=4;
let pbPickMode=false;
let pbCropState={};
let pbIntervalSec=3;
let pbCustomFrame={w:800,h:1200,cols:2,gap:10};

const COLOR_PRESETS=[
  {name:'White', hex:'#ffffff'},{name:'Black', hex:'#111111'},{name:'Pink', hex:'#ff8fb1'},
  {name:'Green', hex:'#3ecf8e'},{name:'Blue', hex:'#5b6cff'},{name:'Yellow', hex:'#f7d154'},
  {name:'Purple', hex:'#9b6bd4'},{name:'Maroon', hex:'#7a1f2b'},{name:'Burgundy', hex:'#5e1029'}
];
const swatchRow = document.getElementById('pb-swatch-row');
COLOR_PRESETS.forEach(c=>{
  const sw = document.createElement('div');
  sw.className='pb-swatch'; sw.style.background=c.hex; sw.title=c.name;
  sw.addEventListener('click', ()=>{
    document.querySelectorAll('.pb-swatch').forEach(s=>s.classList.remove('active'));
    sw.classList.add('active');
    document.getElementById('pb-frame-color').value=c.hex;
    renderStripPreview(); pushPBHistory();
  });
  swatchRow.appendChild(sw);
});

async function initPhotoboothCamera(){
  try{
    pbStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'}, audio:false});
    pbVideo.srcObject = pbStream;
  }catch(err){ console.warn('Camera not available yet', err.message); }
}
function stopPhotoboothCamera(){
  if(pbStream){ pbStream.getTracks().forEach(t=>t.stop()); pbStream=null; }
}

const FILTER_CSS = { none:'none', bw:'grayscale(1)', sepia:'sepia(0.8)', vintage:'sepia(0.4) contrast(1.1) brightness(0.95)', bright:'brightness(1.15) saturate(1.1)' };
function currentFilterCSS(){ return FILTER_CSS[document.getElementById('pb-filter-select').value] || 'none'; }

function captureFrame(){
  pbCanvas.width = pbVideo.videoWidth; pbCanvas.height = pbVideo.videoHeight;
  const pctx = pbCanvas.getContext('2d');
  pctx.translate(pbCanvas.width,0); pctx.scale(-1,1);
  pctx.drawImage(pbVideo, 0, 0);
  return pbCanvas.toDataURL('image/png');
}

function flash(){
  const f=document.getElementById('pb-flash');
  f.style.transition='none'; f.style.opacity='0.9';
  setTimeout(()=>{ f.style.transition='opacity .4s'; f.style.opacity='0'; },50);
}

function countdown(n, cb){
  if(n<=0){ pbCountdownEl.style.display='none'; cb(); return; }
  pbCountdownEl.style.display='flex'; pbCountdownEl.textContent=n;
  setTimeout(()=>countdown(n-1, cb), 700);
}

/* ---- shot count: preset dropdown or custom numeric input ---- */
pbShotCountSel.addEventListener('change', ()=>{
  pbShotCountCustom.style.display = pbShotCountSel.value==='custom' ? 'inline-block' : 'none';
});
function getShotTarget(){
  if(pbShotCountSel.value==='custom') return Math.max(1, parseInt(pbShotCountCustom.value)||1);
  return parseInt(pbShotCountSel.value);
}

/* ---- interval: used both for the countdown start number and the gap between shots ---- */
pbIntervalInput.addEventListener('input', ()=>{ pbIntervalSec = Math.max(1, parseInt(pbIntervalInput.value)||1); });
pbIntervalSec = Math.max(1, parseInt(pbIntervalInput.value)||3);

document.getElementById('pb-start').addEventListener('click', ()=>{
  pbShotTarget = getShotTarget();
  pbPickMode = pbShotTarget > 4;
  pbAllShots=[]; pbSelectedShots=[]; pbCropState={};
  pbPickerGrid.innerHTML=''; pbPickHint.style.display='none';
  renderShotsPreview(); renderStripPreview(); renderReorderStrip();
  takeNextShot();
});

function takeNextShot(){
  if(pbAllShots.length>=pbShotTarget){
    if(pbPickMode){ enterPickMode(); }
    else { pbSelectedShots = pbAllShots.slice(); renderStripPreview(); renderReorderStrip(); pushPBHistory(); }
    return;
  }
  countdown(pbIntervalSec, ()=>{
    flash();
    pbAllShots.push(captureFrame());
    renderShotsPreview();
    if(pbAllShots.length<pbShotTarget) setTimeout(takeNextShot, Math.max(300, pbIntervalSec*200));
    else takeNextShot();
  });
}

document.getElementById('pb-retake').addEventListener('click', ()=>{
  pbAllShots=[]; pbSelectedShots=[]; pbPickMode=false; pbCropState={};
  pbPickerGrid.innerHTML=''; pbPickHint.style.display='none';
  renderShotsPreview(); renderStripPreview(); renderReorderStrip();
  pushPBHistory();
});

function renderShotsPreview(){
  pbShotsPreview.innerHTML='';
  pbAllShots.forEach(src=>{
    const img=document.createElement('img'); img.className='pb-shot-thumb'; img.src=src; img.style.filter=currentFilterCSS();
    pbShotsPreview.appendChild(img);
  });
}

function enterPickMode(){
  pbPickHint.style.display='block';
  pbPickerGrid.innerHTML='';
  pbSelectedShots=[];
  pbAllShots.forEach(src=>{
    const thumb = document.createElement('div'); thumb.className='pb-pick-thumb';
    const img=document.createElement('img'); img.src=src; thumb.appendChild(img);
    const orderBadge = document.createElement('div'); orderBadge.className='pick-order'; orderBadge.style.display='none';
    thumb.appendChild(orderBadge);
    thumb.addEventListener('click', ()=>{
      const already = pbSelectedShots.indexOf(src);
      if(already!==-1){ pbSelectedShots.splice(already,1); }
      else {
        if(pbSelectedShots.length>=4){ alert('Pick at most 4 photos for the strip.'); return; }
        pbSelectedShots.push(src);
      }
      renderStripPreview(); renderReorderStrip(); relabelPicks(); pushPBHistory();
    });
    pbPickerGrid.appendChild(thumb);
  });
}

function relabelPicks(){
  const thumbs = pbPickerGrid.querySelectorAll('.pb-pick-thumb');
  thumbs.forEach(t=>{
    const img = t.querySelector('img');
    const idx = pbSelectedShots.indexOf(img.src);
    const badge = t.querySelector('.pick-order');
    if(idx!==-1){ badge.style.display='flex'; badge.textContent=idx+1; t.classList.add('picked'); }
    else { badge.style.display='none'; t.classList.remove('picked'); }
  });
}

function applyFrameClass(){
  const frame = document.getElementById('pb-frame-select').value;
  pbStripPreview.className = 'frame-'+frame;
  const solidFrames=['classic','polaroid','hearts','scallop'];
  pbStripPreview.style.background = solidFrames.includes(frame) ? document.getElementById('pb-frame-color').value : '';
}

function makeCroppable(img, idx){
  if(!pbCropState[idx]) pbCropState[idx] = {scale:1.15, offX:0, offY:0};
  const crop = pbCropState[idx];
  img.style.objectFit='cover';
  img.style.transform = `scale(${crop.scale}) translate(${crop.offX}px, ${crop.offY}px)`;
  img.addEventListener('mousedown', e=>{
    e.preventDefault();
    const startX=e.clientX, startY=e.clientY, origOffX=crop.offX, origOffY=crop.offY;
    function onMove(ev){
      crop.offX = origOffX + (ev.clientX-startX)/crop.scale;
      crop.offY = origOffY + (ev.clientY-startY)/crop.scale;
      img.style.transform = `scale(${crop.scale}) translate(${crop.offX}px, ${crop.offY}px)`;
    }
    function onUp(){ document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); pushPBHistory(); }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  });
  img.addEventListener('wheel', e=>{
    e.preventDefault();
    crop.scale = Math.max(1, Math.min(3, crop.scale + (e.deltaY<0?0.05:-0.05)));
    img.style.transform = `scale(${crop.scale}) translate(${crop.offX}px, ${crop.offY}px)`;
  });
}

/* ---- custom layout toggle ---- */
pbLayoutSelect.addEventListener('change', ()=>{
  pbCustomSizePanel.style.display = pbLayoutSelect.value==='custom' ? 'block' : 'none';
  renderStripPreview(); pushPBHistory();
});
[pbCustomW, pbCustomH, pbCustomCols, pbCustomGap].forEach(inp=>{
  inp.addEventListener('input', ()=>{
    pbCustomFrame = { w: Math.max(100,parseInt(pbCustomW.value)||800), h: Math.max(100,parseInt(pbCustomH.value)||1200),
                       cols: Math.max(1,parseInt(pbCustomCols.value)||2), gap: Math.max(0,parseInt(pbCustomGap.value)||10) };
    renderStripPreview();
  });
  inp.addEventListener('change', ()=>pushPBHistory());
});

function renderStripPreview(){
  applyFrameClass();
  const layout = pbLayoutSelect.value;
  pbStripPhotos.className = 'layout-'+layout;
  pbStripPhotos.innerHTML='';
  if(layout==='custom'){
    pbStripPhotos.style.gridTemplateColumns = `repeat(${pbCustomFrame.cols}, 1fr)`;
    pbStripPhotos.style.gap = pbCustomFrame.gap+'px';
    const scaleToScreen = Math.min(1, 420/pbCustomFrame.w);
    pbStripPhotos.style.width = Math.round(pbCustomFrame.w*scaleToScreen)+'px';
    pbStripPhotos.style.height = Math.round(pbCustomFrame.h*scaleToScreen)+'px';
  } else {
    pbStripPhotos.style.gridTemplateColumns=''; pbStripPhotos.style.gap=''; pbStripPhotos.style.width=''; pbStripPhotos.style.height='';
  }
  pbSelectedShots.forEach((src, idx)=>{
    const img=document.createElement('img'); img.className='pb-strip-photo'; img.src=src; img.style.filter=currentFilterCSS();
    makeCroppable(img, idx);
    pbStripPhotos.appendChild(img);
  });
  pbStripCaption.textContent = document.getElementById('pb-caption-input').value;
  pbStripCaption.style.fontFamily = document.getElementById('pb-font-select').value;
}
document.getElementById('pb-frame-select').addEventListener('change', ()=>{ renderStripPreview(); pushPBHistory(); });
document.getElementById('pb-frame-color').addEventListener('input', renderStripPreview);
document.getElementById('pb-frame-color').addEventListener('change', ()=>pushPBHistory());
document.getElementById('pb-caption-input').addEventListener('input', renderStripPreview);
document.getElementById('pb-caption-input').addEventListener('change', ()=>pushPBHistory());
document.getElementById('pb-font-select').addEventListener('change', ()=>{ renderStripPreview(); pushPBHistory(); });
document.getElementById('pb-filter-select').addEventListener('change', ()=>{ renderShotsPreview(); renderStripPreview(); pushPBHistory(); });

function renderReorderStrip(){
  pbReorderStrip.innerHTML='';
  pbSelectedShots.forEach((src, idx)=>{
    const img=document.createElement('img'); img.className='pb-reorder-thumb'; img.src=src; img.draggable=true; img.dataset.idx=idx;
    img.addEventListener('dragstart', e=>{ img.classList.add('dragging'); e.dataTransfer.setData('text/plain', idx); });
    img.addEventListener('dragend', ()=>img.classList.remove('dragging'));
    img.addEventListener('dragover', e=>e.preventDefault());
    img.addEventListener('drop', e=>{
      e.preventDefault();
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      const toIdx = parseInt(img.dataset.idx);
      if(fromIdx===toIdx) return;
      const moved = pbSelectedShots.splice(fromIdx,1)[0];
      pbSelectedShots.splice(toIdx,0,moved);
      renderStripPreview(); renderReorderStrip(); pushPBHistory();
    });
    pbReorderStrip.appendChild(img);
  });
}

function drawFrameDecorations(sctx, frame, w, h){
  if(frame==='hearts'){ sctx.strokeStyle='#d46bb0'; sctx.lineWidth=6; sctx.setLineDash([10,8]); sctx.strokeRect(4,4,w-8,h-8); sctx.setLineDash([]); }
  if(frame==='neon'){ sctx.shadowColor='#5b6cff'; sctx.shadowBlur=25; sctx.strokeStyle='#5b6cff'; sctx.lineWidth=4; sctx.strokeRect(4,4,w-8,h-8); sctx.shadowBlur=0; }
  if(frame==='scallop'){ sctx.strokeStyle='#eee'; sctx.lineWidth=8; sctx.strokeRect(4,4,w-8,h-8); }
  if(frame==='stripes'){
    sctx.save(); sctx.beginPath(); sctx.rect(0,0,w,h); sctx.clip();
    sctx.fillStyle='#ffe3ec';
    for(let i=-h;i<w+h;i+=20){ sctx.save(); sctx.translate(i,0); sctx.rotate(Math.PI/4); sctx.fillRect(0,0,10,h*2); sctx.restore(); }
    sctx.restore();
  }
  if(frame==='gold'){ const grad=sctx.createLinearGradient(0,0,w,h); grad.addColorStop(0,'#f7e7ce'); grad.addColorStop(1,'#d4af37'); sctx.fillStyle=grad; sctx.fillRect(0,0,w,h); }
  if(frame==='grid'){
    sctx.strokeStyle='#eee'; sctx.lineWidth=1;
    for(let x=0;x<w;x+=12){ sctx.beginPath(); sctx.moveTo(x,0); sctx.lineTo(x,h); sctx.stroke(); }
    for(let y=0;y<h;y+=12){ sctx.beginPath(); sctx.moveTo(0,y); sctx.lineTo(w,y); sctx.stroke(); }
  }
}

/* ---- layout rect computation, now with a 'custom' branch that scales any
   number of photos to fit an arbitrary user-chosen frame width/height ---- */
function computeLayoutRects(layout, count, pad, gap){
  const cellW = 220, cellH = 165;

  if(layout==='custom'){
    const cf = pbCustomFrame;
    const cols = Math.max(1, cf.cols);
    const rows = Math.max(1, Math.ceil(count/cols));
    const innerW = cf.w - pad*2 - (cols-1)*cf.gap;
    const innerH = cf.h - pad*2 - (rows-1)*cf.gap - 40; // reserve space for caption
    const cw = innerW/cols, ch = innerH/rows;
    const rects=[];
    for(let i=0;i<count;i++){
      const col = i%cols, row = Math.floor(i/cols);
      rects.push({x: pad+col*(cw+cf.gap), y: pad+row*(ch+cf.gap), w:cw, h:ch});
    }
    return { canvasW: cf.w, canvasH: cf.h, rects };
  }

  if(layout==='horizontal'){
    const rects=[];
    for(let i=0;i<count;i++) rects.push({x:pad+i*(cellW+gap), y:pad, w:cellW, h:cellH});
    const w = pad*2 + count*cellW + (count-1)*gap;
    const h = cellH + pad*2;
    return { canvasW:w, canvasH:h, rects };
  }
  if(layout==='grid2x2'){
    const half = cellW; const rects=[];
    const positions=[[0,0],[1,0],[0,1],[1,1]];
    for(let i=0;i<Math.min(count,4);i++){ const pos=positions[i]; rects.push({x:pad+pos[0]*(half+gap), y:pad+pos[1]*(cellH+gap), w:half, h:cellH}); }
    const w = pad*2 + 2*half + gap;
    const h = pad*2 + 2*cellH + gap;
    return { canvasW:w, canvasH:h, rects };
  }
  if(layout==='big3'){
    const bigW = cellW*1.3, bigH = cellH*1.6+gap;
    const smallW = cellW*0.65, smallH = cellH*0.75;
    const rects=[{x:pad, y:pad, w:bigW, h:bigH}];
    for(let i=0;i<Math.min(2, count-1);i++) rects.push({x:pad+bigW+gap, y:pad+i*(smallH+gap), w:smallW, h:smallH});
    const w = pad*2 + bigW + gap + smallW;
    const h = pad*2 + bigH;
    return { canvasW:w, canvasH:h, rects };
  }
  if(layout==='big4'){
    const bigW = cellW*1.3, bigH = cellH*1.6+gap*1.5;
    const smallW = cellW*0.62, smallH = bigH/2-gap/2;
    const rects=[{x:pad, y:pad, w:bigW, h:bigH}];
    for(let i=0;i<Math.min(3,count-1);i++){
      const col = i<2?0:1; const row = i%2;
      rects.push({x:pad+bigW+gap+col*(smallW+gap), y:pad+row*(smallH+gap), w:smallW, h:smallH});
    }
    const w = pad*2 + bigW + gap + smallW*2 + gap;
    const h = pad*2 + bigH;
    return { canvasW:w, canvasH:h, rects };
  }
  const rects=[];
  for(let i=0;i<count;i++) rects.push({x:pad, y:pad+i*(cellH+gap), w:cellW, h:cellH});
  const w = cellW+pad*2;
  const h = pad*2 + count*cellH + (count-1)*gap;
  return { canvasW:w, canvasH:h, rects };
}

function compositeStrip(callback){
  if(!pbSelectedShots.length){ alert('Take or select at least one photo first.'); return; }
  const layout = document.getElementById('pb-layout-select').value;
  const pad=28, gap=10, capH=44;
  const geo = computeLayoutRects(layout, pbSelectedShots.length, pad, gap);
  const w = geo.canvasW, h = geo.canvasH + (layout==='custom'?0:capH);
  pbStripCanvas.width=w; pbStripCanvas.height=h;
  const sctx = pbStripCanvas.getContext('2d');
  const frame = document.getElementById('pb-frame-select').value;
  const frameColor = document.getElementById('pb-frame-color').value;
  const fontFamily = document.getElementById('pb-font-select').value;
  if(frame==='film') sctx.fillStyle='#111';
  else if(frame==='neon') sctx.fillStyle='#0a0a16';
  else if(frame==='gold'||frame==='grid'||frame==='stripes') sctx.fillStyle='#fff';
  else sctx.fillStyle=frameColor;
  sctx.fillRect(0,0,w,h);
  drawFrameDecorations(sctx, frame, w, h);

  let loaded=0; const total=pbSelectedShots.length;
  pbSelectedShots.forEach((src,i)=>{
    const im=new Image();
    im.onload=()=>{
      const r = geo.rects[i] || geo.rects[geo.rects.length-1];
      sctx.save(); sctx.beginPath(); sctx.rect(r.x, r.y, r.w, r.h); sctx.clip();
      sctx.filter = currentFilterCSS();
      const crop = pbCropState[i] || {scale:1, offX:0, offY:0};
      const imgAspect = im.width/im.height, boxAspect = r.w/r.h;
      let dw, dh, dx, dy;
      if(imgAspect>boxAspect){ dh=r.h; dw=dh*imgAspect; dx=r.x-(dw-r.w)/2; dy=r.y; }
      else { dw=r.w; dh=dw/imgAspect; dx=r.x; dy=r.y-(dh-r.h)/2; }
      dw*=crop.scale; dh*=crop.scale;
      dx += crop.offX; dy += crop.offY;
      sctx.drawImage(im, dx, dy, dw, dh);
      sctx.filter='none'; sctx.restore();
      loaded++;
      if(loaded===total){
        if(layout!=='custom'){
          sctx.fillStyle = (frame==='film'||frame==='neon') ? '#eee' : '#555';
          sctx.font='20px '+fontFamily; sctx.textAlign='center';
          sctx.fillText(document.getElementById('pb-caption-input').value, w/2, h-16);
        }
        callback(pbStripCanvas);
      }
    };
    im.src=src;
  });
}
document.getElementById('pb-download-strip').addEventListener('click', ()=>{
  compositeStrip(canvas=>{
    const a=document.createElement('a'); a.href=canvas.toDataURL('image/png'); a.download='photobooth-strip.png'; a.click();
  });
});
document.getElementById('pb-add-to-board').addEventListener('click', ()=>{
  compositeStrip(canvas=>{
    const c = screenToCanvas(innerWidth/2, innerHeight/2);
    const dataUrl = canvas.toDataURL('image/png');
    addImage(dataUrl, c.x, c.y, canvas.width, canvas.height);
    alert('Strip added to your Board!');
  });
});
renderStripPreview();

/* ---- Photobooth's own undo history (independent of Board/Doc/Slides) ---- */
let pbHistory = [];
function pbSnapshot(){
  return JSON.stringify({
    pbSelectedShots, pbCropState,
    layout: pbLayoutSelect.value, frame: document.getElementById('pb-frame-select').value,
    frameColor: document.getElementById('pb-frame-color').value,
    filter: document.getElementById('pb-filter-select').value,
    font: document.getElementById('pb-font-select').value,
    caption: document.getElementById('pb-caption-input').value,
    customFrame: pbCustomFrame
  });
}
function pushPBHistory(){
  pbHistory.push(pbSnapshot());
  if(pbHistory.length>50) pbHistory.shift();
}
function applyPBSnapshot(snap){
  const s = JSON.parse(snap);
  pbSelectedShots = s.pbSelectedShots; pbCropState = s.pbCropState;
  pbLayoutSelect.value = s.layout;
  document.getElementById('pb-frame-select').value = s.frame;
  document.getElementById('pb-frame-color').value = s.frameColor;
  document.getElementById('pb-filter-select').value = s.filter;
  document.getElementById('pb-font-select').value = s.font;
  document.getElementById('pb-caption-input').value = s.caption;
  pbCustomFrame = s.customFrame || pbCustomFrame;
  pbCustomSizePanel.style.display = s.layout==='custom' ? 'block':'none';
  renderStripPreview(); renderReorderStrip();
}
function undoPhotobooth(){
  if(pbHistory.length<2) return;
  pbHistory.pop();
  applyPBSnapshot(pbHistory[pbHistory.length-1]);
}
document.getElementById('pb-undo').addEventListener('click', undoPhotobooth);
pushPBHistory();

/* ============================================================
   DOC PAGE — multiple renameable tabs, each with its own content
   and its own undo history (never erased when switching tabs).
   ============================================================ */
const docEditable=document.getElementById('doc-editable');
const docTabsList=document.getElementById('doc-tabs-list');

let docTabs = JSON.parse(localStorage.getItem('wb_doc_tabs')||'null');
let activeDocTabId;
if(!docTabs || !docTabs.length){
  const legacy = localStorage.getItem('wb_doc_content');
  docTabs = [{ id:'doctab_1', title:'Untitled document', content: legacy || '' }];
}
activeDocTabId = docTabs[0].id;
let docTabIdCounter = docTabs.reduce((m,t)=>Math.max(m, parseInt((t.id.split('_')[1]||0))+1), 1);

/* per-tab undo history: { [tabId]: [snapshotHTML, ...] } — independent from every other mode */
let docHistoryByTab = {};
docTabs.forEach(t=>{ docHistoryByTab[t.id] = [t.content]; });

function saveDocTabs(){ localStorage.setItem('wb_doc_tabs', JSON.stringify(docTabs)); }
function getActiveDocTab(){ return docTabs.find(t=>t.id===activeDocTabId); }

function renderDocTabsBar(){
  docTabsList.innerHTML='';
  docTabs.forEach(t=>{
    const tab=document.createElement('div'); tab.className='doc-tab'+(t.id===activeDocTabId?' active':'');
    const title=document.createElement('span'); title.className='doc-tab-title'; title.textContent=t.title;
    title.addEventListener('dblclick', e=>{
      e.stopPropagation();
      title.contentEditable=true; title.focus(); document.execCommand('selectAll',false,null);
    });
    title.addEventListener('blur', ()=>{
      title.contentEditable=false;
      t.title = title.textContent.trim() || 'Untitled document';
      title.textContent=t.title; saveDocTabs();
    });
    title.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); title.blur(); } });
    tab.appendChild(title);

    const close=document.createElement('span'); close.className='doc-tab-close'; close.textContent='\u2715';
    close.addEventListener('click', e=>{
      e.stopPropagation();
      if(docTabs.length<=1){ alert('At least one document tab is required.'); return; }
      const idx = docTabs.findIndex(x=>x.id===t.id);
      docTabs.splice(idx,1);
      delete docHistoryByTab[t.id];
      if(activeDocTabId===t.id){ activeDocTabId = docTabs[Math.max(0,idx-1)].id; }
      saveDocTabs(); renderDocTabsBar(); loadActiveDocTabContent();
    });
    tab.appendChild(close);

    tab.addEventListener('click', ()=>{
      if(activeDocTabId===t.id) return;
      commitDocContent();
      activeDocTabId = t.id;
      renderDocTabsBar(); loadActiveDocTabContent();
    });
    docTabsList.appendChild(tab);
  });
}

function commitDocContent(){
  const t = getActiveDocTab();
  if(t) t.content = docEditable.innerHTML;
  saveDocTabs();
}

function loadActiveDocTabContent(){
  const t = getActiveDocTab();
  docEditable.innerHTML = t ? t.content : '';
  if(!docHistoryByTab[activeDocTabId]) docHistoryByTab[activeDocTabId] = [docEditable.innerHTML];
}

document.getElementById('doc-tab-add').addEventListener('click', ()=>{
  commitDocContent();
  const id = 'doctab_'+docTabIdCounter++;
  const newTab = { id, title:'Untitled document', content:'' };
  docTabs.push(newTab);
  docHistoryByTab[id] = [''];
  activeDocTabId = id;
  saveDocTabs(); renderDocTabsBar(); loadActiveDocTabContent();
});

document.querySelectorAll('#doc-toolbar button[data-cmd]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.execCommand(btn.dataset.cmd,false,null);
    docEditable.focus();
  });
});
document.querySelectorAll('#doc-toolbar button[data-block]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const tag = btn.dataset.block==='p' ? 'P' : btn.dataset.block.toUpperCase();
    document.execCommand('formatBlock', false, tag);
    docEditable.focus();
  });
});

document.getElementById('doc-download').addEventListener('click', ()=>{
  const text = docEditable.innerText;
  const blob = new Blob([text], {type:'text/plain'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=(getActiveDocTab().title||'document')+'.txt'; a.click();
});
document.getElementById('doc-download-pdf').addEventListener('click', ()=>{
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({unit:'pt', format:'a4'});
  const margin=48;
  const lines = pdf.splitTextToSize(docEditable.innerText, 595-margin*2);
  pdf.setFontSize(12);
  pdf.text(lines, margin, margin+12);
  pdf.save((getActiveDocTab().title||'document')+'.pdf');
});
document.getElementById('doc-download-docx').addEventListener('click', ()=>{
  const { Document, Packer, Paragraph, TextRun } = window.docx;
  const paragraphs = docEditable.innerText.split('\n').filter(l=>l.trim()!=='').map(line=> new Paragraph({ children:[new TextRun(line)] }));
  const doc = new Document({ sections:[{ properties:{}, children: paragraphs }] });
  Packer.toBlob(doc).then(blob=> saveAs(blob, (getActiveDocTab().title||'document')+'.docx'));
});

/* debounced per-tab history push on input, so undo doesn't fire on every keystroke */
let docHistoryDebounce=null;
docEditable.addEventListener('input', ()=>{
  commitDocContent();
  clearTimeout(docHistoryDebounce);
  docHistoryDebounce = setTimeout(()=>{
    const stack = docHistoryByTab[activeDocTabId] || (docHistoryByTab[activeDocTabId]=[]);
    stack.push(docEditable.innerHTML);
    if(stack.length>50) stack.shift();
  }, 500);
});

function undoDoc(){
  const stack = docHistoryByTab[activeDocTabId];
  if(!stack || stack.length<2) return;
  stack.pop();
  docEditable.innerHTML = stack[stack.length-1];
  commitDocContent();
}
document.getElementById('doc-undo').addEventListener('click', undoDoc);

renderDocTabsBar();
loadActiveDocTabContent();

/* ============================================================
   SLIDES — with its own independent undo history
   ============================================================ */
let slides = JSON.parse(localStorage.getItem('wb_slides')||'null') || [{elements:[]}];
let currentSlideIdx = 0;
const slideStage = document.getElementById('slide-stage');
const slideThumbs = document.getElementById('slide-thumbs');
let slidesHistory = [JSON.stringify(slides)];

function saveSlides(){ localStorage.setItem('wb_slides', JSON.stringify(slides)); }
function pushSlidesHistory(){ slidesHistory.push(JSON.stringify(slides)); if(slidesHistory.length>50) slidesHistory.shift(); }
function undoSlides(){
  if(slidesHistory.length<2) return;
  slidesHistory.pop();
  slides = JSON.parse(slidesHistory[slidesHistory.length-1]);
  currentSlideIdx = Math.min(currentSlideIdx, slides.length-1);
  saveSlides(); renderSlideStage();
}
document.getElementById('slide-undo').addEventListener('click', undoSlides);

function renderSlideStage(){
  slideStage.innerHTML='';
  const slide = slides[currentSlideIdx];
  slide.elements.forEach(elData=>{
    const el = document.createElement('div');
    el.className='slide-el';
    el.style.left=elData.x+'px'; el.style.top=elData.y+'px'; el.style.width=elData.w+'px'; el.style.height=elData.h+'px';
    if(elData.type==='text'){
      el.contentEditable=true; el.style.fontSize=(elData.fontSize||24)+'px';
      el.innerText = elData.text||'Click to edit';
      el.addEventListener('input', ()=>{ elData.text=el.innerText; saveSlides(); });
      el.addEventListener('blur', ()=>pushSlidesHistory());
    } else if(elData.type==='image'){
      const img=document.createElement('img'); img.src=elData.src; el.appendChild(img);
    }
    makeSlideElDraggable(el, elData);
    slideStage.appendChild(el);
  });
  renderThumbs();
}

function makeSlideElDraggable(el, elData){
  el.addEventListener('mousedown', e=>{
    if(el.isContentEditable && e.detail>0 && document.activeElement===el) return;
    e.stopPropagation();
    const startX=e.clientX, startY=e.clientY, origX=elData.x, origY=elData.y;
    let moved=false;
    function onMove(ev){
      elData.x=origX+(ev.clientX-startX); elData.y=origY+(ev.clientY-startY);
      el.style.left=elData.x+'px'; el.style.top=elData.y+'px';
      if(Math.abs(ev.clientX-startX)>2||Math.abs(ev.clientY-startY)>2) moved=true;
    }
    function onUp(){ document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); saveSlides(); if(moved) pushSlidesHistory(); }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  });
}

function renderThumbs(){
  slideThumbs.innerHTML='';
  slides.forEach((s,idx)=>{
    const t=document.createElement('div'); t.className='slide-thumb'+(idx===currentSlideIdx?' active':'');
    t.textContent = 'Slide '+(idx+1);
    t.addEventListener('click', ()=>{ currentSlideIdx=idx; renderSlideStage(); });
    slideThumbs.appendChild(t);
  });
}

document.getElementById('slide-add-text').addEventListener('click', ()=>{
  slides[currentSlideIdx].elements.push({type:'text', x:60,y:60,w:400,h:80,text:'New text', fontSize:28});
  saveSlides(); renderSlideStage(); pushSlidesHistory();
});
document.getElementById('slide-add-image').addEventListener('click', ()=>document.getElementById('slideImageInput').click());
document.getElementById('slideImageInput').addEventListener('change', e=>{
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>{
    slides[currentSlideIdx].elements.push({type:'image', x:100,y:100,w:300,h:220,src:ev.target.result});
    saveSlides(); renderSlideStage(); pushSlidesHistory();
  };
  reader.readAsDataURL(file); e.target.value='';
});
document.getElementById('slide-new').addEventListener('click', ()=>{
  slides.push({elements:[]}); currentSlideIdx=slides.length-1; saveSlides(); renderSlideStage(); pushSlidesHistory();
});
document.getElementById('slide-del').addEventListener('click', ()=>{
  if(slides.length<=1){ alert('At least one slide is required.'); return; }
  slides.splice(currentSlideIdx,1); currentSlideIdx=Math.max(0,currentSlideIdx-1);
  saveSlides(); renderSlideStage(); pushSlidesHistory();
});

document.getElementById('slide-export-pdf').addEventListener('click', ()=>{
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({orientation:'landscape', unit:'px', format:[900,506]});
  function renderSlideToCanvasAndAdd(i){
    const slide = slides[i];
    const cnv = document.createElement('canvas'); cnv.width=900; cnv.height=506;
    const c = cnv.getContext('2d');
    c.fillStyle='#fff'; c.fillRect(0,0,900,506);
    const imgs = slide.elements.filter(e=>e.type==='image');
    let pending = imgs.length;
    function finish(){
      if(i>0) pdf.addPage([900,506],'landscape');
      pdf.addImage(cnv.toDataURL('image/png'),'PNG',0,0,900,506);
      if(i+1<slides.length) renderSlideToCanvasAndAdd(i+1);
      else pdf.save('slides.pdf');
    }
    slide.elements.filter(e=>e.type==='text').forEach(e=>{
      c.fillStyle='#000'; c.font=(e.fontSize||28)+'px sans-serif'; c.fillText(e.text, e.x, e.y+(e.fontSize||28));
    });
    if(pending===0){ finish(); return; }
    imgs.forEach(e=>{
      const im=new Image();
      im.onload=()=>{ c.drawImage(im, e.x, e.y, e.w, e.h); pending--; if(pending===0) finish(); };
      im.src=e.src;
    });
  }
  renderSlideToCanvasAndAdd(0);
});

document.getElementById('slide-export-pptx').addEventListener('click', ()=>{
  const pptx = new PptxGenJS();
  pptx.defineLayout({name:'SLIDES', width:10, height:5.63});
  pptx.layout='SLIDES';
  slides.forEach(slideData=>{
    const slide = pptx.addSlide();
    slideData.elements.forEach(el=>{
      const xIn=el.x/900*10, yIn=el.y/506*5.63, wIn=el.w/900*10, hIn=el.h/506*5.63;
      if(el.type==='text') slide.addText(el.text, {x:xIn,y:yIn,w:wIn,h:hIn, fontSize:(el.fontSize||28)/2, color:'000000'});
      else if(el.type==='image') slide.addImage({data:el.src, x:xIn,y:yIn,w:wIn,h:hIn});
    });
  });
  pptx.writeFile({fileName:'slides.pptx'});
});

const presentOverlay=document.getElementById('present-overlay');
const presentStage=document.getElementById('present-stage');
const presentCount=document.getElementById('present-count');
let presentIdx=0;
document.getElementById('present-btn').addEventListener('click', ()=>{
  presentIdx=currentSlideIdx; presentOverlay.classList.add('active'); renderPresentStage();
});
document.getElementById('present-close').addEventListener('click', ()=>presentOverlay.classList.remove('active'));
document.getElementById('present-prev').addEventListener('click', ()=>{ presentIdx=Math.max(0,presentIdx-1); renderPresentStage(); });
document.getElementById('present-next').addEventListener('click', ()=>{ presentIdx=Math.min(slides.length-1,presentIdx+1); renderPresentStage(); });
window.addEventListener('keydown', e=>{
  if(!presentOverlay.classList.contains('active')) return;
  if(e.key==='ArrowRight'){ presentIdx=Math.min(slides.length-1,presentIdx+1); renderPresentStage(); }
  if(e.key==='ArrowLeft'){ presentIdx=Math.max(0,presentIdx-1); renderPresentStage(); }
  if(e.key==='Escape'){ presentOverlay.classList.remove('active'); }
});
function renderPresentStage(){
  presentStage.innerHTML='';
  const slide = slides[presentIdx];
  const scaleFactor = presentStage.getBoundingClientRect().width / 900;
  slide.elements.forEach(elData=>{
    const el=document.createElement('div');
    el.style.position='absolute';
    el.style.left=(elData.x*scaleFactor)+'px'; el.style.top=(elData.y*scaleFactor)+'px';
    el.style.width=(elData.w*scaleFactor)+'px'; el.style.height=(elData.h*scaleFactor)+'px';
    if(elData.type==='text'){ el.innerText=elData.text; el.style.fontSize=((elData.fontSize||28)*scaleFactor)+'px'; }
    else if(elData.type==='image'){
      const img=document.createElement('img'); img.src=elData.src; img.style.width='100%'; img.style.height='100%'; img.style.objectFit='contain';
      el.appendChild(img);
    }
    presentStage.appendChild(el);
  });
  presentCount.textContent = (presentIdx+1)+' / '+slides.length;
}
renderSlideStage();

/* ============================================================
   PER-MODE UNDO ROUTER — each mode's history is independent and
   is never cleared when you switch tabs; Ctrl+Z / the undo button
   in each tab's toolbar calls only that mode's own undo function.
   ============================================================ */
function undoForMode(mode){
  if(mode==='board') undoBoard();
  else if(mode==='doc') undoDoc();
  else if(mode==='slides') undoSlides();
  else if(mode==='photobooth') undoPhotobooth();
}
function getHistoryStackForMode(mode){
  if(mode==='board') return history;
  if(mode==='doc') return docHistoryByTab[activeDocTabId] || [];
  if(mode==='slides') return slidesHistory;
  if(mode==='photobooth') return pbHistory;
  return [];
}
function restoreHistorySnapshot(mode, idx){
  if(mode==='board'){
    pushHistory();
    const prev = JSON.parse(history[idx]);
    items=prev.items; strokes=prev.strokes; connectors=prev.connectors||[];
    renderAll(); saveLocal();
  } else if(mode==='doc'){
    const stack = docHistoryByTab[activeDocTabId];
    stack.push(docEditable.innerHTML);
    docEditable.innerHTML = stack[idx];
    commitDocContent();
  } else if(mode==='slides'){
    pushSlidesHistory();
    slides = JSON.parse(slidesHistory[idx]);
    currentSlideIdx = Math.min(currentSlideIdx, slides.length-1);
    saveSlides(); renderSlideStage();
  } else if(mode==='photobooth'){
    pushPBHistory();
    applyPBSnapshot(pbHistory[idx]);
  }
  renderHistoryList();
}

})();
