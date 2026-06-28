const API='/api';
const MONTH_NAMES=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL=["January","February","March","April","May","June","July","August","September","October","November","December"];
const KEY_VIEW="sfg_view_v1";
const KEY_PLOT="sfg_plot_v1";
const KEY_UNITS="sfg_units_v1";
const KEY_FROST="sfg_frost_v1";

/* ---------- Preferences (per device) ---------- */
function getUnits(){return localStorage.getItem(KEY_UNITS)||'metric';}
function setUnits(u){localStorage.setItem(KEY_UNITS,u);}
function getFrost(){try{return JSON.parse(localStorage.getItem(KEY_FROST))||{};}catch(e){return {};}}
function setFrost(o){localStorage.setItem(KEY_FROST,JSON.stringify(o||{}));}

let vegDB={};
let plots=[];
let activePlotId=null;
let editingCellId=null;
let activeMonthIndex=0;

let _mutating=false;  // guards against double-submits (duplicate POST/PATCH/DELETE)
async function api(path,opts){
  opts=opts||{};
  const method=(opts.method||'GET').toUpperCase();
  const mutating=method!=='GET';
  if(mutating&&_mutating)throw new Error("A change is already saving — please wait a moment.");
  if(mutating)_mutating=true;
  try{
    const headers=opts.headers||{};
    let body=opts.body;
    if(body&&!(body instanceof FormData)&&typeof body!=='string'){
      body=JSON.stringify(body);
      headers['Content-Type']='application/json';
    }
    const res=await fetch(API+path,Object.assign({},opts,{headers,body}));
    if(!res.ok){
      let msg='HTTP '+res.status;
      try{const j=await res.json();msg=j.error||j.detail||JSON.stringify(j);}catch(e){}
      throw new Error(msg);
    }
    if(res.status===204)return null;
    const ct=res.headers.get('Content-Type')||'';
    if(ct.includes('application/json'))return res.json();
    return res.blob();
  }finally{
    if(mutating)_mutating=false;
  }
}

function escapeHtml(s){return (s||"").replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

/* ---------- Toast + reusable confirm / form modals ---------- */
function toast(msg,type){
  const wrap=document.getElementById("toast");if(!wrap)return;
  const el=document.createElement("div");
  el.className="toast-item "+(type||"info");
  el.textContent=msg;
  wrap.appendChild(el);
  requestAnimationFrame(()=>el.classList.add("show"));
  setTimeout(()=>{el.classList.remove("show");setTimeout(()=>el.remove(),300);},3200);
}

let _confirmResolve=null;
function confirmModal(message,opts){
  opts=opts||{};
  document.getElementById("confirmTitle").textContent=opts.title||"Please confirm";
  document.getElementById("confirmMessage").textContent=message;
  const ok=document.getElementById("confirmOk");
  ok.textContent=opts.okLabel||"Confirm";
  ok.className="btn "+(opts.danger?"btn-danger":"btn-primary");
  modalOpen("confirmModal","#confirmOk");
  return new Promise(res=>{_confirmResolve=res;});
}
function _confirmDone(v){
  modalClose("confirmModal");
  const r=_confirmResolve;_confirmResolve=null;if(r)r(v);
}

let _formResolve=null,_formFields=[];
function formModal(title,fields,opts){
  opts=opts||{};
  document.getElementById("formTitle").textContent=title;
  _formFields=fields;
  const body=document.getElementById("formBody");
  body.innerHTML=fields.map((f,i)=>{
    f._id="ff_"+i;
    const lbl='<label for="'+f._id+'">'+escapeHtml(f.label)+(f.opt?' <span class="opt">(optional)</span>':'')+'</label>';
    const val=escapeHtml(f.value!=null?String(f.value):'');
    if(f.type==="number")return lbl+'<input id="'+f._id+'" type="number" '+(f.min!=null?'min="'+f.min+'" ':'')+'value="'+val+'">';
    if(f.type==="date")return lbl+'<input id="'+f._id+'" type="date" value="'+val+'">';
    if(f.type==="textarea")return lbl+'<textarea id="'+f._id+'" rows="'+(f.rows||4)+'" placeholder="'+escapeHtml(f.placeholder||'')+'">'+val+'</textarea>';
    if(f.type==="select"){
      const opts=(f.options||[]).map(o=>'<option'+(String(f.value)===o?' selected':'')+'>'+escapeHtml(o)+'</option>').join("");
      return lbl+'<select id="'+f._id+'">'+opts+'</select>';
    }
    return lbl+'<input id="'+f._id+'" type="text" placeholder="'+escapeHtml(f.placeholder||'')+'" value="'+val+'">';
  }).join("");
  document.getElementById("formSubmit").textContent=opts.submitLabel||"Save";
  modalOpen("formModal","input,textarea");
  return new Promise(res=>{_formResolve=res;});
}
function _formDone(ok){
  if(!ok){modalClose("formModal");const r=_formResolve;_formResolve=null;if(r)r(null);return;}
  const out={};
  for(const f of _formFields){const el=document.getElementById(f._id);out[f.name]=el?el.value:"";}
  modalClose("formModal");
  const r=_formResolve;_formResolve=null;if(r)r(out);
}

/* ---------- Modal open/close: focus save / restore + focus trap ---------- */
const _focusStack=[];
function _focusFirst(modal,sel){
  const el=sel?modal.querySelector(sel):modal.querySelector("input,textarea,select,button");
  if(el){el.focus();if(el.tagName==="INPUT"&&el.select)el.select();}
}
function modalOpen(id,sel){
  const m=document.getElementById(id);if(!m)return;
  _focusStack.push(document.activeElement);
  m.classList.add("open");
  setTimeout(()=>_focusFirst(m,sel),50);
}
function modalClose(id){
  const m=document.getElementById(id);if(!m||!m.classList.contains("open"))return;
  m.classList.remove("open");
  const prev=_focusStack.pop();
  if(prev&&prev.focus)setTimeout(()=>{try{prev.focus();}catch(e){}},0);
}
// Keep Tab focus within the topmost open modal.
document.addEventListener("keydown",e=>{
  if(e.key!=="Tab")return;
  const open=document.querySelectorAll(".modal.open");
  if(!open.length)return;
  const m=open[open.length-1];
  const f=m.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])');
  if(!f.length)return;
  const first=f[0],last=f[f.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
});

async function loadVegDB(){
  const list=await api('/veg/');
  vegDB={};
  for(const v of list)vegDB[v.key]=v;
}

async function loadPlots(){
  plots=await api('/plots/');
  plots.sort((a,b)=>a.id-b.id);
  const saved=parseInt(localStorage.getItem(KEY_PLOT));
  if(plots.length){
    if(!plots.some(p=>p.id===activePlotId)){
      activePlotId=plots.some(p=>p.id===saved)?saved:plots[0].id;
    }
  }else{activePlotId=null;}
}

function activePlot(){return plots.find(p=>p.id===activePlotId)||null;}
function replacePlot(updated){const i=plots.findIndex(p=>p.id===updated.id);if(i>=0)plots[i]=updated;}
function persistActivePlot(){if(activePlotId!=null)localStorage.setItem(KEY_PLOT,String(activePlotId));}
function cellsByPosition(p){const m={};(p.cells||[]).forEach(c=>{m[c.position]=c;});return m;}
function getEditingCell(){const p=activePlot();if(!p)return null;return (p.cells||[]).find(c=>c.id===editingCellId)||null;}
function replaceCell(updated){
  const p=activePlot();if(!p)return;
  const cells=p.cells||(p.cells=[]);
  const idx=cells.findIndex(c=>c.id===updated.id);
  if(idx>=0)cells[idx]=updated;else cells.push(updated);
}

function vegLookup(key){if(!key)return null;return vegDB[key]||null;}
function vegLookupByName(name){
  if(!name)return null;
  const ln=name.toLowerCase();
  for(const k in vegDB)if(vegDB[k].name.toLowerCase()===ln)return vegDB[k];
  return null;
}

function fallbackEmoji(name){
  if(!name)return "➕";
  const n=name.toLowerCase();
  const map=[
    [["tomato"],"🍅"],
    [["carrot"],"🥕"],
    [["aubergine","eggplant"],"🍆"],
    [["cucumber"],"🥒"],
    [["sweetcorn","corn"],"🌽"],
    [["pepper","chilli","chili"],"🌶️"],
    [["potato"],"🥔"],
    [["onion","shallot"],"🧅"],
    [["garlic"],"🧄"],
    [["pumpkin","butternut","squash","marrow","courgette"],"🎃"],
    [["mushroom"],"🍄"],
    [["broccoli","cauliflower"],"🥦"],
    [["lettuce","pak choi","chinese cabbage","salad","cabbage","brussels","kale","kalette","spinach","swiss chard"],"🥬"],
    [["bean","pea","kohl rabi"],"🫛"],
    [["radish","beetroot","turnip","swede","parsnip","celeriac","celery","fennel","artichoke","yacon","oca","asparagus"],"🥕"],
    [["mint","thyme","verbena","chicory","leek","herb"],"🌿"]
  ];
  for(const [keys,emoji] of map){if(keys.some(k=>n.includes(k)))return emoji;}
  return "🌱";
}

function vegVisual(name){
  const e=vegLookupByName(name);
  if(e&&e.image_url)return {type:"img",value:e.image_url};
  if(e&&e.emoji)return {type:"emoji",value:e.emoji};
  return {type:"emoji",value:fallbackEmoji(name)};
}

function monthInRange(m,s,e){if(!s||!e)return false;return s<=e?(m>=s&&m<=e):(m>=s||m<=e);}
function rangeLabel(s,e){if(!s||!e)return "—";return MONTH_NAMES[s-1]+" – "+MONTH_NAMES[e-1];}
// The four sow methods, each with its own from/to month window on the veg.
const SOW_METHODS=[
  {start:"sow_outdoors_start",end:"sow_outdoors_end",cls:"sow-outdoors",label:"Sow outdoors"},
  {start:"sow_covered_start",end:"sow_covered_end",cls:"sow-covered",label:"Sow outdoors (covered)"},
  {start:"sow_indoors_start",end:"sow_indoors_end",cls:"sow-indoors",label:"Sow indoors"},
  {start:"plant_out_start",end:"plant_out_end",cls:"plant-out",label:"Plant outside"}
];
function vegSowsInMonth(v,m){return SOW_METHODS.some(meth=>monthInRange(m,v[meth.start],v[meth.end]));}
function vegSowMethodsSet(v){return SOW_METHODS.filter(meth=>v[meth.start]&&v[meth.end]);}
function parseLocalDate(d){
  if(!d)return null;
  const p=String(d).split("-");
  if(p.length!==3)return null;
  const dt=new Date(+p[0],(+p[1])-1,+p[2]);  // local midnight, no UTC drift
  return isNaN(dt)?null:dt;
}
function daysSince(d){
  const then=parseLocalDate(d);
  if(!then)return null;
  const n=new Date();
  const today=new Date(n.getFullYear(),n.getMonth(),n.getDate());
  return Math.round((today-then)/86400000);
}
function daysLabel(d){if(d===null)return "";if(d<0)return "in "+(-d)+"d";if(d===0)return "today";if(d===1)return "1d ago";return d+"d ago";}
function todayISO(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}

/* ---------- Garden intelligence (families, companions, rotation, succession) ---------- */
const VEG_FAMILIES=[
  {fam:'Brassicas',keys:['cabbage','kale','broccoli','cauliflower','brussels','kohl rabi','kohlrabi','pak choi','chinese cabbage','turnip','swede','radish','kalette','mustard','rocket']},
  {fam:'Alliums',keys:['onion','shallot','garlic','leek','chive','spring onion']},
  {fam:'Solanaceae',keys:['tomato','potato','pepper','chilli','chili','aubergine','eggplant']},
  {fam:'Legumes',keys:['bean','pea ','peas','broad bean']},
  {fam:'Cucurbits',keys:['cucumber','courgette','marrow','pumpkin','squash','melon','gourd']},
  {fam:'Umbellifers',keys:['carrot','parsnip','celery','celeriac','fennel','parsley','dill','coriander']},
  {fam:'Chenopods',keys:['beetroot','beet','chard','spinach']},
  {fam:'Lettuce family',keys:['lettuce','chicory','endive','salsify','artichoke','lambs lettuce']}
];
function vegFamily(name){
  const n=(' '+(name||'').toLowerCase()+' ');
  for(const f of VEG_FAMILIES){if(f.keys.some(k=>n.includes(k)))return f.fam;}
  return null;
}
const COMPANIONS={
  'Brassicas':{good:['alliums','beetroot','aromatic herbs'],bad:['tomato','beans & peas','strawberry']},
  'Alliums':{good:['carrots','brassicas','lettuce','beetroot'],bad:['peas & beans']},
  'Solanaceae':{good:['onions','carrots','basil','marigold'],bad:['brassicas','potato','fennel']},
  'Legumes':{good:['cucurbits','carrots','sweetcorn'],bad:['onions & garlic']},
  'Cucurbits':{good:['beans','sweetcorn','nasturtium'],bad:['potato']},
  'Umbellifers':{good:['onions','tomato','peas'],bad:['dill near carrots']},
  'Chenopods':{good:['onions','brassicas'],bad:[]},
  'Lettuce family':{good:['carrots','onions','radish'],bad:[]}
};
function rotationWarning(cell,vegName){
  const fam=vegFamily(vegName);
  if(!fam||!cell||!cell.history)return null;
  const cutoff=new Date();cutoff.setFullYear(cutoff.getFullYear()-1);
  for(const h of cell.history){
    if(h.event_type!=='planted'&&h.event_type!=='harvested')continue;
    if(vegFamily(h.veg_name)!==fam)continue;
    const d=parseLocalDate(h.date);
    if(d&&d>=cutoff)return fam+' grew in this square within the last year — rotating to a different family helps avoid soil pests & disease.';
  }
  return null;
}
function companionText(vegName){
  const c=COMPANIONS[vegFamily(vegName)];if(!c)return null;
  let s='';
  if(c.good.length)s+='✅ Good near '+c.good.join(', ');
  if(c.bad.length)s+=(s?' · ':'')+'⛔ Keep from '+c.bad.join(', ');
  return s;
}
function sowNowList(month,limit){
  const m=month||(new Date().getMonth()+1);
  return Object.values(vegDB).filter(v=>vegSowsInMonth(v,m)).map(v=>v.name).sort();
}
function frostNote(){
  const f=getFrost();const m=new Date().getMonth()+1;
  if(f.last&&m<=f.last)return ' <span class="frost-note">❄️ tender crops: wait until after '+MONTH_FULL[f.last-1]+' (last frost)</span>';
  return '';
}

