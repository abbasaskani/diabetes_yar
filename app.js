
/* دیابت‌یار — نسخه ۲: چند پروفایل + اعلان + PDF + آموزش + بانک غذا + بینش‌های ساده */
const LS_KEY = "diabetes_yar_v2";
const DEFAULT_PROFILE = () => ({
  id: crypto.randomUUID(),
  name: "بیمار ۱",
  unit: "mg/dL",
  diabetesType: "Type 1",
  targetLow: 80,
  targetHigh: 180,
  createdAt: Date.now()
});

const blankState = () => ({
  activeProfileId: null,
  profiles: [],
  data: {
    // per profile
    // [profileId]: { glucose:[], insulin:[], meals:[], reminders:{ dailyBasalTime:"22:00"} }
  }
});

function loadState(){
  const raw = localStorage.getItem(LS_KEY);
  if(!raw){
    const s = blankState();
    const p = DEFAULT_PROFILE();
    s.profiles.push(p);
    s.activeProfileId = p.id;
    s.data[p.id] = {glucose:[], insulin:[], meals:[], reminders:{dailyBasalTime:"22:00"}};
    saveState(s);
    return s;
  }
  try{
    const s = JSON.parse(raw);
    // basic migrations
    if(!s.profiles || !Array.isArray(s.profiles)) throw new Error("bad");
    if(!s.data) s.data = {};
    if(!s.activeProfileId && s.profiles[0]) s.activeProfileId = s.profiles[0].id;
    return s;
  }catch(e){
    const s = blankState();
    const p = DEFAULT_PROFILE();
    s.profiles.push(p);
    s.activeProfileId = p.id;
    s.data[p.id] = {glucose:[], insulin:[], meals:[], reminders:{dailyBasalTime:"22:00"}};
    saveState(s);
    return s;
  }
}
function saveState(s){ localStorage.setItem(LS_KEY, JSON.stringify(s)); }

let state = loadState();
let chart;

const el = (id)=>document.getElementById(id);
const tabs = document.querySelectorAll(".tab");

function fmtDT(ts){
  const d = new Date(ts);
  return d.toLocaleString("fa-IR");
}
function toDateInputValue(ts){
  const d = new Date(ts);
  const pad = (n)=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function startOfDay(ts){
  const d = new Date(ts);
  d.setHours(0,0,0,0);
  return d.getTime();
}
function endOfDay(ts){
  const d = new Date(ts);
  d.setHours(23,59,59,999);
  return d.getTime();
}
function within(ts, from, to){ return ts>=from && ts<=to; }

function getActiveProfile(){
  return state.profiles.find(p=>p.id===state.activeProfileId) || state.profiles[0];
}
function getPData(pid){
  if(!state.data[pid]) state.data[pid] = {glucose:[], insulin:[], meals:[], reminders:{dailyBasalTime:"22:00"}};
  return state.data[pid];
}

function setDefaultsDT(){
  const now = Date.now();
  el("glucoseDT").value = toDateInputValue(now);
  el("insulinDT").value = toDateInputValue(now);
  el("mealDT").value = toDateInputValue(now);
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth()+1).padStart(2,"0");
  const dd = String(today.getDate()).padStart(2,"0");
  el("reportFrom").value = `${yyyy}-${mm}-${dd}`;
  el("reportTo").value = `${yyyy}-${mm}-${dd}`;
}

