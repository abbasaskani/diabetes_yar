/* دیابت‌یار — نسخه وب MVP (RTL) */
const LS_KEY = "diabetesYar.v1";

const SLOT_LABELS = {
  FBS: "FBS (ناشتا)",
  AfterBreakfast2h: "۲ ساعت بعد صبحانه",
  BeforeLunch: "قبل ناهار",
  AfterLunch2h: "۲ ساعت بعد ناهار",
  BeforeDinner: "قبل شام",
  AfterDinner2h: "۲ ساعت بعد شام",
  BeforeBed: "قبل خواب",
};

const MEAL_LABELS = {
  Breakfast: "صبحانه",
  Lunch: "ناهار",
  Dinner: "شام",
  Snack: "میان‌وعده",
};

function todayISO(){
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0,10);
}

function loadState(){
  const raw = localStorage.getItem(LS_KEY);
  if(!raw){
    return {
      profile: { unit: "mg/dL", diabetesType: "Type 1", targetLow: 80, targetHigh: 180 },
      glucose: [],
      insulin: [],
      meals: [],
      reminders: { basalEnabled: false, basalTime: "" }
    };
  }
  try { return JSON.parse(raw); } catch { localStorage.removeItem(LS_KEY); return loadState(); }
}
function saveState(s){ localStorage.setItem(LS_KEY, JSON.stringify(s)); }

let state = loadState();

