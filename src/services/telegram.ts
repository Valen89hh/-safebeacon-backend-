import { admin } from "../lib/supabase.js";
import { log } from "../lib/log.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;

/** ¿Hay un bot de Telegram configurado? */
export function telegramConfigured(): boolean {
  return Boolean(API);
}

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function tg<T>(
  method: string,
  body: Record<string, unknown>
): Promise<T | null> {
  if (!API) return null;
  try {
    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as TgResponse<T>;
    if (!json.ok) {
      log("warn", "telegram_api_error", { method, description: json.description });
      return null;
    }
    return json.result ?? null;
  } catch (err) {
    log("warn", "telegram_request_failed", {
      method,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Escapa texto para parse_mode HTML de Telegram. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Envía un mensaje al chat de un contacto. Devuelve true si Telegram lo aceptó.
 * `text` puede contener HTML (parse_mode HTML).
 */
export async function sendTelegram(
  chatId: string,
  html: string
): Promise<boolean> {
  const result = await tg<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: false,
  });
  return result != null;
}

let cachedUsername: string | null = null;

/** Nombre de usuario del bot (para construir deep-links t.me/<user>?start=...). */
export async function getBotUsername(): Promise<string | null> {
  if (!API) return null;
  if (cachedUsername) return cachedUsername;
  const me = await tg<{ username?: string }>("getMe", {});
  cachedUsername = me?.username ?? null;
  return cachedUsername;
}

/**
 * Bot con long-polling. Escucha `/start <contact_id>` y vincula el chat del
 * contacto guardando su chat_id. Así el contacto se auto-registra abriendo el
 * deep-link, sin que nadie tenga que averiguar su chat_id a mano.
 */
interface TgUpdate {
  update_id: number;
  message?: {
    chat: { id: number; first_name?: string };
    text?: string;
  };
}

async function handleStart(contactId: string, chatId: number, firstName?: string) {
  // Vincula el chat solo si el contact_id existe.
  const { data, error } = await admin
    .from("emergency_contacts")
    .update({ telegram_chat_id: String(chatId) })
    .eq("id", contactId)
    .select("name")
    .maybeSingle();

  if (error || !data) {
    await sendTelegram(
      String(chatId),
      "⚠️ Este enlace de vinculación no es válido o expiró. Pídele a la persona que te comparta uno nuevo desde SafeBeacon."
    );
    return;
  }

  log("info", "telegram_linked", { contact_id: contactId, chat_id: chatId });
  await sendTelegram(
    String(chatId),
    `✅ <b>¡Listo, ${escapeHtml(firstName ?? data.name ?? "")}!</b>\n\n` +
      "Quedaste vinculado como contacto de emergencia en <b>SafeBeacon</b>. " +
      "Si se activa una alerta, recibirás la ubicación por aquí al instante."
  );
}

export function startTelegramBot(): void {
  if (!API) {
    log("info", "telegram_disabled", { msg: "TELEGRAM_BOT_TOKEN no configurado" });
    return;
  }

  let offset: number | undefined;
  let stopped = false;

  const poll = async () => {
    while (!stopped) {
      const updates = await tg<TgUpdate[]>("getUpdates", {
        offset,
        timeout: 50,
        allowed_updates: ["message"],
      });

      if (updates && updates.length > 0) {
        for (const u of updates) {
          offset = u.update_id + 1;
          const text = u.message?.text?.trim();
          const chat = u.message?.chat;
          if (!text || !chat) continue;

          if (text.startsWith("/start")) {
            const payload = text.split(/\s+/)[1];
            if (payload) {
              await handleStart(payload, chat.id, chat.first_name);
            } else {
              await sendTelegram(
                String(chat.id),
                "👋 Soy el bot de <b>SafeBeacon</b>. Para recibir alertas, abre el " +
                  "enlace de vinculación que te compartió tu contacto desde la app."
              );
            }
          }
        }
      }
    }
  };

  // getMe inicial (cachea el username) y arranca el loop.
  getBotUsername().then((u) =>
    log("info", "telegram_bot_started", { username: u })
  );
  poll().catch((err) =>
    log("error", "telegram_poll_crashed", {
      error: err instanceof Error ? err.message : String(err),
    })
  );
}
