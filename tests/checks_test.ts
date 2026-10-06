import { assertEquals, assertStringIncludes } from "@std/assert";
import { cronCheck, openAICheck, siteCheck, whatsAppCheck } from "../src/checks.ts";

Deno.test("site: 200 with the expected text is ok", () => {
  assertEquals(siteCheck("shop", { status: 200, body: "<h1>Menu</h1>" }, "Menu").ok, true);
});

Deno.test("site: 200 without the expected text is down (paused database, empty page)", () => {
  const check = siteCheck("shop", { status: 200, body: "<div id=app></div>" }, "Menu");
  assertEquals(check.ok, false);
  assertStringIncludes(check.detail, '"Menu" is missing');
});

Deno.test("site: HTTP errors and timeouts are down", () => {
  assertEquals(siteCheck("shop", { status: 503, body: "" }, null).detail, "HTTP 503");
  assertEquals(siteCheck("shop", { error: "no response in 15 s" }, null).ok, false);
});

Deno.test("whatsapp: AVAILABLE is ok", () => {
  const check = whatsAppCheck("Clinic", "123", {
    display_phone_number: "+57 300 000 0000",
    quality_rating: "GREEN",
    health_status: { can_send_message: "AVAILABLE" },
  });
  assertEquals(check, {
    key: "whatsapp:123",
    name: "Clinic +57 300 000 0000",
    ok: true,
    detail: "can send",
  });
});

Deno.test("whatsapp: BLOCKED explains the error code", () => {
  const check = whatsAppCheck("Clinic", "123", {
    health_status: {
      can_send_message: "BLOCKED",
      entities: [{ entity_type: "WABA", errors: [{ error_code: 141006 }] }],
    },
  });
  assertEquals(check.ok, false);
  assertEquals(check.detail, "BLOCKED · WABA 141006 (account has no valid payment method)");
});

Deno.test("whatsapp: LIMITED still sends, so it is a warning", () => {
  const check = whatsAppCheck("Studio", "9", { health_status: { can_send_message: "LIMITED" } });
  assertEquals([check.ok, check.warn], [true, true]);
});

Deno.test("whatsapp: an API error (expired token) is down", () => {
  const check = whatsAppCheck("Studio", "9", {
    error: { message: "Error validating access token" },
  });
  assertEquals(check.ok, false);
  assertStringIncludes(check.detail, "access token");
});

Deno.test("openai: no credit is down, plain rate limit is only a warning", () => {
  const noCredit = openAICheck("bots", 429, { error: { code: "insufficient_quota" } });
  assertEquals(noCredit.ok, false);
  assertStringIncludes(noCredit.detail, "NO CREDIT");
  const rateLimited = openAICheck("bots", 429, { error: { type: "requests" } });
  assertEquals([rateLimited.ok, rateLimited.warn], [true, true]);
  assertEquals(openAICheck("bots", 401, {}).detail, "invalid or revoked key");
  assertEquals(openAICheck("bots", 200, {}).ok, true);
});

Deno.test("cron: one or two failures are restarts, three are a problem", () => {
  assertEquals(cronCheck({ "send-reminders": 2 }).ok, true);
  const broken = cronCheck({ "send-reminders": 3, "daily-report": 1 });
  assertEquals([broken.ok, broken.detail], [false, "send-reminders x3 in 2 h"]);
});