function switchView(name){
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+name));
  localStorage.setItem(KEY_VIEW,name);
  if(name==="settings")renderSettings();
  if(name==="charts")renderCharts();
  if(name==="sowchart")renderSowChart();
  if(name==="designer")renderDesigner();
  if(name==="today")renderToday();
}

function _todayHeading(){
  const d=new Date();const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return days[d.getDay()]+', '+d.getDate()+' '+MONTH_FULL[d.getMonth()];
}
function renderToday(){
  const el=document.getElementById("todayBody");if(!el)return;
  const m=new Date().getMonth()+1;
  const ready=[];
  plots.filter(p=>p.kind!=='plant').forEach(p=>{
    (p.cells||[]).forEach(c=>{
      if(c.veg&&c.date_sown&&c.veg.days_to_harvest){
        const dS=daysSince(c.date_sown);
        if(dS!==null&&(c.veg.days_to_harvest-dS)<=0)ready.push({bed:p.name,cols:p.cols,pos:c.position,veg:c.veg.name,over:dS-c.veg.days_to_harvest});
      }
    });
  });
  ready.sort((a,b)=>b.over-a.over);
  const compost=[];
  plots.forEach(p=>{
    const ds=p.last_composted?daysSince(p.last_composted):null;
    if(p.last_composted==null||ds>60)compost.push({bed:p.name,days:ds});
  });
  const sow=sowNowList(m);
  let html='<div class="today-head"><h2>🗓 '+_todayHeading()+'</h2></div>';
  html+='<div class="today-card"><h3>🧺 Ready to harvest <span class="cnt">'+ready.length+'</span></h3>';
  html+=ready.length?'<ul class="today-list">'+ready.slice(0,40).map(r=>'<li><span>'+escapeHtml(r.veg)+'</span><span class="t-where">'+escapeHtml(r.bed)+' · '+rcLabel(r.pos,r.cols)+(r.over>0?' · '+r.over+'d over':'')+'</span></li>').join('')+'</ul>':'<div class="chart-empty">Nothing ready right now.</div>';
  html+='</div>';
  html+='<div class="today-card"><h3>🌱 Sow this month'+frostNote()+'</h3>';
  html+=sow.length?'<div class="sow-tags">'+sow.map(n=>'<span class="sow-tag" onclick="showVegDetail(\''+escapeHtml(slugForName(n))+'\')">'+escapeHtml(n)+'</span>').join('')+'</div>':'<div class="chart-empty">Nothing to sow this month.</div>';
  html+='</div>';
  html+='<div class="today-card"><h3>🍂 Compost due <span class="cnt">'+compost.length+'</span></h3>';
  html+=compost.length?'<ul class="today-list">'+compost.map(c=>'<li><span>'+escapeHtml(c.bed)+'</span><span class="t-where">'+(c.days==null?'never composted':c.days+'d ago')+'</span></li>').join('')+'</ul>':'<div class="chart-empty">All beds recently composted.</div>';
  html+='</div>';
  el.innerHTML=html;
}
function slugForName(name){const v=vegLookupByName(name);return v?v.key:'';}
document.querySelectorAll(".nav-btn").forEach(b=>b.onclick=()=>switchView(b.dataset.view));

function refreshDatalist(){
  const dl=document.getElementById("vegDataList");dl.innerHTML="";
  Object.values(vegDB).map(v=>v.name).sort().forEach(n=>{const o=document.createElement("option");o.value=n;dl.appendChild(o);});
}

const monthsEl=document.getElementById("months");
const detailEl=document.getElementById("monthDetail");

function buildMonthButtons(){
  monthsEl.innerHTML="";
  MONTH_FULL.forEach((m,i)=>{
    const b=document.createElement("button");b.className="month-btn";b.textContent=m;
    b.onclick=()=>showMonth(i+1,b);monthsEl.appendChild(b);
  });
}

function showMonth(mn,btn){
  activeMonthIndex=mn;
  document.querySelectorAll(".month-btn").forEach(b=>b.classList.remove("active"));
  if(btn)btn.classList.add("active");
  const plants=[],harvests=[];
  Object.values(vegDB).forEach(v=>{
    if(vegSowsInMonth(v,mn))plants.push(v);
    if(monthInRange(mn,v.harvest_start,v.harvest_end))harvests.push(v);
  });
  plants.sort((a,b)=>a.name.localeCompare(b.name));
  harvests.sort((a,b)=>a.name.localeCompare(b.name));
  const rl=arr=>{
    if(!arr.length)return '<div class="empty-msg">Nothing this month</div>';
    return '<div class="veg-list">'+arr.map(v=>{
      const vis=vegVisual(v.name);
      const icon=vis.type==="img"?'<img src="'+vis.value+'" style="width:18px;height:18px;border-radius:50%;object-fit:cover">':'<span>'+vis.value+'</span>';
      return '<button class="veg-list-btn" onclick="showVegDetail(\''+v.key+'\')">'+icon+' '+escapeHtml(v.name)+'</button>';
    }).join("")+'</div>';
  };
  const f=getFrost();let frostLine='';
  if(f.last===mn)frostLine='<div class="frost-line">❄️ Around your last spring frost — sow tender crops (tomatoes, courgettes, beans) outdoors only after this.</div>';
  else if(f.first===mn)frostLine='<div class="frost-line">❄️ Around your first autumn frost — protect or harvest tender crops.</div>';
  detailEl.innerHTML='<div class="month-detail"><h3>'+MONTH_FULL[mn-1]+'</h3>'+frostLine+'<div class="cols"><div class="col"><h4>🌱 Plant</h4>'+rl(plants)+'</div><div class="col"><h4>🧺 Harvest</h4>'+rl(harvests)+'</div></div></div>';
}

function refreshGuideIfActive(){
  if(document.getElementById("view-guide").classList.contains("active")&&activeMonthIndex){
    const b=document.querySelectorAll(".month-btn")[activeMonthIndex-1];
    showMonth(activeMonthIndex,b);
  }
}

function renderSearchResults(q){
  const dd=document.getElementById("searchDropdown");
  const query=(q||"").trim().toLowerCase();
  if(!query){closeSearchDropdown();return;}
  const es=Object.values(vegDB)
    .filter(v=>v.name.toLowerCase().includes(query)||(v.latin_name||"").toLowerCase().includes(query))
    .sort((a,b)=>a.name.localeCompare(b.name)).slice(0,8);
  if(!es.length){dd.innerHTML='<div class="no-results">No plants match "'+escapeHtml(q)+'"</div>';}
  else{
    dd.innerHTML=es.map(v=>{
      const vis=vegVisual(v.name);
      const t=vis.type==="img"?'<img src="'+vis.value+'" alt="">':'<span>'+vis.value+'</span>';
      return '<div class="search-result-item" onclick="selectSearchResult(\''+v.key+'\')"><div class="search-result-thumb">'+t+'</div><div class="search-result-text"><div class="search-result-name">'+escapeHtml(v.name)+'</div>'+(v.latin_name?'<div class="search-result-latin">'+escapeHtml(v.latin_name)+'</div>':"")+'</div></div>';
    }).join("");
  }
  dd.classList.add("open");
}
function closeSearchDropdown(){document.getElementById("searchDropdown").classList.remove("open");}
function selectSearchResult(key){closeSearchDropdown();const i=document.getElementById("guideSearch");if(i)i.value="";showVegDetail(key);}

function infoCard(label,value){
  return `<div class="veg-info-card"><div class="lbl">${label}</div><div class="val">${escapeHtml(String(value))}</div></div>`;
}
function showVegDetail(key){
  const v=vegLookup(key);if(!v)return;
  const vis=vegVisual(v.name);
  const vh=vis.type==="img"?`<img src="${escapeHtml(vis.value)}" alt="">`:`<span>${vis.value}</span>`;
  const latin=v.latin_name?`<div class="latin">${escapeHtml(v.latin_name)}</div>`:"";
  const notes=v.notes?`<div class="veg-notes"><div class="veg-notes-label">Growing tips</div>${escapeHtml(v.notes).replace(/\n/g,"<br>")}</div>`:"";
  document.getElementById("vegDetailBody").innerHTML=`
    <div class="veg-detail-header">
      <div class="veg-detail-img">${vh}</div>
      <div class="veg-detail-title"><h2>${escapeHtml(v.name)}</h2>${latin}</div>
    </div>
    <div class="veg-info-grid">
      ${vegSowMethodsSet(v).map(meth=>infoCard("🌱 "+meth.label,rangeLabel(v[meth.start],v[meth.end]))).join("")||infoCard("🌱 Sow","—")}
      ${infoCard("🧺 Harvest months",rangeLabel(v.harvest_start,v.harvest_end))}
      ${infoCard("📐 Per sq ft",v.per_sq_ft)}
      ${infoCard("⏱ Days to harvest",v.days_to_harvest)}
    </div>${notes}`;
  modalOpen("vegDetailModal",".btn-primary");
}
function closeVegDetail(){modalClose("vegDetailModal");}

/* ---------- Plots & grid ---------- */

const gridEl=document.getElementById("grid");

function buildPlotTabs(){
  const el=document.getElementById("plotTabs");
  if(!plots.length){el.innerHTML='<span class="chart-empty" style="padding:.3rem 0">No beds yet — create one →</span>';return;}
  el.innerHTML=plots.map(p=>'<button class="plot-tab'+(p.id===activePlotId?' active':'')+'" onclick="switchPlot('+p.id+')">'+(p.kind==='plant'?'🌷':'🥕')+' '+escapeHtml(p.name)+' <span class="dim">'+p.rows+'×'+p.cols+'</span></button>').join("");
}

function switchPlot(id){activePlotId=id;persistActivePlot();buildPlotTabs();buildGrid();}

function renderCompostStatus(){
  const el=document.getElementById("compostStatus");if(!el)return;
  const p=activePlot();
  if(!p){el.textContent="";return;}
  if(p.last_composted){
    const ds=daysSince(p.last_composted);
    el.innerHTML='🍂 Last composted: <strong>'+p.last_composted+'</strong>'+(ds!==null?' · '+daysLabel(ds):'');
  }else{
    el.innerHTML='🍂 No compost recorded for this bed yet.';
  }
}

async function addCompost(){
  const p=activePlot();if(!p){toast("No bed selected","error");return;}
  const v=await formModal('🍂 Add compost to "'+p.name+'"',
    [{name:'date',label:'Date compost was added',type:'date',value:todayISO()}],
    {submitLabel:'Save'});
  if(!v)return;
  const iso=(v.date||'').trim()||todayISO();
  try{
    const updated=await api('/plots/'+p.id+'/add_compost/',{method:'POST',body:{date:iso}});
    replacePlot(updated);renderCompostStatus();buildPlotTabs();toast("Compost recorded","success");
  }catch(e){toast("Failed: "+e.message,"error");}
}

function openBedNotes(){
  const p=activePlot();if(!p){toast("No bed selected","error");return;}
  document.getElementById("bedNotesTitle").textContent='📝 Notes — '+p.name;
  document.getElementById("bedNotesText").value=p.notes||"";
  modalOpen("bedNotesModal","#bedNotesText");
}
function closeBedNotes(){modalClose("bedNotesModal");}
async function saveBedNotes(){
  const p=activePlot();if(!p)return;
  const notes=document.getElementById("bedNotesText").value;
  try{
    const updated=await api('/plots/'+p.id+'/',{method:'PATCH',body:{notes:notes}});
    replacePlot(updated);closeBedNotes();renderBedNotes();toast("Notes saved","success");
  }catch(e){toast("Failed: "+e.message,"error");}
}
function renderBedNotes(){
  const el=document.getElementById("bedNotes");if(!el)return;
  const p=activePlot();
  if(p&&(p.notes||"").trim()){el.innerHTML='📝 '+escapeHtml(p.notes).replace(/\n/g,'<br>');el.style.display='block';}
  else{el.style.display='none';el.innerHTML='';}
}

