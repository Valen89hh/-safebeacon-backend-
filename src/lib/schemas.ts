import { z } from "zod";

/**
 * Esquema de la alerta que envía el ESP32-C3 (o el simulador).
 */
export const alertSchema = z.object({
  device_id: z
    .string()
    .min(1, "device_id es obligatorio")
    .max(64, "device_id demasiado largo"),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  battery_pct: z.number().int().min(0).max(100),
  timestamp_iso: z
    .string()
    .datetime({ message: "timestamp_iso debe ser ISO 8601 válido" }),
});

export type Alert = z.infer<typeof alertSchema>;

/** Valores autocompletados para /api/test (Plaza de Armas de Trujillo). */
export function testAlertFields(): Omit<Alert, "device_id"> {
  return {
    lat: -8.1116,
    lng: -79.0287,
    battery_pct: 75,
    timestamp_iso: new Date().toISOString(),
  };
}
