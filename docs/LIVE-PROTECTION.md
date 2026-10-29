# Public LIVE protection — Phase 3

## Status and safety boundary

Implemented locally; not deployed. No real Qloo/Upstash requests or account/infrastructure changes were made. Shared reservations are atomic Lua operations under normal Redis operation. **This is not an absolute hard cap across Upstash replication failovers, partitions, data loss, operator resets, or calls made outside this application.** Upstash documents eventual replication consistency. This application allowance is chosen by the operator; it is not Qloo's official quota or a usage report from Qloo.

The existing per-plan cap, request timeouts, 45-second planner deadline, category validation, caching, evidence provenance, and coverage-aware ranking remain. No Qloo request is made to check usage. The protection uses native server-only fetch, with no new dependency.

## Required server-side environment variables

| Name | Required value or rule |
| --- | --- |
| `QLOO_LIVE_ENABLED` | Keep `false` during setup; exactly `true` opts into LIVE. |
| `QLOO_API_KEY` | Private, valid Qloo credential. Prior exposed-key rotation must be confirmed separately. |
| `QLOO_BASE_URL` | `https://hackathon.api.qloo.com`. |
| `QLOO_MAX_HTTP_ATTEMPTS` | Existing per-plan cap, default 48. This is distinct from the shared allowance. |
| `QLOO_MAX_RETRIES` | Recommend `0` during controlled judging; existing support for 1 retry is preserved, and each retry reserves a new shared unit. |
| `UPSTASH_REDIS_REST_URL` | HTTPS database REST origin on `*.upstash.io`, without credentials, query, custom port, or path. |
| `UPSTASH_REDIS_REST_TOKEN` | Private write-capable token. Do not use a read-only token or put it in a URL. |
| `QLOO_SHARED_BUDGET_ID` | Stable operator-selected identifier, 1–80 letters/digits/underscores/hyphens. Same ID across deployments sharing this allowance; never derive it from deployment/build IDs. |
| `QLOO_SHARED_BUDGET_LIMIT` | Approved positive integer, 1–1,000,000,000. Must exactly match the stored limit. Choose from your actual authorized remaining allowance; no provider quota is assumed. |
| `HOST_AGENT_LIVE_REQUEST_LIMIT` | Positive integer 1–10,000 LIVE planner starts per visitor per window. Operator policy, not provider quota. |
| `HOST_AGENT_LIVE_WINDOW_SECONDS` | Integer 30–86,400. Fixed windows; choose one policy consistently across instances. |
| `HOST_AGENT_VISITOR_HMAC_SECRET` | Independent random secret, at least 32 characters. Generate privately in your secret manager; never reuse the Qloo/Redis credential. |
| `HOST_AGENT_PROXY_MODE` | Exactly `vercel`, after confirming direct Vercel ingress. |
| `VERCEL` | Platform-provided value `1`. Do not manually fake this on another host. |
| `QLOO_PLANNER_VALIDATION` | `false` in production. Leave `QLOO_PLANNER_LEDGER_FILE` unset. Old local validation ledgers are not production quota storage. |

No sensitive variable may use a `NEXT_PUBLIC_` prefix. Missing/invalid values block LIVE. Keep Preview LIVE disabled unless explicitly authorized; if it uses the same Qloo allowance, it must share the same stable budget record. Changing the budget ID, flushing Redis, restoring an old database, or rotating the HMAC secret can reset accounting or visitor limits and requires operator review.

## Manual Upstash setup (operator only)

1. Create or select one Redis database after reviewing provider costs; no account or service was created by this implementation. Choose its region for latency and keep **eviction disabled**. Use one authoritative shared database and endpoint for all instances using this budget; do not use independent regional counters.
2. Copy its REST URL and write token directly to approved private configuration. Do not paste them into chat, source, logs, or commands saved in the repository.
3. Select an authorized budget ID and allowance. The server expects the persistent hash `host-agent:v1:{<ID>}:budget` with integer fields `limit` and `used`. It requires **no TTL**. Missing records, wrong types, invalid counters, expired records, and a configured/stored limit mismatch fail closed.
4. Initialize once in the provider's private Redis command console, substituting the reviewed ID and allowance. Use this guarded command; do not use HSET with `used=0` against an existing budget:

```text
EVAL "if redis.call('EXISTS', KEYS[1]) ~= 0 then return redis.error_reply('Budget already exists; refusing reset') end local n = tonumber(ARGV[1]) if not n or n < 1 or n > 1000000000 or n ~= math.floor(n) then return redis.error_reply('Invalid allowance') end redis.call('HSET', KEYS[1], 'limit', ARGV[1], 'used', '0') return 1" 1 host-agent:v1:{<APPROVED_ID>}:budget <APPROVED_ALLOWANCE>
```