function buildGrid(){
  const p=activePlot();
  renderCompostStatus();
  renderBedNotes();
  const stat=document.getElementById("plantedStat");
  if(!p){
    gridEl.style.gridTemplateColumns="1fr";
    gridEl.innerHTML='<div style="color:#fff;text-align:center;padding:1.5rem;font-style:italic">No bed selected. Click “＋ New bed” to start.</div>';
    stat.textContent="0/0 squares";
    return;
  }
  if(p.kind==='plant'){buildPlantGrid(p,stat);return;}
  gridEl.style.gridTemplateColumns="repeat("+p.cols+",1fr)";
  gridEl.innerHTML="";
  const byPos=cellsByPosition(p);
  const total=p.rows*p.cols;
  let planted=0,seedsT=0,harvT=0;
  for(let i=0;i<total;i++){
    const c=byPos[i]||{id:null,veg:null,date_sown:null,seeds_planted:0,total_harvested:0,total_failed:0,history:[]};
    const row=Math.floor(i/p.cols)+1,col=(i%p.cols)+1;
    const vegName=c.veg?c.veg.name:"";
    const has=vegName||c.date_sown;
    if(has)planted++;
    seedsT+=c.seeds_planted||0;
    harvT+=c.total_harvested||0;
    const cell=document.createElement("button");
    cell.type="button";
    cell.className="cell "+(has?"planted":"empty");
    cell.setAttribute("aria-label","Square "+row+","+col+(vegName?": "+vegName:": empty"));
    cell.onclick=()=>openEditModal(i);
    const vis=vegVisual(vegName);
    const vh=vis.type==="img"?'<img class="cell-img" src="'+vis.value+'" alt="">':'<div class="cell-emoji">'+vis.value+'</div>';
    const dS=daysSince(c.date_sown);
    const e=c.veg;
    let hh="";
    if(dS!==null&&e&&e.days_to_harvest){
      const rem=e.days_to_harvest-dS;
      if(rem<=0)hh='<div class="cell-harvest ready">🧺 Ready!</div>';
      else hh='<div class="cell-harvest">'+rem+'d to harvest</div>';
    }
    const totals=(c.total_harvested||c.total_failed)?'<div class="totals-line">🧺'+(c.total_harvested||0)+' · ❌'+(c.total_failed||0)+'</div>':"";
    const seedBadge=(has&&c.seeds_planted>0)?'<div class="seed-badge">🌱'+c.seeds_planted+'</div>':"";
    cell.innerHTML='<div class="cell-label">'+row+','+col+'</div>'+seedBadge+vh+'<div style="display:flex;flex-direction:column;align-items:center;gap:2px;width:100%">'+(vegName?'<div class="cell-veg">'+escapeHtml(vegName)+'</div>':"")+(c.date_sown?'<div class="cell-days">'+daysLabel(dS)+'</div>':"")+hh+totals+'</div>';
    gridEl.appendChild(cell);
  }
  stat.textContent=planted+"/"+total+" squares · 🌱"+seedsT+" seeds · 🧺"+harvT+" harvested";
}

/* ---------- Plant beds ---------- */
function plantEmoji(name){
  const n=(name||"").toLowerCase();
  const map=[
    [["rose"],"🌹"],[["tulip"],"🌷"],[["daffodil","narcissus"],"🌼"],[["sunflower"],"🌻"],
    [["hydrangea","peony","dahlia","camellia","flower","bloom"],"🌸"],
    [["lavender","salvia","catmint"],"💜"],
    [["tree","oak","maple","birch","acer","shrub","bush","hedge","rhododendron","azalea","box"],"🌳"],
    [["fern","hosta"],"🌿"],[["grass","pampas","miscanthus"],"🌾"],
    [["cactus","succulent","sedum"],"🌵"],[["bamboo"],"🎋"],
    [["herb","rosemary","thyme","sage","mint"],"🌿"],
    [["foxglove","lupin","delphinium","hollyhock","hibiscus"],"🌺"]
  ];
  for(const [keys,e] of map){if(keys.some(k=>n.includes(k)))return e;}
  return "🌷";
}
function sunIcon(s){return s==='Full sun'?'☀️':s==='Partial shade'?'⛅':s==='Full shade'?'☁️':'';}
function waterIcon(w){return w==='High'?'💧💧':w==='Medium'?'💧':w==='Low'?'💧·':'';}

function buildPlantGrid(p,stat){
  gridEl.style.gridTemplateColumns="repeat("+p.cols+",1fr)";
  gridEl.innerHTML="";
  const byPos=cellsByPosition(p);
  const total=p.rows*p.cols;
  let planted=0;
  for(let i=0;i<total;i++){
    const c=byPos[i]||{id:null,plant:null};
    const pl=c.plant;
    const has=!!pl;
    if(has)planted++;
    const row=Math.floor(i/p.cols)+1,col=(i%p.cols)+1;
    const cell=document.createElement("button");
    cell.type="button";
    cell.className="cell "+(has?"planted":"empty");
    cell.setAttribute("aria-label","Square "+row+","+col+(has?": "+pl.name:": empty"));
    cell.onclick=()=>openPlantModal(i);
    const emoji='<div class="cell-emoji">'+(has?plantEmoji(pl.name):"🌿")+'</div>';
    let info="";
    if(has){
      info='<div class="cell-veg">'+escapeHtml(pl.name)+'</div>';
      const dS=daysSince(pl.date_planted);
      if(pl.date_planted&&dS!==null)info+='<div class="cell-days">'+daysLabel(dS)+'</div>';
      const badges=[sunIcon(pl.sun_level),waterIcon(pl.water_level)].filter(Boolean).join(' ');
      if(badges)info+='<div class="totals-line">'+badges+'</div>';
    }
    cell.innerHTML='<div class="cell-label">'+row+','+col+'</div>'+emoji+'<div style="display:flex;flex-direction:column;align-items:center;gap:2px;width:100%">'+info+'</div>';
    gridEl.appendChild(cell);
  }
  stat.textContent=planted+"/"+total+" squares planted";
}

let editingPlantCellId=null;
function _editingPlantCell(){const p=activePlot();if(!p)return null;return (p.cells||[]).find(c=>c.id===editingPlantCellId)||null;}
function openPlantModal(pos){
  const p=activePlot();if(!p)return;
  const c=cellsByPosition(p)[pos];
  if(!c||c.id==null)return;
  editingPlantCellId=c.id;
  const cur=c.plant;
  const row=Math.floor(pos/p.cols)+1,col=(pos%p.cols)+1;
  document.getElementById("plantModalTitle").textContent=p.name+" · square "+row+","+col;
  document.getElementById("plantClearBtn").style.display=cur?"":"none";
  const pick=document.getElementById("plantPick");
  pick.innerHTML='<option value="">— choose a plant —</option>';
  document.getElementById("plantPickInfo").style.display="none";
  const _pf=document.getElementById("plantFields");if(_pf)_pf.style.display="none";
  loadPlantCatalog().then(()=>{
    const avail=plantCatalog.slice().sort((a,b)=>a.name.localeCompare(b.name));
    if(!avail.length){
      pick.innerHTML='<option value="">— no plants in your database —</option>';
    }else{
      pick.innerHTML='<option value="">— choose a plant —</option>'+
        avail.map(x=>'<option value="'+x.id+'"'+(cur&&cur.id===x.id?' selected':'')+'>'+escapeHtml(x.name)+'</option>').join('');
    }
    onPlantPick();
  });
  modalOpen("plantModal","#plantPick");
}
function onPlantPick(){
  const pid=document.getElementById("plantPick").value;
  const info=document.getElementById("plantPickInfo");
  const fields=document.getElementById("plantFields");
  const pl=plantCatalog.find(x=>String(x.id)===String(pid));
  if(!pl){info.style.display="none";info.innerHTML="";if(fields)fields.style.display="none";return;}
  const bits=[];
  if(pl.latin_name)bits.push('<span style="font-style:italic">'+escapeHtml(pl.latin_name)+'</span>');
  if(pl.sun_level)bits.push('☀️ '+escapeHtml(pl.sun_level));
  if(pl.water_level)bits.push('💧 '+escapeHtml(pl.water_level));
  if(pl.soil_type)bits.push('🪴 '+escapeHtml(pl.soil_type));
  let html='<strong>'+escapeHtml(pl.name)+'</strong>';
  if(bits.length)html+='<br>'+bits.join(' · ');
  info.innerHTML=html;info.style.display="block";
  if(fields){
    document.getElementById("plantDate").value=pl.date_planted||"";
    document.getElementById("plantNotes").value=pl.about||"";
    fields.style.display="block";
  }
}
function closePlantModal(){modalClose("plantModal");editingPlantCellId=null;}
async function savePlant(){
  const pid=document.getElementById("plantPick").value;
  if(!pid){toast("Choose a plant from the list","error");return;}
  if(!editingPlantCellId)return;
  const btn=document.getElementById("plantSaveBtn");if(btn)btn.disabled=true;
  try{
    // Save the planted date + notes onto the plant (which this square holds),
    // then place it in the square.
    const dateV=document.getElementById("plantDate").value;
    const notesV=document.getElementById("plantNotes").value;
    const plantUpd=await api('/plants/'+pid+'/',{method:'PATCH',body:{date_planted:dateV||null,about:notesV}});
    const i=plantCatalog.findIndex(x=>String(x.id)===String(pid));if(i>=0)plantCatalog[i]=plantUpd;
    updatePlantInPlots(plantUpd);
    const updated=await api('/cells/'+editingPlantCellId+'/place_plant/',{method:'POST',body:{plant_id:parseInt(pid)}});
    replaceCell(updated);buildGrid();closePlantModal();toast("Plant placed","success");
  }catch(e){toast("Failed: "+e.message,"error");}
  finally{if(btn)btn.disabled=false;}
}
async function clearPlant(){
  const c=_editingPlantCell();if(!c)return;
  if(!c.plant){closePlantModal();return;}
  const ok=await confirmModal("Remove this plant from the square? It stays in your plant database.",{danger:true,okLabel:'Remove'});
  if(!ok)return;
  try{
    const updated=await api('/cells/'+c.id+'/unplace_plant/',{method:'POST'});
    replaceCell(updated);buildGrid();closePlantModal();toast("Plant removed from square","success");
  }catch(e){toast("Failed: "+e.message,"error");}
}

const KIND_LABELS=['Veg plot','Plant plot'];
function kindToLabel(k){return k==='plant'?'Plant plot':'Veg plot';}
function labelToKind(l){return l==='Plant plot'?'plant':'veg';}
function hasPlantings(p){
  return (p.cells||[]).some(c=>c.veg||c.date_sown||c.seeds_planted||c.total_harvested||c.total_failed||c.plant);
}

async function createPlot(){
  const v=await formModal('New bed',[
    {name:'kind',label:'Type',type:'select',options:KIND_LABELS,value:'Veg plot'},
    {name:'name',label:'Name',type:'text',value:'New bed',placeholder:'e.g. Tomato Bed'},
    {name:'rows',label:'Rows (squares tall)',type:'number',value:4,min:1},
    {name:'cols',label:'Columns (squares wide)',type:'number',value:4,min:1},
  ],{submitLabel:'Create bed'});
  if(!v)return;
  const rows=parseInt(v.rows),cols=parseInt(v.cols);
  if(isNaN(rows)||rows<1||isNaN(cols)||cols<1){toast("Enter valid row and column numbers","error");return;}
  const name=(v.name||"").trim()||"New bed";
  try{
    const np=await api('/plots/',{method:'POST',body:{name:name,rows:rows,cols:cols,kind:labelToKind(v.kind)}});
    plots.push(np);activePlotId=np.id;persistActivePlot();
    buildPlotTabs();buildGrid();toast("Bed created","success");
  }catch(e){toast("Failed to create bed: "+e.message,"error");}
}

async function editBed(){
  const p=activePlot();if(!p){toast("No bed selected","error");return;}
  const v=await formModal('Edit bed',[
    {name:'name',label:'Name',type:'text',value:p.name},
    {name:'kind',label:'Type',type:'select',options:KIND_LABELS,value:kindToLabel(p.kind)},
  ],{submitLabel:'Save'});
  if(!v)return;
  const name=(v.name||"").trim();
  if(!name){toast("Name can't be empty","error");return;}
  const kind=labelToKind(v.kind);
  if(kind!==p.kind&&hasPlantings(p)){
    const ok=await confirmModal('Switching this bed to a '+(kind==='plant'?'plant':'veg')+' bed will remove its current plantings. Continue?',
      {danger:true,okLabel:'Switch type'});
    if(!ok)return;
  }
  try{
    const updated=await api('/plots/'+p.id+'/',{method:'PATCH',body:{name:name,kind:kind}});
    replacePlot(updated);buildPlotTabs();buildGrid();toast("Bed updated","success");
  }catch(e){toast("Failed: "+e.message,"error");}
}

async function resizePlot(){
  const p=activePlot();if(!p){toast("No bed selected","error");return;}
  const v=await formModal('Resize "'+p.name+'"',[
    {name:'rows',label:'Rows (squares tall)',type:'number',value:p.rows,min:1},
    {name:'cols',label:'Columns (squares wide)',type:'number',value:p.cols,min:1},
  ],{submitLabel:'Resize'});
  if(!v)return;
  const rows=parseInt(v.rows),cols=parseInt(v.cols);
  if(isNaN(rows)||rows<1||isNaN(cols)||cols<1){toast("Enter valid row and column numbers","error");return;}
  try{
    const updated=await api('/plots/'+p.id+'/',{method:'PATCH',body:{rows:rows,cols:cols}});
    replacePlot(updated);buildPlotTabs();buildGrid();toast("Bed resized","success");
  }catch(e){toast(e.message,"error");}
}

async function deletePlot(){
  const p=activePlot();if(!p){toast("No bed selected","error");return;}
  const ok=await confirmModal('Delete bed "'+p.name+'" and everything in it? This cannot be undone.',
    {danger:true,okLabel:'Delete bed',title:'Delete bed'});
  if(!ok)return;
  try{
    await api('/plots/'+p.id+'/',{method:'DELETE'});
    plots=plots.filter(x=>x.id!==p.id);
    activePlotId=plots.length?plots[0].id:null;persistActivePlot();
    buildPlotTabs();buildGrid();toast("Bed deleted","success");
  }catch(e){toast("Failed: "+e.message,"error");}
}

function openEditModal(pos){
  const p=activePlot();if(!p)return;
  const c=cellsByPosition(p)[pos];
  if(!c||c.id==null)return;
  editingCellId=c.id;
  const row=Math.floor(pos/p.cols)+1,col=(pos%p.cols)+1;
  document.getElementById("editModalTitle").textContent=p.name+" · square "+row+","+col;
  document.getElementById("modalVeg").value=c.veg?c.veg.name:"";
  document.getElementById("modalDate").value=c.date_sown||"";
  document.getElementById("modalSeeds").value=c.seeds_planted||0;
  renderModalDetails();
  modalOpen("editModal","#modalVeg");
}

