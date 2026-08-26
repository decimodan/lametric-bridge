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

/* Tabs */
$$("#tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$("#tabs button").forEach((b) => b.classList.remove("active"));
    $$(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(`#tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "device") {
      loadDevices().catch((e) => setMsg($("#deviceMsg"), e.message, "error"));
    }
    if (btn.dataset.tab === "cards") {
      loadCards().catch((e) => setMsg($("#cardMsg"), e.message, "error"));
    }
    if (btn.dataset.tab === "queue") {
      loadQueueTab().catch((e) => setMsg($("#queueMsg"), e.message, "error"));
      startQueuePolling();
    } else {
      stopQueuePolling();
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

function deviceOptions(selected = "", includeAll = true) {
  const all = includeAll ? `<option value="" ${selected === "" ? "selected" : ""}>Todos</option>` : "";
  return all + cachedDevices.map((d) =>
    `<option value="${escapeHtml(d.id)}" ${selected === d.id || selected === d.slug ? "selected" : ""}>${escapeHtml(d.name)} (${escapeHtml(d.slug)})</option>`
  ).join("");
}

function fillDeviceSelects() {
  $$("#notifyDevice, #haDeviceSelect, #cardDeviceSelect").forEach((sel) => {
    const current = sel.value;
    sel.innerHTML = deviceOptions(current, true);
  });
}

async function loadDevices() {
  const { devices } = await api("/panel/api/devices");
  cachedDevices = devices || [];
  fillDeviceSelects();
  const list = $("#deviceList");
  list.innerHTML = "";
  if (!cachedDevices.length) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="meta">No hay relojes. Agregá uno o definí LAMETRIC_* / AWTRIX_BASE_URL.</div>`;
    list.appendChild(li);
    return;
  }

  for (const d of cachedDevices) {
    const li = document.createElement("li");
    const kindLabel = d.kind === "awtrix" ? "Ulanzi / AWTRIX" : "LaMetric";
    const env = d.envManaged ? `<span class="badge">env</span>` : "";
    li.innerHTML = `
      <div class="device-card-top">
        <div>
          <strong>${escapeHtml(d.name)}</strong> ${env}
          <div class="meta">${escapeHtml(kindLabel)} · slug <code>${escapeHtml(d.slug)}</code> · ${escapeHtml(d.host)}</div>
        </div>
        <div class="device-actions">
          <button type="button" class="secondary" data-test="${d.id}">Probar</button>
          <button type="button" data-identify="${d.id}">Identificar</button>
          ${d.envManaged ? "" : `<button type="button" class="danger" data-del-dev="${d.id}">Borrar</button>`}
        </div>
      </div>
      <form class="brightness" data-bright="${d.id}">
        <label>Brillo <span data-bright-val="${d.id}">—</span>%
          <input type="range" min="0" max="100" value="50" data-bright-range="${d.id}" />
        </label>
        <label class="check">
          <input type="checkbox" data-bright-auto="${d.id}" />
          Automático
        </label>
        <button type="submit">Aplicar brillo</button>
      </form>`;
    list.appendChild(li);
    loadDeviceStatus(d.id).catch(() => {});
  }

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
      } catch (err) {
        setMsg($("#deviceMsg"), err.message, "error");
      }
    });
  });
}

async function loadDeviceStatus(id) {
  const r = await api(`/panel/api/devices/${id}/status`);
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
        apiKey: fd.get("apiKey") || undefined,
      }),
    });
    e.target.reset();
    setMsg($("#deviceMsg"), "Reloj agregado", "ok");
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
  try {
    await sendNotify({
      text: String(fd.get("text") || "").trim(),
      icon: String(fd.get("icon") || "").trim() || undefined,
      priority: fd.get("priority") || "info",
      sound: fd.get("sound") === "on",
      device: fd.get("device") || undefined,
    });
  } catch (err) {
    setMsg($("#notifyMsg"), err.message, "error");
  }
});

