import type { DomainPlan, GuestEvidence, Pick, PlanResponse } from "@/types";
import { classifySeed } from "./taste-seeds";

export const SOURCE_LABELS = { qloo: "LIVE", sample: "SAMPLE", baseline: "BASELINE" } as const;
const list = (names: string[]) => new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(names);

export function individualEvidence(pick: Pick, source: DomainPlan["source"]): GuestEvidence[] {
  return source === "qloo" && pick.support?.kind === "qloo-retrieval" ? pick.guestEvidence ?? [] : [];
}

export function explainRecommendation(pick: Pick, source: DomainPlan["source"]): string {
  if (source === "baseline") return "A fixed generic suggestion, independent of your guests’ tastes. Use it as a comparison.";
  if (source === "sample") return pick.support?.kind === "synthetic-keyword" && pick.bridgingGuests.length
    ? `A curated idea with simple keyword matches for ${list(pick.bridgingGuests)}. Not verified Qloo support.`
    : "A curated hosting idea. No verified Qloo guest support is claimed.";
  const evidence = individualEvidence(pick, source);
  const supported = evidence.filter((e) => e.state === "supported").map((e) => e.guest);
  if (supported.length) return `Chosen from the group’s Qloo results; also returned for ${list(supported)} in individual checks.`;
  return evidence.some((e) => e.state === "checked-not-retrieved")
    ? "Chosen from the group’s Qloo results. Completed individual checks did not retrieve this pick; that does not mean dislike."
    : "Chosen from the group’s Qloo results. Individual guest support has not been checked.";
}

export function evidenceLabel(state: GuestEvidence["state"]): string {
  return state === "supported" ? "Supported: returned in individual results"
    : state === "checked-not-retrieved" ? "Checked, not retrieved: not evidence of dislike" : "Not checked: preference unknown";
}

export function summarizeGroupEvidence(plan: PlanResponse, guestNames: string[]) {
  // Count each guest once, across the selected LIVE picks only. Never count synthetic matches.
  const live = plan.domains.filter((domain) => domain.source === "qloo");
  const supported = new Set(live.flatMap((domain) => domain.picks.flatMap((pick) => individualEvidence(pick, domain.source).filter((e) => e.state === "supported").map((e) => e.guest))));
  const represented = guestNames.filter((name) => supported.has(name));
  const unrepresented = guestNames.filter((name) => !supported.has(name));
  const incomplete = plan.domains.length !== 4 || live.length !== 4 || live.some((domain) => domain.picks.some((pick) => guestNames.some((guest) => !individualEvidence(pick, domain.source).some((e) => e.guest === guest && e.state !== "unchecked"))));
  return { represented, unrepresented, total: guestNames.length, incomplete, liveDomains: live.length };
}

export function unresolvedGuidance(seed: string): string {
  const { kind } = classifySeed(seed);
  if (kind === "music-tag") return "Try a simpler music genre, such as jazz or electronic.";
  if (kind === "cuisine-tag") return "Try a cuisine name, such as Italian food or Japanese food.";
  if (/style|denim|jacket|streetwear|minimalism|vintage/i.test(seed)) return "Try a specific brand name instead of a broad style description.";
  if (/film|movie|cinema/i.test(seed)) return "Try the exact title of one film instead of a collection or broad film description.";
  return "Try the exact name of an artist, a film, or a brand; or a music genre or cuisine.";
}