function renderProfileSelect(){
  const sel = el("profileSelect");
  sel.innerHTML = "";
  state.profiles.forEach(p=>{
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  sel.value = state.activeProfileId;
}

function renderSettings(){
  const p = getActiveProfile();
  el("unitSelect").value = p.unit;
  el("diabetesTypeSelect").value = p.diabetesType;
  el("targetLow").value = p.targetLow;
  el("targetHigh").value = p.targetHigh;
  // reminder
  const pd = getPData(p.id);
  el("basalTime").value = (pd.reminders?.dailyBasalTime) || "22:00";
}

function showTab(name){
  tabs.forEach(t=>t.classList.toggle("active", t.dataset.tab===name));
  document.querySelectorAll(".panel").forEach(p=>p.classList.add("hidden"));
  el(`tab-${name}`).classList.remove("hidden");
  if(name==="dashboard"){ renderDashboard(); }
  if(name==="log"){ renderLinkedGlucose(); renderTodayList(); }
  if(name==="reports"){ renderReportInsights(); }
  if(name==="settings"){ renderSettings(); updateNotifStatus(); }
}

tabs.forEach(t=>t.addEventListener("click", ()=>showTab(t.dataset.tab)));

function addSafetyAlert(box, kind, title, desc){
  const div = document.createElement("div");
  div.className = `alert ${kind}`;
  div.innerHTML = `<div class="t">${title}</div><div class="d">${desc}</div>`;
  box.appendChild(div);
}

function calcKpis(glucose, p){
  if(glucose.length===0) return null;
  const values = glucose.map(x=>Number(x.value)).filter(v=>Number.isFinite(v));
  if(values.length===0) return null;
  const avg = Math.round(values.reduce((a,b)=>a+b,0)/values.length);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const inRange = values.filter(v=>v>=p.targetLow && v<=p.targetHigh).length;
  const tir = Math.round((inRange/values.length)*100);
  return {avg, min, max, tir, n: values.length};
}

function buildInsights(p, pd){
  const insights = [];
  // Pattern: average by glucose type
  const byType = {};
  for(const g of pd.glucose){
    if(!byType[g.type]) byType[g.type] = [];
    byType[g.type].push(Number(g.value));
  }
  const typeNames = {
    FBS:"ناشتا", AfterBreakfast2h:"۲ساعت بعد صبحانه", BeforeLunch:"قبل ناهار",
    AfterLunch2h:"۲ساعت بعد ناهار", BeforeDinner:"قبل شام", AfterDinner2h:"۲ساعت بعد شام", BeforeSleep:"قبل خواب"
  };
  Object.keys(byType).forEach(k=>{
    const arr = byType[k].filter(v=>Number.isFinite(v));
    if(arr.length>=3){
      const avg = arr.reduce((a,b)=>a+b,0)/arr.length;
      if(avg > p.targetHigh){
        insights.push({title:`میانگین ${typeNames[k]||k} بالاست`, body:`میانگین ${Math.round(avg)} است که بالاتر از هدف (${p.targetHigh}) است. این یک الگوی تکرارشونده است؛ ثبت دقیق غذا/انسولین کمک می‌کند علت مشخص شود.`});
      }else if(avg < p.targetLow){
        insights.push({title:`میانگین ${typeNames[k]||k} پایین است`, body:`میانگین ${Math.round(avg)} است که پایین‌تر از هدف (${p.targetLow}) است. مراقب هیپو باشید و با تیم درمانی مشورت کنید.`});
      }else{
        insights.push({title:`${typeNames[k]||k} معمولاً در محدوده است`, body:`میانگین ${Math.round(avg)} در بازه هدف است. 👍`});
      }
    }
  });

  // Meal -> linked 2h glucose deltas
  const linked = pd.meals
    .map(m=>{
      if(!m.linkedGlucoseId) return null;
      const g = pd.glucose.find(x=>x.id===m.linkedGlucoseId);
      if(!g) return null;
      return {mealType:m.mealType, carb:Number(m.carb||0), glucose2h:Number(g.value)};
    })
    .filter(Boolean);

  if(linked.length>=2){
    const byMeal = {};
    linked.forEach(x=>{
      if(!byMeal[x.mealType]) byMeal[x.mealType]=[];
      byMeal[x.mealType].push(x.glucose2h);
    });
    const mealNames = {Breakfast:"صبحانه", Lunch:"ناهار", Dinner:"شام", Snack:"میان‌وعده"};
    Object.keys(byMeal).forEach(k=>{
      if(byMeal[k].length>=2){
        const avg = byMeal[k].reduce((a,b)=>a+b,0)/byMeal[k].length;
        if(avg > p.targetHigh){
          insights.push({title:`بعد از ${mealNames[k]||k} معمولاً بالا می‌رود`, body:`میانگین قند ۲ ساعت بعد از ${mealNames[k]||k} حدود ${Math.round(avg)} است. اگر این روند تکراری است، می‌توانید با ثبت دقیق‌تر کربوهیدرات/زمان تزریق علت را بررسی کنید.`});
        }
      }
    });
  }

  if(insights.length===0){
    insights.push({title:"هنوز داده کافی برای الگوها نداریم", body:"برای فعال شدن بینش‌ها، چند روز ثبت قند + وعده + لینک به قند ۲ ساعت بعد انجام بده."});
  }
  return insights.slice(0,8);
}

function renderDashboard(){
  const p = getActiveProfile();
  const pd = getPData(p.id);

  // KPIs today
  const from = startOfDay(Date.now());
  const to = endOfDay(Date.now());
  const todayG = pd.glucose.filter(g=>within(g.ts, from, to));
  const k = calcKpis(todayG, p);
  const kpiBox = el("todayKpis");
  kpiBox.innerHTML = "";
  const addK = (label,val)=> {
    const d=document.createElement("div");
    d.className="kpi";
    d.innerHTML = `<div class="k">${label}</div><div class="v">${val}</div>`;
    kpiBox.appendChild(d);
  };
  if(!k){
    addK("ثبت‌ها","0");
    addK("میانگین","—");
    addK("حداقل/حداکثر","—");
    addK("در محدوده","—");
  }else{
    addK("تعداد ثبت", k.n);
    addK("میانگین", k.avg);
    addK("حداقل / حداکثر", `${k.min} / ${k.max}`);
    addK("Time-in-Range", `${k.tir}%`);
  }

  // Safety
  const sbox = el("safetyBox");
  sbox.innerHTML="";
  const recent = pd.glucose.slice().sort((a,b)=>b.ts-a.ts).slice(0,10);
  if(recent.length===0){
    sbox.innerHTML = `<div class="muted">هنوز موردی ثبت نشده است.</div>`;
  }else{
    recent.forEach(g=>{
      const v=Number(g.value);
      if(!Number.isFinite(v)) return;
      if(v<70){
        addSafetyAlert(sbox,"bad","🚨 هیپوگلیسمی (قند پایین)", `قند ${v} در ${fmtDT(g.ts)} ثبت شد. اقدام عمومی: قند سریع‌الجذب طبق توصیه تیم درمانی + تکرار اندازه‌گیری.`);
      }else if(v>=70 && v<80){
        addSafetyAlert(sbox,"warn","⚠ نزدیک به هیپو", `قند ${v} در ${fmtDT(g.ts)} ثبت شد. مراقب علائم باشید.`);
      }else if(v>300){
        addSafetyAlert(sbox,"bad","🚨 هایپر شدید (قند خیلی بالا)", `قند ${v} در ${fmtDT(g.ts)} ثبت شد. اگر تکرار/علائم دارید با تیم درمانی/اورژانس تماس بگیرید.`);
      }else if(v>p.targetHigh){
        addSafetyAlert(sbox,"warn","⚠ قند بالاتر از هدف", `قند ${v} در ${fmtDT(g.ts)} ثبت شد (هدف تا ${p.targetHigh}).`);
      }else{
        addSafetyAlert(sbox,"good","✅ در محدوده/نزدیک هدف", `قند ${v} در ${fmtDT(g.ts)} ثبت شد.`);
      }
    });
  }

  // Chart last 7 days
  const sevenDaysAgo = Date.now() - 7*24*3600*1000;
  const g7 = pd.glucose.filter(g=>g.ts>=sevenDaysAgo).sort((a,b)=>a.ts-b.ts);
  const labels = g7.map(g=> new Date(g.ts).toLocaleString("fa-IR",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}));
  const values = g7.map(g=> Number(g.value));
  const ctx = el("glucoseChart");
  if(chart) chart.destroy();
  chart = new Chart(ctx, {
    type:"line",
    data:{
      labels,
      datasets:[{
        label:"قند خون (mg/dL)",
        data: values,
        tension:.35,
        borderWidth:3,
      }]
    },
    options:{
      plugins:{legend:{display:true}},
      scales:{
        y:{
          suggestedMin: 50,
          suggestedMax: 300
        }
      }
    }
  });

  // Insights
  const ibox = el("insightsBox");
  ibox.innerHTML="";
  const ins = buildInsights(p, pd);
  ins.forEach(x=>{
    const d=document.createElement("div");
    d.className="insight";
    d.innerHTML = `<b>${x.title}</b><div class="muted" style="margin-top:6px">${x.body}</div>`;
    ibox.appendChild(d);
  });
}

function renderLinkedGlucose(){
  const p = getActiveProfile();
  const pd = getPData(p.id);
  const sel = el("mealLinkedGlucose");
  sel.innerHTML = `<option value="">— انتخاب —</option>`;
  // show glucose entries in last 2 days
  const from = Date.now() - 2*24*3600*1000;
  const items = pd.glucose.filter(g=>g.ts>=from).sort((a,b)=>b.ts-a.ts);
  items.forEach(g=>{
    const opt=document.createElement("option");
    opt.value=g.id;
    opt.textContent = `${g.type} — ${g.value} — ${fmtDT(g.ts)}`;
    sel.appendChild(opt);
  });
}

function renderTodayList(){
  const p = getActiveProfile();
  const pd = getPData(p.id);
  const from = startOfDay(Date.now());
  const to = endOfDay(Date.now());
  const list = el("todayList");
  list.innerHTML = "";

  const addItem = (badge, title, subtitle)=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML = `<div class="top"><div><span class="badge">${badge}</span> <b>${title}</b></div><div class="muted">${subtitle}</div></div>`;
    list.appendChild(div);
  };

  pd.glucose.filter(x=>within(x.ts,from,to)).sort((a,b)=>b.ts-a.ts).forEach(g=>{
    addItem("قند", `${g.value} mg/dL`, `${g.type} • ${fmtDT(g.ts)}`);
  });
  pd.insulin.filter(x=>within(x.ts,from,to)).sort((a,b)=>b.ts-a.ts).forEach(i=>{
    const rem = i.reminder ? " • 🔔 یادآور" : "";
    addItem("انسولین", `${i.name||"—"} • ${i.units}u`, `${i.kind}${rem} • ${fmtDT(i.ts)}`);
  });
  pd.meals.filter(x=>within(x.ts,from,to)).sort((a,b)=>b.ts-a.ts).forEach(m=>{
    addItem("وعده", `${mealName(m.mealType)} • ${m.carb||0}g`, `${m.desc||""} • ${fmtDT(m.ts)}`);
  });

  if(list.children.length===0){
    list.innerHTML = `<div class="muted">برای امروز چیزی ثبت نشده است.</div>`;
  }
}