/* --- UI helpers --- */
function $(id){ return document.getElementById(id); }
function esc(s){ return (s ?? "").toString().replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function showAlert(kind, html){
  const box = $("alert-box");
  box.className = "alert " + kind;
  box.innerHTML = html;
  box.hidden = false;
  setTimeout(()=>{ box.hidden = true; }, 9000);
}

function glucoseSafetyMessage(v){
  if(v < 70){
    return { kind: "danger", title: "⚠️ هشدار هیپو (قند پایین)", msg: "۱۵ گرم قند سریع‌الاثر مصرف کن و ۱۵ دقیقه بعد دوباره تست کن. اگر بهتر نشد تکرار. در علائم شدید، کمک فوری." };
  }
  if(v >= 300){
    return { kind: "warn", title: "⚠️ هشدار هایپر شدید (قند خیلی بالا)", msg: "آب کافی، بررسی علائم. در صورت امکان بررسی کتون طبق دستور پزشک. اگر تهوع/استفراغ/خواب‌آلودگی: اورژانس." };
  }
  const { targetLow, targetHigh } = state.profile;
  if(v >= targetLow && v <= targetHigh){
    return { kind: "ok", title: "✅ در محدوده هدف", msg: "داخل محدوده هدف ثبت شد." };
  }
  return null;
}

/* --- Seed data --- */
function seedData(){
  const d = todayISO();
  state.profile = { unit:"mg/dL", diabetesType:"Type 1", targetLow:80, targetHigh:180 };

  state.glucose = [
    { id: crypto.randomUUID(), date:d, slot:"FBS", value:145, note:"" },
    { id: crypto.randomUUID(), date:d, slot:"AfterBreakfast2h", value:210, note:"" },
    { id: crypto.randomUUID(), date:d, slot:"BeforeLunch", value:160, note:"" },
    { id: crypto.randomUUID(), date:d, slot:"AfterLunch2h", value:190, note:"" },
    { id: crypto.randomUUID(), date:d, slot:"BeforeDinner", value:130, note:"" },
    { id: crypto.randomUUID(), date:d, slot:"AfterDinner2h", value:175, note:"" },
    { id: crypto.randomUUID(), date:d, slot:"BeforeBed", value:110, note:"" },
  ];

  state.insulin = [
    { id: crypto.randomUUID(), date:d, kind:"Basal", name:"Lantus", units:16, time:"22:00", mealRef:"", reminder:true },
    { id: crypto.randomUUID(), date:d, kind:"Bolus", name:"Novorapid", units:5, time:"08:00", mealRef:"Breakfast", reminder:false },
    { id: crypto.randomUUID(), date:d, kind:"Bolus", name:"Novorapid", units:6, time:"13:00", mealRef:"Lunch", reminder:false },
    { id: crypto.randomUUID(), date:d, kind:"Bolus", name:"Novorapid", units:4, time:"20:00", mealRef:"Dinner", reminder:false },
    { id: crypto.randomUUID(), date:d, kind:"Correction", name:"Novorapid", units:2, time:"11:30", mealRef:"", reminder:false },
  ];

  state.meals = [
    { id: crypto.randomUUID(), date:d, meal:"Breakfast", desc:"نان + پنیر + چای", carbs:45, linkToSlot:"AfterBreakfast2h" },
    { id: crypto.randomUUID(), date:d, meal:"Lunch", desc:"برنج + مرغ", carbs:70, linkToSlot:"AfterLunch2h" },
    { id: crypto.randomUUID(), date:d, meal:"Dinner", desc:"سیب‌زمینی/نان + تخم‌مرغ", carbs:50, linkToSlot:"AfterDinner2h" },
  ];

  saveState(state);
  renderAll();
  showAlert("ok", "📥 دیتای نمونه وارد شد. داشبورد و نمودارها باید الان جان گرفته باشند ✅");
}

/* --- Chart --- */
let glucoseChart = null;

function getRangeEntries(range, dateISO){
  const d = new Date(dateISO + "T00:00:00");
  if(range === "day"){
    return state.glucose.filter(x => x.date === dateISO);
  }
  // week: from Sat? We'll use last 7 days ending at dateISO
  const end = new Date(d);
  const start = new Date(d);
  start.setDate(start.getDate() - 6);
  const inRange = (iso) => {
    const t = new Date(iso + "T00:00:00");
    return t >= start && t <= end;
  };
  return state.glucose.filter(x => inRange(x.date));
}

function buildChart(range, dateISO){
  const entries = getRangeEntries(range, dateISO)
    .slice()
    .sort((a,b)=> (a.date+a.slot).localeCompare(b.date+b.slot));

  // Labels: for day -> slot labels. For week -> date+slot
  const labels = entries.map(e => {
    if(range === "day") return SLOT_LABELS[e.slot] ?? e.slot;
    return `${e.date} • ${(SLOT_LABELS[e.slot] ?? e.slot)}`;
  });
  const values = entries.map(e => e.value);

  const ctx = $("glucoseChart").getContext("2d");

  if(glucoseChart) glucoseChart.destroy();

  const { targetLow, targetHigh } = state.profile;

  glucoseChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "قند خون", data: values, tension: 0.35, borderWidth: 2, pointRadius: 4 },
        { label: "هدف پایین", data: labels.map(()=>targetLow), borderDash: [6,6], borderWidth: 1, pointRadius: 0 },
        { label: "هدف بالا", data: labels.map(()=>targetHigh), borderDash: [6,6], borderWidth: 1, pointRadius: 0 },
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom", rtl: true },
        tooltip: { rtl: true },
      },
      scales: {
        y: { title: { display:true, text:`قند (${state.profile.unit})` } }
      }
    }
  });
}

/* --- KPI / analytics --- */
function computeKPI(range, dateISO){
  const entries = getRangeEntries(range, dateISO);
  if(entries.length === 0){
    return { avg:null, min:null, max:null, tir:null, count:0 };
  }
  const vals = entries.map(e=>Number(e.value)).filter(v=>Number.isFinite(v));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const avg = Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
  const { targetLow, targetHigh } = state.profile;
  const inRangeCount = vals.filter(v=> v>=targetLow && v<=targetHigh).length;
  const tir = Math.round((inRangeCount/vals.length)*100);
  return { avg, min, max, tir, count: vals.length };
}

function renderKPIs(range, dateISO){
  const k = computeKPI(range, dateISO);
  const row = $("kpi-row");
  const cards = [
    { k:"میانگین", v: k.avg ?? "—" },
    { k:"کمینه", v: k.min ?? "—" },
    { k:"بیشینه", v: k.max ?? "—" },
    { k:"Time in Range", v: k.tir != null ? (k.tir + "%") : "—" },
  ];
  row.innerHTML = cards.map(x => `
    <div class="kpi">
      <div class="v">${esc(x.v)}</div>
      <div class="k">${esc(x.k)}</div>
    </div>
  `).join("");
}

