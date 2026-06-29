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
const KEY_GEO="sfg_geo_v1";
function getGeo(){try{return JSON.parse(localStorage.getItem(KEY_GEO))||{};}catch(e){return {};}}
function setGeo(o){localStorage.setItem(KEY_GEO,JSON.stringify(o||{}));}

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
function toast(msg,type,action){
  const wrap=document.getElementById("toast");if(!wrap)return;
  const el=document.createElement("div");
  el.className="toast-item "+(type||"info");
  const span=document.createElement("span");span.textContent=msg;el.appendChild(span);
  let ttl=3200;
  if(action&&action.label&&action.fn){
    ttl=7000;
    const b=document.createElement("button");b.className="toast-action";b.textContent=action.label;
    b.onclick=()=>{el.classList.remove("show");setTimeout(()=>el.remove(),300);action.fn();};
    el.appendChild(b);
  }
  wrap.appendChild(el);
  requestAnimationFrame(()=>el.classList.add("show"));
  setTimeout(()=>{el.classList.remove("show");setTimeout(()=>el.remove(),300);},ttl);
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
// Full display name including the variety, e.g. "Radish — Green Luobo".
function vegLabel(v){if(!v)return "";return v.display_name||(v.variety?v.name+" — "+v.variety:v.name);}
// Visual (image/emoji) resolved straight from a veg object (works for varieties).
function vegVisualOf(v){
  if(v&&v.image_url)return {type:"img",value:v.image_url};
  if(v&&v.emoji)return {type:"emoji",value:v.emoji};
  return {type:"emoji",value:fallbackEmoji(v?v.name:"")};
}
// Distinct base types (for the square picker's type list), sorted.
function vegTypes(){return [...new Set(Object.values(vegDB).map(v=>v.name))].sort((a,b)=>a.localeCompare(b));}
function varietiesOfType(typeName){
  const t=(typeName||"").trim().toLowerCase();
  return Object.values(vegDB).filter(v=>v.name.toLowerCase()===t)
    .sort((a,b)=>(a.variety||"").localeCompare(b.variety||""));
}

/* ---------- Jobs (seasonal tasks attached to veg & plants) ---------- */
function jobMonthOptions(sel){
  let h='<option value="0"'+(sel==0?' selected':'')+'>Any time</option>';
  for(let i=1;i<=12;i++)h+='<option value="'+i+'"'+(sel==i?' selected':'')+'>'+MONTH_NAMES[i-1]+'</option>';
  return h;
}
// Read-only jobs list shown on info popups (veg detail, square, plant).
function jobsBlockHtml(jobs,label){
  jobs=(jobs||[]).slice().sort((a,b)=>(a.month||13)-(b.month||13));
  if(!jobs.length)return '';
  const cm=new Date().getMonth()+1;
  const rows=jobs.map(j=>{
    const ml=j.month?MONTH_NAMES[j.month-1]:'Any time';
    return '<div class="job-item'+(j.month===cm?' job-now':'')+'"><span class="job-month">'+ml+'</span><span class="job-desc">'+escapeHtml(j.description||'')+'</span></div>';
  }).join("");
  return '<div class="jobs-block"><div class="jobs-cap">📋 Jobs</div>'+rows+'</div>';
}
// Editable jobs section for Settings cards (veg or plant).
function jobRowHtml(j){
  j=j||{id:'',month:(new Date().getMonth()+1),description:''};
  return '<div class="job-row" data-job="'+(j.id||'')+'">'
    +'<select class="job-f" data-jf="month">'+jobMonthOptions(j.month)+'</select>'
    +'<input type="text" class="job-f" data-jf="description" value="'+escapeHtml(j.description||'')+'" placeholder="e.g. Pinch out side shoots">'
    +'<button class="mini-btn danger job-del" type="button">🗑</button></div>';
}
function jobsEditorHtml(kind,owner,jobs){
  jobs=(jobs||[]).slice().sort((a,b)=>(a.month||13)-(b.month||13));
  return '<div class="jobs-editor" data-jobkind="'+kind+'" data-jobowner="'+escapeHtml(String(owner))+'">'
    +'<label class="veg-notes-cap">📋 Jobs (seasonal tasks)</label>'
    +'<div class="job-rows">'+jobs.map(jobRowHtml).join("")+'</div>'
    +'<button class="mini-btn job-add" type="button">＋ Add job</button>'
    +'<span class="jobs-hint">saved with this card</span></div>';
}
// Today: one row per (square, job) for the current month — strict per-square.
// Grouped under a subtle heading per veg main type.
function todayJobsHtml(month){
  const cm=month||(new Date().getMonth()+1), cy=(new Date()).getFullYear();
  const groups={};
  const add=(type,it)=>{(groups[type]||(groups[type]=[])).push(it);};
  plots.forEach(p=>(p.cells||[]).forEach(c=>{
    // Jobs already done for THIS square this month (matched by description).
    const cellDone=new Set();
    (c.history||[]).forEach(h=>{if(h.event_type==='job'&&h.date){const d=parseLocalDate(h.date);if(d&&d.getMonth()+1===cm&&d.getFullYear()===cy)cellDone.add(h.note||'');}});
    const loc=escapeHtml(p.name)+' '+rcLabel(c.position,p.cols);
    if(c.veg){
      const v=vegDB[c.veg.key]||c.veg;
      (v.jobs||[]).forEach(j=>{if(j.month===cm)add(v.name,{jobId:j.id,cellId:c.id,label:vegLabel(v),desc:j.description||'',loc:loc,done:cellDone.has(j.description||'')});});
    }
    if(c.plant){
      const pl=(plantCatalog||[]).find(x=>x.id===c.plant.id)||c.plant;
      (pl.jobs||[]).forEach(j=>{if(j.month===cm)add(pl.name,{jobId:j.id,cellId:c.id,label:pl.name,desc:j.description||'',loc:loc,done:cellDone.has(j.description||'')});});
    }
  }));
  const types=Object.keys(groups).sort((a,b)=>a.localeCompare(b));
  const total=types.reduce((n,t)=>n+groups[t].length,0);
  if(!total)return '';
  let body='';
  types.forEach(t=>{
    body+='<li class="job-group">'+escapeHtml(t)+'</li>';
    groups[t].forEach(it=>{
      body+='<li class="'+(it.done?'job-done':'')+'">'
        +'<span class="job-main">'+escapeHtml(it.label)+(it.desc?': '+escapeHtml(it.desc):'')+' <span class="job-loc">📍 '+it.loc+'</span></span>'
        +(it.done?'<span class="t-where">✓ done</span>':'<button class="mini-btn job-done-btn" onclick="completeJobForCell('+it.cellId+','+it.jobId+')">✓ Done</button>')
        +'</li>';
    });
  });
  return '<div class="today-card"><h3>📋 Jobs this month <span class="cnt">'+total+'</span></h3><ul class="today-list job-today-list">'+body+'</ul></div>';
}
async function completeJobForCell(cellId,jobId){
  try{
    const updated=await api('/cells/'+cellId+'/log_job/',{method:'POST',body:{job:jobId}});
    replaceCellAnywhere(updated);renderToday();buildGrid();toast("Job marked done — logged to that square","success");
  }catch(e){toast("Failed: "+e.message,"error");}
}
// Job edits are staged in the card and persisted by its Save button (syncJobs).
function wireJobRow(row,markDirty){
  row.querySelectorAll(".job-f").forEach(inp=>{inp.addEventListener("input",markDirty);inp.addEventListener("change",markDirty);});
  const del=row.querySelector(".job-del");if(del)del.addEventListener("click",()=>{row.remove();markDirty();});
}
function wireJobsEditors(container){
  container.querySelectorAll(".jobs-editor").forEach(ed=>{
    const card=ed.closest(".veg-card");
    const markDirty=()=>{if(card){card.classList.add("dirty");const sb=card.querySelector(".veg-save,.plant-save");if(sb)sb.disabled=false;}};
    const rowsWrap=ed.querySelector(".job-rows");
    const add=ed.querySelector(".job-add");
    if(add)add.addEventListener("click",()=>{rowsWrap.insertAdjacentHTML("beforeend",jobRowHtml());wireJobRow(rowsWrap.lastElementChild,markDirty);markDirty();});
    ed.querySelectorAll(".job-row").forEach(row=>wireJobRow(row,markDirty));
  });
}
// Persist the card's staged job rows: delete removed, update existing, create new.
async function syncJobs(card,kind,owner,originalJobs){
  const rows=[...card.querySelectorAll(".job-row")].map(r=>({
    id:r.dataset.job?parseInt(r.dataset.job):null,
    month:parseInt(r.querySelector('[data-jf="month"]').value)||0,
    description:(r.querySelector('[data-jf="description"]').value||'').trim(),
  }));
  const keep=new Set(rows.filter(x=>x.id).map(x=>x.id));
  for(const j of (originalJobs||[])){if(!keep.has(j.id))await api('/jobs/'+j.id+'/',{method:'DELETE'});}
  for(const r of rows){
    if(r.id){await api('/jobs/'+r.id+'/',{method:'PATCH',body:{month:r.month,description:r.description}});}
    else if(r.description||r.month){const body={month:r.month,description:r.description};if(kind==='veg')body.veg=owner;else body.plant=parseInt(owner);await api('/jobs/',{method:'POST',body:body});}
  }
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
  return [...new Set(Object.values(vegDB).filter(v=>vegSowsInMonth(v,m)).map(v=>v.name))].sort();
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
  if(name==="greenhouse")renderGreenhouse();
  if(name==="planner")renderPlanner();
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
        if(dS!==null&&(c.veg.days_to_harvest-dS)<=0)ready.push({bed:p.name,plotId:p.id,cols:p.cols,pos:c.position,veg:vegLabel(c.veg),over:dS-c.veg.days_to_harvest});
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
  html+='<div id="todayWeather"></div>';
  html+=todayJobsHtml(m);
  html+='<div class="today-card"><h3>🧺 Ready to harvest <span class="cnt">'+ready.length+'</span></h3>';
  html+=ready.length?'<ul class="today-list">'+ready.slice(0,40).map(r=>'<li class="t-click" title="Open this square" onclick="goToSquare('+r.plotId+','+r.pos+')"><span>'+escapeHtml(r.veg)+'</span><span class="t-where">'+escapeHtml(r.bed)+' · '+rcLabel(r.pos,r.cols)+(r.over>0?' · '+r.over+'d over':'')+' ›</span></li>').join('')+'</ul>':'<div class="chart-empty">Nothing ready right now.</div>';
  html+='</div>';
  html+='<div class="today-card"><h3>🌱 Sow this month'+frostNote()+'</h3>';
  html+=sow.length?'<div class="sow-tags">'+sow.map(n=>'<span class="sow-tag" onclick="showVegDetail(\''+escapeHtml(slugForName(n))+'\')">'+escapeHtml(n)+'</span>').join('')+'</div>':'<div class="chart-empty">Nothing to sow this month.</div>';
  html+='</div>';
  html+='<div class="today-card"><h3>🍂 Compost due <span class="cnt">'+compost.length+'</span></h3>';
  html+=compost.length?'<ul class="today-list">'+compost.map(c=>'<li><span>'+escapeHtml(c.bed)+'</span><span class="t-where">'+(c.days==null?'never composted':c.days+'d ago')+'</span></li>').join('')+'</ul>':'<div class="chart-empty">All beds recently composted.</div>';
  html+='</div>';
  el.innerHTML=html;
  loadTodayWeather();
}
function slugForName(name){const v=vegLookupByName(name);return v?v.key:'';}
// Jump from a Today/list row straight to its bed square.
function goToSquare(plotId,pos){switchView('garden');switchPlot(plotId);openEditModal(pos);}

// Bulk-fill every empty square of the active veg bed with one vegetable.
async function fillBed(){
  const p=activePlot();if(!p){toast("No bed selected","error");return;}
  if(p.kind==='plant'){toast("Fill is for vegetable beds","error");return;}
  const empties=(p.cells||[]).filter(c=>!c.veg&&!c.date_sown&&!c.seeds_planted).length;
  if(!empties){toast("No empty squares to fill","error");return;}
  const entries=Object.values(vegDB).sort((a,b)=>vegLabel(a).localeCompare(vegLabel(b)));
  if(!entries.length){toast("Add a vegetable in Settings first","error");return;}
  const labelToKey={};entries.forEach(e=>{labelToKey[vegLabel(e)]=e.key;});
  const v=await formModal('🌱 Fill '+empties+' empty square'+(empties!==1?'s':''),[
    {name:'veg',label:'Vegetable (type — variety)',type:'select',options:entries.map(vegLabel)},
    {name:'date_sown',label:'Date sown',type:'date',value:todayISO()},
    {name:'seeds_planted',label:'Seeds per square',type:'number',value:1,min:1},
  ],{submitLabel:'Fill'});
  if(!v)return;
  const key=labelToKey[v.veg];if(!key){toast("Pick a vegetable","error");return;}
  try{
    const res=await api('/plots/'+p.id+'/fill/',{method:'POST',body:{veg_key:key,date_sown:v.date_sown||null,seeds_planted:parseInt(v.seeds_planted)||1}});
    if(res.plot)replacePlot(res.plot);
    buildGrid();toast("Filled "+res.filled+" square"+(res.filled!==1?'s':''),"success");
  }catch(e){toast("Failed: "+e.message,"error");}
}

/* ---------- Planner: succession + crop rotation ---------- */
// Distinct types you could sow in a given month (for succession suggestions).
function sowSuggestions(month,limit){
  const types={};
  Object.values(vegDB).forEach(v=>{if(vegSowsInMonth(v,month)&&!types[v.name])types[v.name]=v;});
  return Object.keys(types).sort().slice(0,limit||6);
}
// A square is a rotation risk if a DIFFERENT crop of the same family grew here
// within ~2 years (the current crop's own plantings are ignored).
function rotationIssue(cell){
  if(!cell.veg)return null;
  const curKey=cell.veg.key, fam=vegFamily(cell.veg.name);
  if(!fam||!cell.history)return null;
  const cutoff=new Date();cutoff.setFullYear(cutoff.getFullYear()-2);
  for(const h of cell.history){
    if(h.event_type!=='planted')continue;
    if((h.veg_key||'')===curKey)continue;
    if(vegFamily(h.veg_name)!==fam)continue;
    const d=parseLocalDate(h.date);
    if(d&&d>=cutoff)return {fam:fam,prev:h.veg_name||('a '+fam+' crop')};
  }
  return null;
}
function renderPlanner(){
  const el=document.getElementById("plannerBody");if(!el)return;
  const today=new Date();today.setHours(0,0,0,0);
  const free=[],rot=[];
  plots.filter(p=>p.kind!=='plant').forEach(p=>(p.cells||[]).forEach(c=>{
    if(!c.veg)return;
    const v=vegDB[c.veg.key]||c.veg;
    if(c.date_sown&&v.days_to_harvest){
      const sown=parseLocalDate(c.date_sown);
      if(sown){const fd=new Date(sown);fd.setDate(fd.getDate()+v.days_to_harvest);
        const days=Math.round((fd-today)/86400000);
        free.push({plotId:p.id,pos:c.position,bed:p.name,cols:p.cols,crop:vegLabel(v),fd:fd,days:days,month:fd.getMonth()+1});}
    }
    const ri=rotationIssue(c);
    if(ri)rot.push({plotId:p.id,pos:c.position,bed:p.name,cols:p.cols,crop:vegLabel(v),ri:ri});
  }));
  const soon=free.filter(f=>f.days<=75).sort((a,b)=>a.days-b.days);
  let html='<div class="today-head"><h2>📅 Planner</h2></div>';
  html+='<div class="today-card"><h3>🔄 Squares freeing up <span class="cnt">'+soon.length+'</span></h3>';
  if(soon.length){
    html+='<ul class="today-list">'+soon.slice(0,40).map(f=>{
      const when=f.days<=0?'ready now':'in '+f.days+'d';
      const sugg=sowSuggestions(f.month,5);
      const next=sugg.length?'<li class="plan-next">→ then sow: '+sugg.map(escapeHtml).join(', ')+'</li>':'';
      return '<li class="t-click" onclick="goToSquare('+f.plotId+','+f.pos+')"><span>'+escapeHtml(f.crop)+' <span class="job-loc">📍 '+escapeHtml(f.bed)+' '+rcLabel(f.pos,f.cols)+'</span></span><span class="t-where">'+f.fd.toLocaleDateString()+' · '+when+'</span></li>'+next;
    }).join('')+'</ul>';
  }else html+='<div class="chart-empty">Nothing maturing in the next 10 weeks.</div>';
  html+='</div>';
  html+='<div class="today-card"><h3>🔁 Rotation watch <span class="cnt">'+rot.length+'</span></h3>';
  if(rot.length){
    html+='<ul class="today-list">'+rot.map(r=>'<li class="t-click" onclick="goToSquare('+r.plotId+','+r.pos+')"><span>'+escapeHtml(r.crop)+' <span class="job-loc">📍 '+escapeHtml(r.bed)+' '+rcLabel(r.pos,r.cols)+'</span></span><span class="t-where rot-flag">🔁 '+escapeHtml(r.ri.fam)+' after '+escapeHtml(r.ri.prev)+'</span></li>').join('')+'</ul>';
    html+='<p class="gen-note">Repeating a plant family in the same square within ~2 years can build up soil pests &amp; disease — rotate to a different family where you can.</p>';
  }else html+='<div class="chart-empty">No rotation clashes detected. 👍</div>';
  html+='</div>';
  el.innerHTML=html;
}

/* ---------- Weather / frost (Open-Meteo) ---------- */
const TENDER_KEYS=['tomato','courgette','cucumber','pepper','chilli','chili','aubergine',
  'bean','pumpkin','squash','marrow','sweetcorn','basil'];
function tenderCropsOut(){
  const out=new Set();
  plots.forEach(p=>(p.cells||[]).forEach(c=>{if(c.veg){const n=(c.veg.name||'').toLowerCase();
    if(TENDER_KEYS.some(k=>n.includes(k)))out.add(c.veg.name);}}));
  return [...out];
}
function wxDow(ds){const d=parseLocalDate(ds);return d?['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]:ds;}
function wmoIcon(c){c=(c==null?-1:c);if(c===0)return'☀️';if(c<=3)return'⛅';if(c<=48)return'🌫️';
  if(c<=67)return'🌧️';if(c<=77)return'🌨️';if(c<=82)return'🌦️';if(c<=99)return'⛈️';return'🌡️';}
async function loadTodayWeather(){
  const el=document.getElementById("todayWeather");if(!el)return;
  const g=getGeo();if(!g.lat||!g.lon){el.innerHTML='';return;}
  el.innerHTML='<div class="today-card"><h3>🌦 Weather</h3><div class="chart-empty">Loading forecast…</div></div>';
  try{
    const w=await api('/weather/?lat='+g.lat+'&lon='+g.lon);
    const days=(w.days||[]).map(d=>'<div class="wx-day"><div class="wx-date">'+wxDow(d.date)+'</div>'
      +'<div class="wx-ic">'+wmoIcon(d.code)+'</div>'
      +'<div class="wx-t"><span class="wx-max">'+(d.max!=null?Math.round(d.max)+'°':'–')+'</span> '
      +'<span class="wx-min">'+(d.min!=null?Math.round(d.min)+'°':'–')+'</span></div></div>').join('');
    let frost='';
    if(w.frost_days&&w.frost_days.length){
      const tender=tenderCropsOut();
      frost='<div class="wx-frost">❄️ Frost risk: '+w.frost_days.map(f=>wxDow(f.date)).join(', ')
        +(tender.length?' — protect tender crops ('+tender.slice(0,6).map(escapeHtml).join(', ')+')':'')+'</div>';
    }
    el.innerHTML='<div class="today-card"><h3>🌦 7-day forecast</h3>'+frost+'<div class="wx-strip">'+days+'</div></div>';
  }catch(e){el.innerHTML='<div class="today-card"><h3>🌦 Weather</h3><div class="chart-empty">Couldn’t load the forecast.</div></div>';}
}
function onGeoChange(){
  const lat=parseFloat(document.getElementById("geoLat").value);
  const lon=parseFloat(document.getElementById("geoLon").value);
  setGeo({lat:isNaN(lat)?null:lat,lon:isNaN(lon)?null:lon});
  toast("Location saved","success");
}
document.querySelectorAll(".nav-btn").forEach(b=>b.onclick=()=>switchView(b.dataset.view));

function refreshDatalist(){
  const dl=document.getElementById("vegDataList");dl.innerHTML="";
  vegTypes().forEach(n=>{const o=document.createElement("option");o.value=n;dl.appendChild(o);});
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
  // One entry per main type (any of its varieties sowing/harvesting counts).
  const plantT={},harvT={};
  Object.values(vegDB).forEach(v=>{
    if(vegSowsInMonth(v,mn)&&!plantT[v.name])plantT[v.name]=v;
    if(monthInRange(mn,v.harvest_start,v.harvest_end)&&!harvT[v.name])harvT[v.name]=v;
  });
  const plants=Object.values(plantT).sort((a,b)=>a.name.localeCompare(b.name));
  const harvests=Object.values(harvT).sort((a,b)=>a.name.localeCompare(b.name));
  const rl=arr=>{
    if(!arr.length)return '<div class="empty-msg">Nothing this month</div>';
    return '<div class="veg-list">'+arr.map(v=>{
      const vis=vegVisualOf(v);
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
    .filter(v=>v.name.toLowerCase().includes(query)||(v.variety||"").toLowerCase().includes(query)||(v.latin_name||"").toLowerCase().includes(query))
    .sort((a,b)=>vegLabel(a).localeCompare(vegLabel(b))).slice(0,8);
  if(!es.length){dd.innerHTML='<div class="no-results">No plants match "'+escapeHtml(q)+'"</div>';}
  else{
    dd.innerHTML=es.map(v=>{
      const vis=vegVisualOf(v);
      const t=vis.type==="img"?'<img src="'+vis.value+'" alt="">':'<span>'+vis.value+'</span>';
      return '<div class="search-result-item" onclick="selectSearchResult(\''+v.key+'\')"><div class="search-result-thumb">'+t+'</div><div class="search-result-text"><div class="search-result-name">'+escapeHtml(vegLabel(v))+'</div>'+(v.latin_name?'<div class="search-result-latin">'+escapeHtml(v.latin_name)+'</div>':"")+'</div></div>';
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
  // Type-centric: show the type's plant/harvest, then list its varieties.
  const entries=varietiesOfType(v.name);
  const rep=entries.find(e=>!e.variety)||entries[0]||v;
  const namedVarieties=entries.filter(e=>e.variety);
  const vis=vegVisualOf(rep);
  const vh=vis.type==="img"?`<img src="${escapeHtml(vis.value)}" alt="">`:`<span>${vis.value}</span>`;
  const latin=rep.latin_name?`<div class="latin">${escapeHtml(rep.latin_name)}</div>`:"";
  const notes=rep.notes?`<div class="veg-notes"><div class="veg-notes-label">Growing tips</div>${escapeHtml(rep.notes).replace(/\n/g,"<br>")}</div>`:"";
  // Jobs for the whole type (deduped across its entries).
  const jobs=[],seen=new Set();
  entries.forEach(e=>(e.jobs||[]).forEach(j=>{const sk=j.month+'|'+j.description;if(!seen.has(sk)){seen.add(sk);jobs.push(j);}}));
  // Varieties in the database for this type.
  const varHtml=namedVarieties.length?`
    <div class="veg-varieties">
      <div class="veg-varieties-cap">🌱 Varieties in your database (${namedVarieties.length})</div>
      ${namedVarieties.map(e=>{
        const sow=vegSowMethodsSet(e).map(m=>escapeHtml(m.label)+' '+rangeLabel(e[m.start],e[m.end])).join(' · ')||'—';
        return `<div class="vv-item"><div class="vv-name">${escapeHtml(e.variety)}</div><div class="vv-meta">${sow} · 🧺 ${rangeLabel(e.harvest_start,e.harvest_end)} · ⏱ ~${e.days_to_harvest}d</div></div>`;
      }).join("")}
    </div>`:'';
  document.getElementById("vegDetailBody").innerHTML=`
    <div class="veg-detail-header">
      <div class="veg-detail-img">${vh}</div>
      <div class="veg-detail-title"><h2>${escapeHtml(rep.name)}</h2>${latin}</div>
    </div>
    ${jobsBlockHtml(jobs,rep.name)}
    <div class="veg-info-grid">
      ${vegSowMethodsSet(rep).map(meth=>infoCard("🌱 "+meth.label,rangeLabel(rep[meth.start],rep[meth.end]))).join("")||infoCard("🌱 Sow","—")}
      ${infoCard("🧺 Harvest months",rangeLabel(rep.harvest_start,rep.harvest_end))}
      ${infoCard("📐 Per sq ft",rep.per_sq_ft)}
      ${infoCard("⏱ Days to harvest",rep.days_to_harvest)}
    </div>${varHtml}${notes}`;
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
    const vegName=c.veg?vegLabel(c.veg):"";
    const has=vegName||c.date_sown;
    if(has)planted++;
    seedsT+=c.seeds_planted||0;
    harvT+=c.total_harvested||0;
    const cell=document.createElement("button");
    cell.type="button";
    cell.className="cell "+(has?"planted":"empty");
    cell.setAttribute("aria-label","Square "+row+","+col+(vegName?": "+vegName:": empty"));
    cell.onclick=()=>openEditModal(i);
    const vis=c.veg?vegVisualOf(c.veg):vegVisual("");
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
  html+=jobsBlockHtml(pl.jobs,pl.name);
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

// Fill the variety dropdown with the varieties of the chosen type.
function populateVariety(typeName,selectedKey){
  const sel=document.getElementById("modalVariety");if(!sel)return;
  const matches=varietiesOfType(typeName);
  if(!matches.length){sel.innerHTML='<option value="">—</option>';sel.disabled=true;return;}
  sel.disabled=false;
  sel.innerHTML=matches.map(v=>'<option value="'+v.key+'"'+(v.key===selectedKey?' selected':'')+'>'+escapeHtml(v.variety||'(plain)')+'</option>').join("");
  if(!selectedKey)sel.value=matches[0].key;
}
// The veg entry currently chosen in the square modal (variety wins, else the type).
function currentModalEntry(){
  const sel=document.getElementById("modalVariety");
  if(sel&&sel.value)return vegLookup(sel.value);
  return vegLookupByName((document.getElementById("modalVeg").value||"").trim());
}

function openEditModal(pos){
  const p=activePlot();if(!p)return;
  const c=cellsByPosition(p)[pos];
  if(!c||c.id==null)return;
  editingCellId=c.id;
  const row=Math.floor(pos/p.cols)+1,col=(pos%p.cols)+1;
  document.getElementById("editModalTitle").textContent=p.name+" · square "+row+","+col;
  document.getElementById("modalVeg").value=c.veg?c.veg.name:"";
  populateVariety(c.veg?c.veg.name:"", c.veg?c.veg.key:null);
  document.getElementById("modalDate").value=c.date_sown||"";
  document.getElementById("modalSeeds").value=c.seeds_planted||0;
  renderModalDetails();
  renderModalPhotos();
  modalOpen("editModal","#modalVeg");
}

/* ---------- Square photos ---------- */
function renderModalPhotos(){
  const el=document.getElementById("modalPhotos");if(!el)return;
  const c=getEditingCell();
  const photos=(c&&c.photos)||[];
  if(!photos.length){el.innerHTML='<span class="photo-empty">No photos yet.</span>';return;}
  el.innerHTML=photos.map(p=>'<figure class="photo-thumb"><img src="'+escapeHtml(p.image_url||'')+'" alt="'+escapeHtml(p.caption||'')+'" onclick="window.open(\''+escapeHtml(p.image_url||'')+'\',\'_blank\')">'
    +'<button class="photo-del" title="Delete photo" onclick="deleteCellPhoto('+p.id+')">×</button>'
    +(p.taken_on?'<figcaption>'+p.taken_on+'</figcaption>':'')+'</figure>').join('');
}
function addCellPhoto(){
  const c=getEditingCell();if(!c){toast("Open a square first","error");return;}
  const inp=document.createElement("input");inp.type="file";inp.accept="image/*";
  inp.onchange=async e=>{
    const f=e.target.files[0];if(!f)return;
    const fd=new FormData();fd.append("cell",c.id);fd.append("image",f);fd.append("taken_on",todayISO());
    try{
      await api('/photos/',{method:'POST',body:fd});
      const fresh=await api('/cells/'+c.id+'/');replaceCellAnywhere(fresh);renderModalPhotos();buildGrid();
      toast("Photo added","success");
    }catch(err){toast("Upload failed: "+err.message,"error");}
  };
  inp.click();
}
async function deleteCellPhoto(id){
  const c=getEditingCell();if(!c)return;
  try{
    await api('/photos/'+id+'/',{method:'DELETE'});
    const fresh=await api('/cells/'+c.id+'/');replaceCellAnywhere(fresh);renderModalPhotos();
    toast("Photo removed","success");
  }catch(e){toast("Failed: "+e.message,"error");}
}

function historyLine(h){
  const icons={planted:'🌱',harvested:'🧺',failed:'❌',cleared:'🧹',job:'📋'};
  const verbs={planted:'Planted',harvested:'Harvested',failed:'Failed',cleared:'Cleared',job:'Job done'};
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
  const entry=currentModalEntry();
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
    let html='<strong>'+escapeHtml(vegLabel(entry))+'</strong>'+(entry.latin_name?' <span style="font-style:italic;color:var(--muted)">'+escapeHtml(entry.latin_name)+'</span>':"")+'<br>🌱 '+sowBits+'<br>🧺 Harvest: '+rangeLabel(entry.harvest_start,entry.harvest_end)+' · 📐 '+entry.per_sq_ft+'/sq ft · ⏱ ~'+entry.days_to_harvest+'d to harvest';
    const c0=getEditingCell();
    const rot=rotationWarning(c0,entry.name);
    if(rot)html+='<div class="rot-warn">🔁 '+escapeHtml(rot)+'</div>';
    const comp=companionText(entry.name);
    if(comp)html+='<div class="comp-tip">'+comp+'</div>';
    html+=jobsBlockHtml(entry.jobs,vegLabel(entry));
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
    const e=currentModalEntry();
    if(!e){toast("Add “"+vegName+"” (and pick a variety) in Settings first.","error");return;}
    vegKey=e.key;
    // Sown date + seeds are required once a vegetable is chosen.
    if(!date){toast("Enter the date it was sown","error");document.getElementById("modalDate").focus();return;}
    if(!seeds||seeds<=0){toast("Enter how many seeds were planted","error");document.getElementById("modalSeeds").focus();return;}
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
  // Snapshot what was here so the action can be undone.
  const prev={id:c.id,veg_key:c.veg?c.veg.key:'',date_sown:c.date_sown||null,seeds_planted:c.seeds_planted||0};
  try{
    const updated=await api('/cells/'+c.id+'/clear_plot/',{method:'POST'});
    replaceCell(updated);buildGrid();closeEditModal();
    toast("Square cleared","success",prev.veg_key?{label:"Undo",fn:()=>undoClearCell(prev)}:null);
  }catch(e){toast("Failed: "+e.message,"error");}
}
async function undoClearCell(prev){
  try{
    const updated=await api('/cells/'+prev.id+'/',{method:'PATCH',
      body:{veg_key:prev.veg_key,date_sown:prev.date_sown,seeds_planted:prev.seeds_planted}});
    replaceCellAnywhere(updated);buildGrid();toast("Restored","success");
  }catch(e){toast("Undo failed: "+e.message,"error");}
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

// Resolve a by_vegetable row to its {type, variety}. Prefer the live veg DB
// (by key); fall back to splitting the "Type — Variety" history snapshot.
function vegTypeVariety(v){
  const e=v.veg_key?vegDB[v.veg_key]:null;
  if(e)return {type:e.name,variety:e.variety||""};
  const nm=v.veg_name||"—";
  const i=nm.indexOf(" — ");
  return i>=0?{type:nm.slice(0,i),variety:nm.slice(i+3)}:{type:nm,variety:""};
}
// Side-by-side bar comparison of a type's varieties (only when 2+ have outcomes).
function varietyCompareHtml(rows){
  const withData=rows.filter(v=>(v.total_harvested+v.total_failed)>0);
  if(withData.length<2)return '';
  const sorted=withData.slice().sort((a,b)=>b.total_harvested-a.total_harvested);
  const max=Math.max(1,...sorted.map(v=>v.total_harvested));
  const best=sorted[0];
  const bars=sorted.map(v=>{
    const w=Math.max(2,Math.round(v.total_harvested/max*100));
    const nm=escapeHtml(v.variety||'(plain)');
    return '<div class="vc-row"><span class="vc-name" title="'+nm+'">'+nm+'</span>'
      +'<div class="vc-track"><div class="vc-bar" style="width:'+w+'%"></div></div>'
      +'<span class="vc-val">🧺'+v.total_harvested+(v.weight_g?' · '+fmtWeight(v.weight_g):'')+' · '+pct(v.success_rate)+'</span></div>';
  }).join('');
  return '<div class="vc-compare"><div class="vc-cap">⚖️ Variety comparison — 🏆 best: <strong>'
    +escapeHtml(best.variety||'(plain)')+'</strong></div>'+bars+'</div>';
}
function vegTableHtml(s){
  if(!s.by_vegetable.length)return '<div class="chart-empty">No planting history yet.</div>';
  // Group per-variety rows under their main type.
  const groups={};
  s.by_vegetable.forEach(v=>{
    const tv=vegTypeVariety(v);
    const g=groups[tv.type]||(groups[tv.type]={type:tv.type,rows:[],h:0,w:0,f:0,seeds:0,sq:0});
    g.rows.push(Object.assign({variety:tv.variety},v));
    g.h+=v.total_harvested;g.w+=(v.weight_g||0);g.f+=v.total_failed;g.seeds+=v.seeds_planted;g.sq+=v.squares_used;
  });
  const cols='<tr><th>Variety</th><th>Squares</th><th>Seeds</th><th>🧺</th><th>⚖️</th><th>❌</th><th>Success</th><th>Days→1st</th></tr>';
  return Object.values(groups).sort((a,b)=>b.h-a.h).map(g=>{
    const oc=g.h+g.f,succ=oc?g.h/oc:null;
    const varRows=g.rows.slice().sort((a,b)=>b.total_harvested-a.total_harvested).map(v=>
      '<tr><td>'+escapeHtml(v.variety||'(plain)')+'</td><td>'+v.squares_used+'</td><td>'+v.seeds_planted+'</td><td>'+v.total_harvested+'</td><td>'+fmtWeight(v.weight_g)+'</td><td>'+v.total_failed+'</td><td>'+pct(v.success_rate)+'</td><td>'+(v.avg_days_to_harvest!=null?v.avg_days_to_harvest+'d':'—')+'</td></tr>'
    ).join('');
    return '<details class="veg-type"><summary class="veg-type-sum">'
      +'<span class="vt-name">'+escapeHtml(g.type)+'</span>'
      +'<span class="vt-stats">🧺'+g.h+' · ⚖️'+fmtWeight(g.w)+' · ❌'+g.f+' · '+pct(succ)+' · '+g.rows.length+' '+(g.rows.length===1?'variety':'varieties')+'</span>'
      +'</summary><div class="mx-scroll"><table class="data-table"><thead>'+cols+'</thead><tbody>'+varRows+'</tbody></table></div>'
      +varietyCompareHtml(g.rows)+'</details>';
  }).join('');
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
function vegOverview(s){
  if(!s.by_vegetable.length)return 'no crops yet';
  const types={};
  s.by_vegetable.forEach(v=>{const t=vegTypeVariety(v).type;types[t]=(types[t]||0)+v.total_harvested;});
  const arr=Object.entries(types).sort((a,b)=>b[1]-a[1]);
  return arr.length+' type'+(arr.length!==1?'s':'')+' · top '+escapeHtml(arr[0][0])+' 🧺'+arr[0][1];
}
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
  return '<div class="chart-card"><h3>🔬 Vegetable performance — detailed</h3><p class="chart-sub">'+plants.length+' crops across all beds · click a crop to expand</p>'+plants.map(p=>plantCard(p,mx[p.veg_key||p.veg_name])).join('')+'</div>';
}

// Merge every bed's per-variety figures into one garden-wide list (keyed by
// veg_key), so the Veg tab can group it by type just like a single bed does.
function aggregateVeg(){
  const m={};
  chartStats.forEach(s=>(s.by_vegetable||[]).forEach(v=>{
    const k=v.veg_key||v.veg_name||'—';
    const d=m[k]||(m[k]={veg_key:v.veg_key,veg_name:v.veg_name,squares_used:0,seeds_planted:0,
                         total_harvested:0,weight_g:0,total_failed:0,_dsum:0,_dn:0});
    d.squares_used+=v.squares_used;d.seeds_planted+=v.seeds_planted;d.total_harvested+=v.total_harvested;
    d.weight_g+=(v.weight_g||0);d.total_failed+=v.total_failed;
    if(v.avg_days_to_harvest!=null){d._dsum+=v.avg_days_to_harvest;d._dn++;}
  }));
  return Object.values(m).map(d=>{
    const oc=d.total_harvested+d.total_failed;
    return Object.assign(d,{success_rate:oc?d.total_harvested/oc:null,
                            avg_days_to_harvest:d._dn?Math.round(d._dsum/d._dn):null});
  });
}
function vegTab(){
  const agg=aggregateVeg();
  if(!agg.length)return '<div class="chart-card"><div class="chart-empty">No planting history yet.</div></div>';
  return '<div class="chart-card"><h3>🥕 Vegetable performance by type</h3>'
    +'<p class="chart-sub">across all beds · open a type to see each variety</p>'
    +vegTableHtml({by_vegetable:agg})+'</div>';
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
  const tabs='<div class="data-tabs">'+tab('beds','🟩 Beds')+tab('veg','🥕 Veg')+tab('plants','🔬 Veg - Detailed')+'</div>';
  body.innerHTML=overallSummary(chartStats)+yearOverYear(chartStats)+tabs
    +(dataTab==='beds'?bedsTab():dataTab==='veg'?vegTab():plantsTab());
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
      return v.name.toLowerCase().includes(q)||(v.variety||"").toLowerCase().includes(q)||(v.latin_name||"").toLowerCase().includes(q);
    })
    .sort((a,b)=>vegLabel(a).localeCompare(vegLabel(b)));

  if(!list.length){
    body.innerHTML='<div class="sow-empty">No vegetables with sow or harvest months'+(q?' match "'+escapeHtml(q)+'"':'')+'.</div>';
    return;
  }

  let html='<div class="sow-grid"><div class="sow-head sow-label-head">Vegetable</div>';
  for(let m=1;m<=12;m++)html+='<div class="sow-head">'+MONTH_NAMES[m-1]+'</div>';

  list.forEach(v=>{
    const vis=vegVisualOf(v);
    const icon=vis.type==="img"
      ? '<img src="'+vis.value+'" alt="">'
      : '<span class="sow-emoji">'+vis.value+'</span>';
    html+='<div class="sow-rowlabel" title="'+escapeHtml(vegLabel(v))+'" onclick="showVegDetail(\''+v.key+'\')">'+icon+'<span>'+escapeHtml(vegLabel(v))+'</span></div>';
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
  designerDirty=false;
  const _dsb=document.getElementById("designerSaveBtn");if(_dsb){_dsb.disabled=true;_dsb.classList.remove("dirty");}
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
    opts.setPos(nx,ny);_resizeDesignerCanvas();markDesignerDirty();
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
    _resizeDesignerCanvas();markDesignerDirty();
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
  renderDesigner();markDesignerDirty();
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
  renderDesigner();markDesignerDirty();toast("Beds arranged — click Save layout to keep","success");
}

async function saveLayout(list){
  try{await api('/plots/save_layout/',{method:'POST',body:{layouts:list}});}
  catch(e){toast("Couldn't save layout: "+e.message,"error");}
}

// Designer changes (drag/resize/rotate/auto-arrange) are held locally until Save.
let designerDirty=false;
function markDesignerDirty(){
  designerDirty=true;
  const b=document.getElementById("designerSaveBtn");
  if(b){b.disabled=false;b.classList.add("dirty");}
}
async function saveDesigner(){
  const list=plots.filter(p=>designLayout[p.id]).map(p=>({id:p.id,x:designLayout[p.id].x,y:designLayout[p.id].y}));
  if(list.length)await saveLayout(list);
  for(const ft of features)await saveFeature(ft);
  designerDirty=false;
  const b=document.getElementById("designerSaveBtn");if(b){b.disabled=true;b.classList.remove("dirty");}
  toast("Layout saved","success");
}

/* ---------- Greenhouse (seedlings raised indoors) ---------- */
let seedlings=[];
async function loadSeedlings(){try{seedlings=await api('/seedlings/');}catch(e){seedlings=[];}}
function replaceSeedling(upd){const i=seedlings.findIndex(s=>s.id===upd.id);if(i>=0)seedlings[i]=upd;}
function renderGreenhouse(){
  const el=document.getElementById("greenhouseBody");if(!el)return;
  const q=(document.getElementById("ghSearch").value||"").toLowerCase();
  const list=seedlings.filter(s=>!q||(s.veg_display||"").toLowerCase().includes(q));
  if(!list.length){el.innerHTML='<div class="chart-empty">'+(seedlings.length?'No seedlings match your search.':'No seedlings yet. Click “＋ Sow seedlings” to start a batch.')+'</div>';return;}
  const rows=list.map(s=>{
    const v=s.veg_key?vegDB[s.veg_key]:null;
    const vis=v?vegVisualOf(v):{type:'emoji',value:'🌱'};
    const icon=vis.type==='img'?'<img class="gh-ic" src="'+vis.value+'" alt="">':'<span class="gh-ic">'+vis.value+'</span>';
    const age=daysSince(s.date_sown);
    let status='<span class="gh-stat-none">—</span>';
    if(s.amount>0){
      const ageTxt=age!=null?' · '+age+'d':'';
      status=(age!=null&&age>=14)
        ? '<span class="gh-ready">🪴 Ready to transplant'+ageTxt+'</span>'
        : '<span class="gh-growing">🌱 Growing'+ageTxt+'</span>';
    }
    return '<tr>'
      +'<td>'+icon+' '+escapeHtml(s.veg_display||'—')+'</td>'
      +'<td>'+(s.date_sown||'—')+'</td>'
      +'<td class="gh-num">'+s.amount+'</td>'
      +'<td class="gh-num">'+s.sprouted+'</td>'
      +'<td class="gh-num">'+s.failed+'</td>'
      +'<td>'+status+'</td>'
      +'<td class="gh-actions">'
        +'<button class="mini-btn" title="Record sprouted" onclick="recordSeedling('+s.id+',\'sprouted\')">🌱 +</button>'
        +'<button class="mini-btn" title="Record failed" onclick="recordSeedling('+s.id+',\'failed\')">❌ +</button>'
        +'<button class="mini-btn danger" title="Delete batch" onclick="deleteSeedling('+s.id+')">🗑</button>'
      +'</td></tr>';
  }).join('');
  const ready=list.filter(s=>s.amount>0&&daysSince(s.date_sown)!=null&&daysSince(s.date_sown)>=14).length;
  const hint=ready?'<p class="gen-note">🪴 '+ready+' batch'+(ready!==1?'es':'')+' ready to transplant — open a veg square and use “Plant from greenhouse”.</p>':'';
  el.innerHTML=hint+'<div class="mx-scroll"><table class="data-table gh-table"><thead><tr>'
    +'<th>Vegetable</th><th>Date sown</th><th>In greenhouse</th><th>Sprouted</th><th>Failed</th><th>Status</th><th></th></tr></thead><tbody>'
    +rows+'</tbody></table></div>';
}
async function addSeedling(){
  const entries=Object.values(vegDB).sort((a,b)=>vegLabel(a).localeCompare(vegLabel(b)));
  if(!entries.length){toast("Add a vegetable in Settings first","error");return;}
  const labelToKey={};entries.forEach(e=>{labelToKey[vegLabel(e)]=e.key;});
  const v=await formModal('🪴 Sow seedlings',[
    {name:'veg',label:'Vegetable (type — variety)',type:'select',options:entries.map(vegLabel)},
    {name:'date_sown',label:'Date sown',type:'date',value:todayISO()},
    {name:'amount',label:'How many sown',type:'number',value:12,min:1},
  ],{submitLabel:'Add'});
  if(!v)return;
  const key=labelToKey[v.veg];if(!key){toast("Pick a vegetable","error");return;}
  try{
    const sd=await api('/seedlings/',{method:'POST',body:{veg:key,date_sown:v.date_sown||null,amount:parseInt(v.amount)||0}});
    seedlings.unshift(sd);renderGreenhouse();toast("Seedlings sown","success");
  }catch(e){toast("Failed: "+e.message,"error");}
}
async function recordSeedling(id,field){
  const sd=seedlings.find(s=>s.id===id);if(!sd)return;
  const v=await formModal(field==='sprouted'?'🌱 Record sprouted':'❌ Record failed',
    [{name:'n',label:field==='sprouted'?'How many sprouted?':'How many failed?',type:'number',value:1,min:1}],{submitLabel:'Add'});
  if(!v)return;
  const n=parseInt(v.n)||0;if(n<=0)return;
  const body={};body[field]=(sd[field]||0)+n;
  try{const upd=await api('/seedlings/'+id+'/',{method:'PATCH',body:body});replaceSeedling(upd);renderGreenhouse();}
  catch(e){toast("Failed: "+e.message,"error");}
}
async function deleteSeedling(id){
  const ok=await confirmModal("Delete this seedling batch?",{danger:true,okLabel:'Delete'});
  if(!ok)return;
  try{await api('/seedlings/'+id+'/',{method:'DELETE'});seedlings=seedlings.filter(s=>s.id!==id);renderGreenhouse();toast("Deleted","success");}
  catch(e){toast("Failed: "+e.message,"error");}
}
async function plantFromGreenhouse(){
  const c=getEditingCell();if(!c){toast("Open a square first","error");return;}
  await loadSeedlings();
  const avail=seedlings.filter(s=>s.amount>0&&s.veg_key);
  if(!avail.length){toast("No seedlings available in the greenhouse","error");return;}
  const labelToId={};avail.forEach(s=>{labelToId[(s.veg_display||'—')+' · sown '+(s.date_sown||'?')+' · '+s.amount+' available']=s.id;});
  const v=await formModal('🪴 Plant from greenhouse',[
    {name:'batch',label:'Seedling batch',type:'select',options:Object.keys(labelToId)},
    {name:'count',label:'How many to plant in this square',type:'number',value:1,min:1},
  ],{submitLabel:'Plant'});
  if(!v)return;
  const sid=labelToId[v.batch];const count=parseInt(v.count)||0;
  if(!sid||count<=0){toast("Pick a batch and amount","error");return;}
  try{
    const updated=await api('/cells/'+c.id+'/plant_from_seedling/',{method:'POST',body:{seedling_id:sid,count:count}});
    replaceCell(updated);await loadSeedlings();buildGrid();closeEditModal();toast("Transplanted from greenhouse","success");
  }catch(e){toast("Failed: "+e.message,"error");}
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
  const g=getGeo();
  const la=document.getElementById("geoLat"),lo=document.getElementById("geoLon");
  if(la)la.value=g.lat!=null?g.lat:'';
  if(lo)lo.value=g.lon!=null?g.lon:'';
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
    ${jobsEditorHtml('plant',pl.id,pl.jobs)}
    <div class="veg-card-actions">
      <button class="mini-btn save-btn plant-save" type="button" disabled>💾 Save</button>
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
    const saveBtn=card.querySelector(".plant-save");
    const markDirty=()=>{card.classList.add("dirty");if(saveBtn)saveBtn.disabled=false;};
    card.querySelectorAll("[data-field]").forEach(inp=>{
      inp.addEventListener("input",markDirty);
      inp.addEventListener("change",markDirty);
    });
    if(saveBtn)saveBtn.addEventListener("click",()=>savePlantCard(pid,card,saveBtn));
  });
  wireJobsEditors(le);
}

async function savePlantCard(pid,card,saveBtn){
  const body={};
  card.querySelectorAll("[data-field]").forEach(x=>{body[x.dataset.field]=x.value;});
  if(!(body.name||"").trim()){toast("Plant name can't be empty","error");return;}
  body.date_planted=body.date_planted||null;
  if(saveBtn)saveBtn.disabled=true;
  try{
    await api('/plants/'+pid+'/',{method:'PATCH',body:body});
    const orig=plantCatalog.find(x=>x.id===pid);
    await syncJobs(card,'plant',pid,(orig||{}).jobs);
    const fresh=await api('/plants/'+pid+'/');
    const i=plantCatalog.findIndex(x=>x.id===pid);if(i>=0)plantCatalog[i]=fresh;
    updatePlantInPlots(fresh);renderPlantList();buildGrid();toast("Saved","success");
  }catch(err){toast("Save failed: "+err.message,"error");if(saveBtn)saveBtn.disabled=false;}
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
// One aligned "From / To" row for a sow/harvest window.
function winRow(label,sf,ef,v){
  return `<div class="win-row"><span class="win-label">${label}</span>`
    +`<select data-field="${sf}">${makeMonthOptions(v[sf])}</select>`
    +`<select data-field="${ef}">${makeMonthOptions(v[ef])}</select></div>`;
}

function vegCardHtml(v){
  const k=escapeHtml(v.key);
  const thumb=v.image_url?`<img src="${escapeHtml(v.image_url)}">`:`<span>${escapeHtml(v.emoji||fallbackEmoji(v.name))}</span>`;
  const imgBtn=v.image_url?`<button class="mini-btn" onclick="removeImage('${k}')">Remove image</button>`:"";
  return `<div class="veg-card" data-key="${k}">
    <div class="veg-card-header">
      <div class="veg-thumb">${thumb}</div>
      <div class="veg-card-titles">
        <input type="text" value="${escapeHtml(v.name)}" placeholder="Type (e.g. Radish)" data-field="name">
        <input type="text" value="${escapeHtml(v.variety||"")}" placeholder="Variety (e.g. Green Luobo)" data-field="variety">
        <input type="text" value="${escapeHtml(v.latin_name||"")}" placeholder="Latin name" data-field="latin_name">
      </div>
    </div>
    <div class="win-grid">
      <div class="win-head"><span class="win-label">When to…</span><span>From</span><span>To</span></div>
      ${winRow("Sow outdoors","sow_outdoors_start","sow_outdoors_end",v)}
      ${winRow("Sow outdoors (covered)","sow_covered_start","sow_covered_end",v)}
      ${winRow("Sow indoors","sow_indoors_start","sow_indoors_end",v)}
      ${winRow("Plant outside","plant_out_start","plant_out_end",v)}
      ${winRow("Harvest","harvest_start","harvest_end",v)}
    </div>
    <div class="veg-misc">
      ${vegField("Emoji",`<input type="text" class="emoji-in" value="${escapeHtml(v.emoji||"")}" data-field="emoji" maxlength="4">`)}
      ${vegField("Plants / sq ft",`<input type="number" class="num-in" step="0.25" min="0" value="${escapeHtml(String(v.per_sq_ft))}" data-field="per_sq_ft">`)}
      ${vegField("Days to harvest",`<input type="number" class="num-in" min="0" value="${escapeHtml(String(v.days_to_harvest))}" data-field="days_to_harvest">`)}
    </div>
    <div class="veg-notes-field">
      <label class="veg-notes-cap">Growing notes</label>
      <textarea data-field="notes" placeholder="Tips...">${escapeHtml(v.notes||"")}</textarea>
    </div>
    ${jobsEditorHtml('veg',k,v.jobs)}
    <div class="veg-card-actions">
      <button class="mini-btn save-btn veg-save" type="button" disabled>💾 Save</button>
      <button class="mini-btn" onclick="uploadImage('${k}')">📷 Upload image</button>
      ${imgBtn}
      <button class="mini-btn" onclick="duplicateVeg('${k}')">⧉ Duplicate</button>
      <button class="mini-btn danger" onclick="deleteVeg('${k}')">🗑 Delete</button>
    </div>
  </div>`;
}

function renderVegList(){
  const q=(document.getElementById("vegSearch").value||"").toLowerCase();
  const le=document.getElementById("vegList");
  const list=Object.values(vegDB).sort((a,b)=>vegLabel(a).localeCompare(vegLabel(b)))
    .filter(v=>v.name.toLowerCase().includes(q)||(v.variety||"").toLowerCase().includes(q)||(v.latin_name||"").toLowerCase().includes(q));
  le.innerHTML=list.map(vegCardHtml).join("");
  le.querySelectorAll(".veg-card").forEach(card=>{
    const k=card.dataset.key;
    const saveBtn=card.querySelector(".veg-save");
    const markDirty=()=>{card.classList.add("dirty");if(saveBtn)saveBtn.disabled=false;};
    card.querySelectorAll("[data-field]").forEach(inp=>{
      inp.addEventListener("input",markDirty);
      inp.addEventListener("change",markDirty);
    });
    if(saveBtn)saveBtn.addEventListener("click",()=>saveVegCard(k,card,saveBtn));
  });
  wireJobsEditors(le);
}

const VEG_INT_FIELDS=["sow_start","sow_end","harvest_start","harvest_end","days_to_harvest",
  "sow_outdoors_start","sow_outdoors_end","sow_covered_start","sow_covered_end",
  "sow_indoors_start","sow_indoors_end","plant_out_start","plant_out_end"];

async function saveVegCard(k,card,saveBtn){
  const body={};
  card.querySelectorAll("[data-field]").forEach(inp=>{
    const f=inp.dataset.field;let val=inp.value;
    if(f==="per_sq_ft")val=parseFloat(val)||0;
    else if(VEG_INT_FIELDS.includes(f))val=parseInt(val)||0;
    body[f]=val;
  });
  if(!(body.name||"").trim()){toast("Type can't be empty","error");return;}
  if(saveBtn)saveBtn.disabled=true;
  try{
    await api('/veg/'+k+'/',{method:'PATCH',body:body});
    await syncJobs(card,'veg',k,(vegDB[k]||{}).jobs);
    const fresh=await api('/veg/'+k+'/');
    vegDB[k]=fresh;
    refreshDatalist();buildGrid();refreshGuideIfActive();renderVegList();
    toast("Saved “"+vegLabel(fresh)+"”","success");
  }catch(err){toast("Save failed: "+err.message,"error");if(saveBtn)saveBtn.disabled=false;}
}

async function duplicateVeg(k){
  const v=vegDB[k];if(!v)return;
  const body={
    name:v.name, variety:(v.variety?v.variety+' (copy)':'Copy'),
    latin_name:v.latin_name||'', emoji:v.emoji||'', sow_where:v.sow_where||'Sow outdoors',
    sow_outdoors_start:v.sow_outdoors_start, sow_outdoors_end:v.sow_outdoors_end,
    sow_covered_start:v.sow_covered_start, sow_covered_end:v.sow_covered_end,
    sow_indoors_start:v.sow_indoors_start, sow_indoors_end:v.sow_indoors_end,
    plant_out_start:v.plant_out_start, plant_out_end:v.plant_out_end,
    harvest_start:v.harvest_start, harvest_end:v.harvest_end,
    per_sq_ft:v.per_sq_ft, days_to_harvest:v.days_to_harvest, notes:v.notes||'',
  };
  try{
    const nv=await api('/veg/',{method:'POST',body:body});
    vegDB[nv.key]=nv;refreshDatalist();buildGrid();refreshGuideIfActive();renderVegList();
    toast("Duplicated as “"+vegLabel(nv)+"”","success");
  }catch(e){toast("Failed: "+e.message,"error");}
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
    [{name:'name',label:'Type',type:'text',placeholder:'e.g. Radish'},
     {name:'variety',label:'Variety (optional)',type:'text',placeholder:'e.g. Green Luobo'}],
    {submitLabel:'Add'});
  if(!v)return;
  const name=(v.name||"").trim();
  const variety=(v.variety||"").trim();
  if(!name){toast("Enter a type","error");return;}
  try{
    const newV=await api('/veg/',{method:'POST',body:{name:name,variety:variety,sow_where:"Sow outdoors",per_sq_ft:1,days_to_harvest:60}});
    vegDB[newV.key]=newV;refreshDatalist();renderVegList();buildGrid();refreshGuideIfActive();toast("Added "+vegLabel(newV),"success");
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
document.getElementById("modalVeg").addEventListener("input",function(){populateVariety(this.value,null);renderModalDetails();});
["modalDate","modalSeeds"].forEach(id=>{document.getElementById(id).addEventListener("input",renderModalDetails);});
(function(){const mv=document.getElementById("modalVariety");if(mv)mv.addEventListener("change",renderModalDetails);})();

async function refreshAll(){
  await loadVegDB();await loadPlots();await loadFeatures();await loadPlantCatalog();await loadSeedlings();
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