function mealName(k){
  return ({Breakfast:"صبحانه",Lunch:"ناهار",Dinner:"شام",Snack:"میان‌وعده"}[k]||k);
}

function addGlucose(){
  const p = getActiveProfile();
  const pd = getPData(p.id);

  const type = el("glucoseType").value;
  const value = Number(el("glucoseValue").value);
  const ts = new Date(el("glucoseDT").value).getTime();
  if(!Number.isFinite(value) || value<=0){ alert("مقدار قند معتبر نیست."); return; }
  if(!Number.isFinite(ts)){ alert("تاریخ/ساعت معتبر نیست."); return; }

  pd.glucose.push({id:crypto.randomUUID(), type, value, ts});
  saveState(state);
  el("glucoseValue").value="";
  renderLinkedGlucose();
  renderTodayList();
  renderDashboard();
}

function addInsulin(){
  const p = getActiveProfile();
  const pd = getPData(p.id);

  const kind = el("insulinKind").value;
  const name = el("insulinName").value.trim();
  const units = Number(el("insulinUnits").value);
  const ts = new Date(el("insulinDT").value).getTime();
  const reminder = el("insulinReminder").checked;

  if(!Number.isFinite(units) || units<0){ alert("مقدار واحد معتبر نیست."); return; }
  if(!Number.isFinite(ts)){ alert("تاریخ/ساعت معتبر نیست."); return; }

  const item = {id:crypto.randomUUID(), kind, name, units, ts, reminder};
  pd.insulin.push(item);
  saveState(state);
  el("insulinName").value="";
  el("insulinUnits").value="";
  el("insulinReminder").checked=false;

  if(reminder){
    scheduleOneShotNotification(`یادآور انسولین (${kind})`, `${name||"انسولین"} • ${units} واحد`, ts);
  }
  renderTodayList();
}

