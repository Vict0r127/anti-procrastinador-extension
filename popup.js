// popup.js - UI do popup, comunica com background.js via sendMessage

const timeEl = document.getElementById("time");
const startBtn = document.getElementById("start");
const pauseBtn = document.getElementById("pause");
const resetBtn = document.getElementById("reset");
const minutesInput = document.getElementById("minutes");
const applyBtn = document.getElementById("apply");

const newSiteInput = document.getElementById("newSite");
const addSiteBtn = document.getElementById("addSite");
const sitesList = document.getElementById("sitesList");
const openOptionsBtn = document.getElementById("openOptions");

let tickInterval = null;

function sendMessage(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (res) => resolve(res));
  });
}

function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

async function refresh() {
  const res = await sendMessage("TIMER_GET_STATE");
  if (!res || !res.ok) return;
  const state = res.state;
  timeEl.textContent = fmt(state.remainingSec);
  if (!state.isRunning) {
    const curMin = Math.max(1, Math.round(state.remainingSec / 60));
    if (Number(minutesInput.value) !== curMin) minutesInput.value = curMin;
  }
  startBtn.disabled = state.isRunning || state.remainingSec === 0;
  pauseBtn.disabled = !state.isRunning;
  resetBtn.disabled = state.isRunning && state.remainingSec > 0 ? false : (state.remainingSec === (25 * 60));
}

function startTicking() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(refresh, 300);
}
function stopTicking() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = null;
}

// Timer buttons
startBtn.addEventListener("click", async () => {
  await sendMessage("TIMER_START");
  refresh();
});
pauseBtn.addEventListener("click", async () => {
  await sendMessage("TIMER_PAUSE");
  refresh();
});
resetBtn.addEventListener("click", async () => {
  await sendMessage("TIMER_RESET");
  refresh();
});
applyBtn.addEventListener("click", async () => {
  const minutes = Number(minutesInput.value);
  if (!Number.isFinite(minutes) || minutes < 1) return alert("Minutos inválidos");
  await sendMessage("TIMER_SET_MINUTES", { minutes });
  refresh();
});

// Sites block UI
async function loadSites() {
  const res = await sendMessage("BLOCKED_GET");
  if (!res?.ok) return;
  renderSites(res.list || []);
}

function renderSites(list) {
  sitesList.innerHTML = "";
  (list || []).forEach(domain => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.className = "domain";
    span.textContent = domain;
    const btn = document.createElement("button");
    btn.textContent = "Remover";
    btn.className = "btn small ghost";
    btn.addEventListener("click", async () => {
      await sendMessage("BLOCKED_REMOVE", { domain });
      loadSites();
    });
    li.appendChild(span);
    li.appendChild(btn);
    sitesList.appendChild(li);
  });
}

addSiteBtn.addEventListener("click", async () => {
  const val = newSiteInput.value.trim();
  if (!val) return;
  const res = await sendMessage("BLOCKED_ADD", { domain: val });
  if (!res?.ok) return alert(res?.error || "Erro ao adicionar");
  newSiteInput.value = "";
  loadSites();
});

openOptionsBtn.addEventListener("click", () => {
  // abre a página de opções
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open(chrome.runtime.getURL("options.html"));
});

// Keep UI in sync with storage changes (so options page changes reflect here)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.blockedSites) {
    loadSites();
  }
});

// init
refresh();
startTicking();
loadSites();
