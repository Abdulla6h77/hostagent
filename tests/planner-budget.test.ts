import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm, rmdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPlannerBudget } from "@/lib/qloo-planner-budget";
import { createQlooClient } from "@/lib/qloo";
import { POST } from "@/app/api/plan/route";

let directory: string | undefined;
afterEach(async () => { if (directory) { for (const name of await readdir(directory)) await rm(path.join(directory, name)); await rmdir(directory); directory = undefined; } });
describe("separate twelve-attempt planner budget, offline", () => {
  it("caps concurrent reservations and persists exhaustion across instances", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "host-planner-ledger-"));
    const file = path.join(directory, "qloo-planner-twelve-attempts.json");
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => createPlannerBudget(file).reserve("/search", { query: "Never logged" })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(12);
    await expect(createPlannerBudget(file).reserve("/search", {})).rejects.toThrow("exhausted");
    expect(JSON.parse(await readFile(file, "utf8")).attempts).toBe(12);
    expect(await readFile(file, "utf8")).not.toContain("Never logged");
  });
  it("isolates Phase 1.8 and records timing while stopping after authentication failure", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "host-final-ledger-"));
    const file = path.join(directory, "qloo-final-twelve-attempts.json");
    const budget = createPlannerBudget(file);
    const attempt = await budget.reserve("/v2/insights", { "filter.type": "urn:entity:movie" });
    await budget.settle(attempt, 401, "http-error", undefined, undefined, 123);
    await expect(budget.reserve("/search", {})).rejects.toThrow("stopped");
    const state = JSON.parse(await readFile(file, "utf8"));
    expect(state.authorization).toBe("phase-1.8-2026-10-23");
    expect(state.records[0].durationMs).toBe(123);
    expect(state.attempts).toBe(1);
    expect(() => createPlannerBudget(path.join(directory!, "qloo-timeout-four-attempts.json"))).toThrow();
  });
  it("cannot target the earlier nine-attempt ledger", () => {
    expect(() => createPlannerBudget(".local/qloo-live-nine-attempts.json")).toThrow("Invalid planner ledger destination");
  });
  it("retry-disabled client makes exactly one attempt for 503", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    const client = createQlooClient({ enabled: true, key: "unit-test-placeholder", retries: 0, fetcher });
    await expect(client.searchEntities("Invented")).rejects.toMatchObject({ code: "upstream" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("allows insights past ten seconds, then aborts at twenty without retry", async () => {
    vi.useFakeTimers();
    const aborted = vi.fn();
    const fetcher = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { aborted(); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    }));
    const client = createQlooClient({ enabled: true, key: "unit-test-placeholder", retries: 0, fetcher });
    const failure = client.getInsights({ filterType: "urn:entity:artist", interestEntityIds: ["invented"] }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(10_001); expect(aborted).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(9_999); expect((await failure).code).toBe("timeout");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("completes all four primary domains before spending the remaining two calls on coverage", async () => {
    vi.stubEnv("QLOO_LIVE_ENABLED", "true"); vi.stubEnv("QLOO_API_KEY", "unit-test-placeholder");
    vi.stubEnv("QLOO_MAX_HTTP_ATTEMPTS", "12"); vi.stubEnv("QLOO_MAX_RETRIES", "0");
    const sequence: { domain: string; signals: number }[] = [];
    const fetcher = vi.fn(async (url: URL) => {
      if (url.pathname === "/search") {
        const query = url.searchParams.get("query")!;
        return Response.json({ results: [{ entity_id: `invented-${query}`, name: query, types: [query === "miles davis" ? "urn:entity:artist" : "urn:entity:movie"] }] });
      }
      if (url.pathname === "/v2/tags") {
        const query = url.searchParams.get("filter.query")!;
        const scope = ["jazz", "electronic"].includes(query) ? "music" : "place";
        return Response.json({ results: { tags: [{ id: `urn:tag:genre:${scope}:${query}`, name: query }] } });
      }
      const domain = url.searchParams.get("filter.type")!;
      const ids = url.searchParams.get("signal.interests.entities")!.split(",");
      sequence.push({ domain, signals: ids.length });
      const a = { entity_id: `${domain}-a`, name: `Invented ${domain} A`, subtype: domain };
      const b = { entity_id: `${domain}-b`, name: `Invented ${domain} B`, subtype: domain };
      return Response.json({ results: { entities: ids.length > 1 ? [a, b, { ...a, entity_id: a.entity_id.toUpperCase() }] : ids[0].includes("miles") ? [a] : [b] } });
    });
    vi.stubGlobal("fetch", fetcher);
    const guests = [{ name: "Guest A", seeds: ["Miles Davis", "jazz", "Italian food"] }, { name: "Guest B", seeds: ["Inception", "electronic music", "Japanese food"] }];
    const response = await POST(new Request("http://localhost/api/plan", { method: "POST", body: JSON.stringify({ guests, useQloo: true }) }));
    const plan = await response.json();
    expect(response.status).toBe(200); expect(plan.mode).toBe("qloo"); expect(plan.domains.map((d: { source: string }) => d.source)).toEqual(["qloo", "qloo", "qloo", "qloo"]);
    expect(fetcher).toHaveBeenCalledTimes(12); expect(sequence.slice(0, 4).every((call) => call.signals === 2)).toBe(true);
    expect(sequence.slice(4).map((call) => call.domain)).toEqual(["urn:entity:artist", "urn:entity:artist"]);
    expect(plan.resolutionCoverage).toEqual(guests.map((g) => ({ guest: g.name, entitySeeds: 1, genreSeeds: 1, cuisineSeeds: 1, unresolvedSeeds: 0 })));
    expect(plan.domains.every((d: { picks: { affinity: unknown }[] }) => d.picks.length === 2 && d.picks.every((p) => p.affinity === null))).toBe(true);
    expect(plan.domains[0].picks.map((p: { bridgingGuests: string[] }) => p.bridgingGuests)).toEqual([["Guest A"], ["Guest B"]]);
    expect(plan.domains[1].picks[0].support.checked).toBe(0); expect(plan.domains[1].picks[0].bridgingGuests).toEqual([]);
    const before = fetcher.mock.calls.length;
    const baseline = await POST(new Request("http://localhost/api/plan", { method: "POST", body: JSON.stringify({ guests, useQloo: false }) }));
    expect((await baseline.json()).mode).toBe("baseline"); expect(fetcher.mock.calls.length).toBe(before);
  }, 10_000);
});
