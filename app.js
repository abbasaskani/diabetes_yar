/* قندیار — وب‌اپ آموزشی/تستی (RTL) */
const LS_KEY = "ghandYar.v3";

const SLOT_LABELS = {
  FBS: "FBS (ناشتا)",
  AfterBreakfast2h: "۲ ساعت بعد صبحانه",
  BeforeLunch: "قبل ناهار",
  AfterLunch2h: "۲ ساعت بعد ناهار",
  BeforeDinner: "قبل شام",
  AfterDinner2h: "۲ ساعت بعد شام",
  BeforeBed: "قبل خواب",
};
const SLOT_TIME = { // برای اینترپولیشن تقریبی
  FBS: "07:00",
  AfterBreakfast2h: "10:00",
  BeforeLunch: "13:00",
  AfterLunch2h: "16:00",
  BeforeDinner: "19:00",
  AfterDinner2h: "22:00",
  BeforeBed: "23:30",
};
const MEAL_LABELS = { Breakfast:"صبحانه", Lunch:"ناهار", Dinner:"شام", Snack:"میان‌وعده" };

function $(id){ return document.getElementById(id); }
function esc(s){ return (s ?? "").toString().replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function todayISO(){
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0,10);
}
function toDateTime(iso, hhmm){
  return new Date(`${iso}T${hhmm}:00`);
}

/* --- State shape:
{
  patients: [{patient_id, name, profile, glucose, insulin, meals}],
  activePatientId,
  ui: { demoMode:boolean }
}
--- */
function defaultPatient(){
  return {
    patient_id: "P001",
    name: "نمونه-کاربر",
    profile: {
      unit:"mg/dL", diabetesType:"Type 1",
      targetLow:80, targetHigh:180,
      health:{ height_cm:"", weight_kg:"", birth_year:"", diagnosis_date:"", other_conditions:"", stress_base:"متوسط" }
    },
    glucose: [],
    insulin: [],
    meals: [],
    reminders: { basalEnabled:false, basalTime:"" },
    ai: { monthlySummary:null }, // for demo display
    demo: { byDate:{} } // demo suggestions keyed by date
  };
}
function loadState(){
  const raw = localStorage.getItem(LS_KEY);
  if(!raw){
    const p = defaultPatient();
    return { patients:[p], activePatientId: p.patient_id, ui:{ demoMode:false } };
  }
  try { return JSON.parse(raw); } catch {
    localStorage.removeItem(LS_KEY);
    return loadState();
  }
}
function saveState(s){ localStorage.setItem(LS_KEY, JSON.stringify(s)); }

let appState = loadState();

function activePatient(){
  return appState.patients.find(p=>p.patient_id===appState.activePatientId) || appState.patients[0];
}

function showBanner(msg, kind="ok"){
  const b = $("banner");
  b.hidden = false;
  b.textContent = msg;
  b.style.borderColor = kind==="danger" ? "rgba(214,40,40,0.30)" : kind==="warn" ? "rgba(247,127,0,0.30)" : "rgba(45,106,79,0.22)";
}
function hideBanner(){ const b=$("banner"); b.hidden=true; }

function showAlert(kind, html){
  const box = $("alert-box");
  if(!box) return;
  box.className = "alert " + kind;
  box.innerHTML = html;
  box.hidden = false;
  setTimeout(()=>{ box.hidden = true; }, 10000);
}

/* --- Safety messages --- */
function glucoseSafetyMessage(v){
  const p = activePatient();
  const { targetLow, targetHigh } = p.profile;
  if(v < 70){
    return { kind:"danger", title:"🟥 هشدار هیپو (قند پایین)", msg:"۱۵ گرم قند سریع‌الاثر مصرف کن و ۱۵ دقیقه بعد دوباره تست کن. اگر بهتر نشد تکرار. در علائم شدید، کمک فوری." };
  }
  if(v >= 300){
    return { kind:"warn", title:"🟧 هشدار هایپر شدید (قند خیلی بالا)", msg:"آب کافی، بررسی علائم. در صورت امکان بررسی کتون طبق دستور پزشک. اگر تهوع/استفراغ/خواب‌آلودگی: اورژانس." };
  }
  if(v >= targetLow && v <= targetHigh){
    return { kind:"ok", title:"🟢 در محدوده هدف", msg:"داخل محدوده هدف ثبت شد." };
  }
  return { kind:"warn", title:"🟡 خارج از هدف", msg:"برای تحلیل بهتر: غذا/فعالیت/استرس را هم ثبت کن." };
}

