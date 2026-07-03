import type { Alert } from "./schemas.js";

/**
 * Formatea un ISO string a la zona horaria de Lima (GMT-5).
 * Devuelve algo como "04/06/2026, 10:30:00".
 */
export function formatHoraLima(timestampIso: string): string {
  try {
    return new Date(timestampIso).toLocaleString("es-PE", {
      timeZone: "America/Lima",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return timestampIso;
  }
}

/** URL de Google Maps para unas coordenadas. */
export function mapsUrl(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat},${lng}`;
}

/**
 * Datos comunes formateados de una alerta, reutilizados por cada provider.
 */
export function alertFields(alert: Alert) {
  return {
    horaLima: formatHoraLima(alert.timestamp_iso),
    maps: mapsUrl(alert.lat, alert.lng),
  };
}