function renderSafetyList(range, dateISO){
  const entries = getRangeEntries(range, dateISO).slice().sort((a,b)=> (a.date+a.slot).localeCompare(b.date+b.slot));
  const list = $("safety-list");
  const items = [];
  for(const e of entries){
    const v = Number(e.value);
    if(v < 70) items.push(`🟥 ${e.date} • ${SLOT_LABELS[e.slot]}: ${v} (هیپو)`);
    if(v >= 300) items.push(`🟧 ${e.date} • ${SLOT_LABELS[e.slot]}: ${v} (هایپر شدید)`);
  }
  list.innerHTML = items.length ? items.map(x=>`<li>${esc(x)}</li>`).join("") : "<li>موردی ثبت نشده ✅</li>";
}

function renderMealAnalysis(range, dateISO){
  // For simplicity, analyze only meals in date range, compare linked slot glucose value same date.
  const list = $("meal-analysis");
  const meals = (range === "day")
    ? state.meals.filter(m=>m.date === dateISO)
    : state.meals.filter(m=>{
        // reuse getRangeEntries logic on dates
        const gs = getRangeEntries("week", dateISO);
        const dates = new Set(gs.map(x=>x.date));
        return dates.has(m.date);
      });

  const items = [];
  for(const m of meals){
    if(!m.linkToSlot) continue;
    const g = state.glucose.find(x => x.date === m.date && x.slot === m.linkToSlot);
    const v = g ? Number(g.value) : null;
    const carbs = Number(m.carbs);
    if(v == null){
      items.push(`🍽️ ${m.date} • ${MEAL_LABELS[m.meal]}: ${m.desc} — ${carbs}g (قندِ لینک‌شده ثبت نشده)`);
      continue;
    }
    let badge = "🟩";
    if(v < 70) badge = "🟥";
    else if(v >= 300) badge = "🟧";
    else {
      const { targetLow, targetHigh } = state.profile;
      if(!(v>=targetLow && v<=targetHigh)) badge = "🟨";
    }
    items.push(`${badge} ${m.date} • ${MEAL_LABELS[m.meal]}: ${carbs}g → قند ۲ساعت بعد: ${v}`);
  }
  list.innerHTML = items.length ? items.map(x=>`<li>${esc(x)}</li>`).join("") : "<li>فعلاً تحلیلی وجود ندارد. وعده را به قند ۲ ساعت بعد لینک کن ✅</li>";
}

function renderSummary(range, dateISO){
  const { avg, min, max, tir, count } = computeKPI(range, dateISO);
  const unit = state.profile.unit;
  const s = $("summary");
  if(count === 0){
    s.innerHTML = "برای این بازه داده‌ای ثبت نشده. می‌تونی «دیتای نمونه» رو وارد کنی ✅";
    return;
  }
  s.innerHTML = `
    <div>🔹 تعداد ثبت‌ها: <b>${count}</b></div>
    <div>🔹 میانگین: <b>${avg}</b> ${esc(unit)} | کمینه: <b>${min}</b> | بیشینه: <b>${max}</b></div>
    <div>🔹 Time in Range: <b>${tir}%</b> (هدف: ${state.profile.targetLow} تا ${state.profile.targetHigh})</div>
    <div class="hint">📌 پیشنهاد: اگر یک وعده همیشه باعث افزایش زیاد می‌شود، کربوهیدرات همان وعده را دقیق‌تر ثبت کن و زمان تزریق/فعالیت را نیز یادداشت کن.</div>
  `;
}