function historyLine(h){
  const icons={planted:'🌱',harvested:'🧺',failed:'❌',cleared:'🧹'};
  const verbs={planted:'Planted',harvested:'Harvested',failed:'Failed',cleared:'Cleared'};
  const ic=icons[h.event_type]||'•';
  const vb=verbs[h.event_type]||h.event_type;
  const cnt=h.count?' '+h.count+' ×':'';
  const wt=h.weight_g?' · '+fmtWeight(h.weight_g):'';
  const txt='<span class="h-text">'+ic+' '+vb+cnt+' '+escapeHtml(h.veg_name||'')+wt+(h.note?' 📝':'')+'</span><span class="h-date">'+h.date+'</span>';
  if(h.note&&h.note.trim()){
    return '<details class="h-det"><summary class="history-item">'+txt+'</summary><div class="h-note">'+escapeHtml(h.note).replace(/\n/g,'<br>')+'</div></details>';
  }
  return '<div class="history-item">'+txt+'</div>';
}

function renderModalDetails(){
  if(editingCellId===null)return;
  const veg=document.getElementById("modalVeg").value.trim();
  const date=document.getElementById("modalDate").value;
  const entry=vegLookupByName(veg);
  const sumEl=document.getElementById("modalSummary");
  const bub=document.getElementById("modalHarvestBubble");
  if(bub){
    if(entry&&date){
      const d=daysSince(date);
      const rem=entry.days_to_harvest-d;
      if(rem<=0){bub.className="harvest-bubble ready";bub.innerHTML='🧺 <strong>Ready to harvest now!</strong>';}
      else{const hd=parseLocalDate(date)||new Date(date);hd.setDate(hd.getDate()+entry.days_to_harvest);bub.className="harvest-bubble";bub.innerHTML='🧺 <strong>Ready in '+rem+' day'+(rem===1?'':'s')+'</strong> · ~'+hd.toLocaleDateString();}
      bub.style.display="block";
    }else if(entry){
      bub.className="harvest-bubble muted";bub.innerHTML='🌱 Set a sown date to estimate harvest (~'+entry.days_to_harvest+'d)';bub.style.display="block";
    }else{bub.style.display="none";}
  }
  if(entry){
    const sowBits=vegSowMethodsSet(entry).map(meth=>escapeHtml(meth.label)+' '+rangeLabel(entry[meth.start],entry[meth.end])).join(' · ')||'—';
    let html='<strong>'+escapeHtml(entry.name)+'</strong>'+(entry.latin_name?' <span style="font-style:italic;color:var(--muted)">'+escapeHtml(entry.latin_name)+'</span>':"")+'<br>🌱 '+sowBits+'<br>🧺 Harvest: '+rangeLabel(entry.harvest_start,entry.harvest_end)+' · 📐 '+entry.per_sq_ft+'/sq ft · ⏱ ~'+entry.days_to_harvest+'d to harvest';
    const c0=getEditingCell();
    const rot=rotationWarning(c0,entry.name);
    if(rot)html+='<div class="rot-warn">🔁 '+escapeHtml(rot)+'</div>';
    const comp=companionText(entry.name);
    if(comp)html+='<div class="comp-tip">'+comp+'</div>';
    sumEl.innerHTML=html;sumEl.style.display="block";
  }else{
    const typed=document.getElementById("modalVeg").value.trim();
    const sow=typed?[]:sowNowList(null);
    if(sow.length){
      sumEl.innerHTML='<div class="sow-now"><strong>🌱 Could sow now ('+MONTH_FULL[new Date().getMonth()]+'):</strong> '+sow.slice(0,12).map(escapeHtml).join(', ')+(sow.length>12?'…':'')+frostNote()+'</div>';
      sumEl.style.display="block";
    }else{sumEl.style.display="none";}
  }
  const c=getEditingCell();if(!c)return;
  const tot=document.getElementById("modalTotals");
  const seeds=c.seeds_planted||0,harv=c.total_harvested||0,fail=c.total_failed||0,wt=c.total_weight_g||0;
  let pp="";
  if(seeds>0)pp+='<span class="pill">🌱 '+seeds+' seeds</span>';
  if(harv>0)pp+='<span class="pill harvest">🧺 '+harv+' harvested</span>';
  if(wt>0)pp+='<span class="pill harvest">⚖️ '+fmtWeight(wt)+'</span>';
  if(fail>0)pp+='<span class="pill fail">❌ '+fail+' failed</span>';
  if(!pp)pp='<span style="color:var(--muted);font-size:.85rem;font-style:italic">No activity yet</span>';
  tot.innerHTML=pp;
  const hist=document.getElementById("modalHistory");
  if(!c.history||!c.history.length){hist.innerHTML='<div class="history-empty">No history yet</div>';}
  else{hist.innerHTML=c.history.slice(0,12).map(historyLine).join("");}
}

let recordMode=null;
function recordHarvest(){openRecordModal('harvest');}
function recordFailure(){openRecordModal('failure');}
function openRecordModal(mode){
  const c=getEditingCell();if(!c)return;
  recordMode=mode;
  document.getElementById("recordTitle").textContent=mode==='harvest'?'🧺 Record harvest':'❌ Record failure';
  document.getElementById("recordCountLabel").textContent=mode==='harvest'?'How many did you harvest?':'How many failed?';
  const cnt=document.getElementById("recordCount");cnt.value=1;
  document.getElementById("recordNote").value="";
  document.getElementById("recordWeight").value="";
  document.getElementById("recordWeightWrap").style.display=(mode==='harvest')?'block':'none';
  document.getElementById("recordSaveBtn").className='btn '+(mode==='harvest'?'btn-primary':'btn-danger');
  modalOpen("recordModal","#recordCount");
}
function closeRecordModal(){modalClose("recordModal");recordMode=null;}
async function submitRecord(){
  const c=getEditingCell();if(!c){closeRecordModal();return;}
  const n=parseInt(document.getElementById("recordCount").value);
  if(isNaN(n)||n<=0){toast("Please enter a positive number","error");return;}
  const note=document.getElementById("recordNote").value.trim();
  const body={count:n,note:note};
  if(recordMode==='harvest'){const w=parseInt(document.getElementById("recordWeight").value);if(!isNaN(w)&&w>0)body.weight=w;}
  const ep=recordMode==='harvest'?'record_harvest':'record_failure';
  const btn=document.getElementById("recordSaveBtn");if(btn)btn.disabled=true;
  try{
    const updated=await api('/cells/'+c.id+'/'+ep+'/',{method:'POST',body:body});
    replaceCell(updated);closeRecordModal();renderModalDetails();buildGrid();
    toast(recordMode==='harvest'?'Harvest recorded':'Failure recorded','success');
  }catch(e){toast("Failed: "+e.message,"error");}
  finally{if(btn)btn.disabled=false;}
}

async function saveCell(){
  const c=getEditingCell();if(!c)return;
  const vegName=document.getElementById("modalVeg").value.trim();
  const date=document.getElementById("modalDate").value;
  const seeds=parseInt(document.getElementById("modalSeeds").value)||0;
  let vegKey=null;
  if(vegName){
    const e=vegLookupByName(vegName);
    if(!e){toast("Unknown vegetable “"+vegName+"”. Add it in Settings first.","error");return;}
    vegKey=e.key;
  }
  const btn=document.getElementById("editSaveBtn");if(btn)btn.disabled=true;
  try{
    const updated=await api('/cells/'+c.id+'/',{method:'PATCH',body:{veg_key:vegKey||"",date_sown:date||null,seeds_planted:seeds}});
    replaceCell(updated);buildGrid();closeEditModal();toast("Square saved","success");
  }catch(e){toast("Failed to save: "+e.message,"error");}
  finally{if(btn)btn.disabled=false;}
}

async function clearCell(){
  const c=getEditingCell();if(!c)return;
  if(!c.veg&&!c.date_sown&&!c.seeds_planted){closeEditModal();return;}
  const ok=await confirmModal("Clear this square? Totals and history are preserved.",{okLabel:'Clear square'});
  if(!ok)return;
  try{
    const updated=await api('/cells/'+c.id+'/clear_plot/',{method:'POST'});
    replaceCell(updated);buildGrid();closeEditModal();toast("Square cleared","success");
  }catch(e){toast("Failed: "+e.message,"error");}
}

async function resetPlotTotals(){
  const c=getEditingCell();if(!c)return;
  const ok=await confirmModal("Reset this square's totals and clear its history? This cannot be undone.",
    {danger:true,okLabel:'Reset'});
  if(!ok)return;
  try{
    const updated=await api('/cells/'+c.id+'/reset_totals/',{method:'POST'});
    replaceCell(updated);renderModalDetails();buildGrid();toast("Square totals reset","success");
  }catch(e){toast("Failed: "+e.message,"error");}
}

function closeEditModal(){modalClose("editModal");editingCellId=null;}

async function resetGrid(){
  const p=activePlot();if(!p){toast("No bed selected","error");return;}
  const ok=await confirmModal('Clear every square in "'+p.name+'" and wipe its totals & history?',
    {danger:true,okLabel:'Reset bed'});
  if(!ok)return;
  try{
    const updated=await api('/plots/'+p.id+'/reset/',{method:'POST',body:{}});
    replacePlot(updated);buildGrid();toast("Bed reset","success");
  }catch(e){toast("Failed: "+e.message,"error");}
}

/* ---------- Data dashboard ---------- */

let chartStats=[];
let heatMetric={};   // plotId -> 'harvested' | 'success' | 'failed'
let openSquare={};   // plotId -> position (or undefined)
let dataTab='beds';  // 'beds' | 'plants'

function kpi(v,l){return '<div class="chart-kpi"><div class="k-val">'+v+'</div><div class="k-lbl">'+l+'</div></div>';}
function pct(r){return (r===null||r===undefined)?'—':Math.round(r*100)+'%';}
function fmtWeight(g){
  g=g||0;if(g<=0)return '—';
  if(getUnits()==='imperial'){
    const oz=g/28.3495;
    if(oz<16)return (Math.round(oz*10)/10)+' oz';
    return (Math.round((oz/16)*100)/100)+' lb';
  }
  return g<1000?g+' g':(g/1000).toFixed(g%1000===0?0:1)+' kg';
}
function rcLabel(pos,cols){return (Math.floor(pos/cols)+1)+','+((pos%cols)+1);}
function squareMap(s){const m={};s.by_square.forEach(q=>{m[q.position]=q;});return m;}

function heatColor(q,metric,maxH,maxF,maxW){
  if(!q)return '#eceee9';
  if(metric==='success'){
    if(q.success_rate===null)return '#e6e8e3';
    return 'hsl('+Math.round(q.success_rate*120)+',60%,52%)';
  }
  if(metric==='failed'){
    if(!q.total_failed)return '#f6f2f0';
    return 'rgba(198,40,40,'+(0.18+0.82*(q.total_failed/(maxF||1))).toFixed(3)+')';
  }
  if(metric==='weight'){
    if(!q.total_weight_g)return '#eef3e6';
    return 'rgba(46,125,50,'+(0.18+0.82*(q.total_weight_g/(maxW||1))).toFixed(3)+')';
  }
  if(!q.total_harvested)return '#eef3e6';
  return 'rgba(46,125,50,'+(0.18+0.82*(q.total_harvested/(maxH||1))).toFixed(3)+')';
}
function heatVal(q,metric){
  if(!q)return '';
  if(metric==='success')return q.success_rate===null?'·':Math.round(q.success_rate*100)+'%';
  if(metric==='failed')return q.total_failed||'';
  if(metric==='weight')return q.total_weight_g?fmtWeight(q.total_weight_g):'';
  return q.total_harvested||'';
}

function heatmapInner(s){
  const pid=s.plot.id,cols=s.plot.cols;
  const metric=heatMetric[pid]||'harvested';
  const map=squareMap(s);
  const maxH=Math.max(1,...s.by_square.map(q=>q.total_harvested));
  const maxF=Math.max(1,...s.by_square.map(q=>q.total_failed));
  const maxW=Math.max(1,...s.by_square.map(q=>q.total_weight_g));
  const total=s.plot.rows*cols;
  let cells='';
  for(let i=0;i<total;i++){
    const q=map[i];
    const sel=(openSquare[pid]===i)?' sel':'';
    const veg=q&&q.veg_name?' · '+escapeHtml(q.veg_name):'';
    cells+='<button class="hm-cell'+sel+'" style="background:'+heatColor(q,metric,maxH,maxF,maxW)+'" onclick="showSquareDetail('+pid+','+i+')" title="Square '+rcLabel(i,cols)+veg+'"><span class="hm-pos">'+rcLabel(i,cols)+'</span><span class="hm-val">'+heatVal(q,metric)+'</span></button>';
  }
  const btn=(m,lbl)=>'<button class="seg-btn'+(metric===m?' active':'')+'" onclick="setHeatMetric('+pid+',\''+m+'\')">'+lbl+'</button>';
  return '<div class="hm-controls"><span class="hm-title">Showing: '+metricLabel(metric)+'</span><div class="seg">'+btn('harvested','🧺 Harvested')+btn('weight','⚖️ Weight')+btn('success','✅ Success %')+btn('failed','❌ Failures')+'</div></div>'
    +'<div class="hm-grid" style="grid-template-columns:repeat('+cols+',1fr)">'+cells+'</div>';
}
function heatmapSection(s){
  const pid=s.plot.id;
  return '<div id="hmwrap-'+pid+'">'+heatmapInner(s)+'</div>'
    +'<div id="sqdetail-'+pid+'" class="sq-detail">'+squareDetailHtml(s,openSquare[pid])+'</div>';
}
function metricLabel(m){return m==='success'?'success rate':m==='failed'?'failures':m==='weight'?'weight harvested':'harvested';}