/* --- Method B: load sample_data.json from project root --- */
async function loadSampleFromFile(){
  const resp = await fetch("./sample_data.json", { cache:"no-store" });
  if(!resp.ok) throw new Error("فایل sample_data.json پیدا نشد");
  const obj = await resp.json();
  // map sample structure to patient
  const p = defaultPatient();
  p.patient_id = obj.profile.patient_id || "P001";
  p.name = obj.profile.name || "نمونه-کاربر";

  p.profile.unit = obj.profile.units || "mg/dL";
  p.profile.diabetesType = obj.profile.diabetes_type || "Type 1";
  p.profile.targetLow = obj.profile.targets?.low ?? 80;
  p.profile.targetHigh = obj.profile.targets?.high ?? 180;

  // health extras
  const h = obj.profile.health || {};
  p.profile.health = {
    height_cm: h.height_cm ?? "",
    weight_kg: h.weight_kg ?? "",
    birth_year: h.birth_year ?? "",
    diagnosis_date: h.diagnosis_date ?? "",
    other_conditions: (h.other_conditions || []).join(", "),
    stress_base: h.personality_stress_profile?.baseline_stress || "متوسط",
  };

  // expand day entries into arrays
  for(const day of (obj.days || [])){
    const date = day.date;
    const g = day.glucose_readings || {};
    const map = {
      FBS: g.FBS,
      AfterBreakfast2h: g.after_breakfast_2h,
      BeforeLunch: g.pre_lunch,
      AfterLunch2h: g.after_lunch_2h,
      BeforeDinner: g.pre_dinner,
      AfterDinner2h: g.after_dinner_2h,
      BeforeBed: g.bedtime
    };
    for(const [slot,val] of Object.entries(map)){
      if(val==null) continue;
      p.glucose.push({ id: crypto.randomUUID(), date, slot, value: Number(val), note: makeNote(day.context) });
    }
    // insulin (as recorded)
    const ins = day.insulin || {};
    for(const b of (ins.basal || [])){
      p.insulin.push({ id: crypto.randomUUID(), date, kind:"Basal", name:b.insulin_type||"Basal", units:Number(b.units||0), time:b.time||"22:00", mealRef:"", reminder:false });
    }
    for(const bl of (ins.bolus || [])){
      p.insulin.push({ id: crypto.randomUUID(), date, kind:"Bolus", name:bl.insulin_type||"Bolus", units:Number(bl.units||0), time:bl.time||"", mealRef:(bl.meal||""), reminder:false });
    }
    for(const c of (ins.corrections || [])){
      p.insulin.push({ id: crypto.randomUUID(), date, kind:"Correction", name:c.insulin_type||"Correction", units:Number(c.units||0), time:c.time||"", mealRef:"", reminder:false });
    }
    // meals
    for(const m of (day.meals || [])){
      const mealKey = m.meal === "صبحانه" ? "Breakfast" :
                      m.meal === "ناهار" ? "Lunch" :
                      m.meal === "شام" ? "Dinner" :
                      m.meal === "میان‌وعده" ? "Snack" : m.meal;
      let linkToSlot = "";
      if(m.linked_glucose === "after_breakfast_2h") linkToSlot = "AfterBreakfast2h";
      if(m.linked_glucose === "after_lunch_2h") linkToSlot = "AfterLunch2h";
      if(m.linked_glucose === "after_dinner_2h") linkToSlot = "AfterDinner2h";
      p.meals.push({ id: crypto.randomUUID(), date, meal: mealKey, desc: m.description || "", carbs: Number(m.carbs_g||0), linkToSlot });
    }

    // demo suggestions
    if(day.demo_suggestions){
      p.demo.byDate[date] = day.demo_suggestions;
    }
  }

  p.ai.monthlySummary = obj.analysis?.mock_ai_monthly_summary || null;

  // replace app state with loaded patient
  appState.patients = [p];
  appState.activePatientId = p.patient_id;
  saveState(appState);
  syncPatientUI();
  renderAll();
  showBanner("✅ دیتای نمونه از فایل sample_data.json لود شد و داشبورد باید پر شده باشد 🌿", "ok");
}

function makeNote(ctx){
  if(!ctx) return "";
  const parts = [];
  if(ctx.stress) parts.push("استرس: " + ctx.stress);
  if(ctx.activity) parts.push("فعالیت: " + ctx.activity);
  if(ctx.sick) parts.push("بیماری/تب");
  if(ctx.sleep_hours!=null) parts.push("خواب: " + ctx.sleep_hours + "h");
  if(ctx.dawn_effect) parts.push("Dawn");
  return parts.join(" | ");
}

/* --- Tabs --- */
function initTabs(){
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
      btn.classList.add("active");
      const key = btn.getAttribute("data-tab");
      document.querySelectorAll(".panel").forEach(p=>p.classList.remove("show"));
      $("tab-"+key).classList.add("show");
      hideBanner();
      // render on tab open (for canvases)
      setTimeout(()=>renderAll(), 30);
    });
  });
}

/* --- Patients --- */
function syncPatientUI(){
  const sel = $("patient-select");
  if(!sel) return;
  sel.innerHTML = appState.patients.map(p=>`<option value="${esc(p.patient_id)}"${p.patient_id===appState.activePatientId?" selected":""}>${esc(p.name)} (${esc(p.patient_id)})</option>`).join("");
  sel.onchange = ()=>{
    appState.activePatientId = sel.value;
    saveState(appState);
    renderAll();
    showBanner("👤 پروفایل فعال تغییر کرد ✅", "ok");
  };
}

/* --- Charts --- */
let glucoseChart = null;
let growthChart = null;

// background zones plugin
const zonePlugin = {
  id: "targetZones",
  beforeDatasetsDraw(chart, args, pluginOptions){
    const p = activePatient();
    const { targetLow, targetHigh } = p.profile;
    const { ctx, chartArea, scales } = chart;
    if(!chartArea) return;
    const y = scales.y;
    const top = y.getPixelForValue(targetHigh);
    const mid = y.getPixelForValue(targetLow);

    ctx.save();

    const style = $("zone-style")?.value || "bands";
    if(style === "gradient"){
      const grad = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      grad.addColorStop(0, "rgba(214,40,40,0.10)");
      grad.addColorStop(0.35, "rgba(247,127,0,0.06)");
      grad.addColorStop(0.55, "rgba(82,183,136,0.12)");
      grad.addColorStop(0.75, "rgba(247,127,0,0.06)");
      grad.addColorStop(1, "rgba(214,40,40,0.08)");
      ctx.fillStyle = grad;
      ctx.fillRect(chartArea.left, chartArea.top, chartArea.right-chartArea.left, chartArea.bottom-chartArea.top);
    }else{
      // Above target high (red)
      ctx.fillStyle = "rgba(214,40,40,0.08)";
      ctx.fillRect(chartArea.left, chartArea.top, chartArea.right-chartArea.left, top-chartArea.top);
      // In range (green)
      ctx.fillStyle = "rgba(82,183,136,0.12)";
      ctx.fillRect(chartArea.left, top, chartArea.right-chartArea.left, mid-top);
      // Below low (orange-ish)
      ctx.fillStyle = "rgba(247,127,0,0.06)";
      ctx.fillRect(chartArea.left, mid, chartArea.right-chartArea.left, chartArea.bottom-mid);
    }

    ctx.restore();
  }
};

