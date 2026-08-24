export function renderUi(token?: string): string {
  const tokenJson = JSON.stringify(token ?? "");
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LaMetric Bridge</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b0d10;
      --panel: #151920;
      --line: #2a3140;
      --text: #e8edf5;
      --muted: #8b97ab;
      --accent: #3dff9a;
      --warn: #ff5a7a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, sans-serif;
      background: radial-gradient(circle at top, #1a2230, var(--bg) 45%);
      color: var(--text);
    }
    main {
      max-width: 640px;
      margin: 0 auto;
      padding: 32px 20px 64px;
    }
    h1 { font-size: 1.4rem; margin: 0 0 8px; }
    p.lead { color: var(--muted); margin: 0 0 24px; }
    form, .status {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 20px;
    }
    label { display: block; font-size: 0.8rem; color: var(--muted); margin-bottom: 6px; }
    input, textarea {
      width: 100%;
      margin-bottom: 14px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: #0f1318;
      color: var(--text);
      font: inherit;
    }
    textarea { min-height: 88px; resize: vertical; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .checks { display: flex; gap: 16px; margin: 4px 0 16px; }
    .checks label { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--text); }
    .checks input { width: auto; margin: 0; }
    .actions { display: flex; gap: 10px; }
    button {
      border: 0;
      border-radius: 999px;
      padding: 10px 16px;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    button.primary { background: var(--accent); color: #062113; }
    button.ghost { background: transparent; color: var(--text); border: 1px solid var(--line); }
    .status { margin-top: 16px; color: var(--muted); min-height: 1.4em; }
    .status.ok { color: var(--accent); }
    .status.err { color: var(--warn); }
    @media (max-width: 560px) { .row, .actions, .checks { grid-template-columns: 1fr; display: grid; } }
  </style>
</head>
<body>
  <main>
    <h1>LaMetric Bridge</h1>
    <p class="lead">Envía una notificación al Ulanzi TC001 (AWTRIX NG) en cuanto haga falta.</p>
    <form id="notify-form">
      <label for="text">Texto</label>
      <textarea id="text" name="text" required placeholder="Puerta abierta, build listo, recordatorio…">Hola desde el bridge</textarea>
      <div class="row">
        <div>
          <label for="textColor">Color</label>
          <input id="textColor" name="textColor" value="#3DFF9A" />
        </div>
        <div>
          <label for="durationMs">Duración (ms)</label>
          <input id="durationMs" name="durationMs" type="number" min="0" value="6000" />
        </div>
      </div>
      <div class="row">
        <div>
          <label for="icon">Icono (id AWTRIX / LaMetric)</label>
          <input id="icon" name="icon" placeholder="opcional" />
        </div>
        <div>
          <label for="name">Nombre (para descartar después)</label>
          <input id="name" name="name" placeholder="opcional" />
        </div>
      </div>
      <div class="checks">
        <label><input id="wakeup" type="checkbox" checked /> Encender pantalla</label>
        <label><input id="hold" type="checkbox" /> Mantener hasta descartar</label>
      </div>
      <div class="actions">
        <button class="primary" type="submit">Enviar</button>
        <button class="ghost" id="dismiss" type="button">Descartar</button>
      </div>
    </form>
    <div class="status" id="status">Listo.</div>
  </main>
  <script>
    const token = ${tokenJson};
    const statusEl = document.getElementById("status");
    const headers = { "Content-Type": "application/json" };
    if (token) headers["X-Bridge-Token"] = token;

    function setStatus(text, kind) {
      statusEl.textContent = text;
      statusEl.className = "status" + (kind ? " " + kind : "");
    }

    async function parse(res) {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || res.statusText);
      return body;
    }

    document.getElementById("notify-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatus("Enviando…");
      try {
        const payload = {
          text: document.getElementById("text").value,
          textColor: document.getElementById("textColor").value,
          durationMs: Number(document.getElementById("durationMs").value) || undefined,
          icon: document.getElementById("icon").value || undefined,
          name: document.getElementById("name").value || undefined,
          wakeup: document.getElementById("wakeup").checked,
          hold: document.getElementById("hold").checked,
        };
        await parse(await fetch("/api/notify", { method: "POST", headers, body: JSON.stringify(payload) }));
        setStatus("Notificación enviada al reloj.", "ok");
      } catch (error) {
        setStatus(error.message || "No se pudo enviar", "err");
      }
    });

    document.getElementById("dismiss").addEventListener("click", async () => {
      setStatus("Descartando…");
      try {
        const name = document.getElementById("name").value;
        const url = name ? "/api/notify/" + encodeURIComponent(name) : "/api/notify";
        await parse(await fetch(url, { method: "DELETE", headers }));
        setStatus("Notificación descartada.", "ok");
      } catch (error) {
        setStatus(error.message || "No se pudo descartar", "err");
      }
    });
  </script>
</body>
</html>`;
}
