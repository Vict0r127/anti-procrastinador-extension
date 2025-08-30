// options.js - gerencia lista completa de sites (salva em storage)
const listEl = document.getElementById("optList");
const addBtn = document.getElementById("optAdd");
const newInput = document.getElementById("optNewSite");
const saveAllBtn = document.getElementById("optSaveAll");
const defaultMinutesInput = document.getElementById("optDefaultMinutes");
const applyDefaultBtn = document.getElementById("optApplyDefault");

function sendMessage(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (res) => resolve(res));
  });
}

async function refresh() {
  const res = await sendMessage("BLOCKED_GET");
  if (!res?.ok) return;
  render(res.list || []);
  // load timer default if exists
  const timerRaw = await chrome.storage.local.get("timerState");
  if (timerRaw && timerRaw.timerState && timerRaw.timerState.remainingSec) {
    const mins = Math.max(1, Math.round(timerRaw.timerState.remainingSec / 60));
    defaultMinutesInput.value = mins;
  }
}

function render(list) {
  listEl.innerHTML = "";
  (list||[]).forEach(domain => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.className = "domain";
    span.textContent = domain;
    const btn = document.createElement("button");
    btn.textContent = "Remover";
    btn.className = "btn small ghost";
    btn.addEventListener("click", async () => {
      await sendMessage("BLOCKED_REMOVE", { domain });
      refresh();
    });
    li.appendChild(span);
    li.appendChild(btn);
    listEl.appendChild(li);
  });
}

addBtn.addEventListener("click", async () => {
  const v = newInput.value.trim();
  if (!v) return;
  await sendMessage("BLOCKED_ADD", { domain: v });
  newInput.value = "";
  refresh();
});

saveAllBtn.addEventListener("click", async () => {
  // pega todos os domínios do DOM e salva (opcional)
  const domains = Array.from(listEl.querySelectorAll(".domain")).map(d => d.textContent.trim());
  await sendMessage("BLOCKED_SET", { list: domains });
  alert("Lista salva.");
});

applyDefaultBtn.addEventListener("click", async () => {
  const mins = Number(defaultMinutesInput.value);
  if (!Number.isFinite(mins) || mins < 1) return alert("Minutos inválidos");
  await sendMessage("TIMER_SET_MINUTES", { minutes: mins });
  alert("Duração padrão atualizada.");
});

refresh();
