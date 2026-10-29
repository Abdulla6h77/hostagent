import { describe, expect, it, vi } from "vitest";
import { describeCoverage, selectGroupCoverage } from "@/lib/group-coverage";
import { buildPlan } from "@/lib/orchestrator";
import { QlooError, type QlooClient } from "@/lib/qloo";
import { PlanResponseSchema } from "@/lib/plan-request";
import type { Pick } from "@/types";

const names = ["Guest 1", "Guest 2", "Guest 3", "Guest 4"];
function candidate(title: string, supported: string[], checked = names): Pick {
  return { title, subtitle: "Offline fixture", why: "Synthetic test only", entityId: title, affinity: null, bridgingGuests: supported,
    support: { kind: "qloo-retrieval", count: supported.length, total: names.length, checked: checked.length, rankScore: 1 },
    guestEvidence: names.map((guest) => ({ guest, state: supported.includes(guest) ? "supported" : checked.includes(guest) ? "checked-not-retrieved" : "unchecked" })),
  };
}
const titles = (picks: Pick[]) => picks.map((pick) => pick.title);

describe("exact set-level group coverage", () => {
  it("fixes the three-guest majority counterexample", () => {
    const pool = [candidate("A", names.slice(0, 2)), candidate("B", names.slice(0, 2)), candidate("C", names.slice(0, 2)), candidate("Minority", [names[2]])];
    const original = structuredClone(pool);
    const result = selectGroupCoverage(pool, names.slice(0, 3));
    expect(titles(result.picks)).toEqual(["A", "B", "Minority"]);
    expect(result.coverage.representedGuests).toEqual(names.slice(0, 3));
    expect(pool).toEqual(original);
    expect(result.picks.every((pick) => pool.includes(pick) && pick.affinity === null)).toBe(true);
  });
  it.each([2, 3, 4])("covers %i guests when a feasible three-pick set exists", (count) => {
    const guests = names.slice(0, count);
    const result = selectGroupCoverage([candidate("A", [names[0]]), candidate("B", [names[0]]), candidate("C", [names[0]]), candidate("Bridge", guests.slice(1))], guests);
    expect(result.coverage.representedGuests).toEqual(guests);
    expect(result.picks).toHaveLength(3);
  });
  it("finds global coverage rather than a greedy high-support first pick", () => {
    const pool = [candidate("Greedy", [names[0], names[1]]), candidate("Pair", [names[0], names[2]]), candidate("OtherPair", [names[1], names[3]])];
    expect(selectGroupCoverage(pool, names).coverage.representedGuests).toEqual(names);
  });
  it("uses lexicographic existing rank order for tied sets deterministically", () => {
    const pool = [candidate("A", [names[0]]), candidate("B", [names[1]]), candidate("C", [names[0]]), candidate("D", [names[1]])];
    for (let i = 0; i < 5; i++) expect(titles(selectGroupCoverage(pool, names.slice(0, 2)).picks)).toEqual(["A", "B", "C"]);
  });
  it("preserves ranking with no evidence and ignores pooled attribution alone", () => {
    const pool = ["A", "B", "C", "D"].map((title) => ({ ...candidate(title, names), guestEvidence: undefined }));
    const result = selectGroupCoverage(pool, names);
    expect(titles(result.picks)).toEqual(["A", "B", "C"]);
    expect(result.coverage.uncheckedGuests).toEqual(names);
  });
  it("never treats synthetic keyword support as verified evidence", () => {
    const pool = [candidate("A", []), candidate("B", []), candidate("C", []), { ...candidate("Synthetic", names), support: { ...candidate("x", []).support!, kind: "synthetic-keyword" as const } }];
    expect(titles(selectGroupCoverage(pool, names).picks)).toEqual(["A", "B", "C"]);
  });
  it("separates absent candidates from unchecked evidence", () => {
    const result = selectGroupCoverage([candidate("Only", [names[0]], [names[0], names[1]])], names.slice(0, 3));
    expect(result.coverage).toEqual({ representedGuests: [names[0]], checkedWithoutCandidateGuests: [names[1]], uncheckedGuests: [names[2]], unselectedGuests: [] });
    expect(describeCoverage(result.coverage, 3)).toContain("No candidate");
    expect(describeCoverage(result.coverage, 3)).toContain("not checked");
    expect(result.picks).toHaveLength(1);
  });
  it("reports an unavoidable fourth-guest exclusion rather than inventing a pick", () => {
    const pool = names.map((guest, i) => candidate(String(i), [guest]));
    const result = selectGroupCoverage(pool, names);
    expect(titles(result.picks)).toEqual(["0", "1", "2"]);
    expect(result.coverage.unselectedGuests).toEqual([names[3]]);
    expect(describeCoverage(result.coverage, 4)).toContain("three-pick limit");
  });
  it("matches exhaustive selection on deterministic sparse and overlapping pools", () => {
    for (const count of [2, 3, 4]) for (let seed = 0; seed < 12; seed++) {
      const guests = names.slice(0, count);
      const pool = Array.from({ length: 7 }, (_, i) => candidate(String(i), guests.filter((_guest, j) => ((seed + i * 5 + i * i) >> j) & 1)));
      let best: number[] = [], covered = -1;
      for (let a = 0; a < pool.length - 2; a++) for (let b = a + 1; b < pool.length - 1; b++) for (let c = b + 1; c < pool.length; c++) {
        const size = new Set([a, b, c].flatMap((i) => pool[i].bridgingGuests)).size;
        // Enumeration order is already lexicographic in existing rank.
        if (size > covered) { best = [a, b, c]; covered = size; }
      }
      expect(titles(selectGroupCoverage(pool, guests).picks)).toEqual(best.map((i) => pool[i].title));
    }
  });
  it("handles an empty pool without padding or claiming support", () => {
    const result = selectGroupCoverage([], names);
    expect(result.picks).toEqual([]); expect(result.coverage.uncheckedGuests).toEqual(names);
  });
});