$("#notifyTest").addEventListener("click", async () => {
  try {
    await sendNotify({
      text: "Prueba lametric-bridge",
      priority: "info",
      sound: true,
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
    const sound = c.sound ? " · sonido" : "";
    tile.innerHTML = `
      <header>
        <p class="tile-name">${escapeHtml(c.name)}</p>
        <div>${preset}${priorityBadge(c.priority)}</div>
      </header>
      <p class="tile-text">${escapeHtml(c.text)}</p>
      <div class="tile-meta">${escapeHtml(c.slug)} · ${escapeHtml(c.icon)}${sound}</div>
      <div class="tile-actions">
        <button type="button" data-send-card="${c.id}">Enviar</button>
        <button type="button" class="secondary" data-edit-card="${c.id}">Editar</button>
        ${c.isPreset ? "" : `<button type="button" class="danger" data-del-card="${c.id}">Borrar</button>`}
      </div>`;
    grid.appendChild(tile);
  }

  grid.querySelectorAll("[data-send-card]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const r = await api(`/panel/api/cards/${btn.dataset.sendCard}/send`, {
          method: "POST",
          body: JSON.stringify({
            device: $("#cardDeviceSelect").value || undefined,
          }),
        });
        setMsg($("#cardMsg"), r.detail, r.ok ? "ok" : "error");
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
      $("#cardEditId").value = card.id;
      $("#cardSaveBtn").textContent = "Guardar";
      $("#cardCancelEdit").hidden = false;
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

function resetCardForm() {
  const form = $("#cardForm");
  form.reset();
  form.icon.value = "a2867";
  $("#cardEditId").value = "";
  $("#cardSaveBtn").textContent = "Crear";
  $("#cardCancelEdit").hidden = true;
}

$("#cardCancelEdit").addEventListener("click", () => resetCardForm());

$("#cardForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const id = String(fd.get("id") || "").trim();
  const payload = {
    name: String(fd.get("name") || "").trim(),
    slug: String(fd.get("slug") || "").trim().toLowerCase(),
    text: String(fd.get("text") || "").trim(),
    icon: String(fd.get("icon") || "").trim() || "a2867",
    priority: fd.get("priority") || "info",
    sound: fd.get("sound") === "on",
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
  } catch (err) {
    setMsg($("#cardMsg"), err.message, "error");
  }
});

/* Queue / send entities */
let queuePollTimer = null;

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

async function loadQueueEntities() {
  const { entities } = await api("/panel/api/ha/previews");
  const list = $("#queueEntityList");
  list.innerHTML = "";
  if (!entities.length) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="meta">No hay entidades mapeadas. Agregalas en la pestaña Home Assistant.</div>`;
    list.appendChild(li);
    return;
  }
  for (const ent of entities) {
    const li = document.createElement("li");
    const preview = ent.preview || "(sin estado)";
    const name = ent.friendly_name || ent.entity_id;
    li.innerHTML = `
      <div style="flex:1">
        <strong>${escapeHtml(name)}</strong>
        <div class="meta">${escapeHtml(ent.entity_id)} · ${escapeHtml(ent.mode)} · ${escapeHtml(ent.device_name || "todos")}</div>
        <div style="margin-top:0.35rem">${escapeHtml(preview)}</div>
      </div>
      <div class="entity-send">
        <select data-prio-for="${ent.id}">
          <option value="info">info</option>
          <option value="warning">warning</option>
          <option value="critical" selected>critical</option>
        </select>
        <button type="button" data-send-ent="${ent.id}">Encolar</button>
      </div>`;
    list.appendChild(li);
  }
  list.querySelectorAll("[data-send-ent]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.sendEnt;
      const sel = list.querySelector(`[data-prio-for="${id}"]`);
      const priority = sel ? sel.value : "critical";
      try {
        btn.disabled = true;
        const r = await api(`/panel/api/ha/entities/${id}/send`, {
          method: "POST",
          body: JSON.stringify({ priority, sound: priority === "critical" }),
        });
        setMsg($("#queueMsg"), `${r.detail}: ${r.text || ""}`, "ok");
        await loadQueueBoard();
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
  const data = await api("/panel/api/queue");
  $("#queueSizeLabel").textContent = `(${data.size})`;
  const cur = data.current;
  $("#queueCurrentLabel").textContent = cur
    ? `Enviando: [${cur.priority}] ${cur.text}${cur.deviceId ? ` → ${cur.deviceId}` : ""}`
    : "Enviando: —";

  for (const p of ["critical", "warning", "info"]) {
    const lane = $(`#lane-${p}`);
    lane.innerHTML = "";
    const items = (data.items || []).filter((i) => i.priority === p);
    for (const item of items) {
      const li = document.createElement("li");
      li.innerHTML = `
        <strong>#${item.position} ${escapeHtml(item.text)}</strong>
        <div class="meta">${escapeHtml(item.source)}${item.deviceId ? ` · ${escapeHtml(item.deviceId)}` : ""} · ${new Date(item.enqueuedAt).toLocaleTimeString()}</div>`;
      lane.appendChild(li);
    }
  }

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
  await loadQueueEntities();
  await loadQueueBoard();
}

$("#refreshQueueEntities").addEventListener("click", () => {
  loadQueueEntities().catch((e) => setMsg($("#queueMsg"), e.message, "error"));
});

$("#clearQueueBtn").addEventListener("click", async () => {
  try {
    const r = await api("/panel/api/queue", { method: "DELETE" });
    setMsg($("#queueMsg"), `Cola vaciada (${r.cleared})`, "ok");
    await loadQueueBoard();
    refreshStatus();
  } catch (err) {
    setMsg($("#queueMsg"), err.message, "error");
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

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

(async function init() {
  await refreshStatus();
  await loadDevices();
  await loadCards();
  await loadApps();
  await loadChannels();
  await loadHa();
  await loadLogs();
})().catch((err) => {
  $("#statusLine").textContent = `Error: ${err.message}`;
});
