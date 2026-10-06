import { createClient } from "@supabase/supabase-js";
import {
  type Check,
  cronCheck,
  openAICheck,
  siteCheck,
  whatsAppCheck,
} from "../../../src/checks.ts";
import { changeAlert, dailyReport } from "../../../src/report.ts";
import { diffStates } from "../../../src/state.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const TIME_ZONE = env("TIME_ZONE") || "America/Bogota";

Deno.serve(async (req) => {
  // Fail closed: no secret configured means nobody can trigger it (it spends API calls).
  const secret = env("MONITOR_SECRET");
  if (!secret || !safeEqual(req.headers.get("x-monitor-secret") ?? "", secret)) {
    return new Response("unauthorized", { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const mode: "daily" | "watch" = body.mode === "daily" ? "daily" : "watch";
  const send = body.send !== false; // {"send": false} = dry run

  const [sites, numbers, keys, cron, previous] = await Promise.all([
    db.from("monitor_sites").select("name, url, expect_text").eq("active", true),
    db.from("monitor_whatsapp").select("name, phone_number_id, token_env").eq("active", true),
    db.from("monitor_openai").select("name, key_env").eq("active", true),
    db.rpc("monitor_cron_failures"),
    db.from("monitor_state").select("key, ok, since"),
  ]);

  const checks: Check[] = (await Promise.all([
    ...(sites.data ?? []).map(async (s) =>
      siteCheck(s.name, await fetchSite(s.url), s.expect_text)
    ),
    ...(numbers.data ?? []).map(async (n) =>
      whatsAppCheck(n.name, n.phone_number_id, await fetchWhatsApp(n.phone_number_id, n.token_env))
    ),
    ...(keys.data ?? []).map(async (k) => {
      const { status, body } = await fetchOpenAI(env(k.key_env));
      return openAICheck(k.name, status, body);
    }),
  ])).concat(
    cron.error
      ? [{ key: "cron", name: "Scheduled jobs", ok: false, detail: cron.error.message }]
      : [cronCheck(cron.data ?? {})],
  );

  const now = new Date();
  const { rows, changes } = diffStates(previous.data ?? [], checks, now);
  await db.from("monitor_state").upsert(rows);

  const text = mode === "daily"
    ? dailyReport(checks, previous.data ?? [], now, TIME_ZONE)
    : changeAlert(changes, now, TIME_ZONE);
  if (text && send) await telegram(text);
  await db.from("monitor_runs").insert({
    mode,
    red: checks.filter((c) => !c.ok).length,
    summary: text || null,
  });

  return Response.json({ mode, changes, checks });
});

async function withTimeout(url: string, init: RequestInit = {}, ms = 15_000): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** One retry: a single timeout is not an outage. */
async function fetchSite(url: string) {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await withTimeout(url, { headers: { "user-agent": "health-monitor/1" } });
      const body = await res.text();
      if (res.status < 400) return { status: res.status, body };
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e instanceof DOMException && e.name === "AbortError"
        ? "no response in 15 s"
        : String(e).slice(0, 80);
    }
  }
  return { error: last };
}

async function fetchWhatsApp(phoneId: string, tokenEnv: string) {
  const token = env(tokenEnv);
  if (!token) return { error: { message: `secret ${tokenEnv} is not set` } };
  try {
    const res = await withTimeout(
      `https://graph.facebook.com/v21.0/${phoneId}?fields=display_phone_number,quality_rating,health_status`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    return await res.json();
  } catch (e) {
    return { error: { message: `Graph API unreachable: ${String(e).slice(0, 60)}` } };
  }
}

async function fetchOpenAI(key: string) {
  if (!key) return { status: 401, body: {} };
  try {
    const res = await withTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 1,
        messages: [{ role: "user", content: "ok" }],
      }),
    }, 20_000);
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch {
    return { status: 0, body: {} };
  }
}

async function telegram(text: string) {
  const token = env("TELEGRAM_BOT_TOKEN");
  const chat = env("TELEGRAM_CHAT_ID");
  if (!token || !chat) return;
  await withTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000) }),
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