function getEntriesForRange(range, endDateISO){
  const p = activePatient();
  const end = new Date(endDateISO + "T00:00:00");
  let start = new Date(end);
  if(range === "day"){
    start = new Date(end);
  }else if(range === "week"){
    start.setDate(start.getDate() - 6);
  }else{ // month
    start.setDate(start.getDate() - 29);
  }
  const inRange = (iso) => {
    const t = new Date(iso + "T00:00:00");
    return t >= start && t <= end;
  };
  return p.glucose.filter(x => inRange(x.date));
}

function buildGlucoseSeries(range, endDateISO){
  const entries = getEntriesForRange(range, endDateISO);
  const p = activePatient();

  if(range === "day"){
    const day = endDateISO;
    // fixed slot order
    const slotOrder = ["FBS","AfterBreakfast2h","BeforeLunch","AfterLunch2h","BeforeDinner","AfterDinner2h","BeforeBed"];
    const labels = slotOrder.map(s=>SLOT_LABELS[s]);
    const values = slotOrder.map(s=>{
      const e = entries.find(x=>x.date===day && x.slot===s);
      return e ? Number(e.value) : null;
    });
    return { labels, values, pointsMeta: slotOrder.map((s,i)=>({date:day, slot:s})) };
  }

  // week/month -> daily AVG series (also keep min/max)
  const map = new Map(); // date -> list values
  for(const e of entries){
    const arr = map.get(e.date) || [];
    arr.push(Number(e.value));
    map.set(e.date, arr);
  }
  const dates = Array.from(map.keys()).sort();
  const avg = dates.map(d=>{
    const vals = map.get(d).filter(v=>Number.isFinite(v));
    if(!vals.length) return null;
    return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
  });
  const min = dates.map(d=>Math.min(...map.get(d)));
  const max = dates.map(d=>Math.max(...map.get(d)));
  return { labels: dates, values: avg, min, max, pointsMeta: dates.map(d=>({date:d})) };
}

function renderGlucoseChart(){
  const endDateISO = $("range-date").value || todayISO();
  const range = $("range-select").value || "month";
  const p = activePatient();
  const { targetLow, targetHigh } = p.profile;

  const s = buildGlucoseSeries(range, endDateISO);
  const ctx = $("glucoseChart").getContext("2d");
  if(glucoseChart) glucoseChart.destroy();

  const datasets = [
    {
      label: range==="day" ? "قند (نقطه‌ای)" : "میانگین روزانه",
      data: s.values,
      borderWidth: 3,
      pointRadius: range==="day" ? 5 : 4,
      tension: 0.35,
    },
    {
      label:"هدف پایین",
      data: s.labels.map(()=>targetLow),
      borderDash:[6,6],
      borderWidth: 1,
      pointRadius:0
    },
    {
      label:"هدف بالا",
      data: s.labels.map(()=>targetHigh),
      borderDash:[6,6],
      borderWidth: 1,
      pointRadius:0
    },
  ];

  // add min/max band for week/month
  if(range !== "day"){
    datasets.unshift({
      label:"کمینه/بیشینه روزانه",
      data: s.max,
      borderWidth: 0,
      pointRadius: 0,
      fill: { target: 1 },
    });
    datasets.splice(1,0,{
      label:"(band)",
      data: s.min,
      borderWidth: 0,
      pointRadius: 0,
    });
  }

  glucoseChart = new Chart(ctx,{
    type:"line",
    data:{ labels:s.labels, datasets },
    plugins:[zonePlugin],
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{ position:"bottom", rtl:true, labels:{ usePointStyle:true } },
        tooltip:{ rtl:true }
      },
      scales:{
        y:{ title:{ display:true, text:`قند (${p.profile.unit})` } },
        x:{ ticks:{ maxRotation:0, autoSkip:true } }
      }
    }
  });
}

/* --- KPI + interpolation (hours in/out-of-range) --- */
function computeStats(entries){
  const vals = entries.map(e=>Number(e.value)).filter(v=>Number.isFinite(v));
  if(!vals.length) return { count:0, avg:null, min:null, max:null, tirPct:null, hypoPct:null, hyperPct:null };
  const p = activePatient();
  const { targetLow, targetHigh } = p.profile;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const avg = Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
  const inRange = vals.filter(v=>v>=targetLow && v<=targetHigh).length;
  const hypo = vals.filter(v=>v<70).length;
  const hyper = vals.filter(v=>v>=300).length;
  return {
    count: vals.length,
    avg, min, max,
    tirPct: Math.round((inRange/vals.length)*100),
    hypoPct: Math.round((hypo/vals.length)*100),
    hyperPct: Math.round((hyper/vals.length)*100),
  };
}

