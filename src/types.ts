export type Domain = "music" | "food" | "film" | "vibe";
export type Provenance = "qloo" | "sample" | "baseline";
export interface Guest { name: string; seeds: string[] }
export interface GuestEvidence { guest: string; state: "supported" | "checked-not-retrieved" | "unchecked" }
export interface GroupCoverage {
  representedGuests: string[];
  checkedWithoutCandidateGuests: string[];
  uncheckedGuests: string[];
  unselectedGuests: string[];
}
export interface Pick {
  title: string;
  subtitle: string;
  why: string;
  // Rankings and keyword matches are not calibrated affinity measurements.
  affinity: number | null;
  bridgingGuests: string[];
  entityId?: string;
  guestEvidence?: GuestEvidence[];
  support?: { kind: "qloo-retrieval" | "synthetic-keyword"; count: number; total: number; checked?: number; rankScore: number };
}
export interface DomainPlan {
  domain: Domain;
  headline: string;
  source: Provenance;
  reason?: string;
  coverage?: GroupCoverage;
  picks: Pick[];
}
export interface QlooCall { endpoint: string; count: number; cacheHits: number }
export interface PlanResponse {
  mode: Provenance;
  domains: DomainPlan[];
  qlooCalls: QlooCall[];
  generatedAt: string;
  warnings: string[];
  unresolvedSeeds: { guest: string; seeds: string[] }[];
  resolutionCoverage?: { guest: string; entitySeeds: number; genreSeeds: number; cuisineSeeds: number; unresolvedSeeds: number }[];
  context: { occasion?: string; city?: string };
}
