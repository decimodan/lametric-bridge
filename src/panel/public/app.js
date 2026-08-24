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
  const device = s.device.configured ? `LM ${s.device.host}` : "LM no configurado";
  const ha = s.ha.configured
    ? `HA ${s.ha.connected ? "conectado" : "idle"}`
    : "HA no configurado";
  $("#statusLine").textContent = `${device} · ${ha} · cola ${s.queue} · ${s.apps} apps · ${s.channels} canales`;

  const deviceOk = !!s.device.configured;
  $("#statDeviceValue").textContent = deviceOk ? (s.device.host || "OK") : "—";
  $("#statDeviceMeta").textContent = deviceOk ? "configurado" : "sin configurar";
  $("#statDeviceDot").dataset.state = deviceOk ? "on" : "off";

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

/* Device */
async function loadDevice() {
  const d = await api("/panel/api/device");
  const form = $("#deviceForm");
  if (d.configured) {
    form.host.value = d.host || "";
  }
  const fromEnv = d.source === "env";
  form.host.readOnly = fromEnv;
  form.apiKey.readOnly = fromEnv;
  form.apiKey.required = !fromEnv;
  form.apiKey.placeholder = fromEnv ? "(desde variables de entorno)" : "device API key";
  $("#deviceSave").hidden = fromEnv;
  $("#deviceHint").textContent = fromEnv
    ? "Configurado vía LAMETRIC_DEVICE_IP / LAMETRIC_API_KEY (solo lectura en el panel)."
    : "IP o host del reloj en la LAN y API key de developer (local).";
}


$("#deviceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("/panel/api/device", {
      method: "PUT",
      body: JSON.stringify({
        host: fd.get("host"),
        apiKey: fd.get("apiKey"),
      }),
    });
    setMsg($("#deviceMsg"), "Guardado", "ok");
    refreshStatus();
  } catch (err) {
    setMsg($("#deviceMsg"), err.message, "error");
  }
});

$("#deviceTest").addEventListener("click", async () => {
  try {
    const r = await api("/panel/api/device/test", { method: "POST", body: "{}" });
    setMsg($("#deviceMsg"), r.detail, r.ok ? "ok" : "error");
  } catch (err) {
    setMsg($("#deviceMsg"), err.message, "error");
  }
});

async function sendToLametric(payload) {
  const r = await api("/panel/api/device/notify", {
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
    await sendToLametric({
      text: String(fd.get("text") || "").trim(),
      icon: String(fd.get("icon") || "").trim() || undefined,
      priority: fd.get("priority") || "info",
      sound: fd.get("sound") === "on",
    });
  } catch (err) {
    setMsg($("#notifyMsg"), err.message, "error");
  }
});

$("#notifyTest").addEventListener("click", async () => {
  try {
    await sendToLametric({
      text: "Prueba lametric-bridge",
      priority: "info",
      sound: true,
    });
  } catch (err) {
    setMsg($("#notifyMsg"), err.message, "error");
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
        <div class="meta">${escapeHtml(ent.entity_id)} · ${escapeHtml(ent.mode)}</div>
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
    ? `Enviando: [${cur.priority}] ${cur.text}`
    : "Enviando: —";

  for (const p of ["critical", "warning", "info"]) {
    const lane = $(`#lane-${p}`);
    lane.innerHTML = "";
    const items = (data.items || []).filter((i) => i.priority === p);
    for (const item of items) {
      const li = document.createElement("li");
      li.innerHTML = `
        <strong>#${item.position} ${escapeHtml(item.text)}</strong>
        <div class="meta">${escapeHtml(item.source)} · ${new Date(item.enqueuedAt).toLocaleTimeString()}</div>`;
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
          <div class="meta">${escapeHtml(ent.entity_id)} · ${escapeHtml(ent.mode)}</div>
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
  await loadDevice();
  await loadApps();
  await loadChannels();
  await loadHa();
  await loadLogs();
})().catch((err) => {
  $("#statusLine").textContent = `Error: ${err.message}`;
});
