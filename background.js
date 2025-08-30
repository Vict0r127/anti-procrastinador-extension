// background.js - service worker (Manifest V3)
// Timer (alarms + storage) + regras dinâmicas (declarativeNetRequest)
// Projetado para não lançar erros na inicialização.

// ---------- Constantes ----------
const DEFAULT_MINUTES = 25;
const DEFAULT_DURATION_SEC = DEFAULT_MINUTES * 60;
const TIMER_KEY = "timerState";
const BLOCKED_KEY = "blockedSites";
const ALARM_NAME = "antip_timer_end";

// ---------- Helpers de storage ----------
function getStorage(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (res) => resolve(res[key]));
  });
}
function setStorage(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, () => resolve());
  });
}

// ---------- Timer state helpers ----------
function nowMs() { return Date.now(); }

async function defaultTimerState() {
  return {
    isRunning: false,
    remainingSec: DEFAULT_DURATION_SEC,
    targetTime: null
  };
}

function calcRemainingSec(state) {
  if (!state || !state.isRunning || !state.targetTime) return state?.remainingSec ?? DEFAULT_DURATION_SEC;
  return Math.max(0, Math.round((state.targetTime - nowMs()) / 1000));
}

async function getFreshTimerState() {
  const s = await getStorage(TIMER_KEY);
  let st = s ?? await defaultTimerState();
  if (st.isRunning && st.targetTime) {
    const rem = calcRemainingSec(st);
    if (rem === 0) {
      st.isRunning = false;
      st.remainingSec = 0;
      st.targetTime = null;
      await chrome.alarms.clear(ALARM_NAME);
      await setStorage({ [TIMER_KEY]: st });
    } else {
      // expose fresh remaining without persisting
      st = { ...st, remainingSec: rem };
    }
  }
  return st;
}

async function saveTimerState(state) {
  await setStorage({ [TIMER_KEY]: state });
}

// ---------- Timer control ----------
async function startTimer() {
  const st = await getFreshTimerState();
  if (!st.isRunning && st.remainingSec > 0) {
    const target = nowMs() + st.remainingSec * 1000;
    st.isRunning = true;
    st.targetTime = target;
    // criar alarme exato
    chrome.alarms.create(ALARM_NAME, { when: target });
    await saveTimerState(st);
  }
}

async function pauseTimer() {
  const st = await getFreshTimerState();
  if (st.isRunning) {
    st.remainingSec = calcRemainingSec(st);
    st.isRunning = false;
    st.targetTime = null;
    await chrome.alarms.clear(ALARM_NAME);
    await saveTimerState(st);
  }
}

async function resetTimer() {
  const st = await defaultTimerState();
  await chrome.alarms.clear(ALARM_NAME);
  await saveTimerState(st);
}

async function setTimerMinutes(minutes) {
  const secs = Math.max(1, Math.round(Number(minutes) * 60));
  const st = await getFreshTimerState();
  st.isRunning = false;
  st.remainingSec = secs;
  st.targetTime = null;
  await chrome.alarms.clear(ALARM_NAME);
  await saveTimerState(st);
}

// ---------- Alarme (quando o timer termina) ----------
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  try {
    const st = await getFreshTimerState();
    st.isRunning = false;
    st.remainingSec = 0;
    st.targetTime = null;
    await saveTimerState(st);

    // Notificação
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: "Tempo de foco terminado",
      message: "Ciclo concluído — faça uma pausa e volte mais forte! 💪",
      priority: 2
    });
  } catch (e) {
    console.error("Erro ao processar alarme:", e);
  }
});

