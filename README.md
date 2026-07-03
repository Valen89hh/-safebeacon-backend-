# SafeBeacon — Backend (V1)

**SafeBeacon** es un sistema de botón de pánico basado en un **ESP32-C3** que, al ser presionado, envía una alerta con geolocalización GPS a los contactos de emergencia. Este repositorio contiene el **backend del prototipo académico V1**, desarrollado en el curso de Innovación de **TECSUP**. En esta fase el backend solo recibe alertas (del dispositivo físico o de un simulador web) y las reenvía — sin base de datos, todo se loguea a consola y se reenvía directo.

El backend soporta dos canales de notificación, seleccionables con `NOTIFICATION_PROVIDER`:

- **`baileys`** (por defecto) → WhatsApp vía [Baileys](https://github.com/WhiskeySockets/Baileys). Si Telegram está configurado, queda como **fallback** automático cuando WhatsApp falla.
- **`telegram`** → bot de Telegram (Bot API).

> ⚠️ **Baileys usa WhatsApp Web no oficial.** Escanea el QR con un **número de WhatsApp dedicado**, no tu cuenta personal — existe riesgo de baneo.

---

## 1. Crear el bot de Telegram y obtener el `chat_id`

### a) Crear el bot con @BotFather

1. Abre Telegram y busca **@BotFather**.
2. Envía `/newbot`.
3. Elige un **nombre** (ej. `SafeBeacon Alertas`) y un **username** que termine en `bot` (ej. `safebeacon_tecsup_bot`).
4. BotFather te dará un **token** con este formato:
   `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
   → ese es tu `TELEGRAM_BOT_TOKEN`.

### b) Obtener el `chat_id`

1. Abre un chat con tu nuevo bot (búscalo por su username) y envíale cualquier mensaje, ej. `hola`.
   > Importante: el bot **no puede** escribirte primero; tú debes mandarle un mensaje antes.
2. En tu navegador, abre (reemplazando `<TOKEN>`):
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
3. Busca en la respuesta JSON el campo `"chat":{"id":...}`. Ese número es tu `TELEGRAM_CHAT_ID`.
   - Para chats privados es un entero positivo (ej. `987654321`).
   - Para un **grupo**, agrega el bot al grupo, envía un mensaje y vuelve a `getUpdates`; el id del grupo suele ser negativo (ej. `-100123456789`).

---

## 2. Setup local

Requisitos: **Node.js 20+**.

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar la plantilla de variables de entorno
cp .env.example .env      # en Windows PowerShell: copy .env.example .env

# 3. Editar .env y completar los valores
#    TELEGRAM_BOT_TOKEN=...
#    TELEGRAM_CHAT_ID=...
#    API_KEY=algo-aleatorio-y-secreto
#    PORT=3000

# 4. Levantar el servidor en modo desarrollo (hot reload con tsx)
npm run dev
```

Al iniciar verás un log JSON: `{"event":"server_started","port":3000,...}`.

- Simulador web: <http://localhost:3000/>
- Healthcheck: <http://localhost:3000/health>

---

## 3. Variables de entorno

| Variable                | Descripción                                                       |
| ----------------------- | ---------------------------------------------------------------- |
| `NOTIFICATION_PROVIDER` | `baileys` (WhatsApp, por defecto) o `telegram`.                  |
| `BAILEYS_TARGET_NUMBER` | Número destino de WhatsApp con código de país, sin `+` (ej. `51987654321`). |
| `TELEGRAM_BOT_TOKEN`    | Token del bot obtenido de @BotFather (fallback / provider Telegram). |
| `TELEGRAM_CHAT_ID`      | ID del chat/grupo donde llegarán las alertas.                    |
| `API_KEY`               | Clave que el ESP32 (y el simulador) deben enviar en `x-api-key`. |
| `PORT`                  | Puerto del servidor (por defecto 3000).                         |

### Conectar WhatsApp (Baileys)

1. Con `NOTIFICATION_PROVIDER=baileys`, levanta el server (`npm run dev`).
2. En el **primer arranque** se imprime un **QR en la consola**.
3. Escanéalo con WhatsApp → **Dispositivos vinculados → Vincular dispositivo** (usa un número dedicado).
4. La sesión se guarda en `auth_baileys/`. En los siguientes reinicios **reconecta solo, sin pedir QR de nuevo**.
5. Si el log muestra `baileys_logged_out` (cerraste la sesión desde el teléfono), borra `auth_baileys/` y vuelve a escanear.

---

## 4. Probar con curl

### `POST /api/test` (alerta simulada, coords de Plaza de Armas de Trujillo)

```bash
curl -X POST http://localhost:3000/api/test \
  -H "x-api-key: TU_API_KEY"
```

### `POST /api/alert` (payload completo como el del ESP32)

```bash
curl -X POST http://localhost:3000/api/alert \
  -H "Content-Type: application/json" \
  -H "x-api-key: TU_API_KEY" \
  -d '{
    "device_id": "SB-001",
    "lat": -8.1116,
    "lng": -79.0287,
    "battery_pct": 87,
    "timestamp_iso": "2026-06-04T15:30:00Z"
  }'
```

Respuesta esperada (200):

```json
{ "ok": true, "telegram_message_id": 42 }
```

Códigos de error posibles:

- `401` → falta o no coincide `x-api-key`.
- `400` → body inválido (Zod devuelve el detalle en `issues`).
- `502` → Telegram respondió error (revisa token / chat_id).

---

## 5. Endpoints

| Método | Ruta         | Descripción                                       |
| ------ | ------------ | ------------------------------------------------- |
| `GET`  | `/`          | Simulador web (HTML standalone).                  |
| `GET`  | `/health`    | Estado del servicio (`status`, `uptime_seconds`). |
| `POST` | `/api/alert` | Recibe alerta del ESP32 y la reenvía a Telegram.  |
| `POST` | `/api/test`  | Alerta simulada con coordenadas hardcodeadas.     |

---

## 6. Deploy a Render (free tier)

1. Sube este repositorio a GitHub.
2. En [Render](https://render.com): **New +** → **Web Service** → conecta el repo.
3. Render detectará `render.yaml` automáticamente. Si lo configuras manualmente:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/health`
4. En **Environment**, agrega las variables (marcadas como `sync: false` en `render.yaml`):
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `API_KEY`
5. **Create Web Service** y espera el deploy. Tu backend quedará en `https://<tu-servicio>.onrender.com`.

> Nota: en el free tier el servicio "duerme" tras inactividad; la primera petición tras dormir puede tardar ~30 s.

---

## 7. Integración futura — payload del ESP32

El dispositivo ESP32-C3 enviará un `POST /api/alert` con este formato:

```http
POST /api/alert HTTP/1.1
Host: <tu-servicio>.onrender.com
Content-Type: application/json
x-api-key: TU_API_KEY

{
  "device_id": "SB-001",
  "lat": -8.1116,
  "lng": -79.0287,
  "battery_pct": 87,
  "timestamp_iso": "2026-06-04T15:30:00Z"
}
```

Reglas de validación (Zod):

- `device_id`: string no vacío (máx. 64).
- `lat`: número entre -90 y 90.
- `lng`: número entre -180 y 180.
- `battery_pct`: entero entre 0 y 100.
- `timestamp_iso`: fecha ISO 8601 válida.

---

## Stack

Node.js 20+ · TypeScript (strict) · [Hono](https://hono.dev) · [Zod](https://zod.dev) · deploy en Render.

_Proyecto académico — SafeBeacon · TECSUP._
