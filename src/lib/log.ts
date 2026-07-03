type LogLevel = "info" | "warn" | "error";

/**
 * Log estructurado a consola en formato JSON con timestamp.
 * Sin dependencias externas (no pino ni winston).
 */
export function log(
  level: LogLevel,
  event: string,
  data: Record<string, unknown> = {}
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...data,
  };
  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
