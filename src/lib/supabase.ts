import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

// @supabase/supabase-js (realtime-js) exige un WebSocket global. En Node < 22
// no existe, así que se lo proveemos explícitamente vía la opción realtime.transport.
// (El backend no usa realtime, pero el cliente lo inicializa al construirse.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const realtimeOpts = { transport: ws as any };

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !serviceKey) {
  // No lanzamos en import para permitir /health; se reporta al usarse.
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      event: "supabase_env_missing",
      msg: "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY",
    })
  );
}

/**
 * Cliente administrador (service_role): bypassa RLS.
 * Úsalo para leer devices/contacts y escribir alerts desde el servidor.
 *
 * Si faltan las variables, se construye con placeholders para que el servidor
 * arranque igual (y /health funcione); las llamadas reales fallarán con un
 * error claro hasta que se configuren SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
 */
export const admin: SupabaseClient = createClient(
  url || "https://placeholder.supabase.co",
  serviceKey || "placeholder-service-key",
  {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: realtimeOpts,
  }
);

/** ¿Está configurado el cliente admin de Supabase? */
export const supabaseConfigured = Boolean(url && serviceKey);

/**
 * Verifica un JWT de usuario (emitido por Supabase Auth) y devuelve su id.
 * Lo usa el panel web para autenticar las llamadas de sesión WhatsApp.
 */
export async function getUserFromToken(
  token: string
): Promise<{ id: string; email?: string } | null> {
  if (!url || !anonKey || !token) return null;
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: realtimeOpts,
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? undefined };
}
