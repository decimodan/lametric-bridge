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
  });
});

async function refreshStatus() {
  const s = await api("/panel/api/status");
  const device = s.device.configured ? `LM ${s.device.host}` : "LM no configurado";
  const ha = s.ha.configured
    ? `HA ${s.ha.connected ? "conectado" : "idle"}`
    : "HA no configurado";
  $("#statusLine").textContent = `${device} · ${ha} · cola ${s.queue} · ${s.apps} apps · ${s.channels} canales`;
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
  for (const p of ["critical", "warning", "info"]) {
    const lane = $(`#lane-${p}`);
    lane.innerHTML = "";
    const items = data.items.filter((i) => i.priority === p);
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
          <input name="icon" value="a2867" style="width:7rem" />
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
    const preview = previewById[ent.id];
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
            <input name="icon" value="${escapeHtml(ent.icon)}" style="width:7rem" />
          </label>
          <button type="submit">Guardar texto</button>
        </div>
        <div class="meta">Preview: <strong data-preview-for="${ent.id}">${escapeHtml(preview?.preview || "(sin estado)")}</strong></div>
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
    }),
  });
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