/* --- Tables --- */
function renderTables(){
  // glucose
  const tg = document.querySelector("#tbl-glucose tbody");
  const gRows = state.glucose.slice().sort((a,b)=> (b.date+b.slot).localeCompare(a.date+a.slot));
  tg.innerHTML = gRows.map(e => `
    <tr>
      <td>${esc(e.date)}</td>
      <td>${esc(SLOT_LABELS[e.slot] ?? e.slot)}</td>
      <td>${esc(e.value)}</td>
      <td>${esc(e.note || "")}</td>
      <td><button class="action" data-del="glucose" data-id="${esc(e.id)}">حذف</button></td>
    </tr>
  `).join("");

  // insulin
  const ti = document.querySelector("#tbl-insulin tbody");
  const iRows = state.insulin.slice().sort((a,b)=> (b.date+(b.time||"")).localeCompare(a.date+(a.time||"")));
  ti.innerHTML = iRows.map(e => `
    <tr>
      <td>${esc(e.date)}</td>
      <td>${esc(e.kind)}</td>
      <td>${esc(e.name)}</td>
      <td>${esc(e.units)}</td>
      <td>${esc(e.time || "—")}</td>
      <td>${esc(e.mealRef ? MEAL_LABELS[e.mealRef] : "—")}</td>
      <td><button class="action" data-del="insulin" data-id="${esc(e.id)}">حذف</button></td>
    </tr>
  `).join("");

  // meals
  const tm = document.querySelector("#tbl-meal tbody");
  const mRows = state.meals.slice().sort((a,b)=> (b.date+a.meal).localeCompare(a.date+b.meal));
  tm.innerHTML = mRows.map(e => `
    <tr>
      <td>${esc(e.date)}</td>
      <td>${esc(MEAL_LABELS[e.meal] ?? e.meal)}</td>
      <td>${esc(e.desc)}</td>
      <td>${esc(e.carbs)}g</td>
      <td>${esc(e.linkToSlot ? (SLOT_LABELS[e.linkToSlot] ?? e.linkToSlot) : "—")}</td>
      <td><button class="action" data-del="meals" data-id="${esc(e.id)}">حذف</button></td>
    </tr>
  `).join("");

  // delegate delete
  document.querySelectorAll("[data-del]").forEach(btn=>{
    btn.onclick = () => {
      const type = btn.getAttribute("data-del");
      const id = btn.getAttribute("data-id");
      state[type] = state[type].filter(x => x.id !== id);
      saveState(state);
      renderAll();
    };
  });
}

/* --- Reminder (browser notification) --- */
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

  const [hh, mm] = timeHHMM.split(":").map(x=>parseInt(x,10));
  reminderTimer = setInterval(async ()=>{
    const now = new Date();
    if(now.getHours() === hh && now.getMinutes() === mm){
      const ok = await ensureNotificationPermission();
      if(ok){
        new Notification("دیابت‌یار: یادآور Basal 💉", { body: `الان زمان تزریق Basal است (${timeHHMM}).` });
      }else{
        alert(`یادآور Basal: الان زمان تزریق است (${timeHHMM}).`);
      }
      // avoid spamming - wait 61 seconds
      await new Promise(r=>setTimeout(r,61000));
    }
  }, 10000);
}

