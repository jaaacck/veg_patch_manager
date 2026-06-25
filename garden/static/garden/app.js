const API='/api';
const MONTH_NAMES=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL=["January","February","March","April","May","June","July","August","September","October","November","December"];
const KEY_VIEW="sfg_view_v1";
const KEY_PLOT="sfg_plot_v1";

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

function switchView(name){
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+name));
  localStorage.setItem(KEY_VIEW,name);
  if(name==="settings")renderVegList();
  if(name==="charts")renderCharts();
  if(name==="sowchart")renderSowChart();
}
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
    if(monthInRange(mn,v.sow_start,v.sow_end))plants.push(v);
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
  detailEl.innerHTML='<div class="month-detail"><h3>'+MONTH_FULL[mn-1]+'</h3><div class="cols"><div class="col"><h4>🌱 Plant</h4>'+rl(plants)+'</div><div class="col"><h4>🧺 Harvest</h4>'+rl(harvests)+'</div></div></div>';
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
      ${infoCard("📍 Sow where",v.sow_where||"—")}
      ${infoCard("🌱 Sow months",rangeLabel(v.sow_start,v.sow_end))}
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
  el.innerHTML=plots.map(p=>'<button class="plot-tab'+(p.id===activePlotId?' active':'')+'" onclick="switchPlot('+p.id+')">🌱 '+escapeHtml(p.name)+' <span class="dim">'+p.rows+'×'+p.cols+'</span></button>').join("");
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
  gridEl.style.gridTemplateColumns="repeat("+p.cols+",1fr)";
  gridEl.innerHTML="";
  const byPos=cellsByPosition(p);
  const total=p.rows*p.cols;
  let planted=0,seedsT=0,harvT=0;
  for(let i=0;i<total;i++){
    const c=byPos[i]||{id:null,veg:null,date_sewed:null,seeds_planted:0,total_harvested:0,total_failed:0,history:[]};
    const row=Math.floor(i/p.cols)+1,col=(i%p.cols)+1;
    const vegName=c.veg?c.veg.name:"";
    const has=vegName||c.date_sewed;
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
    const dS=daysSince(c.date_sewed);
    const e=c.veg;
    let hh="";
    if(dS!==null&&e&&e.days_to_harvest){
      const rem=e.days_to_harvest-dS;
      if(rem<=0)hh='<div class="cell-harvest ready">🧺 Ready!</div>';
      else hh='<div class="cell-harvest">'+rem+'d to harvest</div>';
    }
    const totals=(c.total_harvested||c.total_failed)?'<div class="totals-line">🧺'+(c.total_harvested||0)+' · ❌'+(c.total_failed||0)+'</div>':"";
    const seedBadge=(has&&c.seeds_planted>0)?'<div class="seed-badge">🌱'+c.seeds_planted+'</div>':"";
    cell.innerHTML='<div class="cell-label">'+row+','+col+'</div>'+seedBadge+vh+'<div style="display:flex;flex-direction:column;align-items:center;gap:2px;width:100%">'+(vegName?'<div class="cell-veg">'+escapeHtml(vegName)+'</div>':"")+(c.date_sewed?'<div class="cell-days">'+daysLabel(dS)+'</div>':"")+hh+totals+'</div>';
    gridEl.appendChild(cell);
  }
  stat.textContent=planted+"/"+total+" squares · 🌱"+seedsT+" seeds · 🧺"+harvT+" harvested";
}

async function createPlot(){
  const v=await formModal('New bed',[
    {name:'name',label:'Name',type:'text',value:'New bed',placeholder:'e.g. Tomato Bed'},
    {name:'rows',label:'Rows (squares tall)',type:'number',value:4,min:1},
    {name:'cols',label:'Columns (squares wide)',type:'number',value:4,min:1},
  ],{submitLabel:'Create bed'});
  if(!v)return;
  const rows=parseInt(v.rows),cols=parseInt(v.cols);
  if(isNaN(rows)||rows<1||isNaN(cols)||cols<1){toast("Enter valid row and column numbers","error");return;}
  const name=(v.name||"").trim()||"New bed";
  try{
    const np=await api('/plots/',{method:'POST',body:{name:name,rows:rows,cols:cols}});
    plots.push(np);activePlotId=np.id;persistActivePlot();
    buildPlotTabs();buildGrid();toast("Bed created","success");
  }catch(e){toast("Failed to create bed: "+e.message,"error");}
}

