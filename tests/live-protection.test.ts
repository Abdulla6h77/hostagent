import { describe, expect, it, vi } from "vitest";
import { createQlooClient } from "@/lib/qloo";
import { POST } from "@/app/api/plan/route";
import { authorizeLiveVisitor } from "@/lib/live-protection";
import type { QlooCall } from "@/types";
import { buildPlan } from "@/lib/orchestrator";

// No remote Redis/Qloo calls. This atomic in-memory transport models script outcomes,
// not managed Redis replication guarantees. A real storage-only smoke test is required later.
const real = await vi.importActual<typeof import("@/lib/live-protection")>("@/lib/live-protection");
const config: Record<string, string | undefined> = {
  UPSTASH_REDIS_REST_URL: "https://offline-fixture.upstash.io", UPSTASH_REDIS_REST_TOKEN: "offline-token",
  QLOO_SHARED_BUDGET_ID: "judging-fixture", QLOO_SHARED_BUDGET_LIMIT: "7",
  HOST_AGENT_LIVE_REQUEST_LIMIT: "3", HOST_AGENT_LIVE_WINDOW_SECONDS: "60",
  HOST_AGENT_VISITOR_HMAC_SECRET: "offline-fixture-not-a-real-secret-0000", HOST_AGENT_PROXY_MODE: "vercel", VERCEL: "1",
};
const now = 1_800_000_000_000;
function redis(limit = 7) {
  let used = 0;
  const visitors = new Map<string, number>();
  const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as string[];
    const visitor = command[1] === real.VISITOR_SCRIPT;
    expect(command[0]).toBe("EVAL");
    expect(command[1]).toBe(visitor ? real.VISITOR_SCRIPT : real.BUDGET_SCRIPT);
    const count = Number(command[2]);
    const args = command.slice(3 + count);
    // No await inside this state transition: model a single atomic server operation.
    if (Number(args[0]) !== limit) return Response.json({ result: [-1, 0] });
    if (used >= limit) return Response.json({ result: [0, 0] });
    if (visitor) {
      const key = command[4], seen = visitors.get(key) ?? 0;
      if (seen >= Number(args[1])) return Response.json({ result: [2, 60] });
      visitors.set(key, seen + 1); return Response.json({ result: [1, 60] });
    }
    used++; return Response.json({ result: [1, limit - used] });
  });
  return { transport, used: () => used, visitors };
}
const request = (ip = "192.0.2.10") => new Request("https://offline.vercel.app/api/plan", { headers: { "x-vercel-forwarded-for": ip } });
const quota = (fetcher: typeof fetch, env = config) => real.createSharedQuota({ env, fetcher });
const entities = { entities: [{ entity_id: "offline-result", name: "Offline fixture", type: "urn:entity:artist" }] };
const client = (storage: typeof fetch, upstream: typeof fetch, limit = 7, retries: 0 | 1 = 0) => createQlooClient({ key: "unit-test-placeholder", enabled: true, fetcher: upstream, quota: quota(storage, { ...config, QLOO_SHARED_BUDGET_LIMIT: String(limit) }), retries, maxAttempts: 48, backoffMs: 0 });

