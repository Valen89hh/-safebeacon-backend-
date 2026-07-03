import { admin } from "../lib/supabase.js";
import { waManager } from "./wa-manager.js";
import { alertFields } from "../lib/format.js";
import { log } from "../lib/log.js";
import type { Alert } from "../lib/schemas.js";

export interface AlertInput extends Alert {
  device_key: string;
}

export interface DeliveryEntry {
  phone: string;
  ok: boolean;
  message_id?: string;
  error?: string;
}

export interface AlertOutcome {
  ok: boolean;
  code: number;
  error?: string;
  alert_id?: string;
  wa_connected?: boolean;
  queued?: number;
  total?: number;
}

/** Mensaje WhatsApp Markdown, personalizado con el nombre del usuario. */
function buildMessage(name: string | null, alert: Alert): string {
  const { horaLima, maps } = alertFields(alert);
  const quien = name
    ? `*${name}* activó su botón de pánico.`
    : "Se activó un botón de pánico.";
  return [
    "🚨 *ALERTA SAFEBEACON*",
    "",
    quien,
    "",
    "📍 Ver ubicación en Google Maps:",
    maps,
    "",
    `*Batería:* ${alert.battery_pct}%`,
    `*Hora:* ${horaLima} _(Lima, GMT-5)_`,
    `*Coordenadas:* ${alert.lat}, ${alert.lng}`,
  ].join("\n");
}

/**
 * Envía la alerta a los contactos en SEGUNDO PLANO y luego actualiza
 * la fila de la alerta con el resultado de entrega. No se espera (fire-and-forget)
 * para que la respuesta al ESP32 sea inmediata.
 */
async function dispatchDelivery(
  userId: string,
  alertId: string,
  name: string | null,
  alert: Alert,
  contacts: { name: string; phone: string }[]
): Promise<void> {
  const delivery: DeliveryEntry[] = [];
  const text = buildMessage(name, alert);

  for (const c of contacts) {
    try {
      const jid = await waManager.resolveJid(userId, c.phone);
      if (!jid) {
        delivery.push({
          phone: c.phone,
          ok: false,
          error: "No registrado en WhatsApp",
        });
        continue;
      }
      const sent = await waManager.sendText(userId, jid, text);
      delivery.push({
        phone: c.phone,
        ok: true,
        message_id: sent?.key?.id ?? undefined,
      });
    } catch (err) {
      delivery.push({
        phone: c.phone,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await admin
    .from("alerts")
    .update({ delivery })
    .eq("id", alertId)
    .then(
      () => {},
      () => {}
    );

  log("info", "alert_delivered", {
    user_id: userId,
    alert_id: alertId,
    sent: delivery.filter((d) => d.ok).length,
    total: contacts.length,
  });
}

/**
 * Procesa una alerta entrante: autentica el dispositivo, guarda la alerta de
 * inmediato y responde rápido; el envío por WhatsApp ocurre en segundo plano.
 * La alerta se guarda SIEMPRE (aunque WhatsApp esté caído) para alimentar el mapa.
 */
export async function handleAlert(input: AlertInput): Promise<AlertOutcome> {
  // 1. Autenticar dispositivo por device_id + device_key
  const { data: device, error: devErr } = await admin
    .from("devices")
    .select("id, user_id")
    .eq("device_id", input.device_id)
    .eq("device_key", input.device_key)
    .maybeSingle();

  if (devErr) {
    log("error", "device_lookup_failed", { error: devErr.message });
    return { ok: false, code: 500, error: "Error consultando el dispositivo" };
  }
  if (!device) {
    log("warn", "device_unauthorized", { device_id: input.device_id });
    return { ok: false, code: 401, error: "Dispositivo no autorizado" };
  }

  const userId = device.user_id as string;

  // 2. Perfil + contactos del usuario
  const [{ data: profile }, { data: contacts }] = await Promise.all([
    admin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    admin
      .from("emergency_contacts")
      .select("name, phone")
      .eq("user_id", userId)
      .order("priority", { ascending: true }),
  ]);

  const contactList = (contacts ?? []) as { name: string; phone: string }[];

  // last_seen del dispositivo (no bloqueante)
  admin
    .from("devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", device.id)
    .then(
      () => {},
      () => {}
    );

  // 3. Guardar la alerta de inmediato (delivery pendiente)
  const { data: alertRow, error: insErr } = await admin
    .from("alerts")
    .insert({
      user_id: userId,
      device_id: input.device_id,
      lat: input.lat,
      lng: input.lng,
      battery_pct: input.battery_pct,
      device_time: input.timestamp_iso,
      delivery: null,
    })
    .select("id")
    .single();

  if (insErr) {
    log("error", "alert_insert_failed", { error: insErr.message });
    return { ok: false, code: 500, error: "No se pudo registrar la alerta" };
  }

  const alertId = alertRow.id as string;
  const waConnected = waManager.isConnected(userId);

  // 4. Disparar el envío por WhatsApp en segundo plano (no se espera)
  if (waConnected && contactList.length > 0) {
    void dispatchDelivery(
      userId,
      alertId,
      profile?.full_name ?? null,
      input,
      contactList
    ).catch((err) =>
      log("error", "dispatch_failed", {
        alert_id: alertId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }

  log("info", "alert_received", {
    user_id: userId,
    device_id: input.device_id,
    wa_connected: waConnected,
    contacts: contactList.length,
  });

  return {
    ok: true,
    code: 200,
    alert_id: alertId,
    wa_connected: waConnected,
    queued: waConnected ? contactList.length : 0,
    total: contactList.length,
  };
}
