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
  if (d.configured) {
    $("#deviceForm").host.value = d.host || "";
  }
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
  const list = $("#haEntityList");
  list.innerHTML = "";
  for (const ent of data.entities) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(ent.entity_id)}</strong>
        <div class="meta">${ent.mode} · ${escapeHtml(ent.template)}</div>
      </div>
      <button type="button" class="danger" data-del-ent="${ent.id}">Borrar</button>`;
    list.appendChild(li);
  }
  list.querySelectorAll("[data-del-ent]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/panel/api/ha/entities/${btn.dataset.delEnt}`, { method: "DELETE" });
      loadHa();
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
