/** One thing being watched. `warn` = still working, but with a limit worth knowing about. */
export type Check = { key: string; name: string; ok: boolean; detail: string; warn?: boolean };

/** WhatsApp Cloud API error codes that fail silently: the API says 200, nothing is delivered. */
export const WHATSAPP_ERRORS: Record<string, string> = {
  "131042": "account has no valid payment method",
  "141006": "account has no valid payment method",
  "131049": "Meta limited marketing messages to this user",
  "131026": "number cannot receive messages",
  "131047": "24-hour window closed",
  "131056": "too many messages to the same number",
  "132001": "template missing or not approved",
};

// deno-lint-ignore no-explicit-any
type Json = any;

/** Site check: HTTP status plus an optional text that must be in the body. */
export function siteCheck(
  name: string,
  result: { status: number; body: string } | { error: string },
  expectText: string | null,
): Check {
  const key = `site:${name}`;
  if ("error" in result) return { key, name, ok: false, detail: result.error };
  if (result.status >= 400) return { key, name, ok: false, detail: `HTTP ${result.status}` };
  // A paused database often still serves a 200 with an empty page. Checking for a word
  // that only appears when data loaded catches it.
  if (expectText && !result.body.includes(expectText)) {
    return { key, name, ok: false, detail: `HTTP ${result.status} but "${expectText}" is missing` };
  }
  return { key, name, ok: true, detail: `HTTP ${result.status}` };
}

/**
 * Reads `GET /{phone-number-id}?fields=display_phone_number,quality_rating,health_status`.
 * LIMITED still sends (with a cap): it's a warning, not an outage.
 */
export function whatsAppCheck(name: string, phoneId: string, response: Json): Check {
  const key = `whatsapp:${phoneId}`;
  if (response?.error) {
    return { key, name, ok: false, detail: `API: ${String(response.error.message).slice(0, 90)}` };
  }
  const health = response?.health_status ?? {};
  const canSend = String(health.can_send_message ?? "UNKNOWN");
  const errors = new Set<string>();
  for (const entity of health.entities ?? []) {
    for (const e of entity.errors ?? []) {
      const code = String(e.error_code ?? "");
      errors.add(
        `${entity.entity_type} ${code}${
          WHATSAPP_ERRORS[code] ? ` (${WHATSAPP_ERRORS[code]})` : ""
        }`,
      );
    }
  }
  const quality = response?.quality_rating && response.quality_rating !== "GREEN"
    ? ` · quality ${response.quality_rating}`
    : "";
  const label = `${name} ${response?.display_phone_number ?? phoneId}`;
  if (canSend === "AVAILABLE") return { key, name: label, ok: true, detail: `can send${quality}` };
  return {
    key,
    name: label,
    ok: canSend === "LIMITED",
    warn: canSend === "LIMITED",
    detail: `${canSend}${errors.size ? ` · ${[...errors].join(", ")}` : ""}${quality}`,
  };
}

/**
 * Reads the answer to a 1-token completion. Listing models does not prove there is credit;
 * a real completion does, and costs almost nothing.
 */
export function openAICheck(name: string, status: number, body: Json): Check {
  const key = `openai:${name}`;
  const label = `OpenAI ${name}`;
  if (status >= 200 && status < 300) return { key, name: label, ok: true, detail: "has credit" };
  const type = body?.error?.code ?? body?.error?.type ?? "";
  if (status === 429 && type === "insufficient_quota") {
    return {
      key,
      name: label,
      ok: false,
      detail: "NO CREDIT: every bot using this key goes quiet",
    };
  }
  if (status === 429) return { key, name: label, ok: true, warn: true, detail: "rate limited" };
  if (status === 401) return { key, name: label, ok: false, detail: "invalid or revoked key" };
  return { key, name: label, ok: false, detail: `HTTP ${status} ${type}`.trim() };
}

/** One or two failures are a platform restart; three or more in two hours is something broken. */
export function cronCheck(failuresLast2h: Record<string, number>): Check {
  const broken = Object.entries(failuresLast2h).filter(([, n]) => n >= 3);
  return {
    key: "cron",
    name: "Scheduled jobs",
    ok: broken.length === 0,
    detail: broken.length
      ? broken.map(([job, n]) => `${job} x${n}`).join(", ") + " in 2 h"
      : "no recent failures",
  };
}
