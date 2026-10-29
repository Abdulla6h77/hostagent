import { createQlooClient, QlooError, wait, type Entity, type QlooClient, type InsightsInput } from "./qloo";
import { BASELINE_PLAN, DOMAINS, getMockPlan, HEADLINES } from "./mock";
import { isDiningTag } from "./qloo-contract";
import { classifySeed, selectTasteTag } from "./taste-seeds";
import { describeCoverage, selectGroupCoverage } from "./group-coverage";
import type { Domain, DomainPlan, Guest, Pick, PlanResponse, QlooCall } from "@/types";

const TYPES: Record<Domain, string> = { music: "urn:entity:artist", food: "urn:entity:place", film: "urn:entity:movie", vibe: "urn:entity:brand" };
const normalize = (s: string) => s.trim().toLowerCase();
interface Dependencies { client?: QlooClient; spacingMs?: number; budgetMs?: number }
async function boundedMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency = 3): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const index = next++; output[index] = await fn(items[index]); }
  }));
  return output;
}
function failureReason(error: unknown) {
  if (error instanceof QlooError) {
    const reasons = {
      disabled: "Live Qloo access is disabled or credentials are missing.", timeout: "Qloo exceeded the request time budget.",
      network: "Qloo could not be reached.", "rate-limit": "Qloo rate limit reached.", upstream: "Qloo rejected the request or is unavailable.",
      contract: "Qloo returned an unexpected response format.", configuration: "Qloo server configuration needs attention.",
      budget: "The Qloo HTTP-attempt budget for this plan was reached.",
      "shared-budget": "LIVE planning has reached the shared application allowance. Showing SAMPLE ideas where needed.",
      "live-unavailable": "LIVE access is temporarily unavailable. Try SAMPLE ideas or the generic plan.",
    };
    return reasons[error.code];
  }
  return "Recommendations are temporarily unavailable for this domain.";
}
export async function buildPlan(
  guests: Guest[], options: { occasion?: string; city?: string; useQloo: boolean; sampleOnly?: boolean }, dependencies: Dependencies = {},
): Promise<PlanResponse> {
  const calls: QlooCall[] = [];
  const context = { occasion: options.occasion || undefined, city: options.city || undefined };
  const base = { qlooCalls: calls, generatedAt: new Date().toISOString(), context, unresolvedSeeds: [] };
  if (!options.useQloo) return { ...base, context: {}, mode: "baseline", domains: structuredClone(BASELINE_PLAN), warnings: [] };
  if (options.sampleOnly) return { ...base, mode: "sample", domains: getMockPlan(guests, "SAMPLE demo: curated ideas, no live requests."), warnings: ["SAMPLE demo uses curated ideas, not live Qloo results."] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), dependencies.budgetMs ?? 45_000);
  const client = dependencies.client ?? createQlooClient({ calls, signal: controller.signal });
  const samples = getMockPlan(guests);
  const warnings: string[] = [];
  if (options.city) warnings.push(`City context: ${options.city}. Venue locations are not verified; check travel distance before making plans.`);
  if (options.occasion) warnings.push(`Occasion: ${options.occasion}. Recommendations follow taste seeds; no occasion filter is applied.`);
  try {
    if (!client.available) {
      const reason = "Live Qloo access is disabled or credentials are missing. These are synthetic ideas.";
      return { ...base, mode: "sample", domains: getMockPlan(guests, reason), warnings: [reason, ...warnings] };
    }
    const seeds = [...new Set(guests.flatMap((g) => g.seeds.map(normalize)))];
    const resolved = new Map<string, { kind: "entity" | "music-tag" | "cuisine-tag"; id: string }>();
    await boundedMap(seeds, async (seed) => {
      if (controller.signal.aborted) return;
      const intent = classifySeed(seed);
      try {
        if (intent.kind === "entity") {
          const result = await client.searchEntities(intent.query);
          const exact = result.entities.find((e) => normalize(e.name) === seed);
          if (exact) resolved.set(seed, { kind: "entity", id: exact.entity_id });
        } else {
          const result = await client.searchTags(intent.query);
          const exact = selectTasteTag(result.tags, intent.kind, intent.query);
          if (exact) resolved.set(seed, { kind: intent.kind, id: exact.tag_id });
        }
      } catch { /* Disclose unresolved inputs below; never log personal seed text. */ }
    });
    const unresolvedSeeds = guests.map((g) => ({ guest: g.name, seeds: g.seeds.filter((seed) => !resolved.has(normalize(seed))) })).filter((g) => g.seeds.length);
    const forGuests = (members: Guest[], kind: "entity" | "music-tag" | "cuisine-tag") => [...new Set(members.flatMap((g) => g.seeds.flatMap((seed) => {
      const value = resolved.get(normalize(seed)); return value?.kind === kind ? [value.id] : [];
    })))];
    const resolutionCoverage = guests.map((g) => ({ guest: g.name,
      entitySeeds: g.seeds.filter((seed) => resolved.get(normalize(seed))?.kind === "entity").length,
      genreSeeds: g.seeds.filter((seed) => resolved.get(normalize(seed))?.kind === "music-tag").length,
      cuisineSeeds: g.seeds.filter((seed) => resolved.get(normalize(seed))?.kind === "cuisine-tag").length,
      unresolvedSeeds: g.seeds.filter((seed) => !resolved.has(normalize(seed))).length,
    }));
    const allIds = forGuests(guests, "entity");
    const musicTags = forGuests(guests, "music-tag");
    let cuisineTags = forGuests(guests, "cuisine-tag");
    const accessFailure = client.liveAccessFailure?.();
    if (accessFailure) warnings.push(failureReason(new QlooError(accessFailure)));
    if (unresolvedSeeds.length) warnings.push("Some seeds could not be resolved exactly. Qloo uses only resolved entities and genre tags; cuisine tags constrain food. Unresolved inputs are not attributed.");
    if (!allIds.length && !musicTags.length) return { ...base, resolutionCoverage, unresolvedSeeds, mode: "sample", domains: getMockPlan(guests, accessFailure ? failureReason(new QlooError(accessFailure)) : "No exact Qloo taste signals were available."), warnings: ["No taste signals resolved. Showing synthetic ideas.", ...warnings] };
    const spacing = dependencies.spacingMs ?? 300;
    const domains: DomainPlan[] = [];
    const primary = new Map<Domain, { candidates: Entity[]; filterType: string; tags: string[] }>();
    // Fetch every primary domain before spending quota on optional individual evidence.
    await boundedMap(DOMAINS, async (domain) => {
      const fallback = samples.find((p) => p.domain === domain)!;
      try {
        await wait(DOMAINS.indexOf(domain) * spacing, controller.signal);
        if (controller.signal.aborted) throw new QlooError("timeout");
        if (domain === "food" && !cuisineTags.length) {
          const result = await client.searchTags("dining");
          cuisineTags = result.tags.filter(isDiningTag).map((tag) => tag.tag_id);
          if (!cuisineTags.length) throw new QlooError("contract");
        }
        const tags = domain === "food" ? cuisineTags : [];
        let filterType = TYPES[domain];
        const query = (): InsightsInput => ({ filterType, interestEntityIds: allIds, interestTagIds: musicTags, tagIds: tags, take: 10 });
        let group = await client.getInsights(query());
        if (domain === "film" && !group.entities.length) {
          filterType = "urn:entity:tv_show";
          await wait(spacing, controller.signal);
          group = await client.getInsights(query());
        }
        const seenIds = new Set<string>(); const seenNames = new Set<string>();
        const candidates = group.entities.filter((entity) => {
          const id = entity.entity_id.toLowerCase(), name = normalize(entity.name);
          if (seenIds.has(id) || seenNames.has(name)) return false;
          seenIds.add(id); seenNames.add(name); return true;
        });
        if (!candidates.length) domains.push({ ...fallback, reason: "Qloo returned no recommendations for this domain." });
        else primary.set(domain, { candidates, filterType, tags });
      } catch (error) { domains.push({ ...fallback, reason: failureReason(error) }); }
    }, 2);
    for (const domain of DOMAINS) {
      const group = primary.get(domain);
      if (!group) continue;
      const guestResults = new Map<string, Entity[]>();
      const eligible = guests.filter((guest) => forGuests([guest], "entity").length || forGuests([guest], "music-tag").length);
      // Check a domain's eligible guests as a balanced batch, or claim no individual evidence.
      if ((client.remainingAttempts?.() ?? Infinity) >= eligible.length && !controller.signal.aborted) {
        for (const guest of eligible) {
          try {
            await wait(spacing, controller.signal);
            const ownCuisine = forGuests([guest], "cuisine-tag");
            const result = await client.getInsights({ filterType: group.filterType,
              interestEntityIds: forGuests([guest], "entity"), interestTagIds: forGuests([guest], "music-tag"),
              tagIds: domain === "food" ? (ownCuisine.length ? ownCuisine : group.tags) : [], take: 10,
            });
            guestResults.set(guest.name, result.entities);
          } catch { warnings.push(`${HEADLINES[domain]}: individual support could not be checked for ${guest.name}. No support is claimed for that guest.`); }
        }
      } else warnings.push(`${HEADLINES[domain]}: individual support checks were skipped to respect the request budget or deadline. No guest affinity is inferred.`);
      const ranked: Pick[] = group.candidates.map((entity, groupIndex): Pick => {
        const supporting = guests.filter((guest) => guestResults.get(guest.name)?.some((e) => e.entity_id.toLowerCase() === entity.entity_id.toLowerCase()));
        const rankScore = supporting.length + (1 / (groupIndex + 1) + supporting.reduce((sum, guest) => {
          const rank = guestResults.get(guest.name)!.findIndex((e) => e.entity_id.toLowerCase() === entity.entity_id.toLowerCase());
          return sum + 1 / (rank + 1);
        }, 0)) / (guests.length + 2);
        const attribution = supporting.map((guest) => `${guest.name} (resolved seeds: ${guest.seeds.filter((seed) => {
          const value = resolved.get(normalize(seed)); return value && (value.kind !== "cuisine-tag" || domain === "food");
        }).join(", ")})`).join("; ");
        return {
          entityId: entity.entity_id, title: entity.name,
          subtitle: typeof entity.properties?.description === "string" ? entity.properties.description : entity.type ?? TYPES[domain],
          why: supporting.length
            ? `Returned in the group query and in separate Qloo results for ${attribution}. Retrieval overlap: ${supporting.length} of ${guests.length} guests; ${guestResults.size} individual checks completed. This is not a measured affinity probability.`
            : `Returned by Qloo for the combined resolved taste signals. No individual guest support was established for this pick; ${guestResults.size} of ${guests.length} guest checks completed.${unresolvedSeeds.length ? " Some seeds were unresolved." : ""}`,
          affinity: null, bridgingGuests: supporting.map((g) => g.name),
          guestEvidence: guests.map((guest) => ({ guest: guest.name, state: supporting.some((g) => g.name === guest.name) ? "supported" : guestResults.has(guest.name) ? "checked-not-retrieved" : "unchecked" })),
          support: { kind: "qloo-retrieval", count: supporting.length, total: guests.length, checked: guestResults.size, rankScore },
        };
      }).sort((a, b) => b.support!.rankScore - a.support!.rankScore);
      const { picks, coverage } = selectGroupCoverage(ranked, guests.map((guest) => guest.name));
      const reason = describeCoverage(coverage, guests.length);
      domains.push({ domain, headline: HEADLINES[domain], source: "qloo", picks, coverage, reason });
    }
    domains.sort((a, b) => DOMAINS.indexOf(a.domain) - DOMAINS.indexOf(b.domain));
    const mode = domains.every((d) => d.source === "qloo") ? "qloo" : "sample";
    if (mode === "sample") warnings.push("One or more domains use synthetic ideas. Check each domain's source label.");
    return { ...base, resolutionCoverage, unresolvedSeeds, mode, domains, warnings: [...new Set(warnings)] };
  } finally { clearTimeout(timer); }
}
