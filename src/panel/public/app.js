const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data.error ? JSON.stringify(data.error) : res.statusText;
    throw new Error(err);
  }
  return data;
}

function setMsg(el, text, kind = "") {
  el.textContent = text || "";
  el.className = `msg ${kind}`.trim();
}

/* LaMetric sound catalog */
let soundCatalog = [];

function soundOptionsHtml(selected = "", includeBlank = false, blankLabel = "— default —") {
  const opts = [];
  if (includeBlank) {
    opts.push(
      `<option value="" ${!selected ? "selected" : ""}>${escapeHtml(blankLabel)}</option>`,
    );
  }
  const groups = [
    { cat: "notifications", label: "Notificaciones" },
    { cat: "alarms", label: "Alarmas" },
  ];
  for (const g of groups) {
    const items = soundCatalog.filter((s) => s.category === g.cat);
    if (!items.length) continue;
    opts.push(`<optgroup label="${escapeHtml(g.label)}">`);
    for (const s of items) {
      opts.push(
        `<option value="${escapeHtml(s.id)}" ${selected === s.id ? "selected" : ""}>${escapeHtml(s.label)}</option>`,
      );
    }
    opts.push("</optgroup>");
  }
  return opts.join("");
}

function fillSoundSelect(sel, selected = "", includeBlank = false, blankLabel) {
  if (!sel) return;
  sel.innerHTML = soundOptionsHtml(selected, includeBlank, blankLabel);
}

function syncSoundWrap(checkEl, wrapEl) {
  if (!checkEl || !wrapEl) return;
  wrapEl.hidden = !checkEl.checked;
}

function syncAutoSoundIdWrap() {
  const mode = $("#autoSoundSelect")?.value || "off";
  const wrap = $("#autoSoundIdWrap");
  if (wrap) wrap.hidden = mode === "off";
}

