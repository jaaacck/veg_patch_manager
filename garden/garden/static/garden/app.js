const API='/api';
const MONTH_NAMES=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL=["January","February","March","April","May","June","July","August","September","October","November","December"];
const KEY_VIEW="sfg_view_v1";

let vegDB={};
let gridData=[];
let editingIndex=null;
let activeMonthIndex=0;

async function api(path,opts){
  opts=opts||{};
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
}

async function loadVegDB(){
  const list=await api('/veg/');
  vegDB={};
  for(const v of list)vegDB[v.key]=v;
}

async function loadGrid(){
  let arr=await api('/plots/');
  arr.sort((a,b)=>a.index-b.index);
  while(arr.length<16)arr.push({index:arr.length,veg:null,veg_key:null,date_sown:null,seeds_planted:0,total_harvested:0,total_failed:0,history:[]});
  gridData=arr;
}

function vegLookup(key){if(!key)return null;return vegDB[key]||null;}
function vegLookupByName(name){
  if(!name)return null;
  const ln=name.toLowerCase();
  for(const k in vegDB)if(vegDB[k].name.toLowerCase()===ln)return vegDB[k];
  return null;
}

function fallbackEmoji(name){
  if(!name)return "\u2795";
  const n=name.toLowerCase();
  const map=[
    [["tomato"],"\ud83c\udf45"],
    [["carrot"],"\ud83e\udd55"],
    [["aubergine","eggplant"],"\ud83c\udf46"],
    [["cucumber"],"\ud83e\udd52"],
    [["sweetcorn","corn"],"\ud83c\udf3d"],
    [["pepper","chilli","chili"],"\ud83c\udf36\ufe0f"],
    [["potato"],"\ud83e\udd54"],
    [["onion","shallot"],"\ud83e\uddc5"],
    [["garlic"],"\ud83e\uddc4"],
    [["pumpkin","butternut","squash","marrow","courgette"],"\ud83c\udf83"],
    [["mushroom"],"\ud83c\udf44"],
    [["broccoli","cauliflower"],"\ud83e\udd66"],
    [["lettuce","pak choi","chinese cabbage","salad","cabbage","brussels","kale","kalette","spinach","swiss chard"],"\ud83e\udd6c"],
    [["bean","pea","kohl rabi"],"\ud83e\udedb"],
    [["radish","beetroot","turnip","swede","parsnip","celeriac","celery","fennel","artichoke","yacon","oca","asparagus"],"\ud83e\udd55"],
    [["mint","thyme","verbena","chicory","leek","herb"],"\ud83c\udf3f"]
  ];
  for(const [keys,emoji] of map){if(keys.some(k=>n.includes(k)))return emoji;}
  return "\ud83c\udf31";
}

function vegVisual(name){
  const e=vegLookupByName(name);
  if(e&&e.image_url)return {type:"img",value:e.image_url};
  if(e&&e.emoji)return {type:"emoji",value:e.emoji};
  return {type:"emoji",value:fallbackEmoji(name)};
}

const SOW_CATEGORIES=[
  {value:"Sow indoors",cls:"sow-indoors",label:"Sow indoors"},
  {value:"Sow outdoors",cls:"sow-outdoors",label:"Sow outdoors"},
  {value:"Sow outdoors (covered)",cls:"sow-outdoors-covered",label:"Sow outdoors (covered)"},
  {value:"Plant out seedlings",cls:"sow-plantout",label:"Plant out seedlings"}
];
function sowClass(sw){
  const s=(sw||"").trim().toLowerCase();
  for(const c of SOW_CATEGORIES)if(c.value.toLowerCase()===s)return c.cls;
  return "";
}
function makeSowWhereOptions(sel){
  return SOW_CATEGORIES.map(c=>'<option'+(sel===c.value?' selected':'')+'>'+c.label+'</option>').join("");
}
function buildLegend(){
  const el=document.getElementById("sowLegend");if(!el)return;
  el.innerHTML='<span class="legend-title">Sow type:</span>'+SOW_CATEGORIES.map(c=>'<span class="legend-item"><span class="legend-swatch '+c.cls+'"></span>'+c.label+'</span>').join("");
}

