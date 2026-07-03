import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import { admin } from "../lib/supabase.js";
import { log } from "../lib/log.js";
import {
  useSupabaseAuthState,
  clearSupabaseAuthState,
} from "./wa-auth-state.js";

const silentLogger: any = {
  level: "silent",
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  child() {
    return silentLogger;
  },
};

export type SessionStatus =
  | "waiting_qr"
  | "connected"
  | "disconnected"
  | "logged_out";

interface Session {
  socket: WASocket;
  status: SessionStatus;
  qr: string | null; // dataURL base64 para mostrar en la web
  retry: number;
  saveCreds: () => Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Maneja una sesión Baileys por usuario (Modelo A).
 * Patrones reusados de addo-whatsapp: QR, reconexión con backoff,
 * creds.update -> saveCreds, manejo de loggedOut.
 */
class WAManager {
  private sessions = new Map<string, Session>();
  private starting = new Map<string, Promise<void>>();
  private readonly MAX_RETRIES = 5;
  private readonly DELAYS = [5000, 10000, 20000, 30000, 45000];

  /** Inicia (o reusa) la sesión de un usuario y espera brevemente por QR/conexión. */
  async startSession(
    userId: string
  ): Promise<{ status: SessionStatus; qr: string | null }> {
    const existing = this.sessions.get(userId);
    if (existing?.status === "connected") {
      return { status: "connected", qr: null };
    }
    if (!this.sessions.has(userId)) {
      await this.init(userId);
    }

    const s = this.sessions.get(userId)!;
    const start = Date.now();
    while (!s.qr && s.status !== "connected" && Date.now() - start < 12000) {
      await sleep(400);
    }
    return { status: s.status, qr: s.qr };
  }

  getStatus(userId: string): { status: SessionStatus; qr: string | null } {
    const s = this.sessions.get(userId);
    if (!s) return { status: "disconnected", qr: null };
    return { status: s.status, qr: s.qr };
  }

  isConnected(userId: string): boolean {
    return this.sessions.get(userId)?.status === "connected";
  }

  /** Devuelve el jid si el número existe en WhatsApp, o null. */
  async resolveJid(userId: string, rawNumber: string): Promise<string | null> {
    const s = this.sessions.get(userId);
    if (!s || s.status !== "connected") return null;
    const num = rawNumber.replace(/\D/g, "");
    if (!num) return null;
    const [info] = (await s.socket.onWhatsApp(num)) ?? [];
    return info?.exists && info.jid ? info.jid : null;
  }

  async sendText(userId: string, jid: string, text: string) {
    const s = this.sessions.get(userId);
    if (!s || s.status !== "connected") {
      throw new Error("La sesión de WhatsApp del usuario no está conectada");
    }
    return s.socket.sendMessage(jid, { text });
  }

  async logout(userId: string): Promise<void> {
    const s = this.sessions.get(userId);
    if (s) {
      try {
        await s.socket.logout();
      } catch {
        /* ignore */
      }
      this.sessions.delete(userId);
    }
    await clearSupabaseAuthState(userId).catch(() => {});
    await this.setDbStatus(userId, "logged_out");
  }

  /** Restaura en el arranque las sesiones que estaban conectadas. */
  async restoreAll(): Promise<void> {
    try {
      const { data } = await admin
        .from("whatsapp_sessions")
        .select("user_id")
        .eq("status", "connected");
      const ids = (data ?? []).map((r: { user_id: string }) => r.user_id);
      log("info", "wa_restore_start", { count: ids.length });
      for (const id of ids) {
        try {
          await this.init(id);
        } catch (err) {
          log("warn", "wa_restore_failed", {
            user_id: id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      log("warn", "wa_restore_skipped", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // -----------------------------------------------------------------
  private async setDbStatus(
    userId: string,
    status: SessionStatus,
    phone?: string | null
  ): Promise<void> {
    await admin
      .from("whatsapp_sessions")
      .upsert(
        {
          user_id: userId,
          status,
          ...(phone !== undefined ? { phone } : {}),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .then(
        () => {},
        () => {}
      );
  }

  private async init(userId: string): Promise<void> {
    const inFlight = this.starting.get(userId);
    if (inFlight) return inFlight;

    const promise = this._init(userId).finally(() =>
      this.starting.delete(userId)
    );
    this.starting.set(userId, promise);
    return promise;
  }

  private async _init(userId: string): Promise<void> {
    const { state, saveCreds } = await useSupabaseAuthState(userId);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
      },
      printQRInTerminal: false,
      browser: ["SafeBeacon", "Chrome", "1.0"],
      logger: silentLogger,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
    });

    const session: Session = {
      socket,
      status: "waiting_qr",
      qr: null,
      retry: 0,
      saveCreds,
    };
    this.sessions.set(userId, session);

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on(
      "connection.update",
      async (update: Partial<ConnectionState>) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            session.qr = await QRCode.toDataURL(qr);
          } catch {
            session.qr = null;
          }
          session.status = "waiting_qr";
          await this.setDbStatus(userId, "waiting_qr");
          log("info", "wa_qr", { user_id: userId });
          console.log(`\n📲 QR para usuario ${userId} (escanear con WhatsApp):\n`);
          qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === "open") {
          const phone =
            socket.user?.id?.split(":")[0]?.split("@")[0] ?? null;
          session.status = "connected";
          session.qr = null;
          session.retry = 0;
          await this.setDbStatus(userId, "connected", phone);
          log("info", "wa_connected", { user_id: userId, phone });
        }

        if (connection === "close") {
          session.qr = null;
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;

          if (loggedOut) {
            session.status = "logged_out";
            this.sessions.delete(userId);
            await clearSupabaseAuthState(userId).catch(() => {});
            await this.setDbStatus(userId, "logged_out", null);
            log("warn", "wa_logged_out", { user_id: userId });
            return;
          }

          if (session.retry < this.MAX_RETRIES) {
            const delay = this.DELAYS[session.retry] ?? 45000;
            session.retry++;
            session.status = "disconnected";
            await this.setDbStatus(userId, "disconnected");
            log("warn", "wa_reconnecting", {
              user_id: userId,
              statusCode,
              retry: session.retry,
              delay,
            });
            this.sessions.delete(userId);
            await sleep(delay);
            this.init(userId).catch((err) =>
              log("error", "wa_reconnect_failed", {
                user_id: userId,
                error: err instanceof Error ? err.message : String(err),
              })
            );
          } else {
            session.status = "disconnected";
            this.sessions.delete(userId);
            await this.setDbStatus(userId, "disconnected");
            log("error", "wa_give_up", { user_id: userId, statusCode });
          }
        }
      }
    );
  }
}

export const waManager = new WAManager();