async function loadSoundCatalog() {
  try {
    const { sounds } = await api("/panel/api/sounds");
    soundCatalog = sounds || [];
  } catch {
    soundCatalog = [{ id: "notification", label: "Notification", category: "notifications" }];
  }
  fillSoundSelect($("#notifySoundSelect"), "notification");
  fillSoundSelect($("#cardSoundSelect"), "notification");
  fillSoundSelect($("#autoSoundIdSelect"), "", true, "— de la card —");
  syncSoundWrap($("#notifySoundCheck"), $("#notifySoundWrap"));
  syncSoundWrap($("#cardSoundCheck"), $("#cardSoundWrap"));
  syncAutoSoundIdWrap();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* Tabs */
$$("#tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$("#tabs button").forEach((b) => b.classList.remove("active"));
    $$(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(`#tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "device") {
      showDeviceHome();
      loadDevices().catch((e) => setMsg($("#deviceMsg"), e.message, "error"));
      startGaugePolling();
      startSensorPolling();
    } else {
      stopGaugePolling();
      stopSensorPolling();
      showDeviceHome();
    }
    if (btn.dataset.tab === "cards") {
      loadCards().catch((e) => setMsg($("#cardMsg"), e.message, "error"));
      loadAutomations().catch((e) => setMsg($("#autoMsg"), e.message, "error"));
    }
    if (btn.dataset.tab === "queue") {
      loadQueueTab().catch((e) => setMsg($("#queueMsg"), e.message, "error"));
      startQueuePolling();
    } else {
      stopQueuePolling();
    }
    if (btn.dataset.tab === "ha") {
      loadHa().catch((e) => setMsg($("#haMsg"), e.message, "error"));
      loadHaDeviceBrowser($("#haDeviceBrowser")).catch(() => {});
    }
    if (btn.dataset.tab === "icons") {
      loadIcons().catch((e) => setMsg($("#iconMsg"), e.message, "error"));
    }
  });
});

async function refreshStatus() {
  const s = await api("/panel/api/status");
  const devices = s.devices || [];
  const clocks = devices.map((d) => `${d.name} (${d.slug})`).join(", ") || "sin relojes";
  const ha = s.ha.configured
    ? `HA ${s.ha.connected ? "conectado" : "idle"}`
    : "HA no configurado";
  $("#statusLine").textContent = `${clocks} · ${ha} · cola ${s.queue} · ${s.apps} apps · ${s.channels} canales`;

  const n = devices.length;
  $("#statDeviceValue").textContent = n ? String(n) : "—";
  $("#statDeviceMeta").textContent = n
    ? devices.map((d) => d.slug).join(", ")
    : "sin configurar";
  $("#statDeviceDot").dataset.state = n ? "on" : "off";

  const haOk = !!s.ha.configured;
  const haLive = !!s.ha.connected;
  $("#statHaValue").textContent = haOk ? (haLive ? "Live" : "Idle") : "—";
  $("#statHaMeta").textContent = haOk
    ? haLive
      ? "conectado"
      : "configurado"
    : "sin configurar";
  $("#statHaDot").dataset.state = haLive ? "on" : haOk ? "warn" : "off";

  $("#statQueueValue").textContent = String(s.queue ?? 0);
  $("#statAppsValue").textContent = `${s.apps ?? 0} · ${s.channels ?? 0}`;
}

let cachedDevices = [];
let gaugePollTimer = null;
let selectedDeviceDetailId = null;

function showDeviceHome() {
  selectedDeviceDetailId = null;
  const home = $("#deviceHomeView");
  const detail = $("#deviceDetailView");
  if (home) home.hidden = false;
  if (detail) detail.hidden = true;
  stopDeviceQueuePolling();
}

function openDeviceDetail(deviceId) {
  const device = cachedDevices.find((d) => d.id === deviceId);
  if (!device) return;
  selectedDeviceDetailId = deviceId;
  $("#deviceHomeView").hidden = true;
  $("#deviceDetailView").hidden = false;
  $("#deviceDetailTitle").textContent = device.name;
  $("#deviceDetailSubtitle").textContent = `${device.slug} · ${device.host}`;
  $("#deviceDetailView .two-col").hidden = false;
  $("#deviceAddSection").hidden = true;
  $("#deviceQueueSection").hidden = false;
  const notifySel = $("#notifyDevice");
  if (notifySel) notifySel.value = deviceId;
  loadDevices().catch((e) => setMsg($("#deviceMsg"), e.message, "error"));
  loadDeviceQueueBoard(deviceId).catch(() => {});
  startDeviceQueuePolling();
}

function openAddDeviceSlot(slotIndex) {
  selectedDeviceDetailId = `add-${slotIndex}`;
  $("#deviceHomeView").hidden = true;
  $("#deviceDetailView").hidden = false;
  $("#deviceDetailTitle").textContent = `Reloj ${slotIndex + 1}`;
  $("#deviceDetailSubtitle").textContent = "Sin configurar — agregá un reloj en este slot";
  $("#deviceDetailView .two-col").hidden = true;
  $("#deviceAddSection").hidden = false;
  $("#deviceQueueSection").hidden = true;
  stopDeviceQueuePolling();
  setMsg($("#deviceMsg"), "", "");
}

$("#deviceDetailBack")?.addEventListener("click", () => {
  showDeviceHome();
  loadDevices().catch((e) => setMsg($("#deviceMsg"), e.message, "error"));
});

const GAUGE_GRADIENTS = [
  { from: "#60a5fa", to: "#a78bfa", glow: "rgba(96, 165, 250, 0.55)" },
  { from: "#a855f7", to: "#ec4899", glow: "rgba(168, 85, 247, 0.55)" },
  { from: "#f472b6", to: "#fb923c", glow: "rgba(244, 114, 182, 0.5)" },
];

const GAUGE_SLOTS = 3;
const GAUGE_RADIUS = 70;
const GAUGE_CIRC = 2 * Math.PI * GAUGE_RADIUS;
const gaugeStatusCache = new Map();

function pointerToBrightness(clientX, clientY, rect) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let angle = Math.atan2(clientY - cy, clientX - cx) + Math.PI / 2;
  if (angle < 0) angle += 2 * Math.PI;
  return Math.round(Math.max(0, Math.min(100, (angle / (2 * Math.PI)) * 100)));
}

function pointerOnRing(clientX, clientY, rect) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dist = Math.hypot(clientX - cx, clientY - cy);
  const r = rect.width / 2;
  return dist >= r * 0.5 && dist <= r * 1.05;
}

function updateGaugeBrightnessUi(deviceId, percent) {
  const p = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const progress = document.querySelector(`[data-gauge-progress="${deviceId}"]`);
  const valueEl = document.querySelector(`[data-gauge-value="${deviceId}"]`);
  const dial = document.querySelector(`[data-gauge-dial="${deviceId}"]`);
  if (progress) {
    progress.setAttribute("stroke-dashoffset", gaugeProgressOffset(p).toFixed(2));
  }
  if (valueEl) valueEl.textContent = String(p);
  if (dial) dial.setAttribute("aria-valuenow", String(p));
  const range = document.querySelector(`[data-bright-range="${deviceId}"]`);
  const label = document.querySelector(`[data-bright-val="${deviceId}"]`);
  if (range) range.value = String(p);
  if (label) label.textContent = String(p);
}

async function commitGaugeBrightness(deviceId, percent) {
  const cached = gaugeStatusCache.get(deviceId);
  const autoBrightness = Boolean(cached?.autoBrightness);
  const r = await api(`/panel/api/devices/${deviceId}/brightness`, {
    method: "PATCH",
    body: JSON.stringify({ brightness: percent, autoBrightness }),
  });
  setMsg($("#deviceMsg"), r.detail, r.ok ? "ok" : "error");
  if (r.ok) {
    gaugeStatusCache.set(deviceId, {
      ...(cached || { ok: true }),
      brightness: percent,
      autoBrightness,
    });
  }
  return r;
}

function gaugeIconSvg(kind) {
  if (kind === "awtrix") {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2"/>
      <circle cx="8" cy="10" r="1" fill="currentColor" stroke="none"/>
      <circle cx="12" cy="10" r="1" fill="currentColor" stroke="none"/>
      <circle cx="16" cy="10" r="1" fill="currentColor" stroke="none"/>
      <circle cx="8" cy="14" r="1" fill="currentColor" stroke="none"/>
      <circle cx="12" cy="14" r="1" fill="currentColor" stroke="none"/>
      <circle cx="16" cy="14" r="1" fill="currentColor" stroke="none"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    <rect x="4" y="3" width="16" height="18" rx="2"/>
    <circle cx="12" cy="12" r="4"/>
    <path d="M12 8V6M12 18v-2M8 12H6M18 12h-2"/>
  </svg>`;
}

function gaugeProgressOffset(percent) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return GAUGE_CIRC * (1 - p / 100);
}

function gaugeStateLabel(status) {
  if (!status?.ok) return { state: "off", text: "Sin conexión" };
  if (status.power === false) return { state: "warn", text: "Apagado" };
  return { state: "on", text: "En línea" };
}

function buildClockGauge(index, device, status) {
  const grad = GAUGE_GRADIENTS[index % GAUGE_GRADIENTS.length];
  const gradId = `gaugeGrad${index}`;
  const article = document.createElement("article");
  article.className = "clock-gauge";
  article.style.setProperty("--gauge-glow", grad.glow);

  if (!device) {
    article.classList.add("clock-gauge--empty");
    article.innerHTML = `
      <p class="clock-gauge-label">Reloj ${index + 1}</p>
      <div class="clock-gauge-ring">
        <svg viewBox="0 0 160 160" aria-hidden="true">
          <circle class="clock-gauge-track" cx="80" cy="80" r="${GAUGE_RADIUS}" />
        </svg>
        <div class="clock-gauge-center">
          <span class="clock-gauge-icon">${gaugeIconSvg("lametric")}</span>
          <span class="clock-gauge-value">—</span>
          <span class="clock-gauge-unit">vacío</span>
        </div>
      </div>
      <p class="clock-gauge-meta">Sin configurar</p>`;
    return article;
  }

  const brightness =
    status?.ok && typeof status.brightness === "number" ? status.brightness : null;
  const { state, text: stateText } = gaugeStateLabel(status);
  const kindLabel = device.kind === "awtrix" ? "Ulanzi" : "LaMetric";
  const autoLabel = status?.autoBrightness ? " · auto" : "";
  const offset = gaugeProgressOffset(brightness ?? 0);

  article.dataset.deviceId = device.id;
  const dialValue = brightness ?? 0;
  article.innerHTML = `
    <p class="clock-gauge-label">${escapeHtml(device.name)}</p>
    <div
      class="clock-gauge-ring clock-gauge-dial"
      data-gauge-dial="${device.id}"
      role="slider"
      aria-label="Brillo ${escapeHtml(device.name)}"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow="${dialValue}"
      tabindex="0"
    >
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <defs>
          <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${grad.from}" />
            <stop offset="100%" stop-color="${grad.to}" />
          </linearGradient>
        </defs>
        <circle class="clock-gauge-track" cx="80" cy="80" r="${GAUGE_RADIUS}" />
        <circle
          class="clock-gauge-progress"
          cx="80" cy="80" r="${GAUGE_RADIUS}"
          stroke="url(#${gradId})"
          stroke-dasharray="${GAUGE_CIRC.toFixed(2)}"
          stroke-dashoffset="${offset.toFixed(2)}"
          data-gauge-progress="${device.id}"
        />
      </svg>
      <div class="clock-gauge-center">
        <span class="clock-gauge-icon">${gaugeIconSvg(device.kind)}</span>
        <span class="clock-gauge-value" data-gauge-value="${device.id}">${brightness ?? "—"}</span>
        <span class="clock-gauge-unit">brillo</span>
      </div>
      <span class="clock-gauge-dial-hint">arrastrá</span>
    </div>
    <p class="clock-gauge-meta" data-gauge-meta="${device.id}">
      <span class="clock-gauge-status">
        <span class="clock-gauge-dot" data-state="${state}"></span>
        <strong>${escapeHtml(stateText)}</strong>
      </span>
      · ${escapeHtml(kindLabel)}${autoLabel}
      <br /><span class="meta">${escapeHtml(device.slug)} · ${escapeHtml(device.host)}${device.macAddress ? ` · ${escapeHtml(device.macAddress)}` : ""}</span>
    </p>`;
  return article;
}

const SENSOR_GRADIENTS = [
  { from: "#34d399", to: "#22d3ee", glow: "rgba(52, 211, 153, 0.5)" },
  { from: "#fbbf24", to: "#f97316", glow: "rgba(251, 191, 36, 0.5)" },
  { from: "#a78bfa", to: "#ec4899", glow: "rgba(167, 139, 250, 0.5)" },
  { from: "#60a5fa", to: "#818cf8", glow: "rgba(96, 165, 250, 0.5)" },
];

function sensorDomainIcon(domain) {
  const d = domain || "sensor";
  if (d === "binary_sensor") {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`;
  }
  if (d === "climate") {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v13"/><path d="M8 16a4 4 0 108 0"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v2"/><path d="M6 8a6 6 0 1012 0 6 6 0 00-12 0z"/></svg>`;
}

function formatSensorDisplay(card) {
  const state = card.state;
  if (state == null || state === "unavailable" || state === "unknown") {
    return { value: "—", unit: "", state: "off", progress: 0 };
  }
  const domain = card.domain || card.entityId?.split(".")[0] || "sensor";
  if (domain === "binary_sensor") {
    const on = ["on", "true", "open", "detected", "home", "wet", "occupied"].includes(
      String(state).toLowerCase(),
    );
    return { value: on ? "ON" : "OFF", unit: "", state: on ? "on" : "off", progress: on ? 100 : 8 };
  }
  const num = Number(String(state).replace(",", "."));
  if (Number.isFinite(num)) {
    let progress = 40;
    if (card.unit === "%") progress = Math.max(0, Math.min(100, num));
    else if (num >= 0 && num <= 100) progress = num;
    const value = Number.isInteger(num) ? String(num) : String(Math.round(num * 10) / 10);
    return { value, unit: card.unit || "", state: "on", progress };
  }
  const text = String(state);
  const value = text.length > 7 ? `${text.slice(0, 6)}…` : text;
  return { value, unit: "", state: "on", progress: 55 };
}

function buildSensorGauge(card, index) {
  const grad = SENSOR_GRADIENTS[index % SENSOR_GRADIENTS.length];
  const gradId = `sensorGrad${index}`;
  const display = formatSensorDisplay(card);
  const offset = gaugeProgressOffset(display.progress);
  const article = document.createElement("article");
  article.className = "sensor-gauge clock-gauge clock-gauge--clickable";
  article.dataset.sensorId = card.id;
  article.style.setProperty("--gauge-glow", grad.glow);

  article.innerHTML = `
    <p class="clock-gauge-label">${escapeHtml(card.title)}</p>
    <div class="clock-gauge-ring">
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <defs>
          <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${grad.from}" />
            <stop offset="100%" stop-color="${grad.to}" />
          </linearGradient>
        </defs>
        <circle class="clock-gauge-track" cx="80" cy="80" r="${GAUGE_RADIUS}" />
        <circle
          class="clock-gauge-progress"
          cx="80" cy="80" r="${GAUGE_RADIUS}"
          stroke="url(#${gradId})"
          stroke-dasharray="${GAUGE_CIRC.toFixed(2)}"
          stroke-dashoffset="${offset.toFixed(2)}"
          data-sensor-progress="${card.id}"
        />
      </svg>
      <div class="clock-gauge-center">
        <span class="clock-gauge-icon sensor-gauge-icon">${sensorDomainIcon(card.domain)}</span>
        <span class="clock-gauge-value sensor-gauge-value" data-sensor-value="${card.id}">${escapeHtml(display.value)}</span>
        <span class="clock-gauge-unit">${escapeHtml(display.unit || card.domain || "sensor")}</span>
      </div>
    </div>
    <p class="clock-gauge-meta sensor-gauge-meta">
      <span class="clock-gauge-status">
        <span class="clock-gauge-dot" data-state="${display.state}" data-sensor-dot="${card.id}"></span>
        <strong data-sensor-state-label="${card.id}">${escapeHtml(card.friendlyName || card.entityId)}</strong>
      </span>
      <br /><span class="sensor-gauge-desc">${escapeHtml(card.description || "Sin explicación")}</span>
      ${card.alertSummary ? `<br /><span class="sensor-gauge-alert">${escapeHtml(card.alertSummary)}</span>` : ""}
      <br /><span class="meta">${escapeHtml(card.entityId)}</span>
    </p>`;
  return article;
}

function buildEmptySensorGauge() {
  const article = document.createElement("article");
  article.className = "sensor-gauge clock-gauge clock-gauge--empty clock-gauge--clickable";
  article.dataset.addSensor = "1";
  article.innerHTML = `
    <p class="clock-gauge-label">Sensor</p>
    <div class="clock-gauge-ring">
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <circle class="clock-gauge-track" cx="80" cy="80" r="${GAUGE_RADIUS}" />
      </svg>
      <div class="clock-gauge-center">
        <span class="clock-gauge-icon sensor-gauge-icon">+</span>
        <span class="clock-gauge-value">—</span>
        <span class="clock-gauge-unit">agregar</span>
      </div>
    </div>
    <p class="clock-gauge-meta">Elegí un sensor de HA y agregá una explicación</p>`;
  return article;
}

function updateSensorGaugeCard(card) {
  const display = formatSensorDisplay(card);
  const valueEl = document.querySelector(`[data-sensor-value="${card.id}"]`);
  const progress = document.querySelector(`[data-sensor-progress="${card.id}"]`);
  const dot = document.querySelector(`[data-sensor-dot="${card.id}"]`);
  if (valueEl) valueEl.textContent = display.value;
  if (progress) {
    progress.setAttribute("stroke-dashoffset", gaugeProgressOffset(display.progress).toFixed(2));
  }
  if (dot) dot.setAttribute("data-state", display.state);
}

let sensorPollTimer = null;

async function refreshSensorGauges() {
  const container = $("#sensorGauges");
  if (!container) return;
  try {
    const { cards } = await api("/panel/api/sensor-cards/live");
    container.innerHTML = "";
    if (!cards?.length) {
      container.appendChild(buildEmptySensorGauge());
    } else {
      cards.forEach((card, i) => container.appendChild(buildSensorGauge(card, i)));
      container.appendChild(buildEmptySensorGauge());
    }
    bindSensorGaugeClicks(container);
  } catch {
    container.innerHTML = `<p class="meta">Home Assistant no configurado o sin sensores en inicio.</p>`;
    container.appendChild(buildEmptySensorGauge());
    bindSensorGaugeClicks(container);
  }
}

function bindSensorGaugeClicks(container) {
  container.querySelectorAll("[data-sensor-id]").forEach((el) => {
    el.addEventListener("click", async () => {
      const id = el.dataset.sensorId;
      try {
        const { cards } = await api("/panel/api/sensor-cards/live");
        const card = (cards || []).find((c) => c.id === id);
        if (card) openSensorCardEditor(card);
      } catch (err) {
        setMsg($("#sensorCardMsg"), err.message, "error");
      }
    });
  });
  container.querySelectorAll("[data-add-sensor]").forEach((el) => {
    el.addEventListener("click", () => openSensorCardEditor());
  });
}

function startSensorPolling() {
  stopSensorPolling();
  sensorPollTimer = setInterval(() => {
    if (!$("#tab-device")?.classList.contains("active")) return;
    api("/panel/api/sensor-cards/live")
      .then(({ cards }) => {
        for (const card of cards || []) updateSensorGaugeCard(card);
      })
      .catch(() => {});
  }, 15000);
}

function stopSensorPolling() {
  if (sensorPollTimer) {
    clearInterval(sensorPollTimer);
    sensorPollTimer = null;
  }
}

function hideSensorCardEditor() {
  const editor = $("#sensorCardEditor");
  if (editor) editor.hidden = true;
  setMsg($("#sensorCardMsg"), "", "");
}

function syncSensorCardAlertFields() {
  const on = $("#sensorCardAlertEnabled")?.checked;
  const fields = $("#sensorCardAlertFields");
  if (fields) fields.hidden = !on;
  if (on) updateSensorNotifyPreview();
}

let sensorEditorLive = {
  state: null,
  unit: null,
  friendlyName: null,
  entityId: null,
};

function renderClientTemplate(template, vars) {
  return String(template || "").replace(
    /\{\{\s*(\w+)(?:\s*\|\s*(\w+)(?::(\d+))?)?\s*\}\}/g,
    (_m, key, filter, arg) => {
      const raw = vars[key] ?? "";
      if (!filter) return raw;
      const num = Number(String(raw).trim().replace(",", "."));
      if (!Number.isFinite(num)) return raw;
      if (filter === "int") return String(Math.trunc(num));
      if (filter === "round" || filter === "fixed") {
        const places = arg !== undefined ? Math.max(0, Math.min(8, Number(arg) || 2)) : 2;
        if (filter === "fixed") return num.toFixed(places);
        const factor = 10 ** places;
        return String(Math.round(num * factor) / factor);
      }
      return raw;
    },
  );
}

function sensorNotifyPreviewVars() {
  const title = $("#sensorCardTitle")?.value?.trim() || "Sensor";
  const entityId = $("#sensorCardEntityId")?.value?.trim() || "";
  return {
    title,
    name: sensorEditorLive.friendlyName || title,
    state: sensorEditorLive.state ?? "—",
    unit: sensorEditorLive.unit ?? "",
    entity_id: entityId || sensorEditorLive.entityId || "",
  };
}

function updateSensorNotifyPreview() {
  const textEl = $("#sensorNotifyPreviewText");
  const metaEl = $("#sensorNotifyPreviewMeta");
  const face = document.querySelector(".sensor-clock-face");
  if (!textEl) return;
  const template =
    $("#sensorCardAlertTemplate")?.value?.trim() ||
    "{{ name }}: {{ state }}{{ unit }}";
  const rendered = renderClientTemplate(template, sensorNotifyPreviewVars()).trim() || "—";
  textEl.textContent = rendered;
  const priority = $("#sensorCardPriority")?.value || "warning";
  if (face) face.setAttribute("data-priority", priority);
  if (metaEl) {
    const st = sensorEditorLive.state;
    metaEl.textContent =
      st != null && st !== ""
        ? `Estado HA: ${st}${sensorEditorLive.unit ? ` ${sensorEditorLive.unit}` : ""}`
        : "Sin estado HA todavía — la vista usa placeholders";
  }
}

async function refreshSensorEditorLiveState(entityId) {
  const id = (entityId || $("#sensorCardEntityId")?.value || "").trim();
  sensorEditorLive = { state: null, unit: null, friendlyName: null, entityId: id || null };
  if (!id) {
    updateSensorNotifyPreview();
    return;
  }
  try {
    const { states } = await api(
      `/panel/api/ha/states?q=${encodeURIComponent(id)}`,
    );
    const exact = (states || []).find((s) => s.entity_id === id) || states?.[0];
    if (exact) {
      sensorEditorLive = {
        state: exact.state ?? null,
        unit: exact.unit ?? exact.attributes?.unit_of_measurement ?? null,
        friendlyName: exact.friendly_name || null,
        entityId: exact.entity_id || id,
      };
    }
  } catch {
    /* preview still works with placeholders */
  }
  updateSensorNotifyPreview();
}

function openSensorCardEditor(card, entityPrefill) {
  const editor = $("#sensorCardEditor");
  if (!editor) return;
  editor.hidden = false;
  $("#sensorCardEditorTitle").textContent = card ? "Editar sensor" : "Agregar sensor";
  $("#sensorCardId").value = card?.id || "";
  $("#sensorCardEntityId").value = card?.entityId || entityPrefill?.entity_id || "";
  $("#sensorCardTitle").value = card?.title || entityPrefill?.name || "";
  $("#sensorCardDescription").value = card?.description || "";
  $("#sensorCardEnabled").checked = card?.enabled !== false;
  $("#sensorCardAlertEnabled").checked = Boolean(card?.alertEnabled);
  $("#sensorCardWhenGt").value = card?.whenGt ?? "";
  $("#sensorCardWhenLt").value = card?.whenLt ?? "";
  $("#sensorCardIntervalMin").value =
    card?.intervalSec != null ? String(Math.max(1, Math.round(card.intervalSec / 60))) : "";
  $("#sensorCardMinDelta").value = card?.minDelta ?? "";
  $("#sensorCardPriority").value = card?.priority || "warning";
  $("#sensorCardSound").checked = Boolean(card?.sound);
  $("#sensorCardAlertTemplate").value =
    card?.alertTemplate || "{{ name }}: {{ state }}{{ unit }}";
  $("#sensorCardDelete").hidden = !card?.id;

  sensorEditorLive = {
    state: card?.state ?? entityPrefill?.state ?? null,
    unit: card?.unit ?? entityPrefill?.unit ?? null,
    friendlyName: card?.friendlyName ?? entityPrefill?.name ?? null,
    entityId: card?.entityId || entityPrefill?.entity_id || null,
  };

  const targets = $("#sensorCardTargets");
  if (targets) {
    const ent = {
      id: card?.id || "new-sensor",
      device_id: card?.deviceId || null,
      device_ids: card?.deviceIds || null,
    };
    targets.innerHTML = buildQueueTargetPicker(ent, "sensor-card");
    bindQueueTargetPickers(targets);
  }

  syncSensorCardAlertFields();
  updateSensorNotifyPreview();
  refreshSensorEditorLiveState($("#sensorCardEntityId")?.value).catch(() => {});
  setMsg($("#sensorCardMsg"), "", "");
  editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function updateGaugeStatus(deviceId, status) {
  gaugeStatusCache.set(deviceId, status || { ok: false });
  const progress = document.querySelector(`[data-gauge-progress="${deviceId}"]`);
  const valueEl = document.querySelector(`[data-gauge-value="${deviceId}"]`);
  const metaEl = document.querySelector(`[data-gauge-meta="${deviceId}"]`);
  const dial = document.querySelector(`[data-gauge-dial="${deviceId}"]`);
  if (!progress && !valueEl) return;

  const device = cachedDevices.find((d) => d.id === deviceId);
  if (!device) return;

  const brightness =
    status?.ok && typeof status.brightness === "number" ? status.brightness : null;
  const { state, text: stateText } = gaugeStateLabel(status);
  const kindLabel = device.kind === "awtrix" ? "Ulanzi" : "LaMetric";
  const autoLabel = status?.autoBrightness ? " · auto" : "";

  if (brightness != null && !dial?.classList.contains("clock-gauge-dial--active")) {
    updateGaugeBrightnessUi(deviceId, brightness);
  } else if (brightness == null && valueEl) {
    valueEl.textContent = "—";
  }
  if (dial && brightness != null) dial.setAttribute("aria-valuenow", String(brightness));
  if (metaEl) {
    metaEl.innerHTML = `
      <span class="clock-gauge-status">
        <span class="clock-gauge-dot" data-state="${state}"></span>
        <strong>${escapeHtml(stateText)}</strong>
      </span>
      · ${escapeHtml(kindLabel)}${autoLabel}
      <br /><span class="meta">${escapeHtml(device.slug)} · ${escapeHtml(device.host)}${device.macAddress ? ` · ${escapeHtml(device.macAddress)}` : ""}</span>`;
  }
}


function bindGaugeDials(container) {
  container.querySelectorAll("[data-gauge-dial]").forEach((dial) => {
    const deviceId = dial.dataset.gaugeDial;
    let dragging = false;
    let moved = false;
    let lastPercent = null;

    const setFromPointer = (clientX, clientY) => {
      const rect = dial.getBoundingClientRect();
      if (!pointerOnRing(clientX, clientY, rect)) return null;
      const percent = pointerToBrightness(clientX, clientY, rect);
      lastPercent = percent;
      updateGaugeBrightnessUi(deviceId, percent);
      return percent;
    };

    const finishDrag = async () => {
      dial.classList.remove("clock-gauge-dial--active");
      if (dragging && moved) {
        dial.closest(".clock-gauge")?.setAttribute("data-gauge-dragged", "1");
      }
      if (dragging && lastPercent != null) {
        try {
          await commitGaugeBrightness(deviceId, lastPercent);
        } catch (err) {
          setMsg($("#deviceMsg"), err.message, "error");
        }
      }
      dragging = false;
      moved = false;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };

    const onPointerMove = (e) => {
      if (!dragging) return;
      if (setFromPointer(e.clientX, e.clientY) != null) moved = true;
    };

    const onPointerUp = () => {
      void finishDrag();
    };

    dial.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = dial.getBoundingClientRect();
      if (!pointerOnRing(e.clientX, e.clientY, rect)) return;
      dragging = true;
      moved = false;
      dial.classList.add("clock-gauge-dial--active");
      dial.setPointerCapture(e.pointerId);
      if (setFromPointer(e.clientX, e.clientY) != null) moved = true;
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    });

    dial.addEventListener("click", (e) => e.stopPropagation());

    dial.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      e.stopPropagation();
      const current = Number(dial.getAttribute("aria-valuenow") || 0);
      const step = e.shiftKey ? 10 : 1;
      const next =
        e.key === "ArrowUp"
          ? Math.min(100, current + step)
          : Math.max(0, current - step);
      updateGaugeBrightnessUi(deviceId, next);
      commitGaugeBrightness(deviceId, next).catch((err) => {
        setMsg($("#deviceMsg"), err.message, "error");
      });
    });
  });
}