function squareDetailHtml(s,pos){
  if(pos===undefined||pos===null)return '<div class="sq-hint">👆 Click a square to see its crop history and performance over time.</div>';
  const q=squareMap(s)[pos];
  if(!q)return '';
  const crops=q.crops_grown.length?q.crops_grown.map(escapeHtml).join(', '):'—';
  let hist;
  if(q.history&&q.history.length){
    hist=q.history.slice().reverse().map(historyLine).join('');
  }else hist='<div class="sq-hint">No history for this square yet.</div>';
  return '<div class="sq-detail-head"><strong>Square '+q.row+','+q.col+'</strong>'+(q.veg_name?' · now growing '+escapeHtml(q.veg_name):' · currently empty')+'</div>'
    +'<div class="chart-kpis">'+kpi('🧺 '+q.total_harvested,'harvested')+kpi('⚖️ '+fmtWeight(q.total_weight_g),'weight')+kpi('❌ '+q.total_failed,'failed')+kpi(pct(q.success_rate),'success')+kpi(q.events,'events')+'</div>'
    +'<div class="sq-crops"><b>Crops grown here:</b> '+crops+'</div>'
    +'<div class="sq-h-list">'+hist+'</div>';
}

function squareRankHtml(s){
  const scored=s.by_square.filter(q=>(q.total_harvested+q.total_failed)>0);
  if(!scored.length)return '';
  const byHarv=scored.slice().sort((a,b)=>b.total_harvested-a.total_harvested);
  const top=byHarv.slice(0,3),bottom=byHarv.slice(-3).reverse();
  const row=q=>'<div class="rank-row"><span>Square '+q.row+','+q.col+(q.veg_name?' · '+escapeHtml(q.veg_name):'')+'</span><span class="rank-val">🧺'+q.total_harvested+' · '+pct(q.success_rate)+'</span></div>';
  return '<div class="mini-cols"><div><div class="mini-h">🏆 Best squares</div>'+top.map(row).join('')+'</div><div><div class="mini-h">⚠️ Weakest squares</div>'+bottom.map(row).join('')+'</div></div>';
}