// approximate time in range for selected day by linear interpolation between known slots
function computeTIRHoursForDay(dateISO){
  const p = activePatient();
  const { targetLow, targetHigh } = p.profile;
  const dayEntries = p.glucose.filter(e=>e.date===dateISO).slice();
  if(!dayEntries.length) return null;

  // order by SLOT_TIME
  const order = Object.keys(SLOT_TIME);
  dayEntries.sort((a,b)=> order.indexOf(a.slot)-order.indexOf(b.slot));

  // build time-value points
  const pts = [];
  for(const e of dayEntries){
    const t = toDateTime(dateISO, SLOT_TIME[e.slot] || "12:00").getTime();
    pts.push({ t, v:Number(e.value) });
  }

  // If only one point, can't estimate hours
  if(pts.length < 2) return { inH:0, outH:0, hypoH:0, hyperH:0, totalH:0, note:"داده کافی نیست." };

  // integrate over segments using small steps (5 min)
  const step = 5*60*1000;
  let inH=0, outH=0, hypoH=0, hyperH=0, totalH=0;

  for(let i=0;i<pts.length-1;i++){
    const a=pts[i], b=pts[i+1];
    const dt = b.t - a.t;
    if(dt<=0) continue;
    for(let t=a.t; t<b.t; t+=step){
      const alpha = (t-a.t)/dt;
      const v = a.v + (b.v-a.v)*alpha;
      const h = step/3600000;
      totalH += h;
      if(v < 70) hypoH += h;
      else if(v >= 300) hyperH += h;
      if(v>=targetLow && v<=targetHigh) inH += h;
      else outH += h;
    }
  }
  // round
  const r = (x)=>Math.round(x*10)/10;
  return { inH:r(inH), outH:r(outH), hypoH:r(hypoH), hyperH:r(hyperH), totalH:r(totalH), note:"تخمینی" };
}

/* --- Render panels --- */
function renderKPIs(){
  const end = $("range-date").value || todayISO();
  const range = $("range-select").value || "month";
  const entries = getEntriesForRange(range, end);
  const s = computeStats(entries);
  const row = $("kpi-row");
  if(!row) return;

  const cards = [
    { k:"میانگین", v: s.avg ?? "—", emoji:"📌" },
    { k:"کمینه", v: s.min ?? "—", emoji:"⬇️" },
    { k:"بیشینه", v: s.max ?? "—", emoji:"⬆️" },
    { k:"TIR", v: s.tirPct!=null ? s.tirPct+"%" : "—", emoji:"🟢" },
  ];
  row.innerHTML = cards.map(x=>`
    <div class="kpi">
      <div class="v">${esc(x.v)} <span style="font-size:14px">${esc(x.emoji)}</span></div>
      <div class="k">${esc(x.k)}</div>
    </div>
  `).join("");
}

function renderTIRBox(){
  const end = $("range-date").value || todayISO();
  const range = $("range-select").value || "month";
  const box = $("tir-hours");
  const detail = $("tir-detail");
  if(!box || !detail) return;

  if(range !== "day"){
    box.textContent = "برای «روز» نمایش دقیق‌تر است";
    detail.textContent = "در بازه‌های طولانی، TIR درصدی در KPI نمایش داده می‌شود.";
    return;
  }

  const r = computeTIRHoursForDay(end);
  if(!r){
    box.textContent = "—";
    detail.textContent = "برای این روز داده‌ای ثبت نشده.";
    return;
  }
  box.textContent = `${r.inH} ساعت در هدف ✅`;
  detail.textContent = `خارج از هدف: ${r.outH}h | هیپو: ${r.hypoH}h | هایپر شدید: ${r.hyperH}h (کل بازه پوشش داده‌شده: ${r.totalH}h — ${r.note})`;
}

function renderSafetyList(){
  const end = $("range-date").value || todayISO();
  const range = $("range-select").value || "month";
  const entries = getEntriesForRange(range, end).slice().sort((a,b)=> (a.date+a.slot).localeCompare(b.date+b.slot));
  const list = $("safety-list");
  if(!list) return;
  const items=[];
  for(const e of entries){
    const v = Number(e.value);
    if(v < 70) items.push(`🟥 ${e.date} • ${SLOT_LABELS[e.slot]}: ${v} (هیپو)`);
    if(v >= 300) items.push(`🟧 ${e.date} • ${SLOT_LABELS[e.slot]}: ${v} (هایپر شدید)`);
  }
  list.innerHTML = items.length ? items.map(x=>`<li>${esc(x)}</li>`).join("") : "<li>✅ موردی ثبت نشده</li>";
}

function renderMealAnalysis(){
  const end = $("range-date").value || todayISO();
  const range = $("range-select").value || "month";
  const p = activePatient();
  const entries = getEntriesForRange(range, end);
  const dates = new Set(entries.map(x=>x.date));
  const meals = p.meals.filter(m=> dates.has(m.date));

  const list = $("meal-analysis");
  if(!list) return;
  const items=[];
  for(const m of meals){
    const carbs = Number(m.carbs);
    let v=null;
    if(m.linkToSlot){
      const g = p.glucose.find(x=>x.date===m.date && x.slot===m.linkToSlot);
      v = g ? Number(g.value) : null;
    }
    let badge="🟦";
    if(v!=null){
      const { targetLow, targetHigh } = p.profile;
      if(v<70) badge="🟥";
      else if(v>=300) badge="🟧";
      else if(v>=targetLow && v<=targetHigh) badge="🟢";
      else badge="🟡";
      items.push(`${badge} ${m.date} • ${MEAL_LABELS[m.meal]||m.meal}: ${carbs}g → قند ۲ساعت بعد: ${v}`);
    }else{
      items.push(`🍽️ ${m.date} • ${MEAL_LABELS[m.meal]||m.meal}: ${carbs}g (لینک/قند موجود نیست)`);
    }
  }
  list.innerHTML = items.length ? items.map(x=>`<li>${esc(x)}</li>`).join("") : "<li>فعلاً داده‌ای نیست. ابتدا دیتای نمونه را لود کن ✅</li>";
}