function bindGaugeClicks(container) {
  container.querySelectorAll(".clock-gauge").forEach((gauge, index) => {
    if (!gauge.dataset.deviceId && !gauge.classList.contains("clock-gauge--empty")) return;
    gauge.classList.add("clock-gauge--clickable");
    if (gauge.dataset.deviceId) {
      gauge.setAttribute("role", "button");
      gauge.setAttribute("tabindex", "0");
    }
    const open = () => {
      if (gauge.dataset.gaugeDragged === "1") {
        gauge.removeAttribute("data-gauge-dragged");
        return;
      }
      const deviceId = gauge.dataset.deviceId;
      if (deviceId) openDeviceDetail(deviceId);
      else openAddDeviceSlot(index);
    };
    gauge.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      if (e.target.closest(".clock-gauge-dial")) return;
      open();
    });
    gauge.addEventListener("keydown", (e) => {
      if (e.target.closest(".clock-gauge-dial")) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
}

async function refreshClockGauges() {
  const container = $("#clockGauges");
  if (!container) return;

  container.innerHTML = "";
  for (let i = 0; i < GAUGE_SLOTS; i++) {
    const device = cachedDevices[i] || null;
    let status = null;
    if (device) {
      try {
        status = await api(`/panel/api/devices/${device.id}/status`);
        gaugeStatusCache.set(device.id, status);
      } catch {
        status = { ok: false };
        gaugeStatusCache.set(device.id, status);
      }
    }
    container.appendChild(buildClockGauge(i, device, status));
  }
  bindGaugeDials(container);
  bindGaugeClicks(container);
}

function startGaugePolling() {
  stopGaugePolling();
  gaugePollTimer = setInterval(() => {
    if (!$("#tab-device")?.classList.contains("active")) return;
    for (const d of cachedDevices.slice(0, GAUGE_SLOTS)) {
      api(`/panel/api/devices/${d.id}/status`)
        .then((status) => updateGaugeStatus(d.id, status))
        .catch(() => updateGaugeStatus(d.id, { ok: false }));
    }
  }, 15000);
}

function stopGaugePolling() {
  if (gaugePollTimer) {
    clearInterval(gaugePollTimer);
    gaugePollTimer = null;
  }
}

function deviceOptions(selected = "", includeAll = true) {
  const all = includeAll ? `<option value="" ${selected === "" ? "selected" : ""}>Todos</option>` : "";
  return all + cachedDevices.map((d) =>
    `<option value="${escapeHtml(d.id)}" ${selected === d.id || selected === d.slug ? "selected" : ""}>${escapeHtml(d.name)} (${escapeHtml(d.slug)})</option>`
  ).join("");
}

function fillDeviceSelects() {
  $$("#notifyDevice, #haDeviceSelect, #cardDeviceSelect, #autoDeviceSelect").forEach((sel) => {
    const current = sel.value;
    sel.innerHTML = deviceOptions(current, true);
  });
}

async function loadDevices() {
  const { devices } = await api("/panel/api/devices");
  cachedDevices = devices || [];
  fillDeviceSelects();
  await refreshClockGauges();
  await refreshSensorGauges();

  if (!selectedDeviceDetailId) return;

  const list = $("#deviceList");
  if (!list) return;
  list.innerHTML = "";

  const showDevices = selectedDeviceDetailId.startsWith("add-")
    ? []
    : cachedDevices.filter((d) => d.id === selectedDeviceDetailId);

  if (!showDevices.length) {
    if (selectedDeviceDetailId.startsWith("add-")) return;
    const li = document.createElement("li");
    li.innerHTML = `<div class="meta">Reloj no encontrado.</div>`;
    list.appendChild(li);
    return;
  }

  for (const d of showDevices) {
    const li = document.createElement("li");
    const kindLabel = d.kind === "awtrix" ? "Ulanzi / AWTRIX" : "LaMetric";
    const env = d.envManaged ? `<span class="badge">env</span>` : "";
    const macLine = d.macAddress
      ? `<div class="meta">MAC <code>${escapeHtml(d.macAddress)}</code></div>`
      : "";
    li.innerHTML = `
      <div class="device-card-top">
        <div>
          <strong>${escapeHtml(d.name)}</strong> ${env}
          <div class="meta">${escapeHtml(kindLabel)} · slug <code>${escapeHtml(d.slug)}</code> · ${escapeHtml(d.host)}</div>
          ${macLine}
        </div>
        <div class="device-actions">
          <button type="button" class="secondary" data-resolve="${d.id}" ${d.macAddress ? "" : "disabled"}>Resolver MAC</button>
          <button type="button" class="secondary" data-test="${d.id}">Probar</button>
          <button type="button" data-identify="${d.id}">Identificar</button>
          ${d.envManaged ? "" : `<button type="button" class="danger" data-del-dev="${d.id}">Borrar</button>`}
        </div>
      </div>
      <form class="device-mac" data-mac-form="${d.id}">
        <label>MAC
          <input name="macAddress" value="${escapeHtml(d.macAddress || "")}" placeholder="aa:bb:cc:dd:ee:ff" />
        </label>
        <button type="submit" class="secondary">Guardar MAC</button>
      </form>
      <form class="brightness" data-bright="${d.id}">
        <label>Brillo <span data-bright-val="${d.id}">—</span>%
          <input type="range" min="0" max="100" value="50" data-bright-range="${d.id}" />
        </label>
        <label class="check">
          <input type="checkbox" data-bright-auto="${d.id}" />
          Automático
        </label>
        <button type="submit">Aplicar brillo</button>
      </form>
      <form class="device-notify-prefs" data-notify-form="${d.id}">
        <div class="row">
          <label>Sonido
            <select name="notifySoundMode" data-notify-mode="${d.id}">
              <option value="inherit" ${d.notifySoundMode === "inherit" ? "selected" : ""}>Según la notificación</option>
              <option value="on" ${d.notifySoundMode === "on" ? "selected" : ""}>Siempre con sonido</option>
              <option value="off" ${d.notifySoundMode === "off" ? "selected" : ""}>Siempre silencioso</option>
            </select>
          </label>
          <label data-notify-sound-wrap="${d.id}" ${d.notifySoundMode === "on" ? "" : "hidden"}>
            Tono
            <select name="notifySoundId" data-notify-sound="${d.id}"></select>
          </label>
        </div>
        ${d.kind === "awtrix" ? `<p class="meta">Ulanzi: beep genérico al activar sonido.</p>` : ""}
        <button type="submit" class="secondary">Guardar notificaciones</button>
      </form>`;
    list.appendChild(li);
    loadDeviceStatus(d.id).catch(() => {});
    const soundSel = li.querySelector(`[data-notify-sound="${d.id}"]`);
    if (soundSel) {
      fillSoundSelect(soundSel, d.notifySoundId || "notification");
    }
  }

  list.querySelectorAll("[data-notify-mode]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const wrap = list.querySelector(`[data-notify-sound-wrap="${sel.dataset.notifyMode}"]`);
      if (wrap) wrap.hidden = sel.value !== "on";
    });
  });

  list.querySelectorAll("form.device-notify-prefs").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = form.dataset.notifyForm;
      const mode = form.querySelector(`[data-notify-mode="${id}"]`)?.value || "inherit";
      const soundId = form.querySelector(`[data-notify-sound="${id}"]`)?.value || null;
      try {
        await api(`/panel/api/devices/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            notifySoundMode: mode,
            notifySoundId: mode === "on" ? soundId : null,
          }),
        });
        setMsg($("#deviceMsg"), "Preferencias de notificación guardadas", "ok");
        await loadDevices();
      } catch (err) {
        setMsg($("#deviceMsg"), err.message, "error");
      }
    });
  });

  list.querySelectorAll("[data-resolve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const r = await api(`/panel/api/devices/${btn.dataset.resolve}/resolve`, {
          method: "POST",
          body: "{}",
        });
        setMsg($("#deviceMsg"), r.detail, r.ok ? "ok" : "error");
        if (r.ok) {
          await loadDevices();
          refreshStatus();
        }
      } catch (err) {
        setMsg($("#deviceMsg"), err.message, "error");
      }
    });
  });

  list.querySelectorAll("form.device-mac").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = form.dataset.macForm;
      const mac = new FormData(form).get("macAddress");
      try {
        await api(`/panel/api/devices/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ macAddress: String(mac || "").trim() || null }),
        });
        setMsg($("#deviceMsg"), "MAC guardada", "ok");
        await loadDevices();
      } catch (err) {
        setMsg($("#deviceMsg"), err.message, "error");
      }
    });
  });

  list.querySelectorAll("[data-test]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const r = await api(`/panel/api/devices/${btn.dataset.test}/test`, { method: "POST", body: "{}" });
        setMsg($("#deviceMsg"), r.detail, r.ok ? "ok" : "error");
      } catch (err) {
        setMsg($("#deviceMsg"), err.message, "error");
      }
    });
  });

  list.querySelectorAll("[data-identify]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const r = await api(`/panel/api/devices/${btn.dataset.identify}/identify`, { method: "POST", body: "{}" });
        setMsg($("#deviceMsg"), r.detail, r.ok ? "ok" : "error");
      } catch (err) {
        setMsg($("#deviceMsg"), err.message, "error");
      }
    });
  });

  list.querySelectorAll("[data-del-dev]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/panel/api/devices/${btn.dataset.delDev}`, { method: "DELETE" });
        setMsg($("#deviceMsg"), "Eliminado", "ok");
        await loadDevices();
        refreshStatus();
      } catch (err) {
        setMsg($("#deviceMsg"), err.message, "error");
      }
    });
  });

  list.querySelectorAll("form.brightness").forEach((form) => {
    const id = form.dataset.bright;
    const range = form.querySelector(`[data-bright-range="${id}"]`);
    const label = form.querySelector(`[data-bright-val="${id}"]`);
    range.addEventListener("input", () => {
      label.textContent = range.value;
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const r = await api(`/panel/api/devices/${id}/brightness`, {
          method: "PATCH",
          body: JSON.stringify({
            brightness: Number(range.value),
            autoBrightness: form.querySelector(`[data-bright-auto="${id}"]`).checked,
          }),
        });
        setMsg($("#deviceMsg"), r.detail, r.ok ? "ok" : "error");
        loadDeviceStatus(id).catch(() => {});
      } catch (err) {
        setMsg($("#deviceMsg"), err.message, "error");
      }
    });
  });
}