function monthInRange(m,s,e){if(!s||!e)return false;return s<=e?(m>=s&&m<=e):(m>=s||m<=e);}
function rangeLabel(s,e){if(!s||!e)return "\u2014";return MONTH_NAMES[s-1]+" \u2013 "+MONTH_NAMES[e-1];}
function daysSince(d){if(!d)return null;const s=new Date(d);if(isNaN(s))return null;return Math.floor((new Date()-s)/86400000);}
function daysLabel(d){if(d===null)return "";if(d<0)return "in "+(-d)+"d";if(d===0)return "today";if(d===1)return "1d ago";return d+"d ago";}
function todayISO(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}

function switchView(name){
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+name));
  localStorage.setItem(KEY_VIEW,name);
  if(name==="settings")renderVegList();
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
  const rl=(arr,colorBySow)=>{
    if(!arr.length)return '<div class="empty-msg">Nothing this month</div>';
    return '<div class="veg-list">'+arr.map(v=>{
      const vis=vegVisual(v.name);
      const icon=vis.type==="img"?'<img src="'+vis.value+'" style="width:18px;height:18px;border-radius:50%;object-fit:cover">':'<span>'+vis.value+'</span>';
      const sc=colorBySow?(' '+sowClass(v.sow_where)):'';
      return '<button class="veg-list-btn'+sc+'" onclick="showVegDetail(\''+v.key+'\')">'+icon+' <span class="veg-list-name">'+v.name+'</span></button>';
    }).join("")+'</div>';
  };
  detailEl.innerHTML='<div class="month-detail"><h3>'+MONTH_FULL[mn-1]+'</h3><div class="cols"><div class="col"><h4>\ud83c\udf31 Plant</h4>'+rl(plants,true)+'</div><div class="col"><h4>\ud83e\uddfa Harvest</h4>'+rl(harvests,false)+'</div></div></div>';
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
  if(!es.length){dd.innerHTML='<div class="no-results">No plants match "'+q+'"</div>';}
  else{
    dd.innerHTML=es.map(v=>{
      const vis=vegVisual(v.name);
      const t=vis.type==="img"?'<img src="'+vis.value+'" alt="">':'<span>'+vis.value+'</span>';
      return '<div class="search-result-item" onclick="selectSearchResult(\''+v.key+'\')"><div class="search-result-thumb">'+t+'</div><div class="search-result-text"><div class="search-result-name">'+v.name+'</div>'+(v.latin_name?'<div class="search-result-latin">'+v.latin_name+'</div>':"")+'</div></div>';
    }).join("");
  }
  dd.classList.add("open");
}
function closeSearchDropdown(){document.getElementById("searchDropdown").classList.remove("open");}
function selectSearchResult(key){closeSearchDropdown();const i=document.getElementById("guideSearch");if(i)i.value="";showVegDetail(key);}

function showVegDetail(key){
  const v=vegLookup(key);if(!v)return;
  const vis=vegVisual(v.name);
  const vh=vis.type==="img"?'<img src="'+vis.value+'" alt="">':'<span>'+vis.value+'</span>';
  document.getElementById("vegDetailBody").innerHTML='<div class="veg-detail-header"><div class="veg-detail-img">'+vh+'</div><div class="veg-detail-title"><h2>'+v.name+'</h2>'+(v.latin_name?'<div class="latin">'+v.latin_name+'</div>':"")+'</div></div><div class="veg-info-grid"><div class="veg-info-card"><div class="lbl">\ud83d\udccd Sow where</div><div class="val">'+(v.sow_where||"\u2014")+'</div></div><div class="veg-info-card"><div class="lbl">\ud83c\udf31 Sow months</div><div class="val">'+rangeLabel(v.sow_start,v.sow_end)+'</div></div><div class="veg-info-card"><div class="lbl">\ud83e\uddfa Harvest months</div><div class="val">'+rangeLabel(v.harvest_start,v.harvest_end)+'</div></div><div class="veg-info-card"><div class="lbl">\ud83d\udcd0 Per sq ft</div><div class="val">'+v.per_sq_ft+'</div></div><div class="veg-info-card"><div class="lbl">\u23f1 Days to harvest</div><div class="val">'+v.days_to_harvest+'</div></div></div>'+(v.notes?'<div class="veg-notes"><div class="veg-notes-label">Growing tips</div>'+v.notes+'</div>':"");
  document.getElementById("vegDetailModal").classList.add("open");
}
function closeVegDetail(){document.getElementById("vegDetailModal").classList.remove("open");}