function renderSummary(){
  const end = $("range-date").value || todayISO();
  const range = $("range-select").value || "month";
  const entries = getEntriesForRange(range, end);
  const p = activePatient();
  const s = computeStats(entries);
  const unit = p.profile.unit;
  const box = $("summary");
  if(!box) return;
  if(!s.count){
    box.innerHTML = "برای این بازه داده‌ای نیست. دکمه «📦 لود دیتای نمونه» را بزن ✅";
    return;
  }
  box.innerHTML = `
    <div>📌 تعداد ثبت‌ها: <b>${s.count}</b></div>
    <div>📈 میانگین: <b>${s.avg}</b> ${esc(unit)} | کمینه: <b>${s.min}</b> | بیشینه: <b>${s.max}</b></div>
    <div>🟢 TIR: <b>${s.tirPct}%</b> | 🟥 هیپو: <b>${s.hypoPct}%</b> | 🟧 هایپر شدید: <b>${s.hyperPct}%</b></div>
    <div class="hint">✨ برای تحلیل حرفه‌ای‌تر: خواب/استرس/ورزش را در یادداشت قند ثبت کن.</div>
  `;
}

function renderAIMock(){
  const end = $("range-date").value || todayISO();
  const p = activePatient();
  const box = $("ai-insights");
  if(!box) return;

  const insights = [];
  // derive quick insights from notes + sample demo data
  const dayDemo = p.demo.byDate?.[end] || null;
  if(dayDemo && appState.ui.demoMode){
    insights.push({ kind:"danger", text: dayDemo.big_warning || "⚠️ دمو" });
    insights.push({ kind:"ok", text: `Basal (دمو): ${dayDemo.basal_level}` });
    insights.push({ kind:"ok", text: `Bolus (دمو): صبحانه ${dayDemo.bolus_level_by_meal?.Breakfast||"—"} | ناهار ${dayDemo.bolus_level_by_meal?.Lunch||"—"} | شام ${dayDemo.bolus_level_by_meal?.Dinner||"—"}` });
    insights.push({ kind:"warn", text: `Hint: ${dayDemo.icr_hint} / ${dayDemo.isf_hint}` });
  }else{
    insights.push({ kind:"ok", text:"Demo Mode خاموش است. برای دیدن خروجی‌های نمایشی روشنش کن 🤖" });
  }

  // monthly summary chips
  const ms = p.ai.monthlySummary;
  if(ms){
    insights.push({ kind:"ok", text:`Dawn احتمالی: ${Math.round((ms.dawn_like_rate||0)*100)}% روزها` });
    insights.push({ kind:"warn", text:`هیپو شبانه: ${Math.round((ms.night_hypo_rate||0)*100)}% روزها` });
  }

  box.innerHTML = insights.map(x=>`<div class="chip ${x.kind}">${esc(x.text)}</div>`).join("");
  $("learn-box").innerHTML = `
    <div class="chip ok">🧠 مدل نمایشی: mock-analytics</div>
    <div class="chip warn">📌 پیشنهاد آموزشی: کیفیت ثبت را بالا ببر</div>
    <div class="chip danger">⚠️ عدد دوز ارائه نمی‌شود</div>
  `;

  // also fill demo panel
  const demoBasal = $("demo-basal");
  const demoBolus = $("demo-bolus");
  const demoHints = $("demo-hints");
  if(demoBasal && demoBolus && demoHints){
    if(appState.ui.demoMode && dayDemo){
      demoBasal.textContent = `سطح ${dayDemo.basal_level}`;
      demoBolus.textContent = `صبحانه ${dayDemo.bolus_level_by_meal.Breakfast} • ناهار ${dayDemo.bolus_level_by_meal.Lunch} • شام ${dayDemo.bolus_level_by_meal.Dinner}`;
      demoHints.textContent = `${dayDemo.icr_hint} | ${dayDemo.isf_hint}`;
    }else{
      demoBasal.textContent = "—";
      demoBolus.textContent = "—";
      demoHints.textContent = "Demo Mode را روشن کن";
    }
  }
}

function renderGrowthChart(){
  const ctx = $("growthChart")?.getContext("2d");
  if(!ctx) return;
  const p = activePatient();
  const h = Number(p.profile.health?.height_cm || 0);
  const w = Number(p.profile.health?.weight_kg || 0);

  // build simple 6-point mock growth series
  const labels = ["۶ ماه قبل","۵ ماه قبل","۴ ماه قبل","۳ ماه قبل","۲ ماه قبل","اکنون"];
  const heightSeries = labels.map((_,i)=> h ? Math.round(h - (5-i)*0.6) : null);
  const weightSeries = labels.map((_,i)=> w ? Math.round((w - (5-i)*0.4)*10)/10 : null);

  if(growthChart) growthChart.destroy();
  growthChart = new Chart(ctx,{
    type:"line",
    data:{
      labels,
      datasets:[
        { label:"قد (cm)", data: heightSeries, borderWidth: 2, tension:0.35, pointRadius: 3 },
        { label:"وزن (kg)", data: weightSeries, borderWidth: 2, tension:0.35, pointRadius: 3 },
      ]
    },
    options:{ responsive:true, plugins:{ legend:{ position:"bottom", rtl:true } } }
  });
}