function addMeal(){
  const p = getActiveProfile();
  const pd = getPData(p.id);

  const mealType = el("mealType").value;
  const desc = el("mealDesc").value.trim();
  const carb = Number(el("mealCarb").value);
  const ts = new Date(el("mealDT").value).getTime();
  const linkedGlucoseId = el("mealLinkedGlucose").value || null;

  if(!Number.isFinite(carb) || carb<0){ alert("کربوهیدرات معتبر نیست."); return; }
  if(!Number.isFinite(ts)){ alert("تاریخ/ساعت معتبر نیست."); return; }

  pd.meals.push({id:crypto.randomUUID(), mealType, desc, carb, ts, linkedGlucoseId});
  saveState(state);
  el("mealDesc").value="";
  el("mealCarb").value="";
  el("mealLinkedGlucose").value="";
  renderTodayList();
  renderDashboard();
}

function seedData(){
  const p = getActiveProfile();
  const pd = getPData(p.id);

  const today = new Date();
  today.setHours(0,0,0,0);
  const base = today.getTime();

  const mk = (h,m)=> base + (h*60+m)*60*1000;

  // glucose entries
  const glucose = [
    ["FBS",145,mk(7,30)],
    ["AfterBreakfast2h",210,mk(9,45)],
    ["BeforeLunch",160,mk(12,30)],
    ["AfterLunch2h",190,mk(15,0)],
    ["BeforeDinner",130,mk(19,0)],
    ["AfterDinner2h",175,mk(21,15)],
    ["BeforeSleep",110,mk(23,10)]
  ].map(([type,value,ts])=>({id:crypto.randomUUID(), type, value, ts}));

  // insulin
  const insulin = [
    {id:crypto.randomUUID(), kind:"Basal", name:"Lantus", units:16, ts: mk(22,0), reminder:false},
    {id:crypto.randomUUID(), kind:"Bolus", name:"Novorapid", units:5, ts: mk(7,45), reminder:false},
    {id:crypto.randomUUID(), kind:"Bolus", name:"Novorapid", units:6, ts: mk(12,45), reminder:false},
    {id:crypto.randomUUID(), kind:"Bolus", name:"Novorapid", units:4, ts: mk(19,15), reminder:false},
    {id:crypto.randomUUID(), kind:"Correction", name:"Novorapid", units:2, ts: mk(11,30), reminder:false}
  ];

  // meals (link to 2h entries)
  const meals = [
    {mealType:"Breakfast", desc:"نان + پنیر + چای", carb:45, ts: mk(7,35), linked: "AfterBreakfast2h"},
    {mealType:"Lunch", desc:"برنج + مرغ", carb:70, ts: mk(12,35), linked: "AfterLunch2h"},
    {mealType:"Dinner", desc:"سیب‌زمینی/نان + تخم‌مرغ", carb:50, ts: mk(19,5), linked: "AfterDinner2h"}
  ].map(m=>{
    const g = glucose.find(x=>x.type===m.linked);
    return {id:crypto.randomUUID(), mealType:m.mealType, desc:m.desc, carb:m.carb, ts:m.ts, linkedGlucoseId: g?g.id:null};
  });

  // replace today's items (keep older history)
  const from = startOfDay(Date.now());
  const to = endOfDay(Date.now());
  pd.glucose = pd.glucose.filter(x=>!within(x.ts,from,to)).concat(glucose);
  pd.insulin = pd.insulin.filter(x=>!within(x.ts,from,to)).concat(insulin);
  pd.meals = pd.meals.filter(x=>!within(x.ts,from,to)).concat(meals);

  saveState(state);
  renderLinkedGlucose();
  renderTodayList();
  renderDashboard();
}

