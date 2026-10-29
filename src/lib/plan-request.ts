import { z } from "zod";
import type { PlanRequest } from "./validation";
import type { PlanResponse } from "@/types";

const domain = z.enum(["music", "food", "film", "vibe"]);
const source = z.enum(["qloo", "sample", "baseline"]);
const pick = z.object({
  title: z.string(), subtitle: z.string(), why: z.string(), affinity: z.number().nullable(),
  bridgingGuests: z.array(z.string()), entityId: z.string().optional(),
  guestEvidence: z.array(z.object({ guest: z.string(), state: z.enum(["supported", "checked-not-retrieved", "unchecked"]) })).optional(),
  support: z.object({ kind: z.enum(["qloo-retrieval", "synthetic-keyword"]), count: z.number(), total: z.number(), checked: z.number().optional(), rankScore: z.number() }).optional(),
});
export const PlanResponseSchema = z.object({
  mode: source,
  domains: z.array(z.object({ domain, headline: z.string(), source, reason: z.string().optional(), coverage: z.object({ representedGuests: z.array(z.string()), checkedWithoutCandidateGuests: z.array(z.string()), uncheckedGuests: z.array(z.string()), unselectedGuests: z.array(z.string()) }).optional(), picks: z.array(pick).min(1) })).length(4).refine((items) => new Set(items.map((item) => item.domain)).size === 4),
  warnings: z.array(z.string()), unresolvedSeeds: z.array(z.object({ guest: z.string(), seeds: z.array(z.string()) })),
  qlooCalls: z.array(z.object({ endpoint: z.string(), count: z.number(), cacheHits: z.number() })),
  generatedAt: z.string(), context: z.object({ occasion: z.string().optional(), city: z.string().optional() }),
  resolutionCoverage: z.array(z.object({ guest: z.string(), entitySeeds: z.number(), genreSeeds: z.number(), cuisineSeeds: z.number(), unresolvedSeeds: z.number() })).optional(),
});

export async function requestPlan(input: PlanRequest, signal?: AbortSignal): Promise<PlanResponse> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 55_000);
  try {
    let response: Response;
    try {
      response = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: controller.signal });
    } catch {
      if (controller.signal.aborted) throw new Error(timedOut ? "Planning took too long. Your details are saved. Try again or choose the instant generic plan." : "Planning was cancelled.");
      throw new Error("We couldn't connect. Check your connection and try again. Your guest details are saved.");
    }
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: "Check each guest has a name and 3–5 different tastes, then try again.",
        413: "This guest list is too large. Shorten the details and try again.",
        503: input.useQloo && !input.sampleOnly ? "LIVE planning is temporarily unavailable. Choose SAMPLE ideas or the generic plan." : "Planning is temporarily unavailable. Your details are saved. Please try again.",
        429: "LIVE request limit reached. Wait before trying again, or choose SAMPLE ideas or the generic plan.",
      };
      throw new Error(messages[response.status] ?? "The planning service couldn't finish. Your details are saved. Try again or use the generic plan.");
    }
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new Error(timedOut ? "Planning took too long. Try again or use the generic plan." : "The service returned an unreadable plan. Try again or use the generic plan."); }
    const parsed = PlanResponseSchema.safeParse(body);
    if (!parsed.success) throw new Error("The service returned an incomplete plan. Try again or use the generic plan.");
    return parsed.data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
