import type { Check } from "./checks.ts";
import { downFor, type StoredState } from "./state.ts";

/** The 7 am message: everything, green or not, so silence never means "the monitor died". */
export function dailyReport(
  checks: Check[],
  previous: StoredState[],
  now: Date,
  timeZone: string,
): string {
  const before = new Map(previous.map((p) => [p.key, p]));
  const red = checks.filter((c) => !c.ok);
  const yellow = checks.filter((c) => c.ok && c.warn);
  const green = checks.filter((c) => c.ok && !c.warn);
  const when = now.toLocaleString("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" });

  const lines = [`🩺 System health — ${when}`];
  if (red.length) {
    lines.push("", `🔴 ${red.length} with problems:`);
    for (const c of red) lines.push(`• ${c.name}: ${c.detail}${downFor(before.get(c.key), now)}`);
  } else {
    lines.push("", "✅ All green");
  }
  if (yellow.length) {
    lines.push("", "🟡 Limited:");
    for (const c of yellow) lines.push(`• ${c.name}: ${c.detail}`);
  }
  lines.push("", `🟢 OK (${green.length}): ${green.map((c) => c.name).join(", ")}`);
  return lines.join("\n");
}

/** The every-30-minutes message. Empty string = nothing changed, send nothing. */
export function changeAlert(changes: string[], now: Date, timeZone: string): string {
  if (!changes.length) return "";
  const when = now.toLocaleString("en-US", { timeZone, timeStyle: "short" });
  return [`⚠️ Status change — ${when}`, ...changes].join("\n");
}