function clearToday(){
  const p = getActiveProfile();
  const pd = getPData(p.id);
  const from = startOfDay(Date.now());
  const to = endOfDay(Date.now());
  pd.glucose = pd.glucose.filter(x=>!within(x.ts,from,to));
  pd.insulin = pd.insulin.filter(x=>!within(x.ts,from,to));
  pd.meals = pd.meals.filter(x=>!within(x.ts,from,to));
  saveState(state);
  renderLinkedGlucose();
  renderTodayList();
  renderDashboard();
}

function exportJSON(){
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "diabetes_yar_export.json";
  a.click();
  URL.revokeObjectURL(url);
}
function importJSON(file){
  const r = new FileReader();
  r.onload = ()=>{
    try{
      const s = JSON.parse(r.result);
      if(!s.profiles || !Array.isArray(s.profiles)) throw new Error("bad");
      state = s;
      saveState(state);
      renderProfileSelect();
      renderSettings();
      renderLinkedGlucose();
      renderTodayList();
      renderDashboard();
      alert("Import انجام شد ✅");
    }catch(e){
      alert("فایل JSON معتبر نیست.");
    }
  };
  r.readAsText(file);
}

function updateFoodResults(){
  const q = (el("foodSearch").value||"").trim();
  const mult = Number(el("foodServing").value||"1");
  const results = el("foodResults");
  results.innerHTML = "";
  const foods = (window.FOOD_DB?.foods||[]);
  const filtered = foods.filter(f=>!q || f.name.includes(q));
  filtered.slice(0,50).forEach(f=>{
    const carb = Math.round(f.carb_g * mult);
    const div = document.createElement("div");
    div.className="foodRow";
    div.innerHTML = `
      <div class="name">${f.name}</div>
      <div class="meta">کربوهیدرات: <b>${carb} گرم</b> • (${f.carb_g}g برای ۱ واحد) • ${f.note||""}</div>
      <button class="btn ghost" data-add="1">استفاده در وعده</button>
    `;
    div.querySelector("button").addEventListener("click", ()=>{
      // set meal inputs
      el("mealDesc").value = f.name;
      el("mealCarb").value = carb;
      showTab("log");
    });
    results.appendChild(div);
  });
  if(filtered.length===0){
    results.innerHTML = `<div class="muted">موردی پیدا نشد.</div>`;
  }
}

