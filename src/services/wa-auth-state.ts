import {
  initAuthCreds,
  BufferJSON,
  proto,
  type AuthenticationState,
  type AuthenticationCreds,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { admin } from "../lib/supabase.js";

/**
 * Estado de autenticación de Baileys respaldado en Supabase.
 *
 * Reemplaza a `useMultiFileAuthState` (que escribe archivos en disco). Cada
 * "archivo" que Baileys guardaría (`creds`, `pre-key-*`, `session-*`, etc.)
 * se convierte en una fila de `whatsapp_auth` con PK (user_id, key). Así la
 * sesión de WhatsApp sobrevive a redeploys/reinicios del backend en la nube.
 *
 * La (de)serialización usa BufferJSON de Baileys para preservar los Buffers.
 */
const TABLE = "whatsapp_auth";

export async function useSupabaseAuthState(
  userId: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const readData = async (key: string): Promise<any | null> => {
    const { data, error } = await admin
      .from(TABLE)
      .select("data")
      .eq("user_id", userId)
      .eq("key", key)
      .maybeSingle();
    if (error || !data?.data) return null;
    // `data.data` ya es un objeto JSON; lo pasamos por el reviver para
    // reconstruir los Buffers marcados por BufferJSON.replacer.
    return JSON.parse(JSON.stringify(data.data), BufferJSON.reviver);
  };

  const writeData = async (key: string, value: any): Promise<void> => {
    const serialized = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
    await admin
      .from(TABLE)
      .upsert(
        { user_id: userId, key, data: serialized, updated_at: new Date().toISOString() },
        { onConflict: "user_id,key" }
      );
  };

  const creds: AuthenticationCreds =
    (await readData("creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result: { [id: string]: SignalDataTypeMap[typeof type] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              result[id] = value;
            })
          );
          return result;
        },
        set: async (data) => {
          const upserts: { user_id: string; key: string; data: any; updated_at: string }[] = [];
          const deletes: string[] = [];
          const now = new Date().toISOString();
          for (const category in data) {
            const cat = data[category as keyof SignalDataTypeMap]!;
            for (const id in cat) {
              const value = (cat as any)[id];
              const key = `${category}-${id}`;
              if (value) {
                upserts.push({
                  user_id: userId,
                  key,
                  data: JSON.parse(JSON.stringify(value, BufferJSON.replacer)),
                  updated_at: now,
                });
              } else {
                deletes.push(key);
              }
            }
          }
          const tasks: Promise<any>[] = [];
          if (upserts.length) {
            tasks.push(
              admin.from(TABLE).upsert(upserts, { onConflict: "user_id,key" }) as any
            );
          }
          if (deletes.length) {
            tasks.push(
              admin.from(TABLE).delete().eq("user_id", userId).in("key", deletes) as any
            );
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData("creds", creds),
  };
}

/** Borra TODAS las credenciales/llaves de un usuario (al hacer logout / loggedOut). */
export async function clearSupabaseAuthState(userId: string): Promise<void> {
  await admin.from(TABLE).delete().eq("user_id", userId);
}