/* --- Tables --- */
function renderTables(){
  const p = activePatient();
  // glucose
  const tg = document.querySelector("#tbl-glucose tbody");
  const gRows = p.glucose.slice().sort((a,b)=> (b.date+b.slot).localeCompare(a.date+a.slot));
  tg.innerHTML = gRows.map(e=>`
    <tr>
      <td>${esc(e.date)}</td>
      <td>${esc(SLOT_LABELS[e.slot]||e.slot)}</td>
      <td>${esc(e.value)}</td>
      <td>${esc(e.note||"")}</td>
      <td><button class="action" data-del="glucose" data-id="${esc(e.id)}">حذف</button></td>
    </tr>
  `).join("");

  // insulin
  const ti = document.querySelector("#tbl-insulin tbody");
  const iRows = p.insulin.slice().sort((a,b)=> (b.date+(b.time||"")).localeCompare(a.date+(a.time||"")));
  ti.innerHTML = iRows.map(e=>`
    <tr>
      <td>${esc(e.date)}</td>
      <td>${esc(e.kind)}</td>
      <td>${esc(e.name)}</td>
      <td>${esc(e.units)}</td>
      <td>${esc(e.time||"—")}</td>
      <td>${esc(e.mealRef ? (MEAL_LABELS[e.mealRef]||e.mealRef) : "—")}</td>
      <td><button class="action" data-del="insulin" data-id="${esc(e.id)}">حذف</button></td>
    </tr>
  `).join("");

  // meals
  const tm = document.querySelector("#tbl-meal tbody");
  const mRows = p.meals.slice().sort((a,b)=> (b.date+a.meal).localeCompare(a.date+b.meal));
  tm.innerHTML = mRows.map(e=>`
    <tr>
      <td>${esc(e.date)}</td>
      <td>${esc(MEAL_LABELS[e.meal]||e.meal)}</td>
      <td>${esc(e.desc)}</td>
      <td>${esc(e.carbs)}g</td>
      <td>${esc(e.linkToSlot ? (SLOT_LABELS[e.linkToSlot]||e.linkToSlot) : "—")}</td>
      <td><button class="action" data-del="meals" data-id="${esc(e.id)}">حذف</button></td>
    </tr>
  `).join("");

  document.querySelectorAll("[data-del]").forEach(btn=>{
    btn.onclick = ()=>{
      const type = btn.getAttribute("data-del");
      const id = btn.getAttribute("data-id");
      p[type] = p[type].filter(x=>x.id !== id);
      saveState(appState);
      renderAll();
    };
  });
}

/* --- Reminder notification --- */
let reminderTimer = null;

async function ensureNotificationPermission(){
  if(!("Notification" in window)) return false;
  if(Notification.permission === "granted") return true;
  if(Notification.permission === "denied") return false;
  const p = await Notification.requestPermission();
  return p === "granted";
}
function scheduleBasalReminder(timeHHMM){
  if(reminderTimer) clearInterval(reminderTimer);
  if(!timeHHMM) return;
  const [hh,mm] = timeHHMM.split(":").map(x=>parseInt(x,10));
  reminderTimer = setInterval(async ()=>{
    const now = new Date();
    if(now.getHours()===hh && now.getMinutes()===mm){
      const ok = await ensureNotificationPermission();
      const msg = `الان زمان Basal است (${timeHHMM}).`;
      if(ok) new Notification("قندیار 💚 یادآور Basal", { body: msg });
      else alert("⏰ " + msg);
      await new Promise(r=>setTimeout(r,61000));
    }
  }, 10000);
}

/* --- Tools --- */
function initTools(){
  $("btn-convert").onclick = ()=>{
    const val = Number($("conv-in").value);
    const mode = $("conv-mode").value;
    if(!Number.isFinite(val)){ $("conv-out").textContent="عدد معتبر وارد کن"; return; }
    if(mode==="mg2mm") $("conv-out").textContent = (val/18).toFixed(1) + " mmol/L";
    else $("conv-out").textContent = Math.round(val*18) + " mg/dL";
  };
  $("btn-carb").onclick = ()=>{
    const val = Number($("carb-a").value);
    const mode = $("carb-mode").value;
    if(!Number.isFinite(val)){ $("carb-out").textContent="عدد معتبر وارد کن"; return; }
    if(mode==="ex") $("carb-out").textContent = (val/15).toFixed(1) + " واحد نان (تقریبی)";
    else $("carb-out").textContent = Math.round(val*4) + " kcal (تقریبی)";
  };
}

/* --- Food DB UI --- */
let foodPick = null;
function renderFoodResults(query=""){
  const box = $("food-results");
  if(!box) return;
  const q = (query||"").trim();
  const list = (window.FOOD_DB||[]).filter(x=> !q || x.name.includes(q));
  box.innerHTML = list.slice(0,12).map(item=>`
    <div class="food-card">
      <div class="name">🍲 ${esc(item.name)}</div>
      <div class="meta">کربوهیدرات: ${esc(item.carbs_per_100g)}g / 100g • یا ${esc(item.carbs_per_serving)}g (${esc(item.serving_label)})</div>
      <button class="btn btn-ghost" data-food="${esc(item.name)}">انتخاب ✅</button>
    </div>
  `).join("");

  box.querySelectorAll("[data-food]").forEach(btn=>{
    btn.onclick = ()=>{
      const name = btn.getAttribute("data-food");
      const item = (window.FOOD_DB||[]).find(x=>x.name===name);
      foodPick = item;
      showBanner(`✅ انتخاب شد: ${name} — حالا مقدار را بزن و «افزودن به وعده»`, "ok");
    };
  });
}
function initFoodUI(){
  $("food-search").oninput = (e)=> renderFoodResults(e.target.value);
  renderFoodResults("");
  $("btn-add-food").onclick = ()=>{
    if(!foodPick){ showBanner("اول یک غذا انتخاب کن 😊", "warn"); return; }
    const unit = $("food-unit").value;
    const amount = Number($("food-amount").value);
    if(!Number.isFinite(amount) || amount<=0){ showBanner("مقدار معتبر وارد کن", "warn"); return; }

    let carbs = 0;
    if(unit==="g") carbs = (foodPick.carbs_per_100g * amount)/100;
    else carbs = foodPick.carbs_per_serving * amount;

    // append to meal form
    const mf = $("meal-form");
    const prevDesc = mf.desc.value ? (mf.desc.value + " + ") : "";
    mf.desc.value = prevDesc + foodPick.name;
    mf.carbs.value = Math.round(carbs);
    showBanner(`🍽️ به فرم وعده اضافه شد: ${foodPick.name} | کربوهیدرات تخمینی: ${Math.round(carbs)}g`, "ok");
  };
}