function requestNotifications(){
  if(!("Notification" in window)){
    alert("مرورگر شما اعلان‌ها را پشتیبانی نمی‌کند.");
    return;
  }
  Notification.requestPermission().then(()=>updateNotifStatus());
}

function updateNotifStatus(){
  if(!("Notification" in window)){
    el("notifStatus").textContent = "مرورگر اعلان‌ها را پشتیبانی نمی‌کند.";
    return;
  }
  el("notifStatus").textContent = `وضعیت اعلان‌ها: ${Notification.permission}`;
}

function scheduleOneShotNotification(title, body, whenTs){
  if(!("Notification" in window)) return;
  if(Notification.permission !== "granted") return;
  const delay = whenTs - Date.now();
  if(delay <= 0) return;
  setTimeout(()=> new Notification(title, {body}), delay);
}

// Daily basal reminder: schedule next occurrence; reschedule on load.
function scheduleDailyBasal(){
  const p = getActiveProfile();
  const pd = getPData(p.id);
  const t = (pd.reminders?.dailyBasalTime) || "22:00";
  const [hh, mm] = t.split(":").map(Number);
  const now = new Date();
  const next = new Date();
  next.setHours(hh, mm, 0, 0);
  if(next.getTime() <= now.getTime()){
    next.setDate(next.getDate()+1);
  }
  scheduleOneShotNotification("یادآور Basal", `زمان تزریق Basal نزدیک است (${t})`, next.getTime());
  // store a marker
  pd.reminders.nextBasalTs = next.getTime();
  saveState(state);
}

function setDailyBasalTime(){
  const p = getActiveProfile();
  const pd = getPData(p.id);
  const t = el("basalTime").value || "22:00";
  pd.reminders = pd.reminders || {};
  pd.reminders.dailyBasalTime = t;
  saveState(state);
  scheduleDailyBasal();
  alert("یادآور روزانه ثبت شد ✅");
}