async function loadDeviceStatus(id) {
  const r = await api(`/panel/api/devices/${id}/status`);
  updateGaugeStatus(id, r);
  if (!r.ok) return;
  const range = document.querySelector(`[data-bright-range="${id}"]`);
  const label = document.querySelector(`[data-bright-val="${id}"]`);
  const auto = document.querySelector(`[data-bright-auto="${id}"]`);
  if (typeof r.brightness === "number" && range) {
    range.value = String(r.brightness);
    if (label) label.textContent = String(r.brightness);
  }
  if (auto) auto.checked = Boolean(r.autoBrightness);
}

$("#deviceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("/panel/api/devices", {
      method: "POST",
      body: JSON.stringify({
        name: fd.get("name"),
        slug: String(fd.get("slug") || "").trim().toLowerCase(),
        kind: fd.get("kind"),
        host: fd.get("host"),
        macAddress: fd.get("macAddress") || undefined,
        apiKey: fd.get("apiKey") || undefined,
      }),
    });
    e.target.reset();
    setMsg($("#deviceMsg"), "Reloj agregado", "ok");
    showDeviceHome();
    await loadDevices();
    refreshStatus();
  } catch (err) {
    setMsg($("#deviceMsg"), err.message, "error");
  }
});

$("#refreshDeviceHosts")?.addEventListener("click", async () => {
  try {
    const r = await api("/panel/api/devices/refresh-hosts", { method: "POST", body: "{}" });
    const lines = (r.devices || [])
      .filter((d) => d.resolved)
      .map((d) => `${d.slug} → ${d.host}`)
      .join(", ");
    setMsg($("#deviceMsg"), lines || "Sin cambios (revisá que tengan MAC)", lines ? "ok" : "");
    await loadDevices();
    refreshStatus();
  } catch (err) {
    setMsg($("#deviceMsg"), err.message, "error");
  }
});

async function sendNotify(payload) {
  const r = await api("/panel/api/notify", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  setMsg($("#notifyMsg"), r.detail, r.ok ? "ok" : "error");
  return r;
}

$("#notifyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const soundOn = fd.get("sound") === "on";
  try {
    await sendNotify({
      text: String(fd.get("text") || "").trim(),
      icon: String(fd.get("icon") || "").trim() || undefined,
      priority: fd.get("priority") || "info",
      sound: soundOn ? String(fd.get("soundId") || "notification") : false,
      device: fd.get("device") || undefined,
    });
  } catch (err) {
    setMsg($("#notifyMsg"), err.message, "error");
  }
});

$("#notifySoundCheck")?.addEventListener("change", () => {
  syncSoundWrap($("#notifySoundCheck"), $("#notifySoundWrap"));
});

$("#notifyTest").addEventListener("click", async () => {
  try {
    const soundOn = $("#notifySoundCheck")?.checked;
    await sendNotify({
      text: "Prueba lametric-bridge",
      priority: "info",
      sound: soundOn
        ? String($("#notifySoundSelect")?.value || "notification")
        : true,
      device: $("#notifyDevice").value || undefined,
    });
  } catch (err) {
    setMsg($("#notifyMsg"), err.message, "error");
  }
});

/* Alert cards */
let cachedCards = [];

function priorityBadge(priority) {
  if (priority === "critical") return `<span class="badge badge-critical">critical</span>`;
  if (priority === "warning") return `<span class="badge badge-warning">warning</span>`;
  return "";
}

async function loadCards() {
  if (!cachedDevices.length) {
    await loadDevices();
  }
  fillDeviceSelects();
  const { cards } = await api("/panel/api/cards");
  cachedCards = cards || [];
  fillCardSelect();
  const grid = $("#alertCardGrid");
  grid.innerHTML = "";
  if (!cachedCards.length) {
    grid.innerHTML = `<p class="meta">No hay cards. Creá una a la derecha.</p>`;
    return;
  }

  for (const c of cachedCards) {
    const tile = document.createElement("article");
    tile.className = "alert-tile";
    const preset = c.isPreset ? `<span class="badge badge-preset">preset</span>` : "";
    const soundLabel = c.sound
      ? ` · ${escapeHtml(c.soundId || "notification")}`
      : " · mudo";
    tile.innerHTML = `
      <header>
        <p class="tile-name">${escapeHtml(c.name)}</p>
        <div>${preset}${priorityBadge(c.priority)}${c.sound ? "" : `<span class="badge">mudo</span>`}</div>
      </header>
      <p class="tile-text">${escapeHtml(c.text)}</p>
      <div class="tile-meta">${escapeHtml(c.slug)} · ${escapeHtml(c.icon)}${soundLabel}</div>
      <div class="tile-actions">
        <button type="button" data-send-card="${c.id}">Enviar</button>
        <button type="button" class="secondary" data-send-card-mute="${c.id}">Mudo</button>
        <button type="button" class="secondary" data-edit-card="${c.id}">Editar</button>
        ${c.isPreset ? "" : `<button type="button" class="danger" data-del-card="${c.id}">Borrar</button>`}
      </div>`;
    grid.appendChild(tile);
  }

  async function sendCard(id, soundOverride) {
    const body = {
      device: $("#cardDeviceSelect").value || undefined,
    };
    if (soundOverride !== undefined) body.sound = soundOverride;
    const r = await api(`/panel/api/cards/${id}/send`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    setMsg($("#cardMsg"), r.detail, r.ok ? "ok" : "error");
  }

  grid.querySelectorAll("[data-send-card]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await sendCard(btn.dataset.sendCard);
      } catch (err) {
        setMsg($("#cardMsg"), err.message, "error");
      }
    });
  });

  grid.querySelectorAll("[data-send-card-mute]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await sendCard(btn.dataset.sendCardMute, false);
      } catch (err) {
        setMsg($("#cardMsg"), err.message, "error");
      }
    });
  });

  grid.querySelectorAll("[data-edit-card]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = cachedCards.find((x) => x.id === btn.dataset.editCard);
      if (!card) return;
      const form = $("#cardForm");
      form.name.value = card.name;
      form.slug.value = card.slug;
      form.text.value = card.text;
      form.icon.value = card.icon;
      form.priority.value = card.priority;
      form.sound.checked = !!card.sound;
      fillSoundSelect($("#cardSoundSelect"), card.soundId || "notification");
      syncSoundWrap($("#cardSoundCheck"), $("#cardSoundWrap"));
      $("#cardEditId").value = card.id;
      $("#cardSaveBtn").textContent = "Guardar";
      $("#cardCancelEdit").hidden = false;
      form.slug.readOnly = !!card.isPreset;
      form.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });

  grid.querySelectorAll("[data-del-card]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/panel/api/cards/${btn.dataset.delCard}`, { method: "DELETE" });
        setMsg($("#cardMsg"), "Card eliminada", "ok");
        await loadCards();
      } catch (err) {
        setMsg($("#cardMsg"), err.message, "error");
      }
    });
  });
}

function fillCardSelect() {
  const sel = $("#autoCardSelect");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML =
    `<option value="">— elegí una card —</option>` +
    cachedCards
      .map(
        (c) =>
          `<option value="${escapeHtml(c.id)}" ${current === c.id ? "selected" : ""}>${escapeHtml(c.name)} (${escapeHtml(c.slug)})</option>`,
      )
      .join("");
}

function triggerLabel(trigger, value) {
  if (trigger === "equals") return `es igual a “${value ?? ""}”`;
  if (trigger === "gt") return `es > ${value ?? ""}`;
  if (trigger === "lt") return `es < ${value ?? ""}`;
  return "cambia";
}

function ruleIfLabel(a) {
  if (a.source === "connection") {
    return `SI ${a.appName || "app"} → ${a.eventName || "event"}`;
  }
  if (a.source === "sensor") {
    const title = a.sensorCardTitle || a.entityId || "sensor";
    const summary = a.sensorCardAlertSummary ? ` (${a.sensorCardAlertSummary})` : "";
    return `SI sensor ${title}${summary}`;
  }
  return `SI ${a.entityId || "?"} ${triggerLabel(a.trigger, a.triggerValue)}`;
}

let automationSensorCards = [];

async function loadAutomationSensorCards() {
  try {
    const { cards } = await api("/panel/api/sensor-cards");
    automationSensorCards = cards || [];
  } catch {
    automationSensorCards = [];
  }
  fillAutomationSensorSelect();
}

function fillAutomationSensorSelect() {
  const sel = $("#autoSensorSelect");
  if (!sel) return;
  const current = sel.value;
  if (!automationSensorCards.length) {
    sel.innerHTML =
      '<option value="">— sin sensores (creá uno en Inicio) —</option>';
    return;
  }
  sel.innerHTML =
    '<option value="">— elegí un sensor —</option>' +
    automationSensorCards
      .map((c) => {
        const label = `${c.title} (${c.entityId})${c.alertSummary ? ` · ${c.alertSummary}` : ""}`;
        return `<option value="${escapeHtml(c.id)}" ${current === c.id ? "selected" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("");
}

function syncAutoSensorHint() {
  const hint = $("#autoSensorHint");
  const sel = $("#autoSensorSelect");
  if (!hint || !sel) return;
  const card = automationSensorCards.find((c) => c.id === sel.value);
  if (!card) {
    hint.textContent =
      "Usa las condiciones del sensor (umbrales, intervalo) configuradas en Inicio → Sensores.";
    return;
  }
  hint.textContent = card.alertSummary
    ? `Dispara cuando: ${card.alertSummary}. Editá umbrales en Inicio → Sensores.`
    : "Sin umbrales: dispara al cambiar el valor. Configurá alertas en Inicio → Sensores.";
}

let connectionCatalog = [];

async function loadConnectionCatalog() {
  try {
    const { connections } = await api("/panel/api/connections");
    connectionCatalog = connections || [];
  } catch {
    connectionCatalog = [
      {
        id: "sentinel",
        name: "Sentinel",
        events: [
          { id: "torrent.added", label: "Nueva tarea" },
          { id: "torrent.completed", label: "Descarga terminada" },
          { id: "torrent.removed", label: "Tarea eliminada" },
          { id: "copy.done", label: "Copia terminada" },
        ],
      },
      {
        id: "frigate",
        name: "Frigate",
        events: [
          { id: "detection", label: "Cualquier detección" },
          { id: "person", label: "Persona" },
          { id: "car", label: "Auto" },
          { id: "dog", label: "Perro" },
          { id: "cat", label: "Gato" },
          { id: "package", label: "Paquete" },
        ],
      },
    ];
  }
  fillConnectionSelects();
}

function fillConnectionSelects() {
  const appSel = $("#autoAppSelect");
  const eventSel = $("#autoEventSelect");
  if (!appSel || !eventSel) return;
  const appCurrent = appSel.value;
  const eventCurrent = eventSel.value;
  appSel.innerHTML = connectionCatalog
    .map(
      (c) =>
        `<option value="${escapeHtml(c.id)}" ${appCurrent === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`,
    )
    .join("");
  const app = connectionCatalog.find((c) => c.id === appSel.value) || connectionCatalog[0];
  eventSel.innerHTML = (app?.events || [])
    .map(
      (e) =>
        `<option value="${escapeHtml(e.id)}" ${eventCurrent === e.id ? "selected" : ""}>${escapeHtml(e.label)} (${escapeHtml(e.id)})</option>`,
    )
    .join("");
}

function syncAutoSourceUI() {
  const source = $("#autoSource")?.value || "connection";
  const ha = $("#autoHaFields");
  const conn = $("#autoConnFields");
  const sensor = $("#autoSensorFields");
  if (ha) ha.hidden = source !== "ha";
  if (conn) conn.hidden = source !== "connection";
  if (sensor) sensor.hidden = source !== "sensor";
  if (source === "ha") syncAutoValueVisibility();
  if (source === "sensor") syncAutoSensorHint();
}

async function loadAutomations() {
  fillDeviceSelects();
  fillCardSelect();
  fillConnectionSelects();
  await loadAutomationSensorCards();
  syncAutoSourceUI();
  const { automations } = await api("/panel/api/automations");
  const list = $("#autoList");
  list.innerHTML = "";
  if (!automations.length) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="meta">Sin reglas. Armá una arriba: SI Conexiones/Sensores/HA → ENTONCES card en reloj.</div>`;
    list.appendChild(li);
    return;
  }
  for (const a of automations) {
    const li = document.createElement("li");
    const badge =
      a.source === "connection"
        ? `<span class="badge badge-preset">conexión</span>`
        : a.source === "sensor"
          ? `<span class="badge">sensor</span>`
          : `<span class="badge">HA</span>`;
    li.innerHTML = `
      <div class="auto-rule">
        <div>
          <strong>${escapeHtml(a.name || a.cardName || "regla")}</strong>
          ${badge}
          ${a.enabled ? "" : `<span class="badge">pausada</span>`}
          <div class="rule-if">${escapeHtml(ruleIfLabel(a))}</div>
          <div class="rule-then">ENTONCES <code>${escapeHtml(a.cardSlug || a.cardId)}</code>
            → ${escapeHtml(a.deviceName || a.deviceSlug || "todos")}
            · ${a.soundEffective ? escapeHtml(a.soundEffectiveId || "sonido") : "mudo"}${a.sound === null || a.sound === undefined ? " (card)" : ""}
          </div>
          <div class="meta">last ${escapeHtml(String(a.lastValue ?? "—"))}${a.lastSentAt ? ` · sent ${escapeHtml(String(a.lastSentAt))}` : ""}</div>
        </div>
        <div class="rule-actions">
          <button type="button" class="secondary" data-test-auto="${a.id}">Probar</button>
          <button type="button" class="secondary" data-toggle-auto="${a.id}" data-enabled="${a.enabled ? "1" : "0"}">${a.enabled ? "Pausar" : "Activar"}</button>
          <button type="button" class="danger" data-del-auto="${a.id}">Borrar</button>
        </div>
      </div>`;
    list.appendChild(li);
  }

  list.querySelectorAll("[data-test-auto]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const r = await api(`/panel/api/automations/${btn.dataset.testAuto}/test`, {
          method: "POST",
          body: "{}",
        });
        setMsg($("#autoMsg"), r.detail, r.ok ? "ok" : "error");
      } catch (err) {
        setMsg($("#autoMsg"), err.message, "error");
      }
    });
  });

  list.querySelectorAll("[data-toggle-auto]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const enabled = btn.dataset.enabled !== "1";
        await api(`/panel/api/automations/${btn.dataset.toggleAuto}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        });
        setMsg($("#autoMsg"), enabled ? "Activada" : "Pausada", "ok");
        await loadAutomations();
      } catch (err) {
        setMsg($("#autoMsg"), err.message, "error");
      }
    });
  });

  list.querySelectorAll("[data-del-auto]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/panel/api/automations/${btn.dataset.delAuto}`, { method: "DELETE" });
        setMsg($("#autoMsg"), "Regla eliminada", "ok");
        await loadAutomations();
      } catch (err) {
        setMsg($("#autoMsg"), err.message, "error");
      }
    });
  });
}

