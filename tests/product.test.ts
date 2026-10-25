import { describe, it, expect, vi } from "vitest";
import { buildPlan } from "@/lib/orchestrator";
import { getMockPlan } from "@/lib/mock";
import { PlanRequestSchema } from "@/lib/validation";
import { QlooError, type QlooClient, type Entity } from "@/lib/qloo";
import type { Guest } from "@/types";

const guests: Guest[] = [
  { name: "Mina", seeds: ["jazz", "ramen", "minimalism"] },
  { name: "Omar", seeds: ["jazz", "tacos", "Marvel"] },
];
function fakeClient(overrides: Partial<QlooClient> = {}): QlooClient {
  return {
    available: true,
    searchEntities: vi.fn(async (q) => ({ entities: [{ entity_id: `seed-${q}`, name: q }] })),
    searchTags: vi.fn(async () => ({ tags: [{ tag_id: "urn:tag:genre:place:synthetic", name: "Dining" }] })),
    getInsights: vi.fn(async ({ filterType }) => ({ entities: [{ entity_id: `pick-${filterType}`, name: `Synthetic test entity ${filterType}`, type: filterType }] })),
    compareEntities: vi.fn(async () => ({})), ...overrides,
  };
}
const options = { useQloo: true };
const deps = (client: QlooClient) => ({ client, spacingMs: 0 });
describe("baseline and sample", () => {
  it("baseline content ignores all guest/context inputs and performs no IO", async () => {
    const client = fakeClient();
    const a = await buildPlan(guests, { ...options, useQloo: false }, deps(client));
    const b = await buildPlan([{ name: "Other", seeds: [] }], { useQloo: false, city: "Other city" }, deps(client));
    expect(a.domains).toEqual(b.domains); expect(a.context).toEqual({});
    expect(a.mode).toBe("baseline"); expect(a.domains).toHaveLength(4);
    expect(client.searchEntities).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("missing credentials return sample without network even with live flag enabled", async () => {
    vi.stubEnv("QLOO_LIVE_ENABLED", "true");
    const plan = await buildPlan(guests, options);
    expect(plan.mode).toBe("sample"); expect(plan.qlooCalls).toEqual([]);
    expect(plan.domains.every((d) => d.source === "sample" && d.picks.length === 3)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires explicit live opt-in even when a key is set", async () => {
    vi.stubEnv("QLOO_API_KEY", "unit-test-placeholder");
    expect((await buildPlan(guests, options)).mode).toBe("sample"); expect(fetch).not.toHaveBeenCalled();
  });
  it("sample attribution uses actual guests and declares only keyword evidence", () => {
    const plans = getMockPlan(guests);
    const music = plans[0].picks[0];
    expect(music.bridgingGuests).toEqual(["Mina", "Omar"]);
    expect(music.why).toContain("Synthetic keyword match"); expect(music.why).toContain("Mina");
    expect(music.affinity).toBeNull(); expect(music.support).toMatchObject({ count: 2, total: 2, kind: "synthetic-keyword" });
    expect(JSON.stringify(plans)).not.toMatch(/Aisha|Chloe|Dev/);
  });
  it("unmatched sample seeds do not fabricate guest support", () => {
    const plans = getMockPlan([{ name: "Nobody", seeds: ["zzzzzz"] }]);
    expect(plans.every((d) => d.picks.every((p) => p.bridgingGuests.length === 0 && p.affinity === null))).toBe(true);
  });
  it("preserves curated titles with their matching descriptions", () => {
    const plans = getMockPlan([{ name: "Mina", seeds: ["techno", "bbq", "tarantino"] }]);
    expect(plans[0].picks[0]).toMatchObject({ title: "Late-Night Techno", subtitle: "Charlotte de Witte, Amelie Lens, Nina Kraviz" });
    expect(plans[1].picks[0].title).toBe("Korean BBQ");
    expect(plans[2].picks[0].title).toBe("Tarantino Night");
  });
});
describe("Qloo orchestration with hand-authored test doubles only", () => {
  it("empty domain gets its own fallback, preserving successful domains", async () => {
    const client = fakeClient({ getInsights: vi.fn(async ({ filterType }) => ({ entities: filterType === "urn:entity:brand" ? [] : [{ entity_id: filterType, name: "Invented test entity" }] })) });
    const plan = await buildPlan(guests, options, deps(client));
    expect(plan.mode).toBe("sample"); expect(plan.domains.map((d) => d.source)).toEqual(["qloo", "qloo", "qloo", "sample"]);
    expect(plan.domains[3].picks).toHaveLength(3); expect(plan.domains[3].reason).toContain("no recommendations");
  });
  it("a thrown domain request does not discard other Qloo domains", async () => {
    const client = fakeClient({ getInsights: vi.fn(async ({ filterType }) => {
      if (filterType === "urn:entity:place") throw new QlooError("rate-limit");
      return { entities: [{ entity_id: filterType, name: "Invented test entity" }] };
    }) });
    const plan = await buildPlan(guests, options, deps(client));
    expect(plan.domains[1].source).toBe("sample"); expect(plan.domains[1].reason).toContain("rate limit");
    expect(plan.domains.filter((d) => d.source === "qloo")).toHaveLength(3);
  });
  it("tries TV when movie insights are empty", async () => {
    const client = fakeClient({ getInsights: vi.fn(async ({ filterType }) => ({ entities: filterType === "urn:entity:movie" ? [] : [{ entity_id: filterType, name: "Invented test entity" }] })) });
    const plan = await buildPlan(guests, options, deps(client));
    expect(plan.domains[2].picks[0].entityId).toBe("urn:entity:tv_show");
  });
  it("does not claim probability for short nonempty live results", async () => {
    const plan = await buildPlan(guests, options, deps(fakeClient()));
    expect(plan.mode).toBe("qloo"); expect(plan.domains[0].picks).toHaveLength(1);
    expect(plan.domains[0].picks[0]).toMatchObject({ affinity: null, support: { count: 2, total: 2, kind: "qloo-retrieval" } });
    expect(plan.domains[0].picks[0].why).toContain("2 of 2");
  });
  it("ranks observed per-guest overlap above group rank, without exact seed-ID matching", async () => {
    const a: Entity = { entity_id: "invented-recommendation-a", name: "Invented A" };
    const b: Entity = { entity_id: "invented-recommendation-b", name: "Invented B" };
    const client = fakeClient({ getInsights: vi.fn(async ({ interestEntityIds }) => ({ entities: interestEntityIds.length > 1 ? [a, b] : [b] })) });
    const plan = await buildPlan(guests, options, deps(client));
    expect(plan.domains[0].picks[0].entityId).toBe(b.entity_id);
    expect(plan.domains[0].picks[0].bridgingGuests).toEqual(["Mina", "Omar"]);
    expect(plan.domains[0].picks[1].bridgingGuests).toEqual([]);
  });
  it("unresolved guests and failed per-guest checks never acquire invented support", async () => {
    const client = fakeClient({ searchEntities: vi.fn(async (q) => ({ entities: q === "minimalism" ? [{ entity_id: "minimalism", name: q }] : [] })) });
    const plan = await buildPlan(guests, options, deps(client));
    expect(plan.unresolvedSeeds).toHaveLength(2); expect(plan.domains[0].picks[0].bridgingGuests).toEqual(["Mina"]);
    expect(plan.warnings.join(" ")).toContain("Some seeds");
  });
  it("discloses exact-match failures and avoids unsignaled recommendations", async () => {
    const client = fakeClient({ searchEntities: vi.fn(async () => ({ entities: [{ entity_id: "wrong", name: "Unrelated search result" }] })) });
    const plan = await buildPlan(guests, options, deps(client));
    expect(plan.mode).toBe("sample"); expect(plan.unresolvedSeeds).toHaveLength(2); expect(client.getInsights).not.toHaveBeenCalled();
  });
  it("does not send unrestricted food queries when cuisine tags are unavailable", async () => {
    const client = fakeClient({ searchTags: vi.fn(async () => ({ tags: [] })) });
    const plan = await buildPlan(guests, options, deps(client));
    expect(plan.domains[1].source).toBe("sample");
    expect(vi.mocked(client.getInsights).mock.calls.some(([input]) => input.filterType === "urn:entity:place")).toBe(false);
  });
  it("does not pass an unrelated media tag as a cuisine filter", async () => {
    const client = fakeClient({ searchTags: vi.fn(async () => ({ tags: [{ tag_id: "urn:tag:genre:media:invented", name: "Invented Media Genre" }] })) });
    const plan = await buildPlan(guests, options, deps(client));
    expect(plan.domains[1].source).toBe("sample");
    expect(vi.mocked(client.getInsights).mock.calls.some(([input]) => input.filterType === "urn:entity:place")).toBe(false);
  });
  it("normalizes repeated seeds and bounds seed search concurrency", async () => {
    let active = 0; let max = 0;
    const client = fakeClient({ searchEntities: vi.fn(async (q) => {
      active++; max = Math.max(max, active); await new Promise((r) => setTimeout(r, 1)); active--;
      return { entities: [{ entity_id: q, name: q }] };
    }) });
    await buildPlan([{ name: "A", seeds: ["Seed One", "Seed Two", "Seed Three"] }, { name: "B", seeds: ["Seed One", "Seed Four", "Seed Five"] }], options, deps(client));
    expect(client.searchEntities).toHaveBeenCalledTimes(5); expect(max).toBeLessThanOrEqual(3);
  });
  it("marks remaining domains as sample when total time budget expires", async () => {
    const client = fakeClient();
    const plan = await buildPlan(guests, options, { client, spacingMs: 10, budgetMs: 1 });
    expect(plan.mode).toBe("sample"); expect(plan.domains.some((d) => d.reason?.includes("time budget"))).toBe(true);
  });
  it("bounds concurrent primary insights to two and keeps every domain", async () => {
    let active = 0; let maximum = 0;
    const client = fakeClient({ getInsights: vi.fn(async ({ filterType }) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5)); active--;
      return { entities: [{ entity_id: filterType, name: `Invented ${filterType}` }] };
    }) });
    const result = await buildPlan(guests, options, deps(client));
    expect(maximum).toBe(2); expect(result.domains).toHaveLength(4);
    expect(result.domains.map((d) => d.domain)).toEqual(["music", "food", "film", "vibe"]);
  });
});
describe("validation", () => {
  it("trims names and tastes", () => {
    const result = PlanRequestSchema.parse({ guests: guests.map((g) => ({ name: ` ${g.name} `, seeds: g.seeds.map((s) => ` ${s} `) })) });
    expect(result.guests).toEqual(guests);
  });
  it.each([
    { guests: [] }, { guests: [guests[0]] }, { guests: Array(5).fill(guests[0]) },
    { guests: [{ name: "   ", seeds: guests[0].seeds }, guests[1]] },
    { guests: [{ name: "Mina", seeds: ["jazz", "JAZZ", "ramen"] }, guests[1]] },
    { guests: [guests[0], guests[0]] }, { guests, useQloo: "true" },
    { guests: [{ name: "Mina", seeds: ["jazz", "ramen", " "] }, guests[1]] },
    { guests, city: "x".repeat(101) },
  ])("rejects invalid input %#", (body) => expect(PlanRequestSchema.safeParse(body).success).toBe(false));
});