const gridEl=document.getElementById("grid");

function buildGrid(){
  gridEl.innerHTML="";
  let planted=0,seedsT=0,harvT=0;
  for(let i=0;i<16;i++){
    const c=gridData[i];
    const row=Math.floor(i/4)+1,col=(i%4)+1;
    const vegName=c.veg?c.veg.name:"";
    const has=vegName||c.date_sown;
    if(has)planted++;
    seedsT+=c.seeds_planted||0;
    harvT+=c.total_harvested||0;
    const cell=document.createElement("div");
    cell.className="cell "+(has?"planted":"empty");
    cell.onclick=()=>openEditModal(i);
    const vis=vegVisual(vegName);
    const vh=vis.type==="img"?'<img class="cell-img" src="'+vis.value+'" alt="">':'<div class="cell-emoji">'+vis.value+'</div>';
    const dS=daysSince(c.date_sown);
    const e=c.veg;
    let hh="";
    if(dS!==null&&e&&e.days_to_harvest){
      const rem=e.days_to_harvest-dS;
      if(rem<=0)hh='<div class="cell-harvest ready">\ud83e\uddfa Ready!</div>';
      else hh='<div class="cell-harvest">'+rem+'d to harvest</div>';
    }
    const totals=(c.total_harvested||c.total_failed)?'<div class="totals-line">\ud83e\uddfa'+(c.total_harvested||0)+' \u00b7 \u274c'+(c.total_failed||0)+'</div>':"";
    const seedBadge=(has&&c.seeds_planted>0)?'<div class="seed-badge">\ud83c\udf31'+c.seeds_planted+'</div>':"";
    cell.innerHTML='<div class="cell-label">'+row+','+col+'</div>'+seedBadge+vh+'<div style="display:flex;flex-direction:column;align-items:center;gap:2px;width:100%">'+(vegName?'<div class="cell-veg">'+vegName+'</div>':"")+(c.date_sown?'<div class="cell-days">'+daysLabel(dS)+'</div>':"")+hh+totals+'</div>';
    gridEl.appendChild(cell);
  }
  document.getElementById("plantedStat").textContent=planted+"/16 plots \u00b7 \ud83c\udf31"+seedsT+" seeds \u00b7 \ud83e\uddfa"+harvT+" harvested";
}

function openEditModal(i){
  editingIndex=i;
  const c=gridData[i];
  const row=Math.floor(i/4)+1,col=(i%4)+1;
  document.getElementById("editModalTitle").textContent="Plot "+row+","+col;
  document.getElementById("modalVeg").value=c.veg?c.veg.name:"";
  document.getElementById("modalDate").value=c.date_sown||"";
  document.getElementById("modalSeeds").value=c.seeds_planted||0;
  document.getElementById("modalNotes").value=c.notes||"";
  renderModalDetails();
  document.getElementById("editModal").classList.add("open");
  setTimeout(()=>document.getElementById("modalVeg").focus(),50);
}

