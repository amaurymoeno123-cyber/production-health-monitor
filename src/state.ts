import type { Check } from "./checks.ts";

export type StoredState = { key: string; ok: boolean; since: string };
export type StateRow = StoredState & { detail: string; checked_at: string };

/**
 * Compares this run with the last one. Alerting on every red check every 30 minutes trains
 * people to ignore the alerts; alerting only on changes (went down / came back) does not.
 * A brand-new check that starts red counts as a change; one that starts green does not.
 */
export function diffStates(
  previous: StoredState[],
  checks: Check[],
  now: Date,
): { rows: StateRow[]; changes: string[] } {
  const before = new Map(previous.map((p) => [p.key, p]));
  const at = now.toISOString();
  const changes: string[] = [];
  const rows = checks.map((c) => {
    const p = before.get(c.key);
    const changed = p ? p.ok !== c.ok : !c.ok;
    if (changed) changes.push(`${c.ok ? "🟢 Recovered" : "🔴 Down"}: ${c.name} — ${c.detail}`);
    return {
      key: c.key,
      ok: c.ok,
      detail: c.detail,
      since: changed || !p ? at : p.since,
      checked_at: at,
    };
  });
  return { rows, changes };
}

/** How long something has been down, for the daily summary ("down for 3 d"). */
export function downFor(state: StoredState | undefined, now: Date): string {
  if (!state || state.ok) return "";
  const days = Math.floor((now.getTime() - Date.parse(state.since)) / 86_400_000);
  return days >= 1 ? ` (down for ${days} d)` : "";
}