function fixture(count: number, settings: { unchecked?: boolean; failure?: boolean; unresolved?: boolean; missingCandidate?: boolean; emptyIndividual?: boolean; failedIndividual?: boolean } = {}) {
  const guests = names.slice(0, count).map((name, i) => ({ name, seeds: [`Artist ${i}`, "jazz", "Italian food"] }));
  const client: QlooClient = {
    available: true, remainingAttempts: () => settings.unchecked ? 0 : 100,
    searchEntities: vi.fn(async (query) => ({ entities: settings.unresolved && query === "artist 2" ? [] : [{ entity_id: query, name: query }] })),
    searchTags: vi.fn(async (query) => ({ tags: settings.unresolved ? [] : [{ tag_id: query === "jazz" ? "urn:tag:genre:music:jazz" : "urn:tag:genre:place:italian", name: query }] })),
    getInsights: vi.fn(async (input) => {
      if (settings.failure && input.filterType === "urn:entity:place") throw new QlooError("rate-limit");
      const ids = input.interestEntityIds;
      if (settings.failedIndividual && ids.length === 1 && ids[0] === "artist 2") throw new QlooError("timeout");
      const labels = ids.length > 1 ? ["A", "B", "C", ...(settings.missingCandidate ? [] : ["Minority"])]
        : ids[0] === "artist 2" ? settings.emptyIndividual ? [] : ["Minority"] : ["A", "B", "C"];
      return { entities: labels.map((name) => ({ entity_id: input.filterType + name, name, type: input.filterType })) };
    }), compareEntities: vi.fn(async () => ({})),
  };
  return { guests, client };
}