// ---------- Sanitização de domínio para regras ----------
function sanitizeDomain(input) {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split(/[\/?#:]/)[0]; // corta path, query, porta
  // simples validação: precisa ter pelo menos um ponto
  if (!s || s.indexOf(".") === -1) return null;
  return s;
}

// ---------- Regras dinâmicas (declarativeNetRequest) ----------
function buildRulesFromList(list) {
  // cria regras do tipo "||dominio^" que é aceito pelo urlFilter
  const rules = [];
  for (let i = 0; i < list.length; i++) {
    const d = sanitizeDomain(list[i]);
    if (!d) continue;
    const id = i + 1; // ids 1..N
    const urlFilter = "||" + d + "^";
    rules.push({
      id,
      priority: 1,
      action: { type: "block" },
      condition: { urlFilter, resourceTypes: ["main_frame"] }
    });
  }
  return rules;
}

function applyRulesFromList(list) {
  // usa a API callback-based de forma segura
  try {
    chrome.declarativeNetRequest.getDynamicRules((currentRules) => {
      const removeIds = (currentRules || []).map(r => r.id);
      const addRules = buildRulesFromList(list).slice(0, 5000); // corta por segurança (limite alto)
      chrome.declarativeNetRequest.updateDynamicRules(
        { removeRuleIds: removeIds, addRules },
        () => {
          if (chrome.runtime.lastError) {
            console.error("Erro updateDynamicRules:", chrome.runtime.lastError.message);
          } else {
            console.log("Regras dinâmicas atualizadas. Count:", addRules.length);
          }
        }
      );
    });
  } catch (err) {
    console.error("applyRulesFromList erro:", err);
  }
}

// ---------- Inicialização / armazenamento padrão ----------
chrome.runtime.onInstalled.addListener(async (details) => {
  // definir defaults se não existir
  const existingBlocked = await getStorage(BLOCKED_KEY);
  if (!Array.isArray(existingBlocked)) {
    // lista inicial — você pode editar essa lista
    const defaults = ["facebook.com", "instagram.com", "tiktok.com", "youtube.com"];
    await setStorage({ [BLOCKED_KEY]: defaults });
    applyRulesFromList(defaults);
  } else {
    applyRulesFromList(existingBlocked);
  }

  const existingTimer = await getStorage(TIMER_KEY);
  if (!existingTimer) {
    await setStorage({ [TIMER_KEY]: await defaultTimerState() });
  }
});

// Também no startup (quando o browser é reiniciado)
chrome.runtime.onStartup.addListener(async () => {
  const list = await getStorage(BLOCKED_KEY) || [];
  applyRulesFromList(list);
});

// Quando mudarem os blockedSites via storage (ex.: popup/options), reaplica regras
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[BLOCKED_KEY]) {
    const newList = changes[BLOCKED_KEY].newValue || [];
    applyRulesFromList(newList);
  }
});

// ---------- Mensagens do popup/options ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        // Timer
        case "TIMER_GET_STATE": {
          const state = await getFreshTimerState();
          sendResponse({ ok: true, state });
          break;
        }
        case "TIMER_START": {
          await startTimer();
          sendResponse({ ok: true });
          break;
        }
        case "TIMER_PAUSE": {
          await pauseTimer();
          sendResponse({ ok: true });
          break;
        }
        case "TIMER_RESET": {
          await resetTimer();
          sendResponse({ ok: true });
          break;
        }
        case "TIMER_SET_MINUTES": {
          await setTimerMinutes(msg.minutes);
          sendResponse({ ok: true });
          break;
        }

        // Blocked sites management
        case "BLOCKED_GET": {
          const list = await getStorage(BLOCKED_KEY) || [];
          sendResponse({ ok: true, list });
          break;
        }
        case "BLOCKED_ADD": {
          const raw = msg.domain;
          const d = sanitizeDomain(raw);
          if (!d) {
            sendResponse({ ok: false, error: "Domínio inválido" });
            break;
          }
          const list = (await getStorage(BLOCKED_KEY)) || [];
          if (!list.includes(d)) {
            list.push(d);
            await setStorage({ [BLOCKED_KEY]: list });
            applyRulesFromList(list);
          }
          sendResponse({ ok: true, list });
          break;
        }
        case "BLOCKED_REMOVE": {
          const raw = msg.domain;
          const d = sanitizeDomain(raw);
          let list = (await getStorage(BLOCKED_KEY)) || [];
          list = list.filter(x => x !== d);
          await setStorage({ [BLOCKED_KEY]: list });
          applyRulesFromList(list);
          sendResponse({ ok: true, list });
          break;
        }
        case "BLOCKED_SET": {
          const userList = Array.isArray(msg.list) ? msg.list.map(sanitizeDomain).filter(Boolean) : [];
          await setStorage({ [BLOCKED_KEY]: userList });
          applyRulesFromList(userList);
          sendResponse({ ok: true, list: userList });
          break;
        }
        default:
          sendResponse({ ok: false, error: "Ação desconhecida" });
      }
    } catch (err) {
      console.error("Erro no onMessage:", err);
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true; // keep channel open for async response
});
