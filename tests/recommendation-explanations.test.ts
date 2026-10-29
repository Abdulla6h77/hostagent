import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DomainPlan, GuestEvidence, Pick, PlanResponse } from "@/types";
import { GroupEvidenceSummary, UnresolvedTastes } from "@/components/result-evidence";
import { SOURCE_LABELS, evidenceLabel, explainRecommendation, individualEvidence, summarizeGroupEvidence, unresolvedGuidance } from "@/lib/recommendation-explanations";
import { buildPlan } from "@/lib/orchestrator";
import type { QlooClient } from "@/lib/qloo";

const guests = ["Mina", "Omar", "Lee"];
const evidence: GuestEvidence[] = [{ guest: "Mina", state: "supported" }, { guest: "Omar", state: "checked-not-retrieved" }, { guest: "Lee", state: "unchecked" }];
const pick: Pick = { title: "Offline fixture", subtitle: "Fixture", why: "Technical evidence", affinity: null, entityId: "fixture", bridgingGuests: ["Mina"], guestEvidence: evidence,
  support: { kind: "qloo-retrieval", count: 1, total: 3, checked: 2, rankScore: 1 } };
function fixture(): PlanResponse {
  return { mode: "qloo", generatedAt: "2026-10-29T00:00:00Z", context: {}, warnings: [], qlooCalls: [], unresolvedSeeds: [],
    domains: (["music", "food", "film", "vibe"] as const).map((domain) => ({ domain, headline: domain, source: "qloo", picks: [structuredClone(pick)], coverage: { representedGuests: ["Mina"], checkedWithoutCandidateGuests: ["Omar"], uncheckedGuests: ["Lee"], unselectedGuests: [] } })),
  };
}