function vegTableHtml(s){
  if(!s.by_vegetable.length)return '<div class="chart-empty">No planting history yet.</div>';
  const rows=s.by_vegetable.map(v=>'<tr><td>'+escapeHtml(v.veg_name)+'</td><td>'+v.squares_used+'</td><td>'+v.seeds_planted+'</td><td>'+v.total_harvested+'</td><td>'+fmtWeight(v.weight_g)+'</td><td>'+v.total_failed+'</td><td>'+pct(v.success_rate)+'</td><td>'+(v.avg_days_to_harvest!=null?v.avg_days_to_harvest+'d':'—')+'</td></tr>').join('');
  return '<div class="mx-scroll"><table class="data-table"><thead><tr><th>Vegetable</th><th>Squares</th><th>Seeds</th><th>🧺</th><th>⚖️</th><th>❌</th><th>Success</th><th>Days→1st</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

function matrixHtml(s){
  const m=s.plant_square_matrix;
  if(!m.length)return '';
  const vegNames=[];const seen={};
  m.forEach(x=>{if(!(x.veg_name in seen)){seen[x.veg_name]=1;vegNames.push(x.veg_name);}});
  const positions=[...new Set(m.map(x=>x.position))].sort((a,b)=>a-b);
  const lookup={};m.forEach(x=>{lookup[x.veg_name+'@'+x.position]=x;});
  const maxH=Math.max(1,...m.map(x=>x.harvested));
  const head='<th>Veg ╲ Square</th>'+positions.map(p=>'<th>'+rcLabel(p,s.plot.cols)+'</th>').join('');
  const body=vegNames.map(vn=>{
    const tds=positions.map(p=>{
      const x=lookup[vn+'@'+p];
      if(!x||!x.harvested)return '<td class="mx-cell"></td>';
      const t=x.harvested/maxH;
      return '<td class="mx-cell" style="background:rgba(46,125,50,'+(0.18+0.82*t).toFixed(3)+')" title="'+escapeHtml(vn)+' · square '+rcLabel(p,s.plot.cols)+' · 🧺'+x.harvested+(x.failed?' ❌'+x.failed:'')+'">'+x.harvested+'</td>';
    }).join('');
    return '<tr><td class="mx-veg">'+escapeHtml(vn)+'</td>'+tds+'</tr>';
  }).join('');
  return '<div class="mx-scroll"><table class="data-table mx-table"><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>';
}

function monthlyHtml(s){
  const m=s.monthly;
  if(!m.length)return '';
  const max=Math.max(1,...m.map(x=>Math.max(x.harvested,x.failed)));
  const fmt=ym=>{const a=ym.split('-');return MONTH_NAMES[parseInt(a[1])-1]+" '"+a[0].slice(2);};
  return '<div class="chart-legend"><span><span class="dot" style="background:var(--primary)"></span>Harvested</span><span><span class="dot" style="background:#c62828"></span>Failed</span></div>'
    +'<div class="month-chart">'+m.map(x=>{
      const hh=Math.round((x.harvested/max)*100),fh=Math.round((x.failed/max)*100);
      return '<div class="mc-col"><div class="mc-bars"><div class="mc-bar harv" style="height:'+hh+'%" title="🧺 '+x.harvested+'"></div><div class="mc-bar fail" style="height:'+fh+'%" title="❌ '+x.failed+'"></div></div><div class="mc-label">'+fmt(x.month)+'</div></div>';
    }).join('')+'</div>';
}

// Collapsible section: header shows a one-line stat overview; body hidden until expanded.
function acc(title,overview,body,open){
  if(!body)return '';
  return '<details class="data-acc"'+(open?' open':'')+'><summary><span class="acc-title">'+title+'</span><span class="acc-overview">'+overview+'</span></summary><div class="acc-body">'+body+'</div></details>';
}
function bestSquare(s){const sc=s.by_square.filter(q=>(q.total_harvested+q.total_failed)>0);if(!sc.length)return null;return sc.slice().sort((a,b)=>b.total_harvested-a.total_harvested)[0];}
function heatOverview(s){const b=bestSquare(s);return '🧺'+s.totals.total_harvested+' · '+s.totals.cells_used+' squares'+(b?' · best '+b.row+','+b.col:'');}
function rankOverview(s){const sc=s.by_square.filter(q=>(q.total_harvested+q.total_failed)>0);if(!sc.length)return 'no outcomes yet';const so=sc.slice().sort((a,b)=>b.total_harvested-a.total_harvested);const t=so[0],b=so[so.length-1];return 'best '+t.row+','+t.col+' 🧺'+t.total_harvested+' · weakest '+b.row+','+b.col+' 🧺'+b.total_harvested;}
function vegOverview(s){if(!s.by_vegetable.length)return 'no crops yet';const t=s.by_vegetable[0];return s.by_vegetable.length+' crops · top '+escapeHtml(t.veg_name)+' 🧺'+t.total_harvested;}
function matrixOverview(s){if(!s.plant_square_matrix.length)return 'no data';const v=new Set(s.plant_square_matrix.map(x=>x.veg_name)),p=new Set(s.plant_square_matrix.map(x=>x.position));return v.size+' crops × '+p.size+' squares';}
function monthlyOverview(s){if(!s.monthly.length)return 'no events';let pk=s.monthly[0];s.monthly.forEach(m=>{if(m.harvested>pk.harvested)pk=m;});const a=pk.month.split('-');return s.monthly.length+' months · peak '+MONTH_NAMES[parseInt(a[1])-1]+" '"+a[0].slice(2)+' 🧺'+pk.harvested;}

function bedOverview(s){
  const t=s.totals,total=s.plot.rows*s.plot.cols;
  let line=s.plot.rows+'×'+s.plot.cols+' · '+t.cells_used+'/'+total+' used · 🧺'+t.total_harvested;
  if(t.total_weight_g)line+=' · ⚖️'+fmtWeight(t.total_weight_g);
  line+=' · '+pct(t.success_rate);
  if(s.plot.last_composted){const ds=daysSince(s.plot.last_composted);line+=' · 🍂 '+(ds!==null?daysLabel(ds):s.plot.last_composted);}
  return line;
}
function plotDashboard(s){
  const t=s.totals,total=s.plot.rows*s.plot.cols;
  const kpis='<div class="chart-kpis">'+kpi(t.cells_used+'/'+total,'squares used')+kpi('🌱 '+t.seeds_planted,'seeds')+kpi('🧺 '+t.total_harvested,'harvested')+kpi('⚖️ '+fmtWeight(t.total_weight_g),'weight')+kpi('❌ '+t.total_failed,'failed')+kpi(pct(t.success_rate),'success rate')+kpi(t.distinct_crops,'crops')+'</div>';
  const nb=(s.plot.notes&&s.plot.notes.trim())?'<div class="bed-note-bubble">📝 '+escapeHtml(s.plot.notes).replace(/\n/g,'<br>')+'</div>':'';
  return '<details class="chart-card bed-acc" id="plotcard-'+s.plot.id+'"><summary><span class="bed-name">'+escapeHtml(s.plot.name)+'</span><span class="bed-overview">'+bedOverview(s)+'</span></summary><div class="bed-body">'
    +nb
    +kpis
    +acc('🟩 Yield by square',heatOverview(s),heatmapSection(s),false)
    +acc('🏅 Square performance',rankOverview(s),squareRankHtml(s),false)
    +acc('🥕 Vegetable performance',vegOverview(s),vegTableHtml(s),false)
    +acc('🧬 Plants × squares',matrixOverview(s),matrixHtml(s),false)
    +acc('📈 Harvest over time',monthlyOverview(s),monthlyHtml(s),false)
    +'</div></details>';
}

function overallSummary(arr){
  if(!arr.length)return '';
  let h=0,f=0,w=0,seeds=0,sq=0,used=0;const crops=new Set();
  arr.forEach(s=>{h+=s.totals.total_harvested;f+=s.totals.total_failed;w+=(s.totals.total_weight_g||0);seeds+=s.totals.seeds_planted;sq+=s.plot.rows*s.plot.cols;used+=s.totals.cells_used;s.by_vegetable.forEach(v=>crops.add(v.veg_key||v.veg_name));});
  const oc=h+f,sr=oc?h/oc:null;
  return '<div class="chart-card overall"><h3>🌾 Overview</h3><p class="chart-sub">'+arr.length+' bed'+(arr.length!==1?'s':'')+' · '+sq+' squares · '+crops.size+' crops</p><div class="chart-kpis">'+kpi(used+'/'+sq,'squares used')+kpi('🌱 '+seeds,'seeds')+kpi('🧺 '+h,'harvested')+kpi('⚖️ '+fmtWeight(w),'weight')+kpi('❌ '+f,'failed')+kpi(pct(sr),'success rate')+'</div></div>';
}

// Scoped updates so expanded sections stay open when toggling the heatmap.
function setHeatMetric(pid,m){
  heatMetric[pid]=m;
  const s=chartStats.find(x=>x.plot.id===pid);if(!s)return;
  const w=document.getElementById('hmwrap-'+pid);if(w)w.innerHTML=heatmapInner(s);
}
function showSquareDetail(pid,pos){
  openSquare[pid]=(openSquare[pid]===pos?undefined:pos);
  const s=chartStats.find(x=>x.plot.id===pid);if(!s)return;
  const w=document.getElementById('hmwrap-'+pid);if(w)w.innerHTML=heatmapInner(s);
  const d=document.getElementById('sqdetail-'+pid);if(d)d.innerHTML=squareDetailHtml(s,openSquare[pid]);
}
function setDataTab(t){dataTab=t;paintCharts();}

function bedsTab(){return chartStats.map(plotDashboard).join('');}

// Roll every bed's per-vegetable stats up into one cross-bed view per plant.
function aggregatePlants(){
  const map={};
  chartStats.forEach(s=>{
    s.by_vegetable.forEach(v=>{
      const k=v.veg_key||v.veg_name;
      const d=map[k]||(map[k]={veg_key:v.veg_key,veg_name:v.veg_name,seeds:0,harv:0,fail:0,weight:0,squares:0,beds:[],perBed:[],daysSum:0,daysN:0});
      d.seeds+=v.seeds_planted;d.harv+=v.total_harvested;d.fail+=v.total_failed;d.weight+=(v.weight_g||0);d.squares+=v.squares_used;d.beds.push(s.plot.name);
      d.perBed.push({bed:s.plot.name,squares:v.squares_used,harv:v.total_harvested,fail:v.total_failed,weight:(v.weight_g||0),success:((v.total_harvested+v.total_failed)?v.total_harvested/(v.total_harvested+v.total_failed):null)});
      if(v.avg_days_to_harvest!=null){d.daysSum+=v.avg_days_to_harvest;d.daysN++;}
    });
  });
  return Object.values(map).map(d=>{const oc=d.harv+d.fail;return Object.assign(d,{success:oc?d.harv/oc:null,avg_days:d.daysN?Math.round(d.daysSum/d.daysN):null,bedsCount:new Set(d.beds).size});}).sort((a,b)=>b.harv-a.harv);
}

function plantCard(p,squares){
  const vmeta=vegDB[p.veg_key];
  const vis=vegVisual(p.veg_name);
  const icon=vis.type==='img'?'<img class="pl-ic" src="'+vis.value+'" alt="">':'<span class="pl-ic">'+vis.value+'</span>';
  const overview='🧺'+p.harv+(p.weight?' · ⚖️'+fmtWeight(p.weight):'')+' · '+pct(p.success)+' success · '+p.squares+' sq · '+p.bedsCount+' bed'+(p.bedsCount!==1?'s':'');
  const kpis='<div class="chart-kpis">'+kpi('🧺 '+p.harv,'harvested')+kpi('⚖️ '+fmtWeight(p.weight),'weight')+kpi('❌ '+p.fail,'failed')+kpi(pct(p.success),'success')+kpi('🌱 '+p.seeds,'seeds')+kpi(p.squares,'squares')+kpi(p.avg_days!=null?p.avg_days+'d':'—','days→1st')+'</div>';
  let win='';
  if(vmeta){const sb=vegSowMethodsSet(vmeta).map(meth=>escapeHtml(meth.label)+' '+rangeLabel(vmeta[meth.start],vmeta[meth.end])).join(' · ')||'—';win='<div class="pl-win">🌱 '+sb+' · 🧺 Harvest '+rangeLabel(vmeta.harvest_start,vmeta.harvest_end)+(vmeta.days_to_harvest?' · ⏱ ~'+vmeta.days_to_harvest+'d':'')+'</div>';}
  const bedRows=p.perBed.slice().sort((a,b)=>b.harv-a.harv).map(b=>'<tr><td>'+escapeHtml(b.bed)+'</td><td>'+b.squares+'</td><td>'+b.harv+'</td><td>'+fmtWeight(b.weight)+'</td><td>'+b.fail+'</td><td>'+pct(b.success)+'</td></tr>').join('');
  const bedTbl='<div class="data-section-h" style="margin-top:.7rem">By bed</div><div class="mx-scroll"><table class="data-table"><thead><tr><th>Bed</th><th>Squares</th><th>🧺</th><th>⚖️</th><th>❌</th><th>Success</th></tr></thead><tbody>'+bedRows+'</tbody></table></div>';
  let best='';
  const top=(squares||[]).filter(x=>x.harvested>0).sort((a,b)=>b.harvested-a.harvested).slice(0,5);
  if(top.length)best='<div class="pl-best"><b>Best squares:</b> '+top.map(x=>escapeHtml(x.bed)+' '+rcLabel(x.position,x.cols)+' (🧺'+x.harvested+')').join(' · ')+'</div>';
  return '<details class="data-acc plant-acc"><summary><span class="acc-title">'+icon+' '+escapeHtml(p.veg_name)+'</span><span class="acc-overview">'+overview+'</span></summary><div class="acc-body">'+kpis+win+bedTbl+(best?'<div style="margin-top:.6rem">'+best+'</div>':'')+'</div></details>';
}

function plantsTab(){
  const plants=aggregatePlants();
  if(!plants.length)return '<div class="chart-card"><div class="chart-empty">No planting history yet. Record some harvests or generate sample data first.</div></div>';
  const mx={};
  chartStats.forEach(s=>{s.plant_square_matrix.forEach(x=>{const k=x.veg_key||x.veg_name;(mx[k]||(mx[k]=[])).push({bed:s.plot.name,position:x.position,harvested:x.harvested,failed:x.failed,cols:s.plot.cols});});});
  return '<div class="chart-card"><h3>🥕 Plant performance</h3><p class="chart-sub">'+plants.length+' crops across all beds · click a plant to expand</p>'+plants.map(p=>plantCard(p,mx[p.veg_key||p.veg_name])).join('')+'</div>';
}

function yearOverYear(arr){
  const byYear={};
  arr.forEach(s=>{(s.monthly||[]).forEach(mo=>{const y=mo.month.split('-')[0];const d=byYear[y]||(byYear[y]={harv:0});d.harv+=mo.harvested;});});
  const years=Object.keys(byYear).sort();
  if(years.length<2)return '';
  const max=Math.max(1,...years.map(y=>byYear[y].harv));
  const rows=years.map(y=>{const w=Math.round(byYear[y].harv/max*100);return '<div class="bar-row"><div class="bar-label">'+y+'</div><div class="bar-track"><div class="bar-fill harvest" style="width:'+Math.max(2,w)+'%"></div></div><div class="bar-val">'+byYear[y].harv+'</div></div>';}).join('');
  return '<div class="chart-card"><h3>📅 Harvest by year</h3><p class="chart-sub">total harvested per year</p>'+rows+'</div>';
}

function csvCell(v){v=(v==null?'':String(v));return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}
function _downloadCSV(rows,fname){
  const csv=rows.map(r=>r.map(csvCell).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=fname;a.click();URL.revokeObjectURL(url);
}
function exportHarvestCSV(){
  const rows=[['Date','Bed','Square','Vegetable','Event','Count','Weight (g)','Note']];
  plots.filter(p=>p.kind!=='plant').forEach(p=>{(p.cells||[]).forEach(c=>{(c.history||[]).forEach(h=>{
    if(h.event_type==='harvested'||h.event_type==='failed')rows.push([h.date,p.name,rcLabel(c.position,p.cols),h.veg_name||'',h.event_type,h.count||0,h.weight_g||0,h.note||'']);
  });});});
  if(rows.length<=1){toast("No harvest history to export","error");return;}
  _downloadCSV(rows,'garden_harvests_'+todayISO()+'.csv');toast("Harvest CSV exported","success");
}
function exportSeedList(){
  const map={};
  plots.filter(p=>p.kind!=='plant').forEach(p=>{(p.cells||[]).forEach(c=>{
    if(c.veg&&c.seeds_planted){const k=c.veg.name;const d=map[k]||(map[k]={seeds:0,sq:0});d.seeds+=c.seeds_planted;d.sq++;}
  });});
  const names=Object.keys(map).sort();
  if(!names.length){toast("No seeds planted yet","error");return;}
  _downloadCSV([['Vegetable','Squares','Seeds planted']].concat(names.map(n=>[n,map[n].sq,map[n].seeds])),'garden_seed_list_'+todayISO()+'.csv');
  toast("Seed list exported","success");
}

function paintCharts(){
  const body=document.getElementById("chartsBody");
  if(!chartStats.length){body.innerHTML='<div class="chart-card"><div class="chart-empty">No beds yet. Create one in the Garden tab.</div></div>';return;}
  const tab=(id,lbl)=>'<button class="data-tab'+(dataTab===id?' active':'')+'" onclick="setDataTab(\''+id+'\')">'+lbl+'</button>';
  const tabs='<div class="data-tabs">'+tab('beds','🟩 Beds')+tab('plants','🥕 Plants')+'</div>';
  body.innerHTML=overallSummary(chartStats)+yearOverYear(chartStats)+tabs+(dataTab==='beds'?bedsTab():plantsTab());
}

async function renderCharts(){
  const body=document.getElementById("chartsBody");
  const vegPlots=plots.filter(p=>p.kind!=='plant');
  if(!vegPlots.length){body.innerHTML='<div class="chart-card"><div class="chart-empty">No veg beds yet. The Data tab tracks harvests from veg beds.</div></div>';return;}
  body.innerHTML='<div class="chart-card"><div class="chart-empty">Loading…</div></div>';
  try{
    chartStats=await Promise.all(vegPlots.map(p=>api('/plots/'+p.id+'/stats/')));
    paintCharts();
  }catch(e){body.innerHTML='<div class="chart-card"><div class="chart-empty">Failed to load data: '+escapeHtml(e.message)+'</div></div>';}
}

/* ---------- Sow Chart (sow/harvest calendar) ---------- */

function renderSowChart(){
  const body=document.getElementById("sowChartBody");
  const q=(document.getElementById("sowSearch").value||"").trim().toLowerCase();
  const list=Object.values(vegDB)
    .filter(v=>{
      const hasData=vegSowMethodsSet(v).length||(v.harvest_start&&v.harvest_end);
      if(!hasData)return false;
      if(!q)return true;
      return v.name.toLowerCase().includes(q)||(v.latin_name||"").toLowerCase().includes(q);
    })
    .sort((a,b)=>a.name.localeCompare(b.name));

  if(!list.length){
    body.innerHTML='<div class="sow-empty">No vegetables with sow or harvest months'+(q?' match "'+escapeHtml(q)+'"':'')+'.</div>';
    return;
  }

  let html='<div class="sow-grid"><div class="sow-head sow-label-head">Vegetable</div>';
  for(let m=1;m<=12;m++)html+='<div class="sow-head">'+MONTH_NAMES[m-1]+'</div>';

  list.forEach(v=>{
    const vis=vegVisual(v.name);
    const icon=vis.type==="img"
      ? '<img src="'+vis.value+'" alt="">'
      : '<span class="sow-emoji">'+vis.value+'</span>';
    html+='<div class="sow-rowlabel" title="'+escapeHtml(v.name)+'" onclick="showVegDetail(\''+v.key+'\')">'+icon+'<span>'+escapeHtml(v.name)+'</span></div>';
    for(let m=1;m<=12;m++){
      // A month can have several active activities — stack a colour band per one.
      let bands='';
      SOW_METHODS.forEach(meth=>{if(monthInRange(m,v[meth.start],v[meth.end]))bands+='<span class="sow-band '+meth.cls+'"></span>';});
      if(monthInRange(m,v.harvest_start,v.harvest_end))bands+='<span class="sow-band harvest"></span>';
      html+='<div class="sow-cell">'+bands+'</div>';
    }
  });
  html+='</div>';
  body.innerHTML=html;
}

/* ---------- Garden Designer ---------- */
const DESIGN_UNIT=26;     // base px per square foot (zoom multiplies this)
let designZoom=1;
let designLayout={};      // plotId -> {x,y}
let features=[];

const FEATURE_TYPES=[
  {kind:'grass',label:'Grass',emoji:'🌿',w:4,h:4},
  {kind:'path',label:'Path',emoji:'🟫',w:4,h:1},
  {kind:'wall',label:'Wall',emoji:'🧱',w:4,h:1},
  {kind:'shed',label:'Shed',emoji:'🛖',w:2,h:2},
  {kind:'greenhouse',label:'Greenhouse',emoji:'🏡',w:3,h:2},
  {kind:'pond',label:'Pond',emoji:'💧',w:3,h:2},
  {kind:'table',label:'Table',emoji:'🪑',w:2,h:1},
  {kind:'stairs',label:'Stairs',emoji:'🪜',w:2,h:1},
  {kind:'tree',label:'Tree',emoji:'🌳',w:1,h:1},
  {kind:'compost',label:'Compost',emoji:'♻️',w:1,h:1},
  {kind:'text',label:'Label',emoji:'🔤',w:3,h:1},
];
function featureType(k){return FEATURE_TYPES.find(t=>t.kind===k)||{kind:k,label:k||'Feature',emoji:'⬛',w:2,h:2};}
function _unit(){return DESIGN_UNIT*designZoom;}

async function loadFeatures(){try{features=await api('/features/');}catch(e){features=[];}}

function setZoom(d){
  designZoom=Math.max(0.5,Math.min(3,Math.round((designZoom+d)*100)/100));
  renderDesigner();
}

function _designerWidthUnits(){
  const wrap=document.querySelector('.designer-wrap');
  const w=(wrap&&wrap.clientWidth)||640;
  return Math.max(12,Math.floor(w/DESIGN_UNIT));
}

// Mini grid of a bed's contents (one emoji/photo per square) for the Designer map.
function bedMiniCells(p){
  const byPos=cellsByPosition(p);
  const total=p.rows*p.cols;
  let out="";
  for(let i=0;i<total;i++){
    const c=byPos[i];
    let inner="",cls="bt-sq empty";
    if(c&&p.kind==='plant'&&c.plant){inner=plantEmoji(c.plant.name);cls="bt-sq";}
    else if(c&&c.veg){cls="bt-sq";inner=c.veg.image_url?('<img src="'+escapeHtml(c.veg.image_url)+'" alt="">'):(c.veg.emoji||fallbackEmoji(c.veg.name));}
    out+='<div class="'+cls+'">'+inner+'</div>';
  }
  return out;
}

function buildFeaturePalette(){
  const el=document.getElementById("featurePalette");if(!el)return;
  el.innerHTML='<span class="palette-label">Add:</span>'+FEATURE_TYPES.map(t=>'<button class="palette-btn" onclick="addFeature(\''+t.kind+'\')" title="Add '+t.label+'">'+t.emoji+' '+t.label+'</button>').join('');
}

// Remember the panel height the user drags the designer to.
let _designerObs=null;
function _initDesignerResizePersist(){
  const wrap=document.querySelector('.designer-wrap');
  if(!wrap||_designerObs)return;
  const saved=parseInt(localStorage.getItem('sfg_designer_h'));
  if(saved>200)wrap.style.height=saved+'px';
  if(window.ResizeObserver){
    _designerObs=new ResizeObserver(()=>{const h=wrap.offsetHeight;if(h>200)localStorage.setItem('sfg_designer_h',h);});
    _designerObs.observe(wrap);
  }else _designerObs=true;
}

function renderDesigner(){
  _initDesignerResizePersist();
  const canvas=document.getElementById("designerCanvas");
  const legend=document.getElementById("designerLegend");
  const zl=document.getElementById("zoomLabel");
  if(zl)zl.textContent=Math.round(designZoom*100)+'%';
  buildFeaturePalette();
  const u=_unit();
  canvas.style.backgroundSize=u+'px '+u+'px';
  if(!plots.length&&!features.length){
    canvas.innerHTML='<div class="chart-empty" style="padding:1.5rem">Empty garden — create a bed in the Garden tab, or add a feature above.</div>';
    canvas.style.height="";canvas.style.minWidth="";if(legend)legend.textContent="";return;
  }
  designLayout={};
  const maxU=_designerWidthUnits();
  let fx=0,fy=0,rh=0;
  plots.forEach(p=>{
    if(p.layout_x!=null&&p.layout_y!=null)designLayout[p.id]={x:p.layout_x,y:p.layout_y};
    else{if(fx+p.cols>maxU){fx=0;fy+=rh+1;rh=0;}designLayout[p.id]={x:fx,y:fy};fx+=p.cols+1;rh=Math.max(rh,p.rows);}
  });
  canvas.innerHTML="";
  features.forEach(ft=>canvas.appendChild(_buildFeatureTile(ft,u)));
  plots.forEach(p=>canvas.appendChild(_buildBedTile(p,u)));
  const ovl=document.createElement('div');
  ovl.className='map-overlay';
  ovl.innerHTML='<div class="map-n">N&nbsp;↑</div><div class="map-scalebar"><span style="width:'+(5*u)+'px"></span>5&nbsp;ft</div>';
  canvas.appendChild(ovl);
  _resizeDesignerCanvas();
  if(legend)legend.textContent=plots.length+" bed"+(plots.length!==1?"s":"")+" · "+features.length+" feature"+(features.length!==1?"s":"")+" · each square = 1 sq ft";
}

function _resizeDesignerCanvas(){
  const canvas=document.getElementById("designerCanvas");
  const u=_unit();
  let maxR=8,maxC=12;
  plots.forEach(p=>{const pos=designLayout[p.id];if(pos){maxR=Math.max(maxR,pos.y+p.rows);maxC=Math.max(maxC,pos.x+p.cols);}});
  features.forEach(f=>{maxR=Math.max(maxR,(f.y||0)+(f.h||1));maxC=Math.max(maxC,(f.x||0)+(f.w||1));});
  canvas.style.height=((maxR+1)*u)+'px';
  canvas.style.minWidth=((maxC+1)*u)+'px';
}

function _buildBedTile(p,u){
  const pos=designLayout[p.id];
  const tile=document.createElement("div");
  tile.className="bed-tile "+(p.kind==='plant'?'plant':'veg');
  tile.style.left=(pos.x*u)+'px';tile.style.top=(pos.y*u)+'px';
  tile.style.width=(p.cols*u)+'px';tile.style.height=(p.rows*u)+'px';
  tile.setAttribute("role","button");tile.setAttribute("tabindex","0");
  tile.setAttribute("aria-label",p.name+", "+p.rows+" by "+p.cols+" bed. Press Enter to open.");
  tile.title=p.name+' · '+p.rows+'×'+p.cols+(p.kind==='plant'?' · plant':' · veg');
  tile.innerHTML='<div class="bt-grid" style="grid-template-columns:repeat('+p.cols+',1fr)">'+bedMiniCells(p)+'</div><span class="bt-label">'+(p.kind==='plant'?'🌷':'🥕')+' '+escapeHtml(p.name)+'</span>';
  _attachDrag(tile,{
    getPos:()=>designLayout[p.id],
    setPos:(x,y)=>{designLayout[p.id]={x,y};p.layout_x=x;p.layout_y=y;},
    save:(x,y)=>saveLayout([{id:p.id,x,y}]),
    onTap:()=>{switchPlot(p.id);switchView("garden");},
    unit:u
  });
  tile.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();switchPlot(p.id);switchView("garden");}});
  return tile;
}