5. Privately verify `HGETALL host-agent:v1:{<ID>}:budget` and `PTTL host-agent:v1:{<ID>}:budget`; the latter must be `-1`. Initialization is never performed by the app, a deployment, or a failed request.
6. Select the per-visitor policy. For example, 5 starts per 600 seconds is an application-policy example only, not a claim about Qloo limits. Consider judges behind shared networks before choosing the limit.
7. Configure server-only values on Vercel yourself, while LIVE remains disabled. Confirm direct platform ingress; custom upstream proxy/CDN configurations need a separate trust assessment.

## Enforcement and failure semantics

- The route validates the bounded JSON request first. Explicit SAMPLE/BASELINE requests, disabled LIVE, and missing Qloo credentials bypass Redis and visitor identity completely.
- Configured LIVE requests require `VERCEL=1`, explicit proxy mode, and one valid `x-vercel-forwarded-for` IP. Arbitrary `x-forwarded-for`, lists, ports, zones, missing addresses, and non-Vercel hosts are not accepted. Vercel documents that it supplies the forwarding header; this is a platform trust assumption, not proof of end-user identity.
- A window-scoped HMAC of normalized IP, budget ID, and window is used as the visitor key. Raw IPs, guest names, and taste seeds are never sent to Redis. Budget and visitor keys share the same Redis hash tag to colocate the multi-key script. Visitor keys expire shortly after the window; Redis TIME checks the application's window to fail closed on clock disagreement.
- Atomic visitor admission checks the existing shared record and increments only the visitor counter. It does not spend Qloo units. A visitor denial returns sanitized HTTP 429 with `Retry-After`; identity/config/storage/global-budget denials return sanitized 503 and a SAMPLE option. These denials never contact Qloo.
- Each actual uncached Qloo fetch, including retries and individual evidence checks, must first receive an affirmative atomic budget reservation. Cache hits spend no shared unit. The per-plan counter reserves local capacity before asynchronous work to remain concurrency-safe.
- REST reservation calls have a 1.5-second bound, no application retries, no redirects, and no caching. The timeout includes response parsing and stays inside the existing Qloo attempt timeout; this slightly reduces time available for upstream IO. Visitor admission adds at most its own 1.5-second wait before the planner starts. No timeout was increased.
- Any ambiguous storage result denies transmission, even if Redis already counted the reservation. No refunds occur after failures or aborts; reservations can conservatively exceed actual transmitted calls. Multiple requests can reserve in flight, but every authorized transmission has its own unit. A client latches closed after shared quota failure; already-sent calls can finish, and successful domains remain LIVE while affected domains become SAMPLE.
- SAMPLE and BASELINE remain usable during storage outage. The frontend offers “Use SAMPLE ideas” and the generic plan while preserving entered details.

## Verification before enabling LIVE

Offline tests model atomic Redis outcomes, concurrency, retry reservations, malformed replies, missing configuration, storage timeouts, trusted identity, privacy, cache hits, local caps, and partial fallback. They do **not** execute Lua on a real Upstash database or establish replication guarantees.

Before release, authorize a separate **storage-only** smoke test against a dedicated, manually initialized tiny test budget. Verify script syntax, concurrent reservation limits, visitor TTL/window behavior, missing-record rejection, limit mismatch, and outage behavior. These tests need no Qloo calls. Never run exhaustion tests on the judging budget. Only then request a separately bounded Qloo LIVE smoke-test authorization.

After code review and separate deployment approval: deploy with LIVE disabled, verify SAMPLE/BASELINE and public readiness, configure the reviewed budget and secrets, verify storage-only tests, and enable controlled LIVE. The route exports 60 seconds; verify its effective hosted duration exceeds the 45-second planner deadline plus admission/response overhead. This implementation did not change Vercel settings.

## Rollback and limits

Disable `QLOO_LIVE_ENABLED` and redeploy through the normal approved process; SAMPLE/BASELINE remain. Preserve the shared budget record and previous local validation ledgers. Never restore `used` backwards to resume a demo. For an approved increase, pause LIVE and review both stored/configured limits; do not silently issue a new budget ID.

IP-based limits can group NAT/shared-network users and can be evaded by changing networks. Fixed windows permit bursts across a boundary. No raw IP is stored by this code, but platform/provider logs have independent retention policies. SAMPLE endpoints still incur hosting costs and need platform-level abuse protection for volumetric attacks. This is quota/rate protection, not authentication or a bot-proof identity system.

Other applications/manual scripts using the same Qloo key bypass this application budget. No automatic reconciliation with provider quota occurs. Keep sufficient headroom and monitor actual authorized usage independently.

Sources: [Upstash REST](https://upstash.com/docs/redis/features/restapi), [EVAL](https://upstash.com/docs/redis/sdks/ts/commands/scripts/eval), [consistency limitations](https://upstash.com/docs/redis/features/consistency), [eviction](https://upstash.com/docs/redis/features/eviction), [Vercel forwarding headers](https://vercel.com/docs/headers/request-headers).
