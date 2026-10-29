import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export type LiveAccessCode = "configuration" | "unavailable" | "exhausted" | "visitor-limit" | "identity";
export class LiveAccessError extends Error {
  constructor(public readonly code: LiveAccessCode, public readonly retryAfter?: number) { super("LIVE access is unavailable."); }
}
export interface AttemptQuota { reserve(signal?: AbortSignal): Promise<void> }
type Environment = Readonly<Record<string, string | undefined>>;
interface StorageOptions { env?: Environment; fetcher?: typeof fetch; now?: () => number }
interface Config { url: string; token: string; budgetId: string; limit: number }
const PREFIX = "host-agent:v1:";
const TIMEOUT_MS = 1500;
function integer(value: string | undefined, min: number, max: number): number {
  if (!value || !/^[0-9]+$/.test(value)) throw new LiveAccessError("configuration");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new LiveAccessError("configuration");
  return number;
}
function config(env: Environment): Config {
  try {
    const url = new URL(env.UPSTASH_REDIS_REST_URL ?? "");
    if (url.protocol !== "https:" || !/^[a-z0-9-]+\.upstash\.io$/i.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    const token = env.UPSTASH_REDIS_REST_TOKEN;
    const budgetId = env.QLOO_SHARED_BUDGET_ID;
    if (!token || token.trim() !== token || /\s/.test(token) || !budgetId || !/^[a-zA-Z0-9_-]{1,80}$/.test(budgetId)) throw new Error();
    return { url: url.origin, token, budgetId, limit: integer(env.QLOO_SHARED_BUDGET_LIMIT, 1, 1_000_000_000) };
  } catch { throw new LiveAccessError("configuration"); }
}

// Both scripts run as single atomic EVAL operations; never check with a separate GET.
// Budget must already exist, have no expiry, and agree with the configured limit.
const BUDGET_CHECK = `
local record = redis.call('HMGET', KEYS[1], 'limit', 'used')
local cap = tonumber(record[1])
local used = tonumber(record[2])
if redis.call('PTTL', KEYS[1]) ~= -1 or not cap or not used or cap ~= tonumber(ARGV[1]) or cap < 1 or used < 0 or used > cap or used ~= math.floor(used) then return {-1, 0} end
if used >= cap then return {0, 0} end
`;
export const BUDGET_SCRIPT = BUDGET_CHECK + `
redis.call('HINCRBY', KEYS[1], 'used', 1)
return {1, cap - used - 1}
`;
export const VISITOR_SCRIPT = BUDGET_CHECK + `
local now = tonumber(redis.call('TIME')[1])
local window = tonumber(ARGV[3])
local bucket = math.floor(now / window)
if bucket ~= tonumber(ARGV[4]) then return {-1, 0} end
local ttl = (bucket + 1) * window - now
local count = tonumber(redis.call('GET', KEYS[2]) or '0')
if not count or count < 0 or count ~= math.floor(count) then return {-1, 0} end
if count >= tonumber(ARGV[2]) then return {2, ttl} end
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ttl + 5)
return {1, ttl}
`;

async function evaluate(cfg: Config, script: string, keys: string[], args: string[], fetcher: typeof fetch, signal?: AbortSignal): Promise<[number, number]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, TIMEOUT_MS);
  try {
    if (controller.signal.aborted) throw new Error();
    // No REST retries: an ambiguous result is denied, even if Redis consumed a unit.
    const response = await fetcher(cfg.url, { method: "POST", headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["EVAL", script, String(keys.length), ...keys, ...args]), cache: "no-store", redirect: "error", signal: controller.signal });
    if (!response.ok) throw new Error();
    const body: unknown = await response.json();
    if (controller.signal.aborted || !body || typeof body !== "object" || "error" in body || !("result" in body)) throw new Error();
    const result = (body as { result: unknown }).result;
    if (!Array.isArray(result) || result.length !== 2 || !result.every((value) => typeof value === "number" && Number.isSafeInteger(value)) || result[1] < 0) throw new Error();
    return result as [number, number];
  } catch { throw new LiveAccessError("unavailable"); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
function budgetKey(cfg: Config) { return `${PREFIX}{${cfg.budgetId}}:budget`; }
export function createSharedQuota(options: StorageOptions = {}): AttemptQuota {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  return { reserve: async (signal) => {
    const cfg = config(env);
    const [code, remaining] = await evaluate(cfg, BUDGET_SCRIPT, [budgetKey(cfg)], [String(cfg.limit)], fetcher, signal);
    if (code === 0) throw new LiveAccessError("exhausted");
    if (code !== 1 || remaining >= cfg.limit) throw new LiveAccessError("unavailable");
  } };
}

function trustedVisitor(request: Request, env: Environment): string {
  // Direct Vercel ingress only. A custom upstream proxy needs a separate trust review.
  if (env.VERCEL !== "1" || env.HOST_AGENT_PROXY_MODE !== "vercel") throw new LiveAccessError("identity");
  const raw = request.headers.get("x-vercel-forwarded-for");
  if (!raw || raw.trim() !== raw || raw.includes("%") || raw.length > 45 || !isIP(raw)) throw new LiveAccessError("identity");
  // Canonicalize IPv6 spellings; do not accept lists, ports, zones or arbitrary XFF.
  return isIP(raw) === 6 ? new URL(`http://[${raw}]/`).hostname.slice(1, -1) : raw;
}
export async function authorizeLiveVisitor(request: Request, options: StorageOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const cfg = config(env);
  const limit = integer(env.HOST_AGENT_LIVE_REQUEST_LIMIT, 1, 10_000);
  const window = integer(env.HOST_AGENT_LIVE_WINDOW_SECONDS, 30, 86_400);
  const secret = env.HOST_AGENT_VISITOR_HMAC_SECRET;
  if (!secret || secret.length < 32 || secret.trim() !== secret) throw new LiveAccessError("configuration");
  const ip = trustedVisitor(request, env);
  const bucket = Math.floor((options.now?.() ?? Date.now()) / 1000 / window);
  const digest = createHmac("sha256", secret).update(`${cfg.budgetId}:${bucket}:${ip}`).digest("hex");
  const visitorKey = `${PREFIX}{${cfg.budgetId}}:visitor:${bucket}:${digest}`;
  const [code, ttl] = await evaluate(cfg, VISITOR_SCRIPT, [budgetKey(cfg), visitorKey], [String(cfg.limit), String(limit), String(window), String(bucket)], options.fetcher ?? fetch, request.signal);
  if (code === 0) throw new LiveAccessError("exhausted");
  if (code === 2 && ttl > 0 && ttl <= window) throw new LiveAccessError("visitor-limit", ttl);
  if (code !== 1 || ttl < 1 || ttl > window) throw new LiveAccessError("unavailable");
}