function syncAutoValueVisibility() {
  const trigger = $("#autoTrigger").value;
  const wrap = $("#autoValueWrap");
  wrap.hidden = trigger === "change";
  if (trigger === "change") $("#autoTriggerValue").value = "";
}

$("#autoTrigger").addEventListener("change", syncAutoValueVisibility);
$("#autoSource").addEventListener("change", syncAutoSourceUI);
$("#autoSensorSelect")?.addEventListener("change", syncAutoSensorHint);
$("#autoAppSelect").addEventListener("change", () => fillConnectionSelects());
$("#autoSoundSelect")?.addEventListener("change", syncAutoSoundIdWrap);
$("#cardSoundCheck")?.addEventListener("change", () => {
  syncSoundWrap($("#cardSoundCheck"), $("#cardSoundWrap"));
});

$("#autoSearchBtn").addEventListener("click", async () => {
  try {
    const q = $("#autoEntityId").value.trim();
    const { states } = await api(`/panel/api/ha/states?q=${encodeURIComponent(q || "")}`);
    const dl = $("#autoEntityList");
    dl.innerHTML = "";
    for (const s of (states || []).slice(0, 40)) {
      const opt = document.createElement("option");
      opt.value = s.entity_id;
      opt.label = `${s.friendly_name || s.entity_id} = ${s.state}`;
      dl.appendChild(opt);
    }
    setMsg(
      $("#autoMsg"),
      states?.length ? `${states.length} entidades (elegí del datalist)` : "Sin resultados",
      states?.length ? "ok" : "error",
    );
  } catch (err) {
    setMsg($("#autoMsg"), err.message, "error");
  }
});

$("#autoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const source = String(fd.get("source") || "connection");
  const trigger = String(fd.get("trigger") || "change");
  const soundMode = String(fd.get("sound") || "off");
  const soundId = String(fd.get("soundId") || "").trim();
  const payload = {
    source,
    cardId: fd.get("cardId"),
    deviceId: fd.get("deviceId") || null,
    sound: soundMode === "inherit" ? null : soundMode === "on",
    soundId: soundMode === "off" ? null : soundId || null,
  };
  if (source === "ha") {
    payload.entityId = String(fd.get("entityId") || "").trim();
    payload.trigger = trigger;
    payload.triggerValue = trigger === "change" ? null : String(fd.get("triggerValue") || "").trim();
  } else if (source === "sensor") {
    payload.sensorCardId = String(fd.get("sensorCardId") || "").trim();
    if (!payload.sensorCardId) {
      setMsg($("#autoMsg"), "Elegí un sensor", "error");
      return;
    }
  } else {
    payload.appName = String(fd.get("appName") || "sentinel").trim();
    payload.eventName = String(fd.get("eventName") || "").trim();
  }
  try {
    await api("/panel/api/automations", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    e.target.reset();
    $("#autoSource").value = "connection";
    $("#autoSoundSelect").value = "off";
    fillSoundSelect($("#autoSoundIdSelect"), "", true, "— de la card —");
    syncAutoSourceUI();
    syncAutoSoundIdWrap();
    fillCardSelect();
    fillDeviceSelects();
    fillConnectionSelects();
    await loadAutomationSensorCards();
    setMsg($("#autoMsg"), "Regla creada", "ok");
    await loadAutomations();
  } catch (err) {
    setMsg($("#autoMsg"), err.message, "error");
  }
});

function resetCardForm() {
  const form = $("#cardForm");
  form.reset();
  form.icon.value = "a2867";
  fillSoundSelect($("#cardSoundSelect"), "notification");
  syncSoundWrap($("#cardSoundCheck"), $("#cardSoundWrap"));
  $("#cardEditId").value = "";
  $("#cardSaveBtn").textContent = "Crear";
  $("#cardCancelEdit").hidden = true;
}

$("#cardCancelEdit").addEventListener("click", () => resetCardForm());

$("#cardForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const id = String(fd.get("id") || "").trim();
  const soundOn = fd.get("sound") === "on";
  const payload = {
    name: String(fd.get("name") || "").trim(),
    slug: String(fd.get("slug") || "").trim().toLowerCase(),
    text: String(fd.get("text") || "").trim(),
    icon: String(fd.get("icon") || "").trim() || "a2867",
    priority: fd.get("priority") || "info",
    sound: soundOn,
    soundId: soundOn ? String(fd.get("soundId") || "notification") : null,
  };
  try {
    if (id) {
      await api(`/panel/api/cards/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setMsg($("#cardMsg"), "Card actualizada", "ok");
    } else {
      await api("/panel/api/cards", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMsg($("#cardMsg"), "Card creada", "ok");
    }
    resetCardForm();
    await loadCards();
    await loadAutomations();
  } catch (err) {
    setMsg($("#cardMsg"), err.message, "error");
  }
});

/* HA device browser (group sensors by equipment, drag into editors) */
let haDeviceGroupsCache = null;

function defaultTemplateForEntity(entity) {
  const unit = entity.unit ? "{{ unit }}" : "";
  if (entity.domain === "sensor" || entity.domain === "number") {
    return `{{ name }}: {{ state | round:1 }}${unit}`;
  }
  return `{{ name }}: {{ state }}`;
}

function applyHaEntityToTargets(browser, entity, mode = "fill") {
  const entitySel = browser.dataset.dropEntity;
  const templateSel = browser.dataset.dropTemplate;
  const entityInput = entitySel ? $(entitySel) : null;
  const templateInput = templateSel ? $(templateSel) : null;

  if (mode === "entity" || mode === "fill") {
    if (entityInput) {
      entityInput.value = entity.entity_id;
      entityInput.classList.add("drop-flash");
      setTimeout(() => entityInput.classList.remove("drop-flash"), 500);
    }
  }
  if (mode === "template") {
    if (templateInput) {
      const insert = entity.entity_id;
      const start = templateInput.selectionStart ?? templateInput.value.length;
      const end = templateInput.selectionEnd ?? start;
      templateInput.value =
        templateInput.value.slice(0, start) + insert + templateInput.value.slice(end);
      templateInput.classList.add("drop-flash");
      setTimeout(() => templateInput.classList.remove("drop-flash"), 500);
    }
  } else if (mode === "fill" && templateInput && !templateInput.dataset.userEdited) {
    templateInput.value = defaultTemplateForEntity(entity);
  }
}

function renderHaSensorChips(browser, deviceId, filter = "") {
  const list = browser.querySelector("[data-ha-sensor-list]");
  const empty = browser.querySelector("[data-ha-device-empty]");
  if (!list || !haDeviceGroupsCache) return;

  const groups = [
    ...haDeviceGroupsCache.devices,
    haDeviceGroupsCache.unassigned,
  ];
  const group = groups.find((g) => g.id === deviceId);
  list.innerHTML = "";
  if (!group) {
    if (empty) empty.hidden = false;
    return;
  }

  const q = filter.trim().toLowerCase();
  const entities = group.entities.filter((e) => {
    if (!q) return true;
    return `${e.entity_id} ${e.name} ${e.state ?? ""}`.toLowerCase().includes(q);
  });

  if (empty) empty.hidden = entities.length > 0;
  for (const ent of entities) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "ha-sensor-chip";
    chip.draggable = true;
    chip.dataset.entityId = ent.entity_id;
    chip.innerHTML = `
      <strong>${escapeHtml(ent.name)}</strong>
      <span class="meta">${escapeHtml(ent.entity_id)}</span>
      <span class="ha-sensor-state">${escapeHtml(ent.state ?? "—")}${ent.unit ? ` ${escapeHtml(ent.unit)}` : ""}</span>
      <span class="ha-sensor-pin">+ inicio</span>`;
    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData(
        "application/x-ha-entity",
        JSON.stringify(ent),
      );
      e.dataTransfer.setData("text/plain", ent.entity_id);
      e.dataTransfer.effectAllowed = "copy";
      chip.classList.add("dragging");
    });
    chip.addEventListener("dragend", () => chip.classList.remove("dragging"));
    chip.addEventListener("click", (e) => {
      if (e.target.closest(".ha-sensor-pin")) {
        e.stopPropagation();
        $$("#tabs button").forEach((b) => b.classList.remove("active"));
        $$(".panel").forEach((p) => p.classList.remove("active"));
        $(`#tabs [data-tab="device"]`)?.classList.add("active");
        $("#tab-device")?.classList.add("active");
        showDeviceHome();
        openSensorCardEditor(null, ent);
        return;
      }
      applyHaEntityToTargets(browser, ent, "fill");
    });
    list.appendChild(chip);
  }
}

function fillHaDeviceSelect(browser) {
  const sel = browser.querySelector("[data-ha-device-select]");
  if (!sel || !haDeviceGroupsCache) return;
  const current = sel.value;
  const options = haDeviceGroupsCache.devices.map(
    (d) =>
      `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}${
        d.entities.length ? ` (${d.entities.length})` : ""
      }</option>`,
  );
  if (haDeviceGroupsCache.unassigned.entities.length) {
    options.push(
      `<option value="__unassigned__">Sin equipo (${haDeviceGroupsCache.unassigned.entities.length})</option>`,
    );
  }
  sel.innerHTML = `<option value="">Elegí un equipo…</option>${options.join("")}`;
  if ([...sel.options].some((o) => o.value === current)) {
    sel.value = current;
  }
}

async function loadHaDeviceBrowser(browser, force = false) {
  if (!browser) return;
  try {
    if (!haDeviceGroupsCache || force) {
      haDeviceGroupsCache = await api("/panel/api/ha/devices");
    }
    bindHaDeviceBrowser(browser);
    fillHaDeviceSelect(browser);
    const sel = browser.querySelector("[data-ha-device-select]");
    const filter = browser.querySelector("[data-ha-device-filter]");
    renderHaSensorChips(browser, sel?.value || "", filter?.value || "");
  } catch (err) {
    const list = browser.querySelector("[data-ha-sensor-list]");
    if (list) {
      list.innerHTML = `<p class="meta">No se pudieron cargar equipos: ${escapeHtml(err.message)}</p>`;
    }
  }
}

function bindHaDeviceBrowser(browser) {
  if (!browser || browser.dataset.bound) return;
  browser.dataset.bound = "1";

  browser.querySelector("[data-ha-devices-refresh]")?.addEventListener("click", () => {
    loadHaDeviceBrowser(browser, true).catch(() => {});
  });
  browser.querySelector("[data-ha-device-select]")?.addEventListener("change", (e) => {
    const filter = browser.querySelector("[data-ha-device-filter]");
    renderHaSensorChips(browser, e.target.value, filter?.value || "");
  });
  browser.querySelector("[data-ha-device-filter]")?.addEventListener("input", (e) => {
    const sel = browser.querySelector("[data-ha-device-select]");
    renderHaSensorChips(browser, sel?.value || "", e.target.value || "");
  });

  const entitySel = browser.dataset.dropEntity;
  const templateSel = browser.dataset.dropTemplate;
  for (const sel of [entitySel, templateSel]) {
    if (!sel) continue;
    const input = $(sel);
    if (!input || input.dataset.dropBound) continue;
    input.dataset.dropBound = "1";
    input.addEventListener("dragover", (e) => {
      if (
        ![...e.dataTransfer.types].includes("application/x-ha-entity") &&
        ![...e.dataTransfer.types].includes("text/plain")
      ) {
        return;
      }
      e.preventDefault();
      input.classList.add("drop-ready");
    });
    input.addEventListener("dragleave", () => input.classList.remove("drop-ready"));
    input.addEventListener("drop", (e) => {
      e.preventDefault();
      input.classList.remove("drop-ready");
      let entity = null;
      try {
        entity = JSON.parse(e.dataTransfer.getData("application/x-ha-entity") || "null");
      } catch {
        entity = null;
      }
      if (!entity) {
        const id = e.dataTransfer.getData("text/plain");
        if (!id) return;
        entity = {
          entity_id: id,
          name: id,
          domain: id.split(".")[0],
          state: null,
          unit: null,
        };
      }
      if (sel === templateSel) applyHaEntityToTargets(browser, entity, "template");
      else applyHaEntityToTargets(browser, entity, "fill");
    });
  }
}

