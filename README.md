# Notifications Bridge

Hub de notificaciones en LAN: recibe eventos de apps locales / Home Assistant y los muestra en dispositivos de salida. Hoy son relojes [LaMetric Time](https://lametric.com/) y [AWTRIX](https://blueforcer.github.io/awtrix-light/) (Ulanzi TC001); el producto está pensado para sumar más marcas (Hue, Aqara, …).

El repo y el servicio se llaman `notifications-bridge`. El deploy en LAN sigue usando el host `lametric.lan` y la base Postgres `lametric_bridge` para no romper Dokploy ni las integraciones.

## Qué hace

- Recibe notificaciones y frames desde apps de la LAN (`X-API-Key`)
- Integra Home Assistant (WebSocket + polling fallback)
- Envía notificaciones a LaMetric y/o Ulanzi (AWTRIX), identificables por slug
- Alertas prediseñadas y cards personalizadas (panel **Alertas** / `card` en el API)
- Controla brillo desde el panel
- Expone frames persistentes en `/lametric/frames` para un Indicator App
- Panel web de configuración (basic auth)

## Quick start (local)

```bash
cp .env.example .env
# set DATABASE_URL to your Postgres (existing DB name: lametric_bridge)
npm install
npm run dev
```

Abre `http://localhost:3000` (usuario/password de `.env`). Las migraciones corren al arrancar.

## Docker

```bash
export DATABASE_URL=postgres://user:pass@host:5432/lametric_bridge
docker compose up --build
```

## Docs

- [Problem](docs/PROBLEM.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Integration](docs/INTEGRATION.md)
- [Agents](docs/AGENTS.md)

## API corto

```bash
curl -X POST http://localhost:3000/api/v1/notify \
  -H "Content-Type: application/json" \
  -H "X-API-Key: lb_..." \
    -d '{"text":"hola","priority":"info","device":"ulanzi"}'
```

Health: `GET /api/v1/health`
