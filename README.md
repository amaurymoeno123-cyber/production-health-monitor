# Production Health Monitor

[![CI](https://github.com/amaurymoeno123-cyber/production-health-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/amaurymoeno123-cyber/production-health-monitor/actions/workflows/ci.yml)

Watches the things that break **silently** in a small production stack and tells you on Telegram before a client does. One Supabase Edge Function, two schedules:

- **7 am, every day:** full summary, green or not. If the message doesn't arrive, the monitor itself is down.
- **Every 30 minutes:** writes only when something **changed** (went down or came back). Repeating the same red line every half hour trains people to ignore alerts.

I run this in production over 13 sites, several WhatsApp Business numbers, the OpenAI keys of a few bots, and the database's scheduled jobs. This is the generic version: what to watch lives in tables, not in code.

## What it catches

| Failure | Why it's silent | How it's detected |
| --- | --- | --- |
| Free-tier database paused | The site still answers 200 with an empty page | The page must contain a word that only appears when data loaded |
| WhatsApp account without a valid payment method (131042 / 141006) | The send API returns 200; Meta drops the message later | `health_status` of each number, with the error code explained |
| WhatsApp number limited | It still sends, with a cap | Reported as a warning, not an outage |
| OpenAI key out of credit | Every bot on that key answers the same fallback, or nothing | A 1-token completion (listing models doesn't prove credit) |
| Scheduled job broken | pg_cron fails quietly | 3+ failures in 2 hours; 1-2 are treated as a platform restart |
| Expired access token | Everything that uses it stops at once | Graph API error on the health check |

## Design

- **Pure checks, thin wiring.** `src/` turns raw responses into `Check` objects and decides what changed; the function only fetches and stores. All decisions are unit-tested without network.
- **Fail closed.** No `MONITOR_SECRET` configured means nobody can trigger it (it spends API calls).
- **No tokens in the database.** A `monitor_whatsapp` row names the Edge Function secret that holds the token (`token_env`), it never contains it.
- **RLS on, no policies, functions revoked from `anon`.** In Supabase the default grant to `PUBLIC` makes every new function callable with the public key; CI checks it is not.

## Setup

```bash
supabase db push
supabase secrets set MONITOR_SECRET=... TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... \
  WHATSAPP_TOKEN=... OPENAI_API_KEY=...
supabase functions deploy health-monitor --no-verify-jwt
```

```sql
insert into monitor_sites (name, url, expect_text) values ('Shop', 'https://example.com/menu', 'Menu');
insert into monitor_whatsapp (name, phone_number_id) values ('Support line', '1234567890');
insert into monitor_openai (name) values ('bots');

-- Schedules (pg_cron + pg_net). Keep the secret in Vault, not in the job text.
select cron.schedule('health-daily', '0 12 * * *', $$ select net.http_post(
  url := 'https://<project>.supabase.co/functions/v1/health-monitor',
  headers := jsonb_build_object('x-monitor-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'monitor_secret')),
  body := '{"mode":"daily"}'::jsonb) $$);
select cron.schedule('health-watch', '*/30 * * * *', $$ select net.http_post(
  url := 'https://<project>.supabase.co/functions/v1/health-monitor',
  headers := jsonb_build_object('x-monitor-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'monitor_secret')),
  body := '{"mode":"watch"}'::jsonb) $$);
```

`{"send": false}` in the body runs every check without messaging Telegram.

```bash
deno task check   # fmt, lint, type check, tests
```

## License

MIT