describe("deterministic explanations and provenance", () => {
  it("names only guests with verified individual support", () => {
    const text = explainRecommendation(pick, "qloo");
    expect(text).toContain("Mina"); expect(text).not.toMatch(/Omar|Lee/);
    expect(text).not.toMatch(/%|affinity|consensus|dislike/);
    expect(individualEvidence(pick, "qloo")).toEqual(evidence);
  });
  it("labels all three evidence states without treating absence as dislike", () => {
    expect(evidenceLabel("supported")).toContain("Supported");
    expect(evidenceLabel("checked-not-retrieved")).toContain("not evidence of dislike");
    expect(evidenceLabel("unchecked")).toBe("Not checked: preference unknown");
  });
  it("does not derive support from pooled names or old unverified metadata", () => {
    expect(explainRecommendation({ ...pick, guestEvidence: undefined }, "qloo")).toContain("has not been checked");
    expect(explainRecommendation({ ...pick, guestEvidence: undefined }, "qloo")).not.toContain("Mina");
    expect(individualEvidence({ ...pick, support: { ...pick.support!, kind: "synthetic-keyword" } }, "qloo")).toEqual([]);
  });
  it("handles checked nonmatches separately from unchecked guests", () => {
    const text = explainRecommendation({ ...pick, guestEvidence: evidence.slice(1) }, "qloo");
    expect(text).toContain("did not retrieve"); expect(text).toContain("does not mean dislike");
  });
  it("keeps synthetic matches and baseline content out of verified evidence", () => {
    const synthetic = { ...pick, support: { ...pick.support!, kind: "synthetic-keyword" as const } };
    expect(explainRecommendation(synthetic, "sample")).toContain("simple keyword matches for Mina");
    expect(explainRecommendation(synthetic, "sample")).toContain("Not verified Qloo support");
    expect(explainRecommendation(pick, "baseline")).toContain("fixed generic");
    expect(individualEvidence(pick, "sample")).toEqual([]);
    expect(SOURCE_LABELS).toEqual({ qloo: "LIVE", sample: "SAMPLE", baseline: "BASELINE" });
  });
  it("produces the same explanations without mutating evidence", () => {
    const before = structuredClone(pick);
    expect(explainRecommendation(pick, "qloo")).toBe(explainRecommendation(structuredClone(pick), "qloo"));
    expect(pick).toEqual(before); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("set coverage summaries", () => {
  it("counts a guest only once across selected recommendations", () => {
    const result = summarizeGroupEvidence(fixture(), guests);
    expect(result).toMatchObject({ represented: ["Mina"], unrepresented: ["Omar", "Lee"], total: 3, incomplete: true });
  });
  it("recognizes representation across different domains without implying shared consensus", () => {
    const plan = fixture();
    plan.domains.forEach((domain, i) => { domain.picks[0].guestEvidence = guests.map((guest, j) => ({ guest, state: j === i % 3 ? "supported" : "checked-not-retrieved" })); });
    expect(summarizeGroupEvidence(plan, guests)).toMatchObject({ represented: guests, incomplete: false });
    const html = renderToStaticMarkup(React.createElement(GroupEvidenceSummary, { plan, guestNames: guests }));
    expect(html).toContain("3 of 3"); expect(html).toContain("does not mean every guest supports every pick");
  });
  it.each(["sample", "baseline"] as const)("never counts %s attribution as verified representation", (source) => {
    const plan = fixture(); plan.mode = source; plan.domains.forEach((domain) => { domain.source = source; });
    expect(summarizeGroupEvidence(plan, guests)).toMatchObject({ represented: [], incomplete: true, liveDomains: 0 });
    const html = renderToStaticMarkup(React.createElement(GroupEvidenceSummary, { plan, guestNames: guests }));
    expect(html).toContain("0 of 3"); expect(html).toContain(SOURCE_LABELS[source]);
    expect(html).not.toContain("1 of 3 guests represented");
  });
  it("marks partial fallback and absent individual checks incomplete", () => {
    const plan = fixture(); plan.mode = "sample"; plan.domains[1].source = "sample";
    plan.domains[0].picks[0].guestEvidence = undefined;
    const html = renderToStaticMarkup(React.createElement(GroupEvidenceSummary, { plan, guestNames: guests }));
    expect(html).toContain("Evidence is incomplete"); expect(html).toContain("LIVE"); expect(html).toContain("SAMPLE");
    expect(html).toContain("Not everyone has verified representation");
  });
  it("reports entirely absent checks without interpreting them as dislike", () => {
    const plan = fixture();
    plan.domains.forEach((domain) => { domain.picks[0].guestEvidence = guests.map((guest) => ({ guest, state: "unchecked" })); domain.coverage = undefined; });
    expect(summarizeGroupEvidence(plan, guests)).toMatchObject({ represented: [], incomplete: true });
    const html = renderToStaticMarkup(React.createElement(GroupEvidenceSummary, { plan, guestNames: guests }));
    expect(html).toContain("Not yet verified"); expect(html).not.toContain("dislikes");
  });
  it("ignores evidence for names outside the submitted snapshot", () => {
    expect(summarizeGroupEvidence(fixture(), ["New guest"])).toMatchObject({ represented: [], unrepresented: ["New guest"] });
  });
});

describe("unresolved taste guidance and UI", () => {
  it.each([
    ["jazz", "music genre"], ["Italian food", "cuisine name"], ["vintage denim", "brand name"], ["A24 films", "exact title"], ["something else", "exact name"],
  ])("gives deterministic category guidance for %s without lookup calls", (seed, expected) => {
    expect(unresolvedGuidance(seed)).toContain(expected);
    expect(unresolvedGuidance(seed)).toBe(unresolvedGuidance(seed)); expect(fetch).not.toHaveBeenCalled();
  });
  it("renders unresolved tastes even without warnings and avoids asserting permanent lack of support", () => {
    const plan = fixture(); plan.unresolvedSeeds = [{ guest: "Mina", seeds: ["vintage denim", "A24 films"] }];
    const html = renderToStaticMarkup(React.createElement(UnresolvedTastes, { plan, onEditGuest: vi.fn() }));
    expect(html).toContain("vintage denim"); expect(html).toContain("A24 films");
    expect(html).toContain("not used as Qloo taste signals"); expect(html).toContain("not verified matches");
    expect(html).toContain("Edit tastes for Mina"); expect(html).not.toContain("unsupported forever");
  });
  it("hides unresolved feedback when no resolution failures are reported", () => {
    expect(renderToStaticMarkup(React.createElement(UnresolvedTastes, { plan: fixture(), onEditGuest: vi.fn() }))).toBe("");
  });
  it("escapes guest-entered HTML", () => {
    const plan = fixture(); plan.unresolvedSeeds = [{ guest: "<script>bad</script>", seeds: ["<img src=x>"] }];
    const html = renderToStaticMarkup(React.createElement(UnresolvedTastes, { plan, onEditGuest: vi.fn() }));
    expect(html).not.toContain("<script>"); expect(html).not.toContain("<img");
  });
});

it("presentation of actual orchestrator output adds no Qloo requests or ranking changes", async () => {
  const client: QlooClient = { available: true, remainingAttempts: () => 100,
    searchEntities: vi.fn(async (query) => ({ entities: [{ entity_id: query, name: query }] })),
    searchTags: vi.fn(async () => ({ tags: [{ tag_id: "urn:tag:genre:place:dining", name: "Dining" }] })),
    getInsights: vi.fn(async ({ filterType }) => ({ entities: [{ entity_id: filterType, name: "Offline fixture", type: filterType }] })),
    compareEntities: vi.fn(async () => ({})),
  };
  const members = ["Mina", "Omar"].map((name) => ({ name, seeds: ["Artist A", "Film B", "Brand C"] }));
  const plan = await buildPlan(members, { useQloo: true }, { client, spacingMs: 0 });
  const snapshot = structuredClone(plan);
  const calls = vi.mocked(client.getInsights).mock.calls.length;
  plan.domains.forEach((domain: DomainPlan) => domain.picks.forEach((pick) => explainRecommendation(pick, domain.source)));
  summarizeGroupEvidence(plan, members.map((guest) => guest.name));
  renderToStaticMarkup(React.createElement(GroupEvidenceSummary, { plan, guestNames: members.map((guest) => guest.name) }));
  expect(plan).toEqual(snapshot); expect(client.getInsights).toHaveBeenCalledTimes(calls); expect(calls).toBe(12); expect(fetch).not.toHaveBeenCalled();
});