/* Queue / send entities */
let queuePollTimer = null;
let deviceQueuePollTimer = null;

function queueDeviceLabel(deviceId) {
  if (!deviceId) return "todos";
  const d = cachedDevices.find((x) => x.id === deviceId || x.slug === deviceId);
  return d ? d.name : deviceId;
}

function intervalMinFromSec(sec) {
  if (!sec) return "";
  return String(Math.max(1, Math.round(Number(sec) / 60)));
}

function intervalSecFromMin(min) {
  if (min === "" || min == null) return null;
  const n = Number(min);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(60, Math.round(n * 60));
}

function formatAlertRules(ent) {
  const parts = [];
  if (ent.interval_sec) {
    parts.push(`cada ${intervalMinFromSec(ent.interval_sec)} min`);
  }
  if (ent.when_gt != null && ent.when_gt !== "") parts.push(`>${ent.when_gt}`);
  if (ent.when_lt != null && ent.when_lt !== "") parts.push(`<${ent.when_lt}`);
  if (ent.min_delta != null && ent.min_delta !== "") parts.push(`Δ≥${ent.min_delta}`);
  if (!parts.length) parts.push("al cambiar de valor");
  return parts.join(" · ");
}

function buildQueueTargetPicker(ent, targetKey = ent.id) {
  const ids = ent.device_ids?.length
    ? ent.device_ids
    : ent.device_id
      ? [ent.device_id]
      : [];
  const defaultAll = !ids.length;
  const deviceChecks = cachedDevices
    .map(
      (d) => `<label class="check compact">
        <input type="checkbox" data-target-dev="${d.id}" ${
          ids.includes(d.id) ? "checked" : ""
        } ${defaultAll ? "disabled" : ""} />
        ${escapeHtml(d.name)}
      </label>`,
    )
    .join("");
  return `<div class="queue-targets" data-targets-for="${targetKey}">
    <span class="meta">Relojes destino</span>
    <div class="queue-targets-row">
      <label class="check compact">
        <input type="checkbox" data-target-all ${defaultAll ? "checked" : ""} /> Todos
      </label>
      ${deviceChecks}
    </div>
  </div>`;
}

function readQueueTargets(list, entId) {
  const wrap = list.querySelector(`[data-targets-for="${entId}"]`);
  if (!wrap) return undefined;
  const allCb = wrap.querySelector("[data-target-all]");
  if (allCb?.checked) return [];
  return [...wrap.querySelectorAll("[data-target-dev]:checked")].map(
    (cb) => cb.dataset.targetDev,
  );
}

function readQueueTargetsForSave(list, entId) {
  const targets = readQueueTargets(list, entId);
  if (!targets) return { device_id: null, device_ids: null };
  if (!targets.length) return { device_id: null, device_ids: null };
  if (targets.length === 1) return { device_id: targets[0], device_ids: null };
  return { device_id: null, device_ids: targets };
}

function parseAlertRuleFields(fd) {
  return {
    template: String(fd.get("template") || "").trim() || undefined,
    priority: fd.get("priority") || "warning",
    sound: fd.get("sound") === "on",
    enabled: fd.get("enabled") === "on",
    interval_sec: intervalSecFromMin(fd.get("interval_min")),
    min_delta:
      fd.get("min_delta") !== "" && fd.get("min_delta") != null
        ? Number(fd.get("min_delta"))
        : null,
    when_gt:
      fd.get("when_gt") !== "" && fd.get("when_gt") != null
        ? Number(fd.get("when_gt"))
        : null,
    when_lt:
      fd.get("when_lt") !== "" && fd.get("when_lt") != null
        ? Number(fd.get("when_lt"))
        : null,
  };
}

function renderQueueAlertItem(ent) {
  const preview = ent.preview || "(sin estado)";
  const name = ent.friendly_name || ent.entity_id;
  const rules = formatAlertRules(ent);
  const enabledBadge = ent.enabled
    ? `<span class="badge ok">activa</span>`
    : `<span class="badge">pausada</span>`;
  return `
    <li class="queue-alert-item">
      <div class="queue-alert-head">
        <div>
          <strong>${escapeHtml(name)}</strong> ${enabledBadge}
          <div class="meta">${escapeHtml(ent.entity_id)} · ${escapeHtml(ent.device_name || "todos")}</div>
          <div class="meta queue-alert-rules">${escapeHtml(rules)} · ${escapeHtml(ent.priority || "info")}${ent.sound ? " · sonido" : ""}</div>
          <div style="margin-top:0.35rem">${escapeHtml(preview)}</div>
        </div>
        <button type="button" class="danger secondary" data-del-alert="${ent.id}">Borrar</button>
      </div>
      <form class="stack queue-alert-form" data-alert-id="${ent.id}">
        <label>Texto (template)
          <input name="template" value="${escapeHtml(ent.template || "")}" />
        </label>
        <div class="row">
          <label>Prioridad
            <select name="priority">
              <option value="info" ${ent.priority === "info" ? "selected" : ""}>info</option>
              <option value="warning" ${ent.priority === "warning" ? "selected" : ""}>warning</option>
              <option value="critical" ${ent.priority === "critical" ? "selected" : ""}>critical</option>
            </select>
          </label>
          <label class="check">
            <input name="sound" type="checkbox" ${ent.sound ? "checked" : ""} /> Sonido
          </label>
          <label class="check">
            <input name="enabled" type="checkbox" ${ent.enabled !== false ? "checked" : ""} /> Activa
          </label>
        </div>
        <div class="row">
          <label>Cada N min
            <input name="interval_min" type="number" min="1" step="1" placeholder="off" value="${escapeHtml(intervalMinFromSec(ent.interval_sec))}" />
          </label>
          <label>Si valor &gt;
            <input name="when_gt" type="number" step="0.1" placeholder="off" value="${ent.when_gt ?? ""}" />
          </label>
          <label>Si valor &lt;
            <input name="when_lt" type="number" step="0.1" placeholder="off" value="${ent.when_lt ?? ""}" />
          </label>
          <label>Cambio mín. Δ
            <input name="min_delta" type="number" min="0" step="0.1" placeholder="off" value="${ent.min_delta ?? ""}" />
          </label>
        </div>
        ${buildQueueTargetPicker(ent)}
        <div class="row queue-alert-actions">
          <button type="submit" class="secondary">Guardar reglas</button>
          <button type="button" data-send-ent="${ent.id}">Encolar ahora</button>
        </div>
        <div class="meta">Último: ${escapeHtml(String(ent.last_value ?? "—"))}${ent.last_sent_at ? ` · ${new Date(ent.last_sent_at).toLocaleString()}` : ""}</div>
      </form>
    </li>`;
}

function readQueueTargets(list, entId) {
  const wrap = list.querySelector(`[data-targets-for="${entId}"]`);
  if (!wrap) return undefined;
  const allCb = wrap.querySelector("[data-target-all]");
  if (allCb?.checked) return [];
  return [...wrap.querySelectorAll("[data-target-dev]:checked")].map(
    (cb) => cb.dataset.targetDev,
  );
}

function bindQueueTargetPickers(list) {
  list.querySelectorAll(".queue-targets").forEach((wrap) => {
    const allCb = wrap.querySelector("[data-target-all]");
    const devCbs = [...wrap.querySelectorAll("[data-target-dev]")];
    allCb?.addEventListener("change", () => {
      const all = allCb.checked;
      devCbs.forEach((cb) => {
        cb.disabled = all;
        if (all) cb.checked = false;
      });
    });
    devCbs.forEach((cb) => {
      cb.addEventListener("change", () => {
        if (cb.checked && allCb) {
          allCb.checked = false;
          devCbs.forEach((other) => {
            other.disabled = false;
          });
        }
      });
    });
  });
}

function fillQueueDeviceFilter() {
  const sel = $("#queueDeviceFilter");
  if (!sel) return;
  const current = sel.value || "all";
  sel.innerHTML = `<option value="all">Todos los relojes</option>${cachedDevices
    .map(
      (d) =>
        `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`,
    )
    .join("")}`;
  if ([...sel.options].some((o) => o.value === current)) {
    sel.value = current;
  }
}

function describeQueueSound(item, device = null) {
  const sound = item.sound;
  if (!device) {
    if (sound === false) return "mudo";
    if (typeof sound === "string") return sound;
    if (sound === true) return "sonido";
    return "sin sonido";
  }
  if (device.notifySoundMode === "off") return "silencioso (reloj)";
  if (device.notifySoundMode === "on") {
    return `${device.notifySoundId || "notification"} (reloj)`;
  }
  if (sound === false) return "mudo";
  if (typeof sound === "string") return sound;
  if (sound === true) return "sonido";
  return "sin sonido";
}

function renderQueueLanes(items, lanePrefix, showDevice = false, deviceForSound = null) {
  for (const p of ["critical", "warning", "info"]) {
    const lane = $(`#${lanePrefix}-${p}`);
    if (!lane) continue;
    lane.innerHTML = "";
    const laneItems = (items || []).filter((i) => i.priority === p);
    for (const item of laneItems) {
      const li = document.createElement("li");
      const deviceMeta =
        showDevice && item.deviceId
          ? ` · ${escapeHtml(queueDeviceLabel(item.deviceId))}`
          : "";
      const soundMeta = ` · ${escapeHtml(describeQueueSound(item, deviceForSound))}`;
      li.innerHTML = `
        <strong>#${item.position} ${escapeHtml(item.text)}</strong>
        <div class="meta">${escapeHtml(item.source)}${deviceMeta}${soundMeta} · ${new Date(item.enqueuedAt).toLocaleTimeString()}</div>`;
      lane.appendChild(li);
    }
  }
}

function formatQueueCurrentLabel(data, showDevice = false) {
  if (data.currents?.length) {
    return data.currents
      .map(
        (c) =>
          `[${c.priority}] ${c.text}${showDevice || c.deviceId ? ` → ${queueDeviceLabel(c.deviceId)}` : ""}`,
      )
      .join(" · ");
  }
  const cur = data.current;
  if (!cur) return "Enviando: —";
  const deviceSuffix =
    showDevice || cur.deviceId ? ` → ${queueDeviceLabel(cur.deviceId)}` : "";
  return `Enviando: [${cur.priority}] ${cur.text}${deviceSuffix}`;
}

function startQueuePolling() {
  stopQueuePolling();
  queuePollTimer = setInterval(() => {
    loadQueueBoard().catch(() => {});
  }, 2000);
}

function stopQueuePolling() {
  if (queuePollTimer) {
    clearInterval(queuePollTimer);
    queuePollTimer = null;
  }
}

function startDeviceQueuePolling() {
  stopDeviceQueuePolling();
  deviceQueuePollTimer = setInterval(() => {
    if (selectedDeviceDetailId && !$("#deviceDetailView")?.hidden) {
      loadDeviceQueueBoard(selectedDeviceDetailId).catch(() => {});
    }
  }, 2000);
}

function stopDeviceQueuePolling() {
  if (deviceQueuePollTimer) {
    clearInterval(deviceQueuePollTimer);
    deviceQueuePollTimer = null;
  }
}

async function loadDeviceQueueBoard(deviceId) {
  const data = await api(`/panel/api/devices/${deviceId}/queue`);
  const device = cachedDevices.find((d) => d.id === deviceId) || null;
  $("#deviceQueueSizeLabel").textContent = `(${data.size})`;
  $("#deviceQueueCurrentLabel").textContent = formatQueueCurrentLabel(data, false);
  renderQueueLanes(data.items, "device-lane", false, device);
}

