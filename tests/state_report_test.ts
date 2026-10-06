import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Check } from "../src/checks.ts";
import { changeAlert, dailyReport } from "../src/report.ts";
import { diffStates } from "../src/state.ts";

const now = new Date("2030-01-10T12:00:00Z");
const check = (key: string, ok: boolean, extra: Partial<Check> = {}): Check => ({
  key,
  name: key,
  ok,
  detail: ok ? "fine" : "broken",
  ...extra,
});

Deno.test("only changes are reported, not every red check every run", () => {
  const previous = [
    { key: "a", ok: true, since: "2030-01-01T00:00:00Z" },
    { key: "b", ok: false, since: "2030-01-05T00:00:00Z" },
    { key: "c", ok: false, since: "2030-01-05T00:00:00Z" },
  ];
  const { changes, rows } = diffStates(previous, [
    check("a", false), // went down
    check("b", false), // still down: silent
    check("c", true), // came back
  ], now);
  assertEquals(changes, ["🔴 Down: a — broken", "🟢 Recovered: c — fine"]);
  assertEquals(rows.find((r) => r.key === "b")?.since, "2030-01-05T00:00:00Z");
  assertEquals(rows.find((r) => r.key === "a")?.since, now.toISOString());
});

Deno.test("a new check is reported only if it starts red", () => {
  const { changes } = diffStates([], [check("new-ok", true), check("new-bad", false)], now);
  assertEquals(changes, ["🔴 Down: new-bad — broken"]);
});

Deno.test("daily report lists red, yellow and green, with how long things have been down", () => {
  const report = dailyReport(
    [check("site", false), check("wa", true, { warn: true, detail: "LIMITED" }), check("ai", true)],
    [{ key: "site", ok: false, since: "2030-01-07T12:00:00Z" }],
    now,
    "UTC",
  );
  assertStringIncludes(report, "🔴 1 with problems:\n• site: broken (down for 3 d)");
  assertStringIncludes(report, "🟡 Limited:\n• wa: LIMITED");
  assertStringIncludes(report, "🟢 OK (1): ai");
});

Deno.test("daily report says all green when it is", () => {
  assertStringIncludes(dailyReport([check("a", true)], [], now, "UTC"), "✅ All green");
});

Deno.test("no changes means no message", () => {
  assertEquals(changeAlert([], now, "UTC"), "");
  assertStringIncludes(changeAlert(["🔴 Down: a — broken"], now, "UTC"), "Status change");
});
