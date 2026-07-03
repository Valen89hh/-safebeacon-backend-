import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { alertRoutes } from "./routes/alert.js";
import { sessionRoutes } from "./routes/session.js";
import { waManager } from "./services/wa-manager.js";
import { log } from "./lib/log.js";

const START_TIME = Date.now();

const app = new Hono();

// CORS abierto para que el panel web y el ESP32 puedan llamar.
app.use("*", cors({ origin: "*" }));

// Healthcheck
app.get("/health", (c) =>
  c.json({
    status: "ok",
    uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000),
    timestamp: new Date().toISOString(),
  })
);

// Rutas
app.route("/api", alertRoutes); // /api/alert, /api/test
app.route("/api/session", sessionRoutes); // /api/session/start|status|logout

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  log("info", "server_started", {
    port: info.port,
    url: `http://localhost:${info.port}`,
  });

  // Restaura sesiones WhatsApp que estaban conectadas (creds en disco).
  waManager.restoreAll().catch((err) =>
    log("error", "restore_all_failed", {
      error: err instanceof Error ? err.message : String(err),
    })
  );
});