async function loadQueueEntities() {
  if (!cachedDevices.length) {
    const { devices } = await api("/panel/api/devices");
    cachedDevices = devices || [];
  }
  const targets = $("#queueAlertTargets");
  if (targets) {
    targets.innerHTML = buildQueueTargetPicker({ id: "new" }, "new");
    bindQueueTargetPickers(targets);
  }

  const { entities } = await api("/panel/api/ha/previews");
  const list = $("#queueEntityList");
  list.innerHTML = "";
  if (!entities.length) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="meta">No hay alertas todavía. Creá una arriba o mapeá entidades en Home Assistant.</div>`;
    list.appendChild(li);
    return;
  }
  for (const ent of entities) {
    if (ent.mode !== "notify") continue;
    const li = document.createElement("li");
    li.innerHTML = renderQueueAlertItem(ent);
    list.appendChild(li);
  }
  if (!list.children.length) {
    list.innerHTML = `<li><div class="meta">No hay alertas en modo notify. Las entidades frame están en la pestaña Home Assistant.</div></li>`;
  }

  bindQueueTargetPickers(list);
  list.querySelectorAll("form.queue-alert-form").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = form.dataset.alertId;
      const fd = new FormData(form);
      const deviceTargets = readQueueTargetsForSave(list, id);
      try {
        await api(`/panel/api/ha/entities/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...parseAlertRuleFields(fd),
            mode: "notify",
            ...deviceTargets,
          }),
        });
        setMsg($("#queueMsg"), "Reglas guardadas", "ok");
        await loadQueueEntities();
      } catch (err) {
        setMsg($("#queueMsg"), err.message, "error");
      }
    });
  });

  list.querySelectorAll("[data-del-alert]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Borrar esta alerta?")) return;
      try {
        await api(`/panel/api/ha/entities/${btn.dataset.delAlert}`, { method: "DELETE" });
        setMsg($("#queueMsg"), "Alerta eliminada", "ok");
        await loadQueueEntities();
      } catch (err) {
        setMsg($("#queueMsg"), err.message, "error");
      }
    });
  });

  list.querySelectorAll("[data-send-ent]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.sendEnt;
      const form = list.querySelector(`form[data-alert-id="${id}"]`);
      const fd = form ? new FormData(form) : null;
      const priority = fd?.get("priority") || "critical";
      const targets = readQueueTargets(list, id);
      if (targets !== undefined && !targets.length && !list.querySelector(`[data-targets-for="${id}"] [data-target-all]`)?.checked) {
        setMsg($("#queueMsg"), "Elegí al menos un reloj o marcá Todos", "error");
        return;
      }
      try {
        btn.disabled = true;
        const body = {
          priority,
          sound: fd?.get("sound") === "on",
        };
        if (targets !== undefined) body.devices = targets;
        const r = await api(`/panel/api/ha/entities/${id}/send`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        setMsg($("#queueMsg"), `${r.detail}: ${r.text || ""}`, "ok");
        await loadQueueBoard();
        if (selectedDeviceDetailId) {
          loadDeviceQueueBoard(selectedDeviceDetailId).catch(() => {});
        }
        refreshStatus();
      } catch (err) {
        setMsg($("#queueMsg"), err.message, "error");
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function loadQueueBoard() {
  const filterVal = $("#queueDeviceFilter")?.value || "all";
  const qs =
    filterVal !== "all"
      ? `?device=${encodeURIComponent(filterVal)}`
      : "";
  const data = await api(`/panel/api/queue${qs}`);
  const showDevice = filterVal === "all";
  $("#queueSizeLabel").textContent = `(${data.size})`;
  $("#queueCurrentLabel").textContent = formatQueueCurrentLabel(data, showDevice);
  renderQueueLanes(data.items, "lane", showDevice);

  const recent = $("#queueRecentList");
  recent.innerHTML = "";
  for (const log of data.recent || []) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <strong>[${escapeHtml(log.status)}] ${escapeHtml(log.text)}</strong>
        <div class="meta">${escapeHtml(log.priority)} · ${escapeHtml(log.source)} · ${escapeHtml(log.detail || "")}</div>
      </div>`;
    recent.appendChild(li);
  }
}

async function loadQueueTab() {
  if (!cachedDevices.length) {
    const { devices } = await api("/panel/api/devices");
    cachedDevices = devices || [];
  }
  fillQueueDeviceFilter();
  await loadHaDeviceBrowser($("#queueDeviceBrowser"));
  await loadQueueEntities();
  await loadQueueBoard();
}

$("#queueDeviceFilter")?.addEventListener("change", () => {
  loadQueueBoard().catch((e) => setMsg($("#queueMsg"), e.message, "error"));
});

$("#refreshQueueEntities").addEventListener("click", () => {
  loadQueueEntities().catch((e) => setMsg($("#queueMsg"), e.message, "error"));
});

async function searchQueueHa() {
  const q = $("#queueAlertEntityId")?.value || "";
  const { states } = await api(`/panel/api/ha/states?q=${encodeURIComponent(q || "")}`);
  const list = $("#queueHaStates");
  if (!list) return;
  list.innerHTML = "";
  for (const s of states.slice(0, 20)) {
    const li = document.createElement("li");
    li.innerHTML = `<div><strong>${escapeHtml(s.entity_id)}</strong><div class="meta">${escapeHtml(String(s.friendly_name || ""))} = ${escapeHtml(s.state)}</div></div>
      <button type="button" class="secondary" data-pick-queue="${escapeHtml(s.entity_id)}">Usar</button>`;
    list.appendChild(li);
  }
  list.querySelectorAll("[data-pick-queue]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("#queueAlertEntityId").value = btn.dataset.pickQueue;
      list.innerHTML = "";
    });
  });
}

$("#queueHaPickBtn")?.addEventListener("click", () => {
  searchQueueHa().catch((e) => setMsg($("#queueMsg"), e.message, "error"));
});

$("#queueAlertForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const entityId = String(fd.get("entity_id") || "").trim();
  if (!entityId) return;
  const deviceTargets = readQueueTargetsForSave($("#queueAlertTargets"), "new");
  try {
    await api("/panel/api/ha/entities", {
      method: "POST",
      body: JSON.stringify({
        entity_id: entityId,
        mode: "notify",
        icon: "a2867",
        ...parseAlertRuleFields(fd),
        ...deviceTargets,
      }),
    });
    setMsg($("#queueMsg"), "Alerta creada", "ok");
    e.target.reset();
    e.target.template.value = "{{ name }}: {{ state | round:1 }}{{ unit }}";
    e.target.enabled.checked = true;
    await loadQueueEntities();
  } catch (err) {
    setMsg($("#queueMsg"), err.message, "error");
  }
});

$("#clearQueueBtn").addEventListener("click", async () => {
  try {
    const filterVal = $("#queueDeviceFilter")?.value || "all";
    const qs =
      filterVal !== "all"
        ? `?device=${encodeURIComponent(filterVal)}`
        : "";
    const r = await api(`/panel/api/queue${qs}`, { method: "DELETE" });
    setMsg($("#queueMsg"), `Cola vaciada (${r.cleared})`, "ok");
    await loadQueueBoard();
    if (selectedDeviceDetailId) {
      loadDeviceQueueBoard(selectedDeviceDetailId).catch(() => {});
    }
    refreshStatus();
  } catch (err) {
    setMsg($("#queueMsg"), err.message, "error");
  }
});

$("#clearDeviceQueueBtn")?.addEventListener("click", async () => {
  if (!selectedDeviceDetailId) return;
  try {
    const r = await api(
      `/panel/api/queue?device=${encodeURIComponent(selectedDeviceDetailId)}`,
      { method: "DELETE" },
    );
    setMsg($("#deviceMsg"), `Cola vaciada (${r.cleared})`, "ok");
    await loadDeviceQueueBoard(selectedDeviceDetailId);
    refreshStatus();
    if ($("#tab-queue")?.classList.contains("active")) {
      loadQueueBoard().catch(() => {});
    }
  } catch (err) {
    setMsg($("#deviceMsg"), err.message, "error");
  }
});

/* Icons gallery */
let iconPage = 0;
let iconQuery = "";
let selectedIcon = null;
let lastIconInput = null;

document.addEventListener("focusin", (e) => {
  const t = e.target;
  if (t && t.matches && t.matches("input.icon-field, input[name=icon]")) {
    lastIconInput = t;
  }
});

function setSelectedIcon(icon) {
  selectedIcon = icon;
  $("#iconSelectedCode").textContent = icon ? icon.code : "ninguno";
  $("#iconSelectedTitle").textContent = icon
    ? `${icon.title}${icon.category ? ` · ${icon.category}` : ""}`
    : "Elegí un icono de la grilla";
  const img = $("#iconSelectedThumb");
  if (icon?.thumb) {
    img.src = icon.thumb;
    img.hidden = false;
  } else {
    img.hidden = true;
    img.removeAttribute("src");
  }
  $("#iconApplyBtn").disabled = !icon;
  $("#iconCopyBtn").disabled = !icon;
  $$(".icon-card").forEach((el) => {
    el.classList.toggle("selected", icon && el.dataset.code === icon.code);
  });
  if (icon && lastIconInput) {
    lastIconInput.value = icon.code;
  }
}

function applySelectedIconToFields() {
  if (!selectedIcon) return;
  const fields = $$("input.icon-field, input[name=icon]");
  if (lastIconInput && fields.includes(lastIconInput)) {
    lastIconInput.value = selectedIcon.code;
    setMsg($("#iconMsg"), `Aplicado ${selectedIcon.code} al campo activo`, "ok");
    return;
  }
  if (fields[0]) {
    fields[0].value = selectedIcon.code;
    setMsg($("#iconMsg"), `Aplicado ${selectedIcon.code}`, "ok");
  }
}

async function loadIcons(page = iconPage) {
  iconPage = Math.max(0, page);
  setMsg($("#iconMsg"), "Cargando iconos…");
  const params = new URLSearchParams({
    page: String(iconPage),
    count: "48",
  });
  if (iconQuery) params.set("q", iconQuery);
  const data = await api(`/panel/api/icons?${params}`);
  const grid = $("#iconGrid");
  grid.innerHTML = "";
  for (const icon of data.icons || []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-card";
    btn.dataset.code = icon.code;
    btn.innerHTML = `
      <img src="${escapeHtml(icon.thumb)}" alt="${escapeHtml(icon.title)}" loading="lazy" width="40" height="40" />
      <span class="code">${escapeHtml(icon.code)}</span>
      <span class="title" title="${escapeHtml(icon.title)}">${escapeHtml(icon.title)}</span>`;
    btn.addEventListener("click", () => setSelectedIcon(icon));
    grid.appendChild(btn);
  }
  if (selectedIcon) {
    $$(".icon-card").forEach((el) => {
      el.classList.toggle("selected", el.dataset.code === selectedIcon.code);
    });
  }
  const total = data.total || 0;
  const pageSize = 48;
  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  $("#iconPageLabel").textContent = iconQuery
    ? `busqueda · pág ${iconPage + 1} · ${data.icons.length} resultados`
    : `populares · pág ${iconPage + 1} / ${maxPage + 1}`;
  $("#iconPrevBtn").disabled = iconPage <= 0;
  $("#iconNextBtn").disabled = iconPage >= maxPage || data.icons.length === 0;
  setMsg($("#iconMsg"), data.icons.length ? "" : "Sin resultados");
}

$("#iconSearchBtn").addEventListener("click", () => {
  iconQuery = $("#iconSearch").value.trim();
  loadIcons(0).catch((e) => setMsg($("#iconMsg"), e.message, "error"));
});

$("#iconSearch").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    $("#iconSearchBtn").click();
  }
});

$("#iconPopularBtn").addEventListener("click", () => {
  iconQuery = "";
  $("#iconSearch").value = "";
  loadIcons(0).catch((e) => setMsg($("#iconMsg"), e.message, "error"));
});

$("#iconPrevBtn").addEventListener("click", () => {
  loadIcons(iconPage - 1).catch((e) => setMsg($("#iconMsg"), e.message, "error"));
});

$("#iconNextBtn").addEventListener("click", () => {
  loadIcons(iconPage + 1).catch((e) => setMsg($("#iconMsg"), e.message, "error"));
});

$("#iconApplyBtn").addEventListener("click", () => applySelectedIconToFields());

$("#iconCopyBtn").addEventListener("click", async () => {
  if (!selectedIcon) return;
  try {
    await navigator.clipboard.writeText(selectedIcon.code);
    setMsg($("#iconMsg"), `Copiado ${selectedIcon.code}`, "ok");
  } catch {
    setMsg($("#iconMsg"), selectedIcon.code, "ok");
  }
});

/* Apps */
async function loadApps() {
  const { apps } = await api("/panel/api/apps");
  const list = $("#appList");
  list.innerHTML = "";
  for (const app of apps) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(app.name)}</strong>
        <div class="meta">${escapeHtml(app.id)} · ${escapeHtml(app.created_at)}</div>
      </div>
      <div class="actions">
        <button type="button" class="secondary" data-rotate="${app.id}">Rotar key</button>
        <button type="button" class="danger" data-del="${app.id}">Borrar</button>
      </div>`;
    list.appendChild(li);
  }
  list.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/panel/api/apps/${btn.dataset.del}`, { method: "DELETE" });
      loadApps();
      refreshStatus();
    });
  });
  list.querySelectorAll("[data-rotate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const r = await api(`/panel/api/apps/${btn.dataset.rotate}/rotate`, {
        method: "POST",
        body: "{}",
      });
      setMsg($("#appMsg"), `Nueva key: ${r.apiKey}`, "ok");
    });
  });
}

$("#appForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const r = await api("/panel/api/apps", {
      method: "POST",
      body: JSON.stringify({ name: fd.get("name") }),
    });
    setMsg($("#appMsg"), `API key (única vez): ${r.apiKey}`, "ok");
    e.target.reset();
    loadApps();
    refreshStatus();
  } catch (err) {
    setMsg($("#appMsg"), err.message, "error");
  }
});

/* Channels */
async function loadChannels() {
  const { channels } = await api("/panel/api/channels");
  const list = $("#channelList");
  const select = $("#haChannelSelect");
  list.innerHTML = "";
  select.innerHTML = '<option value="">—</option>';
  for (const ch of channels) {
    select.insertAdjacentHTML(
      "beforeend",
      `<option value="${ch.id}">${escapeHtml(ch.name)}</option>`,
    );
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(ch.name)}</strong>
        <div class="meta">order ${ch.sort_order} · ${ch.enabled ? "on" : "off"} · ${escapeHtml(ch.id)}</div>
        <form class="row frame-form" data-id="${ch.id}">
          <input name="text" placeholder="Texto del frame" required />
          <input name="icon" class="icon-field" value="a2867" style="width:7rem" />
          <button type="submit">Set frame</button>
        </form>
      </div>
      <div class="actions">
        <button type="button" class="secondary" data-toggle="${ch.id}" data-enabled="${ch.enabled ? "true" : "false"}">${ch.enabled ? "Disable" : "Enable"}</button>
        <button type="button" class="danger" data-del-ch="${ch.id}">Borrar</button>
      </div>`;
    list.appendChild(li);
  }

  list.querySelectorAll(".frame-form").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      await api(`/panel/api/channels/${form.dataset.id}/frame`, {
        method: "PUT",
        body: JSON.stringify({ text: fd.get("text"), icon: fd.get("icon") }),
      });
    });
  });

  list.querySelectorAll("[data-del-ch]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/panel/api/channels/${btn.dataset.delCh}`, { method: "DELETE" });
      loadChannels();
      refreshStatus();
    });
  });

  list.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const enabled = btn.dataset.enabled !== "true";
      await api(`/panel/api/channels/${btn.dataset.toggle}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      loadChannels();
    });
  });
}

$("#channelForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await api("/panel/api/channels", {
    method: "POST",
    body: JSON.stringify({
      name: fd.get("name"),
      sort_order: Number(fd.get("sort_order") || 0),
    }),
  });
  e.target.reset();
  loadChannels();
  refreshStatus();
});

/* HA */
async function loadHa() {
  fillDeviceSelects();
  await loadHaDeviceBrowser($("#haDeviceBrowser"));
  const data = await api("/panel/api/ha");
  if (data.baseUrl) $("#haForm").baseUrl.value = data.baseUrl;

  let previews = [];
  try {
    const p = await api("/panel/api/ha/previews");
    previews = p.entities || [];
  } catch {
    previews = [];
  }
  const previewById = Object.fromEntries(previews.map((e) => [e.id, e]));

  const list = $("#haEntityList");
  list.innerHTML = "";
  for (const ent of data.entities) {
    const preview = previewById[ent.id] || ent;
    const li = document.createElement("li");
    li.style.alignItems = "stretch";
    li.style.flexDirection = "column";
    li.innerHTML = `
      <div class="row" style="justify-content:space-between;width:100%;margin:0">
        <div>
          <strong>${escapeHtml(preview?.friendly_name || ent.entity_id)}</strong>
          <div class="meta">${escapeHtml(ent.entity_id)} · ${escapeHtml(ent.mode)} · ${escapeHtml(preview.device_name || ent.device_name || "todos")}</div>
        </div>
        <button type="button" class="danger" data-del-ent="${ent.id}">Borrar</button>
      </div>
      <form class="stack entity-edit" data-id="${ent.id}" style="width:100%;margin:0.5rem 0 0">
        <label>Template
          <input name="template" value="${escapeHtml(ent.template)}" />
        </label>
        <div class="row">
          <label>Modo
            <select name="mode">
              <option value="frame" ${ent.mode === "frame" ? "selected" : ""}>frame</option>
              <option value="notify" ${ent.mode === "notify" ? "selected" : ""}>notify</option>
            </select>
          </label>
          <label>Icon
            <input name="icon" class="icon-field" value="${escapeHtml(ent.icon)}" style="width:7rem" />
          </label>
          <label>Prioridad
            <select name="priority">
              <option value="critical" ${(preview.priority || ent.priority) === "critical" ? "selected" : ""}>critical</option>
              <option value="warning" ${(preview.priority || ent.priority) === "warning" ? "selected" : ""}>warning</option>
              <option value="info" ${(preview.priority || ent.priority || "info") === "info" ? "selected" : ""}>info</option>
            </select>
          </label>
        </div>
        <div class="row">
          <label>Cada N seg.
            <input name="interval_sec" type="number" min="10" placeholder="off" value="${preview.interval_sec ?? ent.interval_sec ?? ""}" />
          </label>
          <label>Δ mínimo
            <input name="min_delta" type="number" min="0" step="0.1" placeholder="off" value="${preview.min_delta ?? ent.min_delta ?? ""}" />
          </label>
          <label>Si &gt;
            <input name="when_gt" type="number" step="0.1" placeholder="off" value="${preview.when_gt ?? ent.when_gt ?? ""}" />
          </label>
          <label>Si &lt;
            <input name="when_lt" type="number" step="0.1" placeholder="off" value="${preview.when_lt ?? ent.when_lt ?? ""}" />
          </label>
          <label>Reloj
            <select name="device_id">${deviceOptions(ent.device_id || "", true)}</select>
          </label>
          <label class="check">
            <input name="sound" type="checkbox" ${(preview.sound ?? ent.sound) ? "checked" : ""} />
            Sonido
          </label>
          <button type="submit">Guardar</button>
        </div>
        <div class="meta">Preview: <strong>${escapeHtml(preview?.preview || "(sin estado)")}</strong>
          · last ${escapeHtml(String(preview.last_value ?? ent.last_value ?? "—"))}
          ${(preview.interval_sec ?? ent.interval_sec) ? `· cada ${preview.interval_sec ?? ent.interval_sec}s` : ""}
          ${(preview.min_delta ?? ent.min_delta) != null ? `· Δ≥${preview.min_delta ?? ent.min_delta}` : ""}
          ${(preview.when_gt ?? ent.when_gt) != null ? `· >${preview.when_gt ?? ent.when_gt}` : ""}
          ${(preview.when_lt ?? ent.when_lt) != null ? `· <${preview.when_lt ?? ent.when_lt}` : ""}
        </div>
      </form>`;
    list.appendChild(li);
  }

  list.querySelectorAll("[data-del-ent]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/panel/api/ha/entities/${btn.dataset.delEnt}`, { method: "DELETE" });
      loadHa();
    });
  });

  list.querySelectorAll("form.entity-edit").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await api(`/panel/api/ha/entities/${form.dataset.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            template: fd.get("template"),
            mode: fd.get("mode"),
            icon: fd.get("icon"),
            priority: fd.get("priority"),
            sound: fd.get("sound") === "on",
            interval_sec: fd.get("interval_sec")
              ? Number(fd.get("interval_sec"))
              : null,
            min_delta: fd.get("min_delta") !== "" && fd.get("min_delta") != null
              ? Number(fd.get("min_delta"))
              : null,
            when_gt: fd.get("when_gt") !== "" && fd.get("when_gt") != null
              ? Number(fd.get("when_gt"))
              : null,
            when_lt: fd.get("when_lt") !== "" && fd.get("when_lt") != null
              ? Number(fd.get("when_lt"))
              : null,
            device_id: fd.get("device_id") || null,
          }),
        });
        setMsg($("#haMsg"), "Entidad actualizada", "ok");
        await loadHa();
      } catch (err) {
        setMsg($("#haMsg"), err.message, "error");
      }
    });
  });
}

$("#haForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("/panel/api/ha", {
      method: "PUT",
      body: JSON.stringify({
        baseUrl: fd.get("baseUrl"),
        token: fd.get("token"),
      }),
    });
    setMsg($("#haMsg"), "Guardado", "ok");
    refreshStatus();
    loadHa();
  } catch (err) {
    setMsg($("#haMsg"), err.message, "error");
  }
});

$("#haTest").addEventListener("click", async () => {
  try {
    const r = await api("/panel/api/ha/test", { method: "POST", body: "{}" });
    setMsg($("#haMsg"), r.detail, r.ok ? "ok" : "error");
  } catch (err) {
    setMsg($("#haMsg"), err.message, "error");
  }
});

async function searchHa() {
  const q = $("#haSearch").value;
  const { states } = await api(`/panel/api/ha/states?q=${encodeURIComponent(q || "")}`);
  const list = $("#haStates");
  list.innerHTML = "";
  for (const s of states.slice(0, 40)) {
    const li = document.createElement("li");
    li.innerHTML = `<div><strong>${escapeHtml(s.entity_id)}</strong><div class="meta">${escapeHtml(String(s.friendly_name || ""))} = ${escapeHtml(s.state)}</div></div>
      <button type="button" class="secondary" data-pick="${escapeHtml(s.entity_id)}">Usar</button>`;
    list.appendChild(li);
  }
  list.querySelectorAll("[data-pick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("#haEntityForm").entity_id.value = btn.dataset.pick;
    });
  });
}

$("#haSearchBtn").addEventListener("click", () => searchHa().catch((e) => setMsg($("#haMsg"), e.message, "error")));

$("#haEntityForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await api("/panel/api/ha/entities", {
    method: "POST",
    body: JSON.stringify({
      entity_id: fd.get("entity_id"),
      mode: fd.get("mode"),
      template: fd.get("template"),
      icon: fd.get("icon"),
      channel_id: fd.get("channel_id") || null,
      priority: fd.get("priority") || "critical",
      sound: fd.get("sound") === "on",
      interval_sec: fd.get("interval_sec")
        ? Number(fd.get("interval_sec"))
        : null,
      min_delta:
        fd.get("min_delta") !== "" && fd.get("min_delta") != null
          ? Number(fd.get("min_delta"))
          : null,
      when_gt:
        fd.get("when_gt") !== "" && fd.get("when_gt") != null
          ? Number(fd.get("when_gt"))
          : null,
      when_lt:
        fd.get("when_lt") !== "" && fd.get("when_lt") != null
          ? Number(fd.get("when_lt"))
          : null,
      device_id: fd.get("device_id") || null,
    }),
  });
  e.target.reset();
  loadHa();
});

/* Logs */
async function loadLogs() {
  const { logs } = await api("/panel/api/logs");
  const list = $("#logList");
  list.innerHTML = "";
  for (const log of logs) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <strong>[${escapeHtml(log.status)}] ${escapeHtml(log.text)}</strong>
        <div class="meta">${escapeHtml(log.created_at)} · ${escapeHtml(log.source)} · ${escapeHtml(log.priority)} · ${escapeHtml(log.detail || "")}</div>
      </div>`;
    list.appendChild(li);
  }
}