describe("production orchestrator integration with offline fixtures", () => {
  it.each([2, 3, 4])("uses verified evidence for %i guests without adding requests", async (count) => {
    const { guests, client } = fixture(count);
    const plan = await buildPlan(guests, { useQloo: true }, { client, spacingMs: 0 });
    expect(client.searchEntities).toHaveBeenCalledTimes(count);
    expect(client.getInsights).toHaveBeenCalledTimes(4 + count * 4);
    expect(plan.domains.every((domain) => domain.coverage?.representedGuests.length === count)).toBe(true);
    if (count > 2) expect(plan.domains[0].picks.some((pick) => pick.title === "Minority")).toBe(true);
    expect(PlanResponseSchema.parse(plan).domains[0].coverage).toEqual(plan.domains[0].coverage);
    expect(PlanResponseSchema.parse(plan).domains[0].picks[0].guestEvidence).toEqual(plan.domains[0].picks[0].guestEvidence);
    expect(plan.domains.every((domain) => domain.picks.every((pick) => pick.affinity === null))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves primary ranking when individual checks are unaffordable", async () => {
    const { guests, client } = fixture(3, { unchecked: true });
    const plan = await buildPlan(guests, { useQloo: true }, { client, spacingMs: 0 });
    expect(client.getInsights).toHaveBeenCalledTimes(4);
    expect(titles(plan.domains[0].picks)).toEqual(["A", "B", "C"]);
    expect(plan.domains[0].coverage?.uncheckedGuests).toEqual(names.slice(0, 3));
    expect(plan.domains[0].picks.every((pick) => pick.bridgingGuests.length === 0 && pick.guestEvidence?.every((e) => e.state === "unchecked"))).toBe(true);
  });
  it("reports a missing supporting candidate without expanding the group pool", async () => {
    const { guests, client } = fixture(3, { missingCandidate: true });
    const plan = await buildPlan(guests, { useQloo: true }, { client, spacingMs: 0 });
    expect(titles(plan.domains[0].picks)).toEqual(["A", "B", "C"]);
    expect(plan.domains[0].coverage?.checkedWithoutCandidateGuests).toEqual([names[2]]);
    expect(plan.domains[0].reason).toContain("No candidate");
  });
  it("treats successful empty individual results as checked, not unchecked", async () => {
    const { guests, client } = fixture(3, { emptyIndividual: true });
    const plan = await buildPlan(guests, { useQloo: true }, { client, spacingMs: 0 });
    expect(plan.domains[0].picks[0].guestEvidence?.find((e) => e.guest === names[2])?.state).toBe("checked-not-retrieved");
  });
  it("keeps failed individual checks unchecked without discarding primary results", async () => {
    const { guests, client } = fixture(3, { failedIndividual: true });
    const plan = await buildPlan(guests, { useQloo: true }, { client, spacingMs: 0 });
    expect(plan.domains.every((domain) => domain.source === "qloo")).toBe(true);
    expect(plan.domains[0].coverage?.uncheckedGuests).toEqual([names[2]]);
    expect(plan.domains[0].picks.every((pick) => pick.guestEvidence?.find((e) => e.guest === names[2])?.state === "unchecked")).toBe(true);
  });
  it("does not attribute unresolved guest inputs", async () => {
    const { guests, client } = fixture(3, { unresolved: true });
    const plan = await buildPlan(guests, { useQloo: true }, { client, spacingMs: 0 });
    expect(plan.domains[0].coverage?.uncheckedGuests).toEqual([names[2]]);
    expect(plan.domains[0].picks.every((pick) => !pick.bridgingGuests.includes(names[2]))).toBe(true);
  });
  it("leaves fallback, baseline, and demo domains outside verified coverage selection", async () => {
    const { guests, client } = fixture(3, { failure: true });
    const plan = await buildPlan(guests, { useQloo: true }, { client, spacingMs: 0 });
    expect(plan.domains[1].source).toBe("sample"); expect(plan.domains[1].coverage).toBeUndefined();
    expect(plan.domains[1].picks.every((pick) => pick.guestEvidence === undefined)).toBe(true);
    for (const options of [{ useQloo: false }, { useQloo: true, sampleOnly: true }]) {
      const result = await buildPlan(guests, options, { client, spacingMs: 0 });
      expect(result.domains.every((domain) => !domain.coverage && domain.picks.every((pick) => !pick.guestEvidence))).toBe(true);
    }
  });
});