/* --- Forms wiring --- */
function initForms(){
  // set default dates
  const d = todayISO();
  document.querySelectorAll('input[type="date"]').forEach(x=> x.value = d);
  $("range-date").value = d;

  // profile
  const pf = $("profile-form");
  pf.unit.value = state.profile.unit;
  pf.diabetesType.value = state.profile.diabetesType;
  pf.targetLow.value = state.profile.targetLow;
  pf.targetHigh.value = state.profile.targetHigh;

  pf.onsubmit = (e)=>{
    e.preventDefault();
    state.profile = {
      unit: pf.unit.value,
      diabetesType: pf.diabetesType.value,
      targetLow: Number(pf.targetLow.value),
      targetHigh: Number(pf.targetHigh.value),
    };
    saveState(state);
    renderAll();
    showAlert("ok", "✅ پروفایل ذخیره شد");
  };

  // glucose
  const gf = $("glucose-form");
  gf.onsubmit = (e)=>{
    e.preventDefault();
    const entry = {
      id: crypto.randomUUID(),
      date: gf.date.value || todayISO(),
      slot: gf.slot.value,
      value: Number(gf.value.value),
      note: gf.note.value || ""
    };
    state.glucose.push(entry);
    saveState(state);

    const sm = glucoseSafetyMessage(entry.value);
    if(sm){
      showAlert(sm.kind, `<b>${sm.title}</b><div style="margin-top:6px">${sm.msg}</div>`);
    } else {
      showAlert("ok", "✅ ثبت شد");
    }

    gf.value.value = "";
    gf.note.value = "";
    renderAll();
  };

  // insulin
  const inf = $("insulin-form");
  inf.onsubmit = async (e)=>{
    e.preventDefault();
    const kind = inf.kind.value;
    const reminder = (kind === "Basal") ? !!inf.reminder.checked : false;
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
    state.insulin.push(item);

    if(kind === "Basal" && reminder && item.time){
      const ok = await ensureNotificationPermission();
      state.reminders.basalEnabled = true;
      state.reminders.basalTime = item.time;
      scheduleBasalReminder(item.time);
      if(ok) showAlert("ok", `⏰ یادآور Basal فعال شد برای ساعت ${item.time}`);
      else showAlert("warn", `⏰ یادآور فعال شد (بدون مجوز اعلان). ممکن است با alert نمایش داده شود.`);
    }

    saveState(state);
    inf.reset();
    // restore date to today for convenience
    inf.date.value = todayISO();
    renderAll();
  };

  // meal
  const mf = $("meal-form");
  mf.onsubmit = (e)=>{
    e.preventDefault();
    const item = {
      id: crypto.randomUUID(),
      date: mf.date.value || todayISO(),
      meal: mf.meal.value,
      desc: mf.desc.value.trim(),
      carbs: Number(mf.carbs.value),
      linkToSlot: mf.linkToSlot.value || ""
    };
    state.meals.push(item);
    saveState(state);
    mf.reset();
    mf.date.value = todayISO();
    renderAll();
    showAlert("ok", "✅ وعده ثبت شد");
  };

  // range controls
  $("range-select").onchange = ()=> renderAll();
  $("range-date").onchange = ()=> renderAll();

  // header buttons
  $("btn-seed").onclick = seedData;

  $("btn-reset").onclick = ()=>{
    if(confirm("همه داده‌ها پاک شود؟")){
      localStorage.removeItem(LS_KEY);
      state = loadState();
      renderAll();
      showAlert("ok", "🗑️ ریست انجام شد");
    }
  };

  $("btn-export").onclick = ()=>{
    const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `diabetes_yar_export_${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  $("file-import").onchange = async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    try{
      const text = await file.text();
      const obj = JSON.parse(text);
      // minimal validation
      if(!obj.profile || !Array.isArray(obj.glucose)) throw new Error("فرمت نامعتبر است");
      state = obj;
      saveState(state);
      renderAll();
      showAlert("ok", "⬆️ ورودی انجام شد");
    }catch(err){
      showAlert("danger", "❌ خطا در ورودی: " + esc(err.message || err));
    }finally{
      e.target.value = "";
    }
  };
}

/* --- Render all --- */
function renderAll(){
  const range = $("range-select")?.value || "day";
  const dateISO = $("range-date")?.value || todayISO();

  renderKPIs(range, dateISO);
  buildChart(range, dateISO);
  renderSafetyList(range, dateISO);
  renderMealAnalysis(range, dateISO);
  renderSummary(range, dateISO);
  renderTables();

  // keep profile form synced (after seed/import)
  const pf = $("profile-form");
  if(pf){
    pf.unit.value = state.profile.unit;
    pf.diabetesType.value = state.profile.diabetesType;
    pf.targetLow.value = state.profile.targetLow;
    pf.targetHigh.value = state.profile.targetHigh;
  }
}

window.addEventListener("load", ()=>{
  initForms();
  renderAll();

  // resume reminder if enabled
  if(state.reminders?.basalEnabled && state.reminders?.basalTime){
    scheduleBasalReminder(state.reminders.basalTime);
  }
});
