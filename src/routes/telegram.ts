import { Hono } from "hono";
import { getBotUsername, telegramConfigured } from "../services/telegram.js";

export const telegramRoutes = new Hono();

/**
 * GET /api/telegram/info
 * Info pública del bot para que el panel arme el deep-link de vinculación
 * t.me/<username>?start=<contact_id>. El username no es secreto.
 */
telegramRoutes.get("/info", async (c) => {
  if (!telegramConfigured()) {
    return c.json({ configured: false, username: null });
  }
  const username = await getBotUsername();
  return c.json({ configured: Boolean(username), username });
});
