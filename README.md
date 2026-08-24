# lametric-bridge

Bridge HTTP para mandar notificaciones al Ulanzi TC001 con **AWTRIX NG**. Corre en Dokploy (`192.168.50.230`); otras apps de la LAN llaman a este servicio y el bridge habla con el reloj.

**Front:** [http://lametric.lan](http://lametric.lan)

## Producción (Dokploy)

Compose en la raíz (`docker-compose.yml`), red `dokploy-network`, dominio `lametric.lan` (LAN DNS ya apunta a `.230`).

En la pestaña **Environment** del servicio:

```env
AWTRIX_BASE_URL=http://192.168.50.98
BRIDGE_HOST=0.0.0.0
BRIDGE_PORT=8787
```

`AWTRIX_BASE_URL` tiene que ser la **IP** del reloj: mDNS (`*.local`) no resuelve dentro de Docker.

Tras un push a `main`, Dokploy reconstruye si el app tiene auto-deploy. El front queda en `http://lametric.lan`.

## Desarrollo local

```bash
cp .env.example .env
npm install
npm run dev
```

Abre `http://127.0.0.1:8787`.

## Cuando haga falta

Desde la LAN:

```bash
curl -X POST http://lametric.lan/api/notify \
  -H "Content-Type: application/json" \
  -d '{"text":"Hola","textColor":"#3DFF9A","wakeup":true,"durationMs":6000}'
```

CLI (misma máquina, contra el reloj directo):

```bash
npm run notify -- "Build listo"
npm run dismiss
```

Si defines `BRIDGE_TOKEN`, añade `Authorization: Bearer <token>` o `X-Bridge-Token`.

## API

| Método | Ruta | Uso |
| --- | --- | --- |
| `POST` | `/api/notify` | Encola una notificación |
| `DELETE` | `/api/notify` | Descarta la que está en pantalla |
| `DELETE` | `/api/notify/:name` | Descarta por nombre |
| `GET` | `/api/health` | Estado del bridge (y del reloj si responde) |
| `GET` | `/api/device` | `GET /api/v1/device` de AWTRIX |

Campos útiles en `POST /api/notify`: `text`, `textColor`, `icon`, `durationMs`, `name`, `hold`, `wakeup`, `sound`, `soundRtttl`.