/* --- Forms wiring --- */
function initForms(){
  // default dates
  const d = todayISO();
  document.querySelectorAll('input[type="date"]').forEach(x=> x.value = d);
  $("range-date").value = d;

  // demo mode
  $("demo-toggle").checked = !!appState.ui.demoMode;
  $("demo-toggle").onchange = ()=>{
    appState.ui.demoMode = $("demo-toggle").checked;
    saveState(appState);
    renderAll();
    showBanner(appState.ui.demoMode ? "🤖 Demo Mode روشن شد (فقط آموزشی)" : "Demo Mode خاموش شد", "ok");
  };

  // load sample
  $("btn-load-sample").onclick = async ()=>{
    try{
      await loadSampleFromFile();
    }catch(err){
      showBanner("❌ خطا در لود دیتای نمونه: " + (err.message||err), "danger");
    }
  };

  // export
  $("btn-export").onclick = ()=>{
    const blob = new Blob([JSON.stringify(appState,null,2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ghandyar_export_${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // import
  $("file-import").onchange = async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    try{
      const text = await file.text();
      const obj = JSON.parse(text);
      if(!obj.patients || !Array.isArray(obj.patients)) throw new Error("فرمت نامعتبر");
      appState = obj;
      saveState(appState);
      syncPatientUI();
      renderAll();
      showBanner("⬆️ ورودی انجام شد ✅", "ok");
    }catch(err){
      showBanner("❌ خطا در ورودی: " + (err.message||err), "danger");
    }finally{
      e.target.value = "";
    }
  };

  // pdf
  $("btn-pdf").onclick = ()=> makePDF();

  // reset
  $("btn-reset").onclick = ()=>{
    if(confirm("همه داده‌ها پاک شود؟")){
      localStorage.removeItem(LS_KEY);
      appState = loadState();
      saveState(appState);
      syncPatientUI();
      renderAll();
      showBanner("🗑️ ریست انجام شد", "ok");
    }
  };

  // patient add
  $("patient-form").onsubmit = (e)=>{
    e.preventDefault();
    const pid = e.target.pid.value.trim();
    const name = e.target.name.value.trim();
    if(!pid || !name) return;
    if(appState.patients.some(p=>p.patient_id===pid)){
      showBanner("این کد قبلاً وجود دارد.", "warn"); return;
    }
    const p = defaultPatient();
    p.patient_id = pid;
    p.name = name;
    appState.patients.push(p);
    appState.activePatientId = pid;
    saveState(appState);
    syncPatientUI();
    renderAll();
    showBanner("✅ پروفایل جدید اضافه شد", "ok");
    e.target.reset();
  };

  syncPatientUI();

  // profile form
  const pf = $("profile-form");
  pf.onsubmit = (e)=>{
    e.preventDefault();
    const p = activePatient();
    p.profile.unit = pf.unit.value;
    p.profile.diabetesType = pf.diabetesType.value;
    p.profile.targetLow = Number(pf.targetLow.value);
    p.profile.targetHigh = Number(pf.targetHigh.value);

    p.profile.health.height_cm = Number(pf.heightCm.value||"") || "";
    p.profile.health.weight_kg = Number(pf.weightKg.value||"") || "";
    p.profile.health.birth_year = Number(pf.birthYear.value||"") || "";
    p.profile.health.diagnosis_date = pf.dxDate.value || "";
    p.profile.health.other_conditions = pf.otherCond.value || "";
    p.profile.health.stress_base = pf.stressBase.value || "متوسط";

    saveState(appState);
    renderAll();
    showBanner("💾 پروفایل ذخیره شد ✅", "ok");
  };

  // glucose
  const gf = $("glucose-form");
  gf.onsubmit = (e)=>{
    e.preventDefault();
    const p = activePatient();
    const entry = {
      id: crypto.randomUUID(),
      date: gf.date.value || todayISO(),
      slot: gf.slot.value,
      value: Number(gf.value.value),
      note: gf.note.value || ""
    };
    p.glucose.push(entry);
    saveState(appState);

    const sm = glucoseSafetyMessage(entry.value);
    showAlert(sm.kind, `<b>${sm.title}</b><div style="margin-top:6px">${sm.msg}</div>`);

    gf.value.value = "";
    gf.note.value = "";
    renderAll();
  };

  // insulin
  const inf = $("insulin-form");
  inf.onsubmit = async (e)=>{
    e.preventDefault();
    const p = activePatient();
    const kind = inf.kind.value;
    const reminder = (kind==="Basal") ? !!inf.reminder.checked : false;
    const item = {
      id: crypto.randomUUID(),
      date: inf.date.value || todayISO(),
      kind,
      name: inf.name.value.trim(),
      units: Number(inf.units.value),
      time: inf.time.value || "",
      mealRef: inf.mealRef.value || "",
      reminder
    };
    p.insulin.push(item);

    if(kind==="Basal" && reminder && item.time){
      const ok = await ensureNotificationPermission();
      p.reminders.basalEnabled = true;
      p.reminders.basalTime = item.time;
      scheduleBasalReminder(item.time);
      showBanner(ok ? `⏰ یادآور Basal فعال شد برای ${item.time}` : `⏰ یادآور فعال شد (بدون مجوز اعلان)`, ok?"ok":"warn");
    }

    saveState(appState);
    inf.reset();
    inf.date.value = todayISO();
    renderAll();
  };

  // meal
  const mf = $("meal-form");
  mf.onsubmit = (e)=>{
    e.preventDefault();
    const p = activePatient();
    const item = {
      id: crypto.randomUUID(),
      date: mf.date.value || todayISO(),
      meal: mf.meal.value,
      desc: mf.desc.value.trim(),
      carbs: Number(mf.carbs.value),
      linkToSlot: mf.linkToSlot.value || ""
    };
    p.meals.push(item);
    saveState(appState);
    mf.reset();
    mf.date.value = todayISO();
    renderAll();
    showBanner("🍽️ وعده ثبت شد ✅", "ok");
  };

  // range controls
  $("range-select").onchange = ()=> renderAll();
  $("range-date").onchange = ()=> renderAll();
  $("zone-style").onchange = ()=> renderAll();

  // tools and food
  initTools();
  initFoodUI();
}

/* --- PDF (simple print stylesheet using new window) --- */
function makePDF(){
  const p = activePatient();
  const end = $("range-date").value || todayISO();
  const range = $("range-select").value || "month";
  const entries = getEntriesForRange(range, end);
  const s = computeStats(entries);

  const html = `
  <html lang="fa" dir="rtl">
  <head>
    <meta charset="utf-8"/>
    <title>گزارش قندیار</title>
    <style>
      body{font-family: "Times New Roman", Tahoma, Arial, sans-serif; direction:rtl; padding:18px}
      h1{margin:0 0 6px}
      .muted{color:#555}
      .box{border:1px solid #ddd; border-radius:12px; padding:12px; margin-top:12px}
      table{width:100%; border-collapse:collapse; margin-top:10px}
      th,td{border-bottom:1px solid #eee; padding:8px; font-size:12px; text-align:right}
      th{background:#f3f6f4}
    </style>
  </head>
  <body>
    <h1>گزارش قندیار — ${esc(p.name)} (${esc(p.patient_id)})</h1>
    <div class="muted">بازه: ${esc(range)} | تاریخ انتهایی: ${esc(end)}</div>
    <div class="box">
      <b>خلاصه:</b><br/>
      میانگین: ${esc(s.avg)} ${esc(p.profile.unit)} — کمینه: ${esc(s.min)} — بیشینه: ${esc(s.max)}<br/>
      TIR: ${esc(s.tirPct)}% — هیپو: ${esc(s.hypoPct)}% — هایپر شدید: ${esc(s.hyperPct)}%
    </div>
    <div class="box">
      <b>آخرین 25 ثبت قند:</b>
      <table>
        <thead><tr><th>تاریخ</th><th>حالت</th><th>قند</th><th>یادداشت</th></tr></thead>
        <tbody>
          ${p.glucose.slice().sort((a,b)=>(b.date+b.slot).localeCompare(a.date+a.slot)).slice(0,25).map(e=>`
            <tr><td>${esc(e.date)}</td><td>${esc(SLOT_LABELS[e.slot]||e.slot)}</td><td>${esc(e.value)}</td><td>${esc(e.note||"")}</td></tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <div class="muted" style="margin-top:10px">⚠️ آموزشی/تستی — توصیه درمانی نیست.</div>
    <script>window.print()</script>
  </body>
  </html>`;
  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
}

/* --- Render all --- */
function syncProfileForm(){
  const p = activePatient();
  const pf = $("profile-form");
  if(!pf) return;
  pf.unit.value = p.profile.unit;
  pf.diabetesType.value = p.profile.diabetesType;
  pf.targetLow.value = p.profile.targetLow;
  pf.targetHigh.value = p.profile.targetHigh;
  pf.heightCm.value = p.profile.health?.height_cm ?? "";
  pf.weightKg.value = p.profile.health?.weight_kg ?? "";
  pf.birthYear.value = p.profile.health?.birth_year ?? "";
  pf.dxDate.value = p.profile.health?.diagnosis_date ?? "";
  pf.otherCond.value = p.profile.health?.other_conditions ?? "";
  pf.stressBase.value = p.profile.health?.stress_base ?? "متوسط";
}

function renderAll(){
  syncPatientUI();
  syncProfileForm();
  renderKPIs();
  renderGlucoseChart();
  renderTIRBox();
  renderSafetyList();
  renderMealAnalysis();
  renderSummary();
  renderAIMock();
  renderTables();
  renderGrowthChart();

  // resume reminder if enabled
  const p = activePatient();
  if(p.reminders?.basalEnabled && p.reminders?.basalTime){
    scheduleBasalReminder(p.reminders.basalTime);
  }
}

/* --- Boot --- */
window.addEventListener("load", async ()=>{
  initTabs();
  initForms();
  renderAll();

  // Auto-load sample_data.json on first run if no records
  try{
    const p = activePatient();
    const empty = (p.glucose.length===0 && p.insulin.length===0 && p.meals.length===0);
    if(empty){
      await loadSampleFromFile();
    }else{
      showBanner("ℹ️ داده‌ها از حافظه مرورگر لود شدند. برای دیتای نمونه: «📦 لود دیتای نمونه»", "ok");
    }
  }catch(err){
    showBanner("ℹ️ برای شروع، فایل sample_data.json را در ریشه پروژه قرار بده یا دکمه لود را بزن.", "warn");
  }
});