async function renamePlot(){
  const p=activePlot();if(!p){toast("No bed selected","error");return;}
  const v=await formModal('Rename bed',[{name:'name',label:'Name',type:'text',value:p.name}],{submitLabel:'Rename'});
  if(!v)return;
  const name=(v.name||"").trim();
  if(!name){toast("Name can't be empty","error");return;}
  try{
    const updated=await api('/plots/'+p.id+'/',{method:'PATCH',body:{name:name}});
    replacePlot(updated);buildPlotTabs();toast("Bed renamed","success");
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
  document.getElementById("modalDate").value=c.date_sewed||"";
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
  if(entry){
    let html='<strong>'+escapeHtml(entry.name)+'</strong>'+(entry.latin_name?' <span style="font-style:italic;color:var(--muted)">'+escapeHtml(entry.latin_name)+'</span>':"")+'<br>📍 '+escapeHtml(entry.sow_where||"—")+' · 🌱 Sow: '+rangeLabel(entry.sow_start,entry.sow_end)+' · 🧺 Harvest: '+rangeLabel(entry.harvest_start,entry.harvest_end)+'<br>📐 '+entry.per_sq_ft+'/sq ft · ⏱ ~'+entry.days_to_harvest+'d to harvest';
    if(date){
      const d=daysSince(date);
      const rem=entry.days_to_harvest-d;
      if(rem<=0)html+='<br>✅ <strong>Should be ready to harvest!</strong>';
      else{const hd=parseLocalDate(date)||new Date(date);hd.setDate(hd.getDate()+entry.days_to_harvest);html+='<br>🗓️ Sown '+daysLabel(d)+' · Expected: <strong>'+hd.toLocaleDateString()+'</strong> ('+rem+'d)';}
    }
    sumEl.innerHTML=html;sumEl.style.display="block";
  }else{sumEl.style.display="none";}
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
    const updated=await api('/cells/'+c.id+'/',{method:'PATCH',body:{veg_key:vegKey||"",date_sewed:date||null,seeds_planted:seeds}});
    replaceCell(updated);buildGrid();closeEditModal();toast("Square saved","success");
  }catch(e){toast("Failed to save: "+e.message,"error");}
  finally{if(btn)btn.disabled=false;}
}