function _buildFeatureTile(ft,u){
  const t=featureType(ft.kind);
  const lbl=ft.label||t.label;
  const tile=document.createElement("div");
  tile.className="feature feature-"+ft.kind;
  tile.style.left=((ft.x||0)*u)+'px';tile.style.top=((ft.y||0)*u)+'px';
  tile.style.width=((ft.w||t.w)*u)+'px';tile.style.height=((ft.h||t.h)*u)+'px';
  tile.setAttribute("role","button");tile.setAttribute("tabindex","0");
  tile.setAttribute("aria-label",lbl+" — drag to move, tap to edit");
  tile.title=lbl;
  tile.innerHTML=(ft.kind==='text'?'':'<span class="ft-emoji">'+t.emoji+'</span>')+'<span class="ft-label">'+escapeHtml(lbl)+'</span>'
    +'<button class="ft-rot" title="Rotate" aria-label="Rotate '+escapeHtml(lbl)+'" onclick="rotateFeature(event,'+ft.id+')">↻</button>'
    +'<button class="ft-del" title="Remove" aria-label="Remove '+escapeHtml(lbl)+'" onclick="deleteFeature(event,'+ft.id+')">×</button>'
    +'<span class="ft-resize" aria-hidden="true"></span>';
  _attachDrag(tile,{
    getPos:()=>({x:ft.x||0,y:ft.y||0}),
    setPos:(x,y)=>{ft.x=x;ft.y=y;},
    save:()=>saveFeature(ft),
    onTap:()=>openFeatureModal(ft),
    unit:u
  });
  _attachResize(tile,ft,u);
  tile.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openFeatureModal(ft);}});
  return tile;
}

function _attachDrag(tile,opts){
  let sx,sy,ox,oy,moved=false,dragging=false;
  tile.addEventListener("pointerdown",e=>{
    if(e.target.closest('.ft-del')||e.target.closest('.ft-rot')||e.target.closest('.ft-resize'))return;
    if(e.button!==undefined&&e.button!==0)return;
    const p=opts.getPos();ox=p.x;oy=p.y;
    sx=e.clientX;sy=e.clientY;moved=false;dragging=true;
    tile.classList.add("dragging");
    try{tile.setPointerCapture(e.pointerId);}catch(_){}
  });
  tile.addEventListener("pointermove",e=>{
    if(!dragging)return;
    const dx=e.clientX-sx,dy=e.clientY-sy;
    if(Math.abs(dx)>4||Math.abs(dy)>4)moved=true;
    tile.style.left=(Math.max(0,ox+dx/opts.unit)*opts.unit)+'px';
    tile.style.top=(Math.max(0,oy+dy/opts.unit)*opts.unit)+'px';
  });
  function end(e){
    if(!dragging)return;dragging=false;tile.classList.remove("dragging");
    if(!moved){opts.onTap();return;}
    const nx=Math.round(Math.max(0,ox+(e.clientX-sx)/opts.unit));
    const ny=Math.round(Math.max(0,oy+(e.clientY-sy)/opts.unit));
    tile.style.left=(nx*opts.unit)+'px';tile.style.top=(ny*opts.unit)+'px';
    opts.setPos(nx,ny);_resizeDesignerCanvas();opts.save(nx,ny);
  }
  tile.addEventListener("pointerup",end);
  tile.addEventListener("pointercancel",()=>{dragging=false;tile.classList.remove("dragging");});
}

function _attachResize(tile,ft,u){
  const handle=tile.querySelector('.ft-resize');if(!handle)return;
  let rsx,rsy,rw,rh,resizing=false;
  handle.addEventListener("pointerdown",e=>{
    e.stopPropagation();e.preventDefault();
    resizing=true;rsx=e.clientX;rsy=e.clientY;
    const t=featureType(ft.kind);rw=ft.w||t.w;rh=ft.h||t.h;
    try{handle.setPointerCapture(e.pointerId);}catch(_){}
  });
  handle.addEventListener("pointermove",e=>{
    if(!resizing)return;
    const nw=Math.max(1,Math.round(rw+(e.clientX-rsx)/u));
    const nh=Math.max(1,Math.round(rh+(e.clientY-rsy)/u));
    tile.style.width=(nw*u)+'px';tile.style.height=(nh*u)+'px';
    ft._nw=nw;ft._nh=nh;
  });
  function rend(){
    if(!resizing)return;resizing=false;
    ft.w=ft._nw||ft.w;ft.h=ft._nh||ft.h;delete ft._nw;delete ft._nh;
    _resizeDesignerCanvas();saveFeature(ft);
  }
  handle.addEventListener("pointerup",rend);
  handle.addEventListener("pointercancel",rend);
}

async function addFeature(kind){
  const t=featureType(kind);
  try{
    const nf=await api('/features/',{method:'POST',body:{kind:kind,label:t.label,x:0,y:0,w:t.w,h:t.h}});
    features.push(nf);renderDesigner();toast(t.label+" added","success");
  }catch(e){toast("Failed: "+e.message,"error");}
}

async function rotateFeature(e,id){
  e.stopPropagation();
  const ft=features.find(f=>f.id===id);if(!ft)return;
  const t=featureType(ft.kind);
  const w=ft.w||t.w,h=ft.h||t.h;
  ft.w=h;ft.h=w;
  renderDesigner();saveFeature(ft);
}

async function deleteFeature(e,id){
  e.stopPropagation();
  try{
    await api('/features/'+id+'/',{method:'DELETE'});
    features=features.filter(f=>f.id!==id);renderDesigner();toast("Removed","success");
  }catch(err){toast("Failed: "+err.message,"error");}
}

async function saveFeature(ft){
  try{await api('/features/'+ft.id+'/',{method:'PATCH',body:{x:ft.x,y:ft.y,w:ft.w,h:ft.h}});}
  catch(e){toast("Couldn't save: "+e.message,"error");}
}

async function openFeatureModal(ft){
  const cur=featureType(ft.kind);
  const v=await formModal('Edit feature',[
    {name:'label',label:'Label',type:'text',value:ft.label||cur.label},
    {name:'kind',label:'Type',type:'select',options:FEATURE_TYPES.map(x=>x.label),value:cur.label},
  ],{submitLabel:'Save'});
  if(!v)return;
  const newKind=(FEATURE_TYPES.find(x=>x.label===v.kind)||cur).kind;
  try{
    const upd=await api('/features/'+ft.id+'/',{method:'PATCH',body:{label:(v.label||'').trim(),kind:newKind}});
    const i=features.findIndex(f=>f.id===ft.id);if(i>=0)features[i]=upd;
    renderDesigner();
  }catch(e){toast("Failed: "+e.message,"error");}
}

function autoArrangeDesigner(){
  if(!plots.length){toast("No beds to arrange","error");return;}
  const maxU=_designerWidthUnits();
  let fx=0,fy=0,rh=0;const out=[];
  plots.forEach(p=>{
    if(fx+p.cols>maxU){fx=0;fy+=rh+1;rh=0;}
    p.layout_x=fx;p.layout_y=fy;out.push({id:p.id,x:fx,y:fy});
    fx+=p.cols+1;rh=Math.max(rh,p.rows);
  });
  renderDesigner();saveLayout(out);toast("Beds arranged","success");
}

async function saveLayout(list){
  try{await api('/plots/save_layout/',{method:'POST',body:{layouts:list}});}
  catch(e){toast("Couldn't save layout: "+e.message,"error");}
}

/* ---------- Backup / Restore ---------- */

async function downloadBackup(){
  try{
    const data=await api('/backup/');
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download="garden_backup_"+todayISO()+".json";a.click();
    URL.revokeObjectURL(url);
    toast("Backup downloaded","success");
  }catch(e){toast("Failed to back up: "+e.message,"error");}
}

function restoreBackup(e){
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=async ev=>{
    let data;
    try{data=JSON.parse(ev.target.result);}catch(err){toast("That file isn't valid JSON","error");return;}
    const ok=await confirmModal("Restore garden and vegetable database from this backup? Current data will be replaced.",
      {danger:true,okLabel:'Restore'});
    if(!ok)return;
    try{
      await api('/backup/restore/',{method:'POST',body:data});
      await refreshAll();
      toast("Backup restored","success");
    }catch(err){toast("Failed to restore: "+err.message,"error");}
  };
  r.readAsText(f);e.target.value="";
}

/* ---------- Settings (Veg / Plants tabs) ---------- */

let settingsTab='veg';
let plantCatalog=[];
function setSettingsTab(t){settingsTab=t;renderSettings();}
function renderSettings(){
  document.getElementById("settings-veg").style.display=settingsTab==='veg'?'':'none';
  document.getElementById("settings-plants").style.display=settingsTab==='plants'?'':'none';
  document.getElementById("settings-general").style.display=settingsTab==='general'?'':'none';
  document.querySelectorAll("#settingsTabs .data-tab").forEach(b=>b.classList.toggle("active",b.dataset.stab===settingsTab));
  if(settingsTab==='veg')renderVegList();
  else if(settingsTab==='plants')loadPlantCatalog().then(renderPlantList);
  else renderGeneral();
}
async function loadPlantCatalog(){try{plantCatalog=await api('/plants/');}catch(e){plantCatalog=[];}}

function fillMonthSelect(id,sel){
  const el=document.getElementById(id);if(!el)return;
  let h='<option value="0">—</option>';
  for(let i=1;i<=12;i++)h+='<option value="'+i+'"'+(String(sel)===String(i)?' selected':'')+'>'+MONTH_FULL[i-1]+'</option>';
  el.innerHTML=h;
}
function renderGeneral(){
  const u=document.getElementById("unitSelect");if(u)u.value=getUnits();
  const f=getFrost();
  fillMonthSelect("frostLast",f.last);
  fillMonthSelect("frostFirst",f.first);
}
function onUnitsChange(){
  setUnits(document.getElementById("unitSelect").value);
  toast("Units updated","success");
  buildGrid();
  if(document.getElementById("view-charts").classList.contains("active"))renderCharts();
}
function onFrostChange(){
  setFrost({last:parseInt(document.getElementById("frostLast").value)||0,first:parseInt(document.getElementById("frostFirst").value)||0});
  toast("Frost dates saved","success");
}
function optionList(opts,val){return opts.map(o=>'<option'+(o===val?' selected':'')+'>'+escapeHtml(o)+'</option>').join('');}
function replaceCellAnywhere(updated){
  for(const p of plots){
    const cells=p.cells||[];
    const idx=cells.findIndex(c=>c.id===updated.id);
    if(idx>=0){cells[idx]=updated;return p;}
  }
  return null;
}