function exportPDF(){
  const p = getActiveProfile();
  const pd = getPData(p.id);

  const fromDate = el("reportFrom").value;
  const toDate = el("reportTo").value;
  if(!fromDate || !toDate){ alert("بازه تاریخ را انتخاب کن."); return; }

  const from = new Date(fromDate+"T00:00:00").getTime();
  const to = new Date(toDate+"T23:59:59").getTime();

  const g = pd.glucose.filter(x=>within(x.ts,from,to)).sort((a,b)=>a.ts-b.ts);
  const i = pd.insulin.filter(x=>within(x.ts,from,to)).sort((a,b)=>a.ts-b.ts);
  const m = pd.meals.filter(x=>within(x.ts,from,to)).sort((a,b)=>a.ts-b.ts);

  const k = calcKpis(g, p);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:"p", unit:"pt", format:"a4"});
  const margin = 40;
  let y = 50;

  doc.setFontSize(16);
  doc.text("Diabetes Yar — Report", margin, y); y+=18;
  doc.setFontSize(11);
  doc.text(`Profile: ${p.name}`, margin, y); y+=14;
  doc.text(`Range: ${fromDate} to ${toDate}`, margin, y); y+=18;

  if(k){
    doc.text(`Avg: ${k.avg}   Min/Max: ${k.min}/${k.max}   TIR: ${k.tir}%   N: ${k.n}`, margin, y); y+=18;
  }else{
    doc.text("No glucose data in this range.", margin, y); y+=18;
  }

  doc.setFontSize(12);
  doc.text("Glucose entries:", margin, y); y+=14;
  doc.setFontSize(10);

  const line = (txt)=>{
    if(y>760){ doc.addPage(); y=50; }
    doc.text(txt, margin, y); y+=12;
  };

  g.forEach(x=>line(`${new Date(x.ts).toLocaleString()}  |  ${x.type}  |  ${x.value}`));
  y+=10; doc.setFontSize(12); doc.text("Insulin:", margin, y); y+=14; doc.setFontSize(10);
  i.forEach(x=>line(`${new Date(x.ts).toLocaleString()}  |  ${x.kind}  |  ${x.name||""}  |  ${x.units}u`));
  y+=10; doc.setFontSize(12); doc.text("Meals:", margin, y); y+=14; doc.setFontSize(10);
  m.forEach(x=>line(`${new Date(x.ts).toLocaleString()}  |  ${mealName(x.mealType)}  |  ${x.carb||0}g  |  ${x.desc||""}`));

  doc.save(`diabetes_yar_${p.name}_${fromDate}_to_${toDate}.pdf`);
}

function renderReportInsights(){
  const p = getActiveProfile();
  const pd = getPData(p.id);
  const box = el("reportInsights");
  box.innerHTML = "";
  const ins = buildInsights(p, pd);
  ins.forEach(x=>{
    const d=document.createElement("div");
    d.className="insight";
    d.innerHTML = `<b>${x.title}</b><div class="muted" style="margin-top:6px">${x.body}</div>`;
    box.appendChild(d);
  });
}

function openModal(){
  el("modalBackdrop").classList.remove("hidden");
  el("profileModal").classList.remove("hidden");
}
function closeModal(){
  el("modalBackdrop").classList.add("hidden");
  el("profileModal").classList.add("hidden");
}

let modalMode = "add"; // add | edit

function openAddProfile(){
  modalMode="add";
  el("profileModalTitle").textContent = "پروفایل جدید";
  el("profileNameInput").value = "";
  el("profileUnitInput").value = "mg/dL";
  el("profileTypeInput").value = "Type 1";
  el("profileTargetLowInput").value = 80;
  el("profileTargetHighInput").value = 180;
  openModal();
}
function openEditProfile(){
  const p = getActiveProfile();
  if(!p) return;
  modalMode="edit";
  el("profileModalTitle").textContent = "ویرایش پروفایل";
  el("profileNameInput").value = p.name;
  el("profileUnitInput").value = p.unit;
  el("profileTypeInput").value = p.diabetesType;
  el("profileTargetLowInput").value = p.targetLow;
  el("profileTargetHighInput").value = p.targetHigh;
  openModal();
}
function saveProfileFromModal(){
  const name = el("profileNameInput").value.trim() || "بدون‌نام";
  const unit = el("profileUnitInput").value;
  const diabetesType = el("profileTypeInput").value;
  const targetLow = Number(el("profileTargetLowInput").value);
  const targetHigh = Number(el("profileTargetHighInput").value);

  if(!(Number.isFinite(targetLow) && Number.isFinite(targetHigh) && targetLow<targetHigh)){
    alert("مقادیر هدف معتبر نیست.");
    return;
  }

  if(modalMode==="add"){
    const p = {id:crypto.randomUUID(), name, unit, diabetesType, targetLow, targetHigh, createdAt:Date.now()};
    state.profiles.push(p);
    state.activeProfileId = p.id;
    state.data[p.id] = {glucose:[], insulin:[], meals:[], reminders:{dailyBasalTime:"22:00"}};
  }else{
    const p = getActiveProfile();
    p.name=name; p.unit=unit; p.diabetesType=diabetesType; p.targetLow=targetLow; p.targetHigh=targetHigh;
  }
  saveState(state);
  closeModal();
  renderProfileSelect();
  renderSettings();
  renderDashboard();
  renderLinkedGlucose();
  renderTodayList();
}