function renderModalDetails(){
  if(editingIndex===null)return;
  const veg=document.getElementById("modalVeg").value.trim();
  const date=document.getElementById("modalDate").value;
  const entry=vegLookupByName(veg);
  const sumEl=document.getElementById("modalSummary");
  const bub=document.getElementById("modalHarvestBubble");
  if(entry&&date){
    const d=daysSince(date);
    const rem=entry.days_to_harvest-d;
    if(rem<=0){bub.className="harvest-bubble ready";bub.innerHTML='🧺 <strong>Ready to harvest now!</strong>';}
    else{const hd=new Date(date);hd.setDate(hd.getDate()+entry.days_to_harvest);bub.className="harvest-bubble";bub.innerHTML='🧺 <strong>Ready in '+rem+' day'+(rem===1?'':'s')+'</strong> · ~'+hd.toLocaleDateString();}
    bub.style.display="block";
  }else if(entry){
    bub.className="harvest-bubble muted";bub.innerHTML='🌱 Set a sown date to estimate harvest (~'+entry.days_to_harvest+'d)';bub.style.display="block";
  }else{bub.style.display="none";}
  if(entry){
    let html='<strong>'+entry.name+'</strong>'+(entry.latin_name?' <span style="font-style:italic;color:var(--muted)">'+entry.latin_name+'</span>':"")+'<br>\ud83d\udccd '+(entry.sow_where||"\u2014")+' \u00b7 \ud83c\udf31 Sow: '+rangeLabel(entry.sow_start,entry.sow_end)+' \u00b7 \ud83e\uddfa Harvest: '+rangeLabel(entry.harvest_start,entry.harvest_end)+'<br>\ud83d\udcd0 '+entry.per_sq_ft+'/sq ft \u00b7 \u23f1 ~'+entry.days_to_harvest+'d to harvest';
    sumEl.innerHTML=html;sumEl.style.display="block";
  }else{sumEl.style.display="none";}
  const c=gridData[editingIndex];
  const tot=document.getElementById("modalTotals");
  const seeds=c.seeds_planted||0,harv=c.total_harvested||0,fail=c.total_failed||0;
  let p="";
  if(seeds>0)p+='<span class="pill">\ud83c\udf31 '+seeds+' seeds</span>';
  if(harv>0)p+='<span class="pill harvest">\ud83e\uddfa '+harv+' harvested</span>';
  if(fail>0)p+='<span class="pill fail">\u274c '+fail+' failed</span>';
  if(!p)p='<span style="color:var(--muted);font-size:.85rem;font-style:italic">No activity yet</span>';
  tot.innerHTML=p;
  const hist=document.getElementById("modalHistory");
  if(!c.history||!c.history.length){hist.innerHTML='<div class="history-empty">No history yet</div>';}
  else{
    const items=c.history.slice(0,8);
    const icons={planted:"\ud83c\udf31",harvested:"\ud83e\uddfa",failed:"\u274c",cleared:"\ud83e\uddf9"};
    const verbs={planted:"Planted",harvested:"Harvested",failed:"Failed",cleared:"Cleared"};
    hist.innerHTML=items.map(h=>{
      const ic=icons[h.event_type]||"\u2022";
      const vb=verbs[h.event_type]||h.event_type;
      const cnt=h.count?' '+h.count+' \u00d7':"";
      return '<div class="history-item"><span class="h-text">'+ic+' '+vb+cnt+' '+(h.veg_name||"")+'</span><span class="h-date">'+h.date+'</span></div>';
    }).join("");
  }
}

async function recordHarvest(){
  if(editingIndex===null)return;
  const s=prompt("How many did you harvest?","1");
  if(s===null)return;
  const n=parseInt(s);
  if(isNaN(n)||n<=0){alert("Please enter a positive number");return;}
  try{
    const updated=await api('/plots/'+gridData[editingIndex].index+'/record_harvest/',{method:'POST',body:{count:n}});
    gridData[editingIndex]=updated;renderModalDetails();buildGrid();
  }catch(e){alert("Failed: "+e.message);}
}

async function recordFailure(){
  if(editingIndex===null)return;
  const s=prompt("How many failed?","1");
  if(s===null)return;
  const n=parseInt(s);
  if(isNaN(n)||n<=0){alert("Please enter a positive number");return;}
  try{
    const updated=await api('/plots/'+gridData[editingIndex].index+'/record_failure/',{method:'POST',body:{count:n}});
    gridData[editingIndex]=updated;renderModalDetails();buildGrid();
  }catch(e){alert("Failed: "+e.message);}
}

async function saveCell(){
  if(editingIndex===null)return;
  const vegName=document.getElementById("modalVeg").value.trim();
  const date=document.getElementById("modalDate").value;
  const seeds=parseInt(document.getElementById("modalSeeds").value)||0;
  const notes=document.getElementById("modalNotes").value;
  let vegKey=null;
  if(vegName){
    const e=vegLookupByName(vegName);
    if(!e){alert("Unknown vegetable '"+vegName+"'. Add it in Settings first.");return;}
    vegKey=e.key;
  }
  try{
    const updated=await api('/plots/'+gridData[editingIndex].index+'/',{method:'PATCH',body:{veg_key:vegKey||"",date_sown:date||null,seeds_planted:seeds,notes:notes}});
    gridData[editingIndex]=updated;buildGrid();closeEditModal();
  }catch(e){alert("Failed to save: "+e.message);}
}