let _plantPlace={};
function plantCardHtml(pl,ctx){
  let ctxLine;
  if(ctx&&ctx.length){
    const places=ctx.map(x=>escapeHtml(x.bed)+' '+(Math.floor(x.pos/x.cols)+1)+','+((x.pos%x.cols)+1)).join(' · ');
    ctxLine='<div class="pl-context">🌷 In '+ctx.length+' square'+(ctx.length!==1?'s':'')+': '+places+'</div>';
  }else{
    ctxLine='<div class="pl-context pl-unplaced">Not placed in a bed</div>';
  }
  return `<div class="veg-card" data-plant="${pl.id}">
    <div class="veg-card-header">
      <div class="veg-thumb"><span>${plantEmoji(pl.name)}</span></div>
      <div class="veg-card-titles">
        <input type="text" value="${escapeHtml(pl.name)}" placeholder="Name" data-field="name">
        <input type="text" value="${escapeHtml(pl.latin_name||'')}" placeholder="Latin name" data-field="latin_name">
      </div>
    </div>
    ${ctxLine}
    <div class="veg-fields">
      ${vegField("Date planted",`<input type="date" value="${escapeHtml(pl.date_planted||'')}" data-field="date_planted">`)}
      ${vegField("Water",`<select data-field="water_level"><option value="">—</option>${optionList(['Low','Medium','High'],pl.water_level)}</select>`)}
      ${vegField("Sun",`<select data-field="sun_level"><option value="">—</option>${optionList(['Full sun','Partial shade','Full shade'],pl.sun_level)}</select>`)}
      ${vegField("Soil",`<select data-field="soil_type"><option value="">—</option>${optionList(['Loam','Clay','Sandy','Chalk','Peat','Silt'],pl.soil_type)}</select>`)}
    </div>
    <div class="veg-notes-field">
      <label class="veg-notes-cap">About</label>
      <textarea data-field="about" placeholder="Notes about this plant…">${escapeHtml(pl.about||'')}</textarea>
    </div>
    <div class="veg-card-actions">
      <button class="mini-btn danger" onclick="deletePlantRecord(${pl.id})">🗑 Delete plant</button>
    </div>
  </div>`;
}

function renderPlantList(){
  const le=document.getElementById("plantList");
  _plantPlace={};
  plots.forEach(p=>{(p.cells||[]).forEach(c=>{if(c.plant){(_plantPlace[c.plant.id]||(_plantPlace[c.plant.id]=[])).push({bed:p.name,cols:p.cols||1,pos:c.position});}});});
  const q=(document.getElementById("plantSearch").value||"").toLowerCase();
  const filtered=plantCatalog.filter(pl=>{
    if(!q)return true;
    const ctx=_plantPlace[pl.id];
    return pl.name.toLowerCase().includes(q)||(pl.latin_name||"").toLowerCase().includes(q)||(ctx&&ctx.some(x=>x.bed.toLowerCase().includes(q)));
  }).sort((a,b)=>a.name.localeCompare(b.name));
  if(!filtered.length){
    le.innerHTML='<div class="chart-empty">'+(plantCatalog.length?'No plants match your search.':'No plants yet. Click “+ Add plant” to create one, or tap a square in a plant bed.')+'</div>';
    return;
  }
  le.innerHTML=filtered.map(pl=>plantCardHtml(pl,_plantPlace[pl.id])).join("");
  le.querySelectorAll(".veg-card").forEach(card=>{
    const pid=parseInt(card.dataset.plant);
    card.querySelectorAll("[data-field]").forEach(inp=>{
      inp.addEventListener("change",async ()=>{
        const body={};
        card.querySelectorAll("[data-field]").forEach(x=>{body[x.dataset.field]=x.value;});
        if(!(body.name||"").trim()){toast("Plant name can't be empty","error");return;}
        body.date_planted=body.date_planted||null;
        try{
          const upd=await api('/plants/'+pid+'/',{method:'PATCH',body:body});
          const i=plantCatalog.findIndex(x=>x.id===pid);if(i>=0)plantCatalog[i]=upd;
          updatePlantInPlots(upd);buildGrid();
        }catch(err){toast("Save failed: "+err.message,"error");}
      });
    });
  });
}

function updatePlantInPlots(upd){
  plots.forEach(p=>{(p.cells||[]).forEach(c=>{if(c.plant&&c.plant.id===upd.id)c.plant=upd;});});
}

async function addNewPlant(){
  const v=await formModal('Add plant',[{name:'name',label:'Plant name',type:'text',placeholder:'e.g. Lavender'}],{submitLabel:'Add'});
  if(!v)return;
  const name=(v.name||"").trim();
  if(!name){toast("Enter a name","error");return;}
  try{
    const np=await api('/plants/',{method:'POST',body:{name:name}});
    plantCatalog.push(np);renderPlantList();toast("Added "+name,"success");
  }catch(e){toast("Failed: "+e.message,"error");}
}

async function deletePlantRecord(pid){
  const ok=await confirmModal("Delete this plant?",{danger:true,okLabel:'Delete'});
  if(!ok)return;
  try{
    await api('/plants/'+pid+'/',{method:'DELETE'});
    plantCatalog=plantCatalog.filter(x=>x.id!==pid);
    plots.forEach(p=>{(p.cells||[]).forEach(c=>{if(c.plant&&c.plant.id===pid)c.plant=null;});});
    renderPlantList();buildGrid();toast("Plant deleted","success");
  }catch(e){toast("Failed: "+e.message,"error");}
}

function makeMonthOptions(sel){
  let h='<option value="0" '+(sel==0?"selected":"")+'>—</option>';
  for(let i=1;i<=12;i++)h+='<option value="'+i+'" '+(sel==i?"selected":"")+'>'+MONTH_NAMES[i-1]+'</option>';
  return h;
}

function vegField(label,inner){return `<div class="veg-field"><label>${label}</label>${inner}</div>`;}

function vegCardHtml(v){
  const k=escapeHtml(v.key);
  const thumb=v.image_url?`<img src="${escapeHtml(v.image_url)}">`:`<span>${escapeHtml(v.emoji||fallbackEmoji(v.name))}</span>`;
  const imgBtn=v.image_url?`<button class="mini-btn" onclick="removeImage('${k}')">Remove image</button>`:"";
  return `<div class="veg-card" data-key="${k}">
    <div class="veg-card-header">
      <div class="veg-thumb">${thumb}</div>
      <div class="veg-card-titles">
        <input type="text" value="${escapeHtml(v.name)}" placeholder="Name" data-field="name">
        <input type="text" value="${escapeHtml(v.latin_name||"")}" placeholder="Latin name" data-field="latin_name">
      </div>
    </div>
    <div class="veg-fields">
      ${vegField("Emoji",`<input type="text" value="${escapeHtml(v.emoji||"")}" data-field="emoji" maxlength="4">`)}
      ${vegField("Sow outdoors from",`<select data-field="sow_outdoors_start">${makeMonthOptions(v.sow_outdoors_start)}</select>`)}
      ${vegField("Sow outdoors to",`<select data-field="sow_outdoors_end">${makeMonthOptions(v.sow_outdoors_end)}</select>`)}
      ${vegField("Sow outdoors (covered) from",`<select data-field="sow_covered_start">${makeMonthOptions(v.sow_covered_start)}</select>`)}
      ${vegField("Sow outdoors (covered) to",`<select data-field="sow_covered_end">${makeMonthOptions(v.sow_covered_end)}</select>`)}
      ${vegField("Sow indoors from",`<select data-field="sow_indoors_start">${makeMonthOptions(v.sow_indoors_start)}</select>`)}
      ${vegField("Sow indoors to",`<select data-field="sow_indoors_end">${makeMonthOptions(v.sow_indoors_end)}</select>`)}
      ${vegField("Plant outside from",`<select data-field="plant_out_start">${makeMonthOptions(v.plant_out_start)}</select>`)}
      ${vegField("Plant outside to",`<select data-field="plant_out_end">${makeMonthOptions(v.plant_out_end)}</select>`)}
      ${vegField("Harvest from",`<select data-field="harvest_start">${makeMonthOptions(v.harvest_start)}</select>`)}
      ${vegField("Harvest to",`<select data-field="harvest_end">${makeMonthOptions(v.harvest_end)}</select>`)}
      ${vegField("Plants / sq ft",`<input type="number" step="0.25" min="0" value="${escapeHtml(String(v.per_sq_ft))}" data-field="per_sq_ft">`)}
      ${vegField("Days to harvest",`<input type="number" min="0" value="${escapeHtml(String(v.days_to_harvest))}" data-field="days_to_harvest">`)}
    </div>
    <div class="veg-notes-field">
      <label class="veg-notes-cap">Growing notes</label>
      <textarea data-field="notes" placeholder="Tips...">${escapeHtml(v.notes||"")}</textarea>
    </div>
    <div class="veg-card-actions">
      <button class="mini-btn" onclick="uploadImage('${k}')">📷 Upload image</button>
      ${imgBtn}
      <button class="mini-btn danger" onclick="deleteVeg('${k}')">🗑 Delete</button>
    </div>
  </div>`;
}

function renderVegList(){
  const q=(document.getElementById("vegSearch").value||"").toLowerCase();
  const le=document.getElementById("vegList");
  const list=Object.values(vegDB).sort((a,b)=>a.name.localeCompare(b.name))
    .filter(v=>v.name.toLowerCase().includes(q)||(v.latin_name||"").toLowerCase().includes(q));
  le.innerHTML=list.map(vegCardHtml).join("");
  le.querySelectorAll(".veg-card").forEach(card=>{
    const k=card.dataset.key;
    card.querySelectorAll("[data-field]").forEach(inp=>{
      inp.addEventListener("change",async e=>{
        const f=e.target.dataset.field;let val=e.target.value;
        if(f==="per_sq_ft")val=parseFloat(val)||0;
        else if(["sow_start","sow_end","harvest_start","harvest_end","days_to_harvest","sow_outdoors_start","sow_outdoors_end","sow_covered_start","sow_covered_end","sow_indoors_start","sow_indoors_end","plant_out_start","plant_out_end"].includes(f))val=parseInt(val)||0;
        try{
          const updated=await api('/veg/'+k+'/',{method:'PATCH',body:{[f]:val}});
          vegDB[k]=updated;refreshDatalist();buildGrid();refreshGuideIfActive();
        }catch(err){toast("Save failed: "+err.message,"error");}
      });
    });
  });
}

function uploadImage(k){
  const inp=document.createElement("input");inp.type="file";inp.accept="image/*";
  inp.onchange=async e=>{
    const f=e.target.files[0];if(!f)return;
    const fd=new FormData();fd.append("image",f);
    try{
      const updated=await api('/veg/'+k+'/upload_image/',{method:'POST',body:fd});
      vegDB[k]=updated;renderVegList();buildGrid();refreshGuideIfActive();toast("Image uploaded","success");
    }catch(err){toast("Upload failed: "+err.message,"error");}
  };
  inp.click();
}

async function removeImage(k){
  try{
    const updated=await api('/veg/'+k+'/remove_image/',{method:'POST',body:{}});
    vegDB[k]=updated;renderVegList();buildGrid();refreshGuideIfActive();toast("Image removed","success");
  }catch(err){toast("Failed: "+err.message,"error");}
}

async function deleteVeg(k){
  const ok=await confirmModal('Delete “'+vegDB[k].name+'” from your vegetable database?',
    {danger:true,okLabel:'Delete'});
  if(!ok)return;
  try{
    await api('/veg/'+k+'/',{method:'DELETE'});
    delete vegDB[k];refreshDatalist();renderVegList();buildGrid();refreshGuideIfActive();toast("Vegetable deleted","success");
  }catch(err){toast("Failed: "+err.message,"error");}
}

async function addNewVeg(){
  const v=await formModal('Add vegetable',
    [{name:'name',label:'Vegetable name',type:'text',placeholder:'e.g. Borlotti beans'}],
    {submitLabel:'Add'});
  if(!v)return;
  const name=(v.name||"").trim();
  if(!name){toast("Enter a name","error");return;}
  try{
    const newV=await api('/veg/',{method:'POST',body:{name:name,sow_where:"Sow outdoors",per_sq_ft:1,days_to_harvest:60}});
    vegDB[newV.key]=newV;refreshDatalist();renderVegList();buildGrid();refreshGuideIfActive();toast("Added "+newV.name,"success");
  }catch(err){toast("Failed: "+err.message,"error");}
}

document.getElementById("editModal").onclick=e=>{if(e.target.id==="editModal")closeEditModal();};
document.getElementById("vegDetailModal").onclick=e=>{if(e.target.id==="vegDetailModal")closeVegDetail();};
document.getElementById("recordModal").onclick=e=>{if(e.target.id==="recordModal")closeRecordModal();};
document.getElementById("bedNotesModal").onclick=e=>{if(e.target.id==="bedNotesModal")closeBedNotes();};
document.getElementById("confirmModal").onclick=e=>{if(e.target.id==="confirmModal")_confirmDone(false);};
document.getElementById("formModal").onclick=e=>{if(e.target.id==="formModal")_formDone(false);};
document.getElementById("plantModal").onclick=e=>{if(e.target.id==="plantModal")closePlantModal();};
document.getElementById("recordCount").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();submitRecord();}});
document.getElementById("formBody").addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.tagName!=="TEXTAREA"){e.preventDefault();_formDone(true);}});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeEditModal();closeVegDetail();closeSearchDropdown();closeRecordModal();closeBedNotes();closePlantModal();_confirmDone(false);_formDone(false);}});
["modalVeg","modalDate","modalSeeds"].forEach(id=>{document.getElementById(id).addEventListener("input",renderModalDetails);});

async function refreshAll(){
  await loadVegDB();await loadPlots();await loadFeatures();
  refreshDatalist();buildPlotTabs();buildGrid();refreshGuideIfActive();
  if(document.getElementById("view-settings").classList.contains("active"))renderSettings();
  if(document.getElementById("view-charts").classList.contains("active"))renderCharts();
  if(document.getElementById("view-sowchart").classList.contains("active"))renderSowChart();
  if(document.getElementById("view-designer").classList.contains("active"))renderDesigner();
  if(document.getElementById("view-today").classList.contains("active"))renderToday();
}

async function init(){
  buildMonthButtons();
  try{await refreshAll();}catch(e){console.error(e);toast("Failed to load data: "+e.message,"error");}
  switchView(localStorage.getItem(KEY_VIEW)||"today");
  const cmi=new Date().getMonth()+1;
  const cb=document.querySelectorAll(".month-btn")[cmi-1];
  if(cb)showMonth(cmi,cb);
}
init();
