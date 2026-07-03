import { Hono } from "hono";
import { alertSchema, testAlertFields } from "../lib/schemas.js";
import { handleAlert } from "../services/alerts.js";
import { log } from "../lib/log.js";

export const alertRoutes = new Hono();

/**
 * POST /api/alert
 * Recibe la alerta del ESP32. Auth por dispositivo:
 *   - header x-api-key: device_key del dispositivo
 *   - body.device_id: identifica el dispositivo
 */
alertRoutes.post("/alert", async (c) => {
  try {
    const deviceKey = c.req.header("x-api-key");
    if (!deviceKey) {
      return c.json({ ok: false, error: "Falta header x-api-key" }, 401);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "Body JSON inválido" }, 400);
    }

    const parsed = alertSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: "Body inválido", issues: parsed.error.issues },
        400
      );
    }

    const outcome = await handleAlert({ ...parsed.data, device_key: deviceKey });
    if (!outcome.ok) {
      return c.json({ ok: false, error: outcome.error }, outcome.code as 401);
    }

    return c.json(
      {
        ok: true,
        alert_id: outcome.alert_id,
        wa_connected: outcome.wa_connected,
        queued: outcome.queued,
        total: outcome.total,
      },
      200
    );
  } catch (err) {
    log("error", "alert_unexpected_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ ok: false, error: "Error interno del servidor" }, 500);
  }
});

/**
 * POST /api/test
 * Alerta simulada (coords hardcodeadas). Misma auth por dispositivo:
 *   - header x-api-key: device_key
 *   - header x-device-id: device_id
 */
alertRoutes.post("/test", async (c) => {
  try {
    const deviceKey = c.req.header("x-api-key");
    const deviceId = c.req.header("x-device-id");
    if (!deviceKey || !deviceId) {
      return c.json(
        { ok: false, error: "Faltan headers x-api-key y/o x-device-id" },
        401
      );
    }

    const outcome = await handleAlert({
      device_id: deviceId,
      device_key: deviceKey,
      ...testAlertFields(),
    });
    if (!outcome.ok) {
      return c.json({ ok: false, error: outcome.error }, outcome.code as 401);
    }

    return c.json(
      {
        ok: true,
        alert_id: outcome.alert_id,
        wa_connected: outcome.wa_connected,
        queued: outcome.queued,
        total: outcome.total,
      },
      200
    );
  } catch (err) {
    log("error", "test_unexpected_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ ok: false, error: "Error interno del servidor" }, 500);
  }
});