describe("shared atomic attempt budget", () => {
  it("caps concurrent reservations across independent adapters and restarts", async () => {
    const store = redis();
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => quota(store.transport).reserve()));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(7);
    expect(store.used()).toBe(7);
    await expect(quota(store.transport).reserve()).rejects.toMatchObject({ code: "exhausted" });
    expect(real.BUDGET_SCRIPT).toContain("HINCRBY"); expect(real.BUDGET_SCRIPT).toContain("PTTL");
    expect(real.BUDGET_SCRIPT).not.toMatch(/HSET|EXPIRE|DEL/);
  });
  it("never transmits more upstream calls than acknowledged shared reservations", async () => {
    const store = redis(); const upstream = vi.fn(async () => Response.json(entities));
    const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => client(store.transport, upstream).searchEntities(`fixture-${i}`)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(7);
    expect(upstream).toHaveBeenCalledTimes(7); expect(store.used()).toBe(7);
  });
  it("reserves a unit for every retry, including failed upstream attempts", async () => {
    const store = redis(); const upstream = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(Response.json(entities));
    await client(store.transport, upstream, 7, 1).searchEntities("fixture");
    expect(store.used()).toBe(2); expect(upstream).toHaveBeenCalledTimes(2);
  });
  it("accounts for individual evidence queries through the same attempt boundary", async () => {
    const store = redis(25);
    const upstream = vi.fn(async (input: unknown) => {
      const url = input as URL;
      if (url.pathname === "/search") return Response.json({ results: [{ entity_id: `fixture-${url.searchParams.get("query")}`, name: url.searchParams.get("query"), types: ["urn:entity:artist"] }] });
      if (url.pathname === "/v2/tags") return Response.json({ results: { tags: [{ id: "urn:tag:genre:place:dining", name: "Dining" }] } });
      return Response.json({ results: { entities: [{ entity_id: `fixture-${url.searchParams.get("filter.type")}`, name: "Offline fixture", subtype: url.searchParams.get("filter.type") }] } });
    });
    const members = ["Mina", "Omar"].map((name, i) => ({ name, seeds: [`Artist ${i}`, `Film ${i}`, `Brand ${i}`] }));
    const result = await buildPlan(members, { useQloo: true }, { client: client(store.transport, upstream, 25), spacingMs: 0 });
    expect(result.mode).toBe("qloo");
    expect(result.domains.every((domain) => domain.picks[0].support?.checked === 2)).toBe(true);
    expect(upstream).toHaveBeenCalledTimes(19); expect(store.used()).toBe(19);
  });
  it("prevents a retry when the last shared unit was already consumed", async () => {
    const store = redis(1); const upstream = vi.fn(async () => new Response(null, { status: 503 }));
    await expect(client(store.transport, upstream, 1, 1).searchEntities("fixture")).rejects.toMatchObject({ code: "shared-budget" });
    expect(upstream).toHaveBeenCalledTimes(1); expect(store.used()).toBe(1);
  });
  it("counts network failures without refunds and denies ambiguous storage results", async () => {
    const store = redis(); const upstream = vi.fn(async () => { throw new Error("private fixture error"); });
    await expect(client(store.transport, upstream).searchEntities("fixture")).rejects.toMatchObject({ code: "network" });
    expect(store.used()).toBe(1);
    const ambiguous = vi.fn(async () => { await store.transport("", { body: JSON.stringify(["EVAL", real.BUDGET_SCRIPT, "1", "fixture", "7"]) }); throw new Error("connection lost after reservation"); });
    const denied = vi.fn(); await expect(client(ambiguous, denied).searchEntities("other")).rejects.toMatchObject({ code: "live-unavailable" });
    expect(denied).not.toHaveBeenCalled(); expect(ambiguous).toHaveBeenCalledTimes(1); expect(store.used()).toBe(2);
  });
  it.each([[-1, 0], [99, 0], [1, 7], ["1", 0], [1], null])("rejects missing/invalid/unknown Redis outcomes %j", async (result) => {
    const storage = vi.fn(async () => Response.json({ result })); const upstream = vi.fn();
    await expect(client(storage, upstream).searchEntities("fixture")).rejects.toMatchObject({ code: "live-unavailable" });
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([new Response(null, { status: 500 }), Response.json({ error: "private fixture error" }), new Response("not json")])("blocks Redis protocol and HTTP failures", async (response) => {
    const upstream = vi.fn(); await expect(client(vi.fn(async () => response), upstream).searchEntities("fixture")).rejects.toMatchObject({ code: "live-unavailable" }); expect(upstream).not.toHaveBeenCalled();
  });
  it.each([
    {}, { ...config, QLOO_SHARED_BUDGET_LIMIT: "" }, { ...config, QLOO_SHARED_BUDGET_ID: "../bad" },
    { ...config, UPSTASH_REDIS_REST_URL: "https://attacker.invalid" }, { ...config, UPSTASH_REDIS_REST_URL: "http://offline-fixture.upstash.io" },
    { ...config, UPSTASH_REDIS_REST_URL: "https://user:password@offline-fixture.upstash.io" }, { ...config, UPSTASH_REDIS_REST_URL: "https://offline-fixture.upstash.io/?token=bad" },
  ])("rejects invalid config before storage or upstream IO %#", async (env) => {
    const storage = vi.fn(); await expect(quota(storage, env).reserve()).rejects.toMatchObject({ code: "configuration" }); expect(storage).not.toHaveBeenCalled();
  });
  it("times out storage once and latches the client closed", async () => {
    vi.useFakeTimers();
    const storage = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("private timeout")), { once: true })));
    const upstream = vi.fn(); const qloo = client(storage, upstream);
    const failure = qloo.searchEntities("fixture").catch((e) => e);
    await vi.advanceTimersByTimeAsync(1500); expect(await failure).toMatchObject({ code: "live-unavailable" });
    await expect(qloo.searchEntities("other")).rejects.toMatchObject({ code: "live-unavailable" });
    expect(storage).toHaveBeenCalledTimes(1); expect(upstream).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not reserve shared units for cache hits", async () => {
    const store = redis(); const upstream = vi.fn(async () => Response.json(entities)); const qloo = client(store.transport, upstream);
    await qloo.searchEntities("fixture"); await qloo.searchEntities("fixture");
    expect(store.used()).toBe(1); expect(upstream).toHaveBeenCalledTimes(1);
  });
  it("preserves a successful domain when shared quota blocks later domains", async () => {
    const store = redis();
    const upstream = vi.fn(async (input: unknown) => { const url = input as URL; return url.pathname === "/search"
      ? Response.json({ results: [{ entity_id: `fixture-${url.searchParams.get("query")}`, name: url.searchParams.get("query"), types: ["urn:entity:artist"] }] })
      : Response.json(entities); });
    const members = ["Mina", "Omar"].map((name, i) => ({ name, seeds: [`Artist ${i}`, `Film ${i}`, `Brand ${i}`] }));
    const result = await buildPlan(members, { useQloo: true }, { client: client(store.transport, upstream), spacingMs: 1 });
    expect(result.mode).toBe("sample"); expect(result.domains[0].source).toBe("qloo");
    expect(result.domains.slice(1).every((domain) => domain.source === "sample")).toBe(true);
    expect(result.domains[1].reason).toContain("shared application allowance");
    expect(upstream).toHaveBeenCalledTimes(7); expect(store.used()).toBe(7);
    expect(result.domains[0].picks.every((pick) => pick.affinity === null)).toBe(true);
  });
  it("explains storage failure during seed resolution without pretending it was a taste mismatch", async () => {
    const storage = vi.fn(async () => Response.json({ result: [-1, 0] })); const upstream = vi.fn();
    const result = await buildPlan([{ name: "Mina", seeds: ["Artist A", "Film A", "Brand A"] }, { name: "Omar", seeds: ["Artist B", "Film B", "Brand B"] }], { useQloo: true }, { client: client(storage, upstream), spacingMs: 0 });
    expect(result.mode).toBe("sample"); expect(result.domains.every((domain) => domain.reason?.includes("temporarily unavailable"))).toBe(true); expect(upstream).not.toHaveBeenCalled();
  });
  it("keeps the local planner cap safe while shared reservations are asynchronous", async () => {
    const store = redis(); const upstream = vi.fn(async () => Response.json(entities)); const calls: QlooCall[] = [];
    const qloo = createQlooClient({ enabled: true, key: "unit-test-placeholder", quota: quota(store.transport), fetcher: upstream, maxAttempts: 1, retries: 0, calls });
    await Promise.allSettled([qloo.searchEntities("a"), qloo.searchEntities("b"), qloo.searchEntities("c")]);
    expect(upstream).toHaveBeenCalledTimes(1); expect(store.used()).toBe(1); expect(calls[0].count).toBe(1);
  });
});