async function clearCell(){
  const c=getEditingCell();if(!c)return;
  if(!c.veg&&!c.date_sewed&&!c.seeds_planted){closeEditModal();return;}
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
function fmtWeight(g){g=g||0;if(g<=0)return '—';return g<1000?g+' g':(g/1000).toFixed(g%1000===0?0:1)+' kg';}
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
  if(vmeta)win='<div class="pl-win">🌱 Sow '+rangeLabel(vmeta.sow_start,vmeta.sow_end)+' · 🧺 Harvest '+rangeLabel(vmeta.harvest_start,vmeta.harvest_end)+(vmeta.sow_where?' · 📍 '+escapeHtml(vmeta.sow_where):'')+(vmeta.days_to_harvest?' · ⏱ ~'+vmeta.days_to_harvest+'d':'')+'</div>';
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

function paintCharts(){
  const body=document.getElementById("chartsBody");
  if(!chartStats.length){body.innerHTML='<div class="chart-card"><div class="chart-empty">No beds yet. Create one in the Garden tab.</div></div>';return;}
  const tab=(id,lbl)=>'<button class="data-tab'+(dataTab===id?' active':'')+'" onclick="setDataTab(\''+id+'\')">'+lbl+'</button>';
  const tabs='<div class="data-tabs">'+tab('beds','🟩 Beds')+tab('plants','🥕 Plants')+'</div>';
  body.innerHTML=overallSummary(chartStats)+tabs+(dataTab==='beds'?bedsTab():plantsTab());
}

async function renderCharts(){
  const body=document.getElementById("chartsBody");
  if(!plots.length){body.innerHTML='<div class="chart-card"><div class="chart-empty">No beds yet. Create one in the Garden tab.</div></div>';return;}
  body.innerHTML='<div class="chart-card"><div class="chart-empty">Loading…</div></div>';
  try{
    chartStats=await Promise.all(plots.map(p=>api('/plots/'+p.id+'/stats/')));
    paintCharts();
  }catch(e){body.innerHTML='<div class="chart-card"><div class="chart-empty">Failed to load data: '+escapeHtml(e.message)+'</div></div>';}
}

/* ---------- Sow Chart (sow/harvest calendar) ---------- */

function renderSowChart(){
  const body=document.getElementById("sowChartBody");
  const q=(document.getElementById("sowSearch").value||"").trim().toLowerCase();
  const list=Object.values(vegDB)
    .filter(v=>{
      const hasData=(v.sow_start&&v.sow_end)||(v.harvest_start&&v.harvest_end);
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
      const sow=monthInRange(m,v.sow_start,v.sow_end);
      const harv=monthInRange(m,v.harvest_start,v.harvest_end);
      let cls="sow-cell";
      if(sow&&harv)cls+=" both";
      else if(sow)cls+=" sow";
      else if(harv)cls+=" harvest";
      html+='<div class="'+cls+'"></div>';
    }
  });
  html+='</div>';
  body.innerHTML=html;
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

/* ---------- Settings (vegetable DB) ---------- */

function makeMonthOptions(sel){
  let h='<option value="0" '+(sel==0?"selected":"")+'>—</option>';
  for(let i=1;i<=12;i++)h+='<option value="'+i+'" '+(sel==i?"selected":"")+'>'+MONTH_NAMES[i-1]+'</option>';
  return h;
}

const SOW_WHERE_OPTIONS=["Indoors","Outdoors","Indoors/Outdoors","In ground","Under cover"];

function vegField(label,inner){return `<div class="veg-field"><label>${label}</label>${inner}</div>`;}

function vegCardHtml(v){
  const k=escapeHtml(v.key);
  const thumb=v.image_url?`<img src="${escapeHtml(v.image_url)}">`:`<span>${escapeHtml(v.emoji||fallbackEmoji(v.name))}</span>`;
  const sowWhere=SOW_WHERE_OPTIONS.map(o=>`<option${v.sow_where===o?" selected":""}>${o}</option>`).join("");
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
      ${vegField("Where to sow",`<select data-field="sow_where">${sowWhere}</select>`)}
      ${vegField("Sow from",`<select data-field="sow_start">${makeMonthOptions(v.sow_start)}</select>`)}
      ${vegField("Sow to",`<select data-field="sow_end">${makeMonthOptions(v.sow_end)}</select>`)}
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
        else if(["sow_start","sow_end","harvest_start","harvest_end","days_to_harvest"].includes(f))val=parseInt(val)||0;
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
    const newV=await api('/veg/',{method:'POST',body:{name:name,sow_where:"Outdoors",per_sq_ft:1,days_to_harvest:60}});
    vegDB[newV.key]=newV;refreshDatalist();renderVegList();buildGrid();refreshGuideIfActive();toast("Added "+newV.name,"success");
  }catch(err){toast("Failed: "+err.message,"error");}
}

document.getElementById("editModal").onclick=e=>{if(e.target.id==="editModal")closeEditModal();};
document.getElementById("vegDetailModal").onclick=e=>{if(e.target.id==="vegDetailModal")closeVegDetail();};
document.getElementById("recordModal").onclick=e=>{if(e.target.id==="recordModal")closeRecordModal();};
document.getElementById("bedNotesModal").onclick=e=>{if(e.target.id==="bedNotesModal")closeBedNotes();};
document.getElementById("confirmModal").onclick=e=>{if(e.target.id==="confirmModal")_confirmDone(false);};
document.getElementById("formModal").onclick=e=>{if(e.target.id==="formModal")_formDone(false);};
document.getElementById("recordCount").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();submitRecord();}});
document.getElementById("formBody").addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.tagName!=="TEXTAREA"){e.preventDefault();_formDone(true);}});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeEditModal();closeVegDetail();closeSearchDropdown();closeRecordModal();closeBedNotes();_confirmDone(false);_formDone(false);}});
["modalVeg","modalDate","modalSeeds"].forEach(id=>{document.getElementById(id).addEventListener("input",renderModalDetails);});

async function refreshAll(){
  await loadVegDB();await loadPlots();
  refreshDatalist();buildPlotTabs();buildGrid();refreshGuideIfActive();
  if(document.getElementById("view-settings").classList.contains("active"))renderVegList();
  if(document.getElementById("view-charts").classList.contains("active"))renderCharts();
  if(document.getElementById("view-sowchart").classList.contains("active"))renderSowChart();
}

async function init(){
  buildMonthButtons();
  try{await refreshAll();}catch(e){console.error(e);toast("Failed to load data: "+e.message,"error");}
  switchView(localStorage.getItem(KEY_VIEW)||"guide");
  const cmi=new Date().getMonth()+1;
  const cb=document.querySelectorAll(".month-btn")[cmi-1];
  if(cb)showMonth(cmi,cb);
}
init();