async function clearCell(){
  if(editingIndex===null)return;
  const c=gridData[editingIndex];
  if(!c.veg&&!c.date_sown&&!c.seeds_planted){closeEditModal();return;}
  if(!confirm("Clear this plot? Totals and history are preserved."))return;
  try{
    const updated=await api('/plots/'+c.index+'/clear_plot/',{method:'POST'});
    gridData[editingIndex]=updated;buildGrid();closeEditModal();
  }catch(e){alert("Failed: "+e.message);}
}

async function resetPlotTotals(){
  if(editingIndex===null)return;
  if(!confirm("Reset plot totals and clear all history? This cannot be undone."))return;
  try{
    const updated=await api('/plots/'+gridData[editingIndex].index+'/reset_totals/',{method:'POST'});
    gridData[editingIndex]=updated;renderModalDetails();buildGrid();
  }catch(e){alert("Failed: "+e.message);}
}

function closeEditModal(){document.getElementById("editModal").classList.remove("open");editingIndex=null;}

async function resetGrid(){
  if(!confirm("Clear ALL 16 plots and totals?"))return;
  try{
    await api('/plots/reset_all/',{method:'POST',body:{}});
    await loadGrid();buildGrid();
  }catch(e){alert("Failed: "+e.message);}
}

async function downloadBackup(){
  try{
    const data=await api('/backup/');
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download="garden_backup_"+todayISO()+".json";a.click();
    URL.revokeObjectURL(url);
  }catch(e){alert("Failed to backup: "+e.message);}
}

function restoreBackup(e){
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=async ev=>{
    try{
      const data=JSON.parse(ev.target.result);
      if(!confirm("Restore garden and vegetable database from this backup? Current data will be replaced."))return;
      await api('/backup/restore/',{method:'POST',body:data});
      await refreshAll();
      alert("Backup restored!");
    }catch(err){alert("Failed to restore: "+err.message);}
  };
  r.readAsText(f);e.target.value="";
}

function makeMonthOptions(sel){
  let h='<option value="0" '+(sel==0?"selected":"")+'>\u2014</option>';
  for(let i=1;i<=12;i++)h+='<option value="'+i+'" '+(sel==i?"selected":"")+'>'+MONTH_NAMES[i-1]+'</option>';
  return h;
}

