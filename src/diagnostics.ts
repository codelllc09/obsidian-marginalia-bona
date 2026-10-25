/**
 * Diagnostics: a small in-memory event log plus a report the user can copy
 * from a command. Rendering code must never fail silently - every early
 * return that explains "nothing appeared" is recorded here, so a report from
 * a real vault answers "why are my margin cards missing?" without guessing.
 */

export type DiagnosticLevel = "info" | "warn" | "error";

export interface DiagnosticEvent {
  at: string;
  level: DiagnosticLevel;
  scope: string;
  message: string;
  data?: unknown;
}

const MAX_EVENTS = 240;
const events: DiagnosticEvent[] = [];
const listeners = new Set<() => void>();

type Snapshot = () => Record<string, unknown>;
let snapshotProvider: Snapshot | null = null;

export function setSnapshotProvider(provider: Snapshot): void {
  snapshotProvider = provider;
}

/** Optional hook so the UI can surface problems without a dev console. */
export function onDiagnostic(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function stringify(data: unknown): string {
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

export function logEvent(
  level: DiagnosticLevel,
  scope: string,
  message: string,
  data?: unknown
): void {
  const event: DiagnosticEvent = {
    at: new Date().toISOString(),
    level,
    scope,
    message,
    data
  };
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  const line = `Marginalia [${scope}] ${message}`;
  // Obsidian's guidelines only sanction console.debug for plugin logging;
  // the level is part of the message so a dump is still greppable.
  console.debug(`${level.toUpperCase()} ${line}`, data ?? "");
  for (const listener of listeners) listener();
}

export function reportError(scope: string, error: unknown, data?: unknown): void {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  logEvent("error", scope, message, {
    ...(typeof data === "object" && data !== null ? data : {}),
    stack: error instanceof Error ? error.stack : undefined
  });
}

/** Recent events, newest last. `since` filters by ISO timestamp. */
export function recentEvents(limit = 60): DiagnosticEvent[] {
  return events.slice(-limit);
}

export function clearDiagnostics(): void {
  events.length = 0;
}

export function diagnosticsReport(pluginVersion: string): string {
  const lines: string[] = [];
  lines.push(`Marginalia Bona diagnostics`);
  lines.push(`generated: ${new Date().toISOString()}`);
  lines.push(`plugin: ${pluginVersion}`);
  if (snapshotProvider) {
    let snapshot: Record<string, unknown> = {};
    try {
      snapshot = snapshotProvider();
    } catch (error) {
      lines.push(`snapshot: failed (${String(error)})`);
    }
    lines.push("");
    lines.push("--- state ---");
    for (const [key, value] of Object.entries(snapshot)) {
      const rendered = typeof value === "string" ? value : stringify(value);
      lines.push(`${key}: ${rendered}`);
    }
  }
  lines.push("");
  lines.push(`--- events (last ${Math.min(events.length, 80)}) ---`);
  for (const event of events.slice(-80)) {
    const data = event.data === undefined ? "" : ` ${stringify(event.data)}`;
    lines.push(`${event.at} ${event.level.toUpperCase()} [${event.scope}] ${event.message}${data}`);
  }
  return lines.join("\n");
}