$("#refreshLogs").addEventListener("click", () => loadLogs());

$("#addSensorCardBtn")?.addEventListener("click", () => openSensorCardEditor());

$("#sensorCardCancel")?.addEventListener("click", () => hideSensorCardEditor());

$("#sensorCardDelete")?.addEventListener("click", async () => {
  const id = $("#sensorCardId")?.value;
  if (!id || !confirm("¿Eliminar esta tarjeta de sensor?")) return;
  try {
    await api(`/panel/api/sensor-cards/${id}`, { method: "DELETE" });
    hideSensorCardEditor();
    await refreshSensorGauges();
    setMsg($("#sensorCardMsg"), "Eliminado", "ok");
  } catch (err) {
    setMsg($("#sensorCardMsg"), err.message, "error");
  }
});

$("#sensorCardForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const id = String(fd.get("id") || "").trim();
  const alertEnabled = fd.get("alertEnabled") === "on";
  const intervalMin = fd.get("intervalMin");
  const deviceTargets = readQueueTargetsForSave($("#sensorCardTargets"), "sensor-card");
  const payload = {
    entityId: String(fd.get("entityId") || "").trim(),
    title: String(fd.get("title") || "").trim(),
    description: String(fd.get("description") || "").trim(),
    enabled: fd.get("enabled") === "on",
    alertEnabled,
    whenGt:
      fd.get("whenGt") !== "" && fd.get("whenGt") != null
        ? Number(fd.get("whenGt"))
        : null,
    whenLt:
      fd.get("whenLt") !== "" && fd.get("whenLt") != null
        ? Number(fd.get("whenLt"))
        : null,
    minDelta:
      fd.get("minDelta") !== "" && fd.get("minDelta") != null
        ? Number(fd.get("minDelta"))
        : null,
    intervalSec:
      intervalMin !== "" && intervalMin != null
        ? Math.max(60, Math.round(Number(intervalMin) * 60))
        : null,
    priority: fd.get("priority") || "warning",
    sound: fd.get("sound") === "on",
    alertTemplate:
      String(fd.get("alertTemplate") || "").trim() ||
      "{{ name }}: {{ state }}{{ unit }}",
    deviceId: deviceTargets.device_id,
    deviceIds: deviceTargets.device_ids,
  };
  try {
    if (id) {
      await api(`/panel/api/sensor-cards/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } else {
      await api("/panel/api/sensor-cards", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
    hideSensorCardEditor();
    await refreshSensorGauges();
    setMsg($("#sensorCardMsg"), "Guardado", "ok");
  } catch (err) {
    setMsg($("#sensorCardMsg"), err.message, "error");
  }
});

$("#sensorCardAlertEnabled")?.addEventListener("change", syncSensorCardAlertFields);

[
  "#sensorCardAlertTemplate",
  "#sensorCardTitle",
  "#sensorCardEntityId",
  "#sensorCardPriority",
].forEach((sel) => {
  $(sel)?.addEventListener("input", updateSensorNotifyPreview);
  $(sel)?.addEventListener("change", updateSensorNotifyPreview);
});

$("#sensorCardEntityId")?.addEventListener("change", () => {
  refreshSensorEditorLiveState().catch(() => {});
});

$("#sensorCardTestBtn")?.addEventListener("click", async () => {
  const text = renderClientTemplate(
    $("#sensorCardAlertTemplate")?.value || "{{ name }}: {{ state }}{{ unit }}",
    sensorNotifyPreviewVars(),
  ).trim();
  if (!text) {
    setMsg($("#sensorCardMsg"), "El texto de la notificación está vacío", "error");
    return;
  }
  const targets = readQueueTargets($("#sensorCardTargets"), "sensor-card");
  if (
    targets !== undefined &&
    !targets.length &&
    !$("#sensorCardTargets [data-target-all]")?.checked
  ) {
    setMsg($("#sensorCardMsg"), "Elegí al menos un reloj o marcá Todos", "error");
    return;
  }
  const btn = $("#sensorCardTestBtn");
  try {
    if (btn) btn.disabled = true;
    const body = {
      text,
      priority: $("#sensorCardPriority")?.value || "warning",
      sound: $("#sensorCardSound")?.checked || false,
      icon: "a2867",
    };
    if (targets?.length) body.devices = targets;
    const r = await api("/panel/api/notify", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setMsg($("#sensorCardMsg"), r.detail || "Prueba enviada", r.ok ? "ok" : "error");
  } catch (err) {
    setMsg($("#sensorCardMsg"), err.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
});

(async function init() {
  await loadSoundCatalog();
  await refreshStatus();
  showDeviceHome();
  await loadDevices();
  startGaugePolling();
  startSensorPolling();
  await loadConnectionCatalog();
  await loadCards();
  await loadAutomations();
  syncAutoSourceUI();
  await loadApps();
  await loadChannels();
  await loadHa();
  await loadLogs();
})().catch((err) => {
  $("#statusLine").textContent = `Error: ${err.message}`;
});