function renderVegList(){
  const s=(document.getElementById("vegSearch").value||"").toLowerCase();
  const le=document.getElementById("vegList");
  const es=Object.values(vegDB).sort((a,b)=>a.name.localeCompare(b.name))
    .filter(v=>v.name.toLowerCase().includes(s)||(v.latin_name||"").toLowerCase().includes(s));
  le.innerHTML=es.map(v=>{
    const k=v.key;
    const tb=v.image_url?'<img src="'+v.image_url+'">':'<span>'+(v.emoji||fallbackEmoji(v.name))+'</span>';
    return '<div class="veg-card" data-key="'+k+'"><div class="veg-card-header"><div class="veg-thumb">'+tb+'</div><div class="veg-card-titles"><input type="text" value="'+(v.name||"").replace(/"/g,'&quot;')+'" placeholder="Name" data-field="name"><input type="text" value="'+(v.latin_name||"").replace(/"/g,'&quot;')+'" placeholder="Latin name" data-field="latin_name"></div></div><div class="veg-fields"><div class="veg-field"><label>Emoji</label><input type="text" value="'+(v.emoji||'')+'" data-field="emoji" maxlength="4"></div><div class="veg-field"><label>Where to sow</label><select data-field="sow_where">'+makeSowWhereOptions(v.sow_where)+'</select></div><div class="veg-field"><label>Sow from</label><select data-field="sow_start">'+makeMonthOptions(v.sow_start)+'</select></div><div class="veg-field"><label>Sow to</label><select data-field="sow_end">'+makeMonthOptions(v.sow_end)+'</select></div><div class="veg-field"><label>Harvest from</label><select data-field="harvest_start">'+makeMonthOptions(v.harvest_start)+'</select></div><div class="veg-field"><label>Harvest to</label><select data-field="harvest_end">'+makeMonthOptions(v.harvest_end)+'</select></div><div class="veg-field"><label>Plants / sq ft</label><input type="number" step="0.25" min="0" value="'+v.per_sq_ft+'" data-field="per_sq_ft"></div><div class="veg-field"><label>Days to harvest</label><input type="number" min="0" value="'+v.days_to_harvest+'" data-field="days_to_harvest"></div></div><div class="veg-notes-field"><label style="display:block;font-size:.7rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.2rem">Growing notes</label><textarea data-field="notes" placeholder="Tips...">'+(v.notes||"")+'</textarea></div><div class="veg-card-actions"><button class="mini-btn" onclick="uploadImage(\''+k+'\')">\ud83d\udcf7 Upload image</button>'+(v.image_url?'<button class="mini-btn" onclick="removeImage(\''+k+'\')">Remove image</button>':'')+'<button class="mini-btn danger" onclick="deleteVeg(\''+k+'\')">\ud83d\uddd1 Delete</button></div></div>';
  }).join("");
  le.querySelectorAll(".veg-card").forEach(card=>{
    const k=card.dataset.key;
    card.querySelectorAll("[data-field]").forEach(inp=>{
      inp.addEventListener("change",async e=>{
        const f=e.target.dataset.field;let val=e.target.value;
        if(f==="per_sq_ft")val=parseFloat(val)||0;
        else if(["sow_start","sow_end","harvest_start","harvest_end","days_to_harvest"].includes(f))val=parseInt(val)||0;
        try{
          const updated=await api('/veg/'+k+'/',{method:'PATCH',body:{[f]:val}});
          vegDB[k]=updated;
          refreshDatalist();buildGrid();refreshGuideIfActive();
        }catch(err){alert("Save failed: "+err.message);}
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
      vegDB[k]=updated;renderVegList();buildGrid();refreshGuideIfActive();
    }catch(err){alert("Upload failed: "+err.message);}
  };
  inp.click();
}

async function removeImage(k){
  try{
    const updated=await api('/veg/'+k+'/remove_image/',{method:'POST',body:{}});
    vegDB[k]=updated;renderVegList();buildGrid();refreshGuideIfActive();
  }catch(err){alert("Failed: "+err.message);}
}

async function deleteVeg(k){
  if(!confirm('Delete "'+vegDB[k].name+'"?'))return;
  try{
    await api('/veg/'+k+'/',{method:'DELETE'});
    delete vegDB[k];refreshDatalist();renderVegList();buildGrid();refreshGuideIfActive();
  }catch(err){alert("Failed: "+err.message);}
}

async function addNewVeg(){
  const name=prompt("Vegetable name:");if(!name)return;
  try{
    const newV=await api('/veg/',{method:'POST',body:{name:name.trim(),sow_where:"Sow outdoors",per_sq_ft:1,days_to_harvest:60}});
    vegDB[newV.key]=newV;refreshDatalist();renderVegList();buildGrid();refreshGuideIfActive();
  }catch(err){alert("Failed: "+err.message);}
}

document.getElementById("editModal").onclick=e=>{if(e.target.id==="editModal")closeEditModal();};
document.getElementById("vegDetailModal").onclick=e=>{if(e.target.id==="vegDetailModal")closeVegDetail();};
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeEditModal();closeVegDetail();closeSearchDropdown();}});
["modalVeg","modalDate","modalSeeds"].forEach(id=>{document.getElementById(id).addEventListener("input",renderModalDetails);});

async function refreshAll(){
  await loadVegDB();await loadGrid();
  refreshDatalist();buildGrid();refreshGuideIfActive();
  if(document.getElementById("view-settings").classList.contains("active"))renderVegList();
}

async function init(){
  buildLegend();
  buildMonthButtons();
  try{await refreshAll();}catch(e){console.error(e);alert("Failed to load data: "+e.message);}
  switchView(localStorage.getItem(KEY_VIEW)||"guide");
  const cmi=new Date().getMonth()+1;
  const cb=document.querySelectorAll(".month-btn")[cmi-1];
  if(cb)showMonth(cmi,cb);
}
init();