function deleteProfile(){
  if(state.profiles.length<=1){ alert("حداقل یک پروفایل باید وجود داشته باشد."); return; }
  const p = getActiveProfile();
  if(!p) return;
  const ok = confirm(`پروفایل «${p.name}» حذف شود؟`);
  if(!ok) return;
  state.profiles = state.profiles.filter(x=>x.id!==p.id);
  delete state.data[p.id];
  state.activeProfileId = state.profiles[0].id;
  saveState(state);
  renderProfileSelect();
  renderSettings();
  renderDashboard();
  renderLinkedGlucose();
  renderTodayList();
}

function saveProfileSettings(){
  const p = getActiveProfile();
  p.unit = el("unitSelect").value;
  p.diabetesType = el("diabetesTypeSelect").value;
  p.targetLow = Number(el("targetLow").value);
  p.targetHigh = Number(el("targetHigh").value);
  if(!(Number.isFinite(p.targetLow) && Number.isFinite(p.targetHigh) && p.targetLow<p.targetHigh)){
    alert("مقادیر هدف معتبر نیست.");
    return;
  }
  saveState(state);
  alert("تنظیمات ذخیره شد ✅");
  renderDashboard();
}

// wire events
function init(){
  renderProfileSelect();
  setDefaultsDT();
  renderSettings();
  renderDashboard();
  renderLinkedGlucose();
  renderTodayList();
  updateFoodResults();
  updateNotifStatus();

  el("profileSelect").addEventListener("change", (e)=>{
    state.activeProfileId = e.target.value;
    saveState(state);
    renderSettings();
    renderDashboard();
    renderLinkedGlucose();
    renderTodayList();
  });

  el("addProfileBtn").addEventListener("click", openAddProfile);
  el("editProfileBtn").addEventListener("click", openEditProfile);
  el("deleteProfileBtn").addEventListener("click", deleteProfile);
  el("saveProfileBtn").addEventListener("click", saveProfileFromModal);
  el("closeProfileModal").addEventListener("click", closeModal);
  el("modalBackdrop").addEventListener("click", closeModal);

  el("saveProfileSettingsBtn").addEventListener("click", saveProfileSettings);

  el("saveGlucoseBtn").addEventListener("click", addGlucose);
  el("saveInsulinBtn").addEventListener("click", addInsulin);
  el("saveMealBtn").addEventListener("click", addMeal);

  el("seedBtn").addEventListener("click", seedData);
  el("clearTodayBtn").addEventListener("click", clearToday);

  el("exportJsonBtn").addEventListener("click", exportJSON);
  el("importJsonInput").addEventListener("change", (e)=>{
    if(e.target.files && e.target.files[0]) importJSON(e.target.files[0]);
    e.target.value="";
  });

  el("foodSearch").addEventListener("input", updateFoodResults);
  el("foodServing").addEventListener("change", updateFoodResults);
  el("foodAddToMealBtn").addEventListener("click", ()=>showTab("log"));

  el("requestNotifBtn").addEventListener("click", requestNotifications);
  el("setDailyBasalReminderBtn").addEventListener("click", setDailyBasalTime);

  el("exportPdfBtn").addEventListener("click", exportPDF);

  // on load: if notifications allowed and reminder set, schedule next basal
  if(("Notification" in window) && Notification.permission==="granted"){
    scheduleDailyBasal();
  }
}

init();