describe("trusted window-scoped visitor limits", () => {
  it("atomically caps simultaneous LIVE starts without consuming Qloo units", async () => {
    const store = redis(); const results = await Promise.allSettled(Array.from({ length: 20 }, () => real.authorizeLiveVisitor(request(), { env: config, fetcher: store.transport, now: () => now })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3); expect(store.used()).toBe(0);
    expect(results.some((r) => r.status === "rejected" && r.reason.code === "visitor-limit" && r.reason.retryAfter === 60)).toBe(true);
  });
  it("never sends raw IPs or guest details to Redis and rotates identifiers by window", async () => {
    const store = redis();
    for (const time of [now, now + 60_000]) await real.authorizeLiveVisitor(request(), { env: config, fetcher: store.transport, now: () => time });
    const bodies = store.transport.mock.calls.map((call) => String(call[1]?.body));
    expect(bodies.join()).not.toContain("192.0.2.10"); expect(new Set([...store.visitors.keys()]).size).toBe(2);
    expect([...store.visitors.keys()].every((key) => key.includes("{judging-fixture}:visitor:"))).toBe(true);
    expect(real.VISITOR_SCRIPT).toContain("EXPIRE"); expect(real.VISITOR_SCRIPT).toContain("TIME");
  });
  it("canonicalizes equivalent IPv6 representations", async () => {
    const store = redis();
    for (const ip of ["2001:db8::1", "2001:0db8:0:0:0:0:0:1"]) await real.authorizeLiveVisitor(request(ip), { env: config, fetcher: store.transport, now: () => now });
    expect(store.visitors.size).toBe(1);
  });
  it.each(["", "192.0.2.1, 198.51.100.1", "192.0.2.1:8080", "garbage", "fe80::1%eth0"])("rejects malformed identity %s without IO", async (ip) => {
    const storage = vi.fn(); await expect(real.authorizeLiveVisitor(request(ip), { env: config, fetcher: storage })).rejects.toMatchObject({ code: "identity" }); expect(storage).not.toHaveBeenCalled();
  });
  it("does not trust arbitrary XFF or non-Vercel hosting", async () => {
    const storage = vi.fn();
    const spoofed = new Request("https://offline.invalid", { headers: { "x-forwarded-for": "192.0.2.1" } });
    await expect(real.authorizeLiveVisitor(spoofed, { env: config, fetcher: storage })).rejects.toMatchObject({ code: "identity" });
    await expect(real.authorizeLiveVisitor(request(), { env: { ...config, VERCEL: "0" }, fetcher: storage })).rejects.toMatchObject({ code: "identity" });
    expect(storage).not.toHaveBeenCalled();
  });
  it("fails closed on Redis outage or server-clock/window mismatch", async () => {
    const down = vi.fn(async () => { throw new Error("private Redis response"); });
    await expect(real.authorizeLiveVisitor(request(), { env: config, fetcher: down })).rejects.toMatchObject({ code: "unavailable", message: "LIVE access is unavailable." });
    const mismatch = vi.fn(async () => Response.json({ result: [-1, 0] }));
    await expect(real.authorizeLiveVisitor(request(), { env: config, fetcher: mismatch })).rejects.toMatchObject({ code: "unavailable" });
  });
  it("requires a strong HMAC secret and explicit limits", async () => {
    const storage = vi.fn(); await expect(real.authorizeLiveVisitor(request(), { env: { ...config, HOST_AGENT_VISITOR_HMAC_SECRET: "short" }, fetcher: storage })).rejects.toMatchObject({ code: "configuration" }); expect(storage).not.toHaveBeenCalled();
  });
});

const guests = [{ name: "Mina", seeds: ["jazz", "ramen", "Inception"] }, { name: "Omar", seeds: ["techno", "tacos", "Dune"] }];
const post = (extra: object = {}) => POST(new Request("http://localhost/api/plan", { method: "POST", body: JSON.stringify({ guests, ...extra }) }));
describe("API access and offline escape paths", () => {
  it("returns sanitized visitor limits with Retry-After", async () => {
    vi.stubEnv("QLOO_LIVE_ENABLED", "true"); vi.stubEnv("QLOO_API_KEY", "unit-test-placeholder");
    vi.mocked(authorizeLiveVisitor).mockRejectedValue(new real.LiveAccessError("visitor-limit", 30));
    const response = await post(); expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("30");
    expect((await response.json()).error).toContain("SAMPLE"); expect(fetch).not.toHaveBeenCalled();
  });
  it("returns a sanitized unavailable response on missing configuration/storage failure", async () => {
    vi.stubEnv("QLOO_LIVE_ENABLED", "true"); vi.stubEnv("QLOO_API_KEY", "unit-test-placeholder");
    vi.mocked(authorizeLiveVisitor).mockRejectedValue(new Error("private storage details"));
    const response = await post(); expect(response.status).toBe(503); const text = await response.text(); expect(text).not.toContain("private storage details"); expect(text).toContain("SAMPLE"); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ sampleOnly: true }, { useQloo: false }])("keeps SAMPLE/BASELINE independent of Redis %#", async (options) => {
    vi.stubEnv("QLOO_LIVE_ENABLED", "true"); vi.stubEnv("QLOO_API_KEY", "unit-test-placeholder");
    vi.mocked(authorizeLiveVisitor).mockRejectedValue(new Error("must not be called"));
    const response = await post(options); expect(response.status).toBe(200); const body = await response.json(); expect(body.qlooCalls).toEqual([]); expect(authorizeLiveVisitor).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("missing Qloo credentials still return SAMPLE without Redis", async () => {
    vi.stubEnv("QLOO_LIVE_ENABLED", "true");
    expect((await post()).status).toBe(200); expect(authorizeLiveVisitor).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});
