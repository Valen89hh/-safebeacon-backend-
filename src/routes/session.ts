import { Hono } from "hono";
import { getUserFromToken } from "../lib/supabase.js";
import { waManager } from "../services/wa-manager.js";
import { log } from "../lib/log.js";

export const sessionRoutes = new Hono();

/** Extrae y valida el Bearer token; devuelve el user id o null. */
async function authUser(authHeader: string | undefined) {
  const token = (authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  return getUserFromToken(token);
}

/**
 * POST /api/session/start
 * Inicia/vincula la sesión WhatsApp del usuario autenticado.
 * Devuelve el QR (dataURL base64) para escanear, o status connected.
 */
sessionRoutes.post("/start", async (c) => {
  try {
    const user = await authUser(c.req.header("authorization"));
    if (!user) return c.json({ ok: false, error: "No autorizado" }, 401);

    const result = await waManager.startSession(user.id);
    log("info", "session_start", { user_id: user.id, status: result.status });
    return c.json({ ok: true, ...result }, 200);
  } catch (err) {
    log("error", "session_start_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ ok: false, error: "Error iniciando la sesión" }, 500);
  }
});

/**
 * GET /api/session/status
 * Estado actual de la sesión del usuario (para que la web haga polling).
 */
sessionRoutes.get("/status", async (c) => {
  try {
    const user = await authUser(c.req.header("authorization"));
    if (!user) return c.json({ ok: false, error: "No autorizado" }, 401);

    return c.json({ ok: true, ...waManager.getStatus(user.id) }, 200);
  } catch (err) {
    log("error", "session_status_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ ok: false, error: "Error consultando estado" }, 500);
  }
});

/**
 * POST /api/session/logout
 * Desvincula el WhatsApp del usuario.
 */
sessionRoutes.post("/logout", async (c) => {
  try {
    const user = await authUser(c.req.header("authorization"));
    if (!user) return c.json({ ok: false, error: "No autorizado" }, 401);

    await waManager.logout(user.id);
    log("info", "session_logout", { user_id: user.id });
    return c.json({ ok: true }, 200);
  } catch (err) {
    log("error", "session_logout_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ ok: false, error: "Error cerrando la sesión" }, 500);
  }
});
