import "server-only";
import { z } from "zod";
import { createHash } from "node:crypto";
import type { QlooCall } from "@/types";
import { createPlannerBudget } from "./qloo-planner-budget";

import {
  EntitiesSchema, TagsSchema, unwrapQlooResponse, searchParameters, tagParameters, insightParameters,
  type SearchResult, type InsightsResult, type TagsResult, type InsightsInput,
} from "./qloo-contract";
export type { Entity, SearchResult, InsightsResult, TagsResult, InsightsInput } from "./qloo-contract";
export interface CompareResult { compatibility_score?: number; analysis?: string }
export interface QlooClient {
  available: boolean;
  remainingAttempts?: () => number;
  searchEntities(query: string, types?: string[]): Promise<SearchResult>;
  searchTags(q: string): Promise<TagsResult>;
  getInsights(input: InsightsInput): Promise<InsightsResult>;
  compareEntities(a: string, b: string): Promise<CompareResult>;
}
export class QlooError extends Error {
  constructor(public readonly code: "disabled" | "timeout" | "network" | "rate-limit" | "upstream" | "contract" | "configuration" | "budget") {
    super(`Qloo request unavailable (${code}).`);
  }
}
interface Options {
  key?: string; baseUrl?: string; enabled?: boolean; fetcher?: typeof fetch;
  calls?: QlooCall[]; signal?: AbortSignal; timeoutMs?: number; backoffMs?: number; maxAttempts?: number; retries?: 0 | 1;
}
// Partitioned by credential identity in memory; credentials never enter cache keys or logs.
const partitions = new Map<string, Map<string, { data: unknown; expiry: number }>>();
const TTL = 300_000;
export function clearQlooCache() { partitions.clear(); }
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new QlooError("timeout")); return; }
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); cleanup(); reject(new QlooError("timeout")); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export function createQlooClient(options: Options = {}): QlooClient {
  const key = options.key ?? process.env.QLOO_API_KEY ?? "";
  const enabled = options.enabled ?? process.env.QLOO_LIVE_ENABLED === "true";
  const base = options.baseUrl ?? process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com";
  const available = enabled && key.trim().length > 0;
  const calls = options.calls ?? [];
  const fetcher = options.fetcher ?? fetch;
  const maxAttempts = options.maxAttempts ?? Number(process.env.QLOO_MAX_HTTP_ATTEMPTS ?? 48);
  const retries = options.retries ?? Number(process.env.QLOO_MAX_RETRIES ?? 1);
  const durable = process.env.QLOO_PLANNER_VALIDATION === "true" ? createPlannerBudget(process.env.QLOO_PLANNER_LEDGER_FILE ?? "") : undefined;
  let attempts = 0;
  function metric(endpoint: string) {
    let entry = calls.find((c) => c.endpoint === endpoint);
    if (!entry) { entry = { endpoint, count: 0, cacheHits: 0 }; calls.push(entry); }
    return entry;
  }
  async function request<T>(endpoint: string, params: Record<string, string>, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
    if (!available) throw new QlooError("disabled");
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100 || ![0, 1].includes(retries) || (durable && retries !== 0)) throw new QlooError("configuration");
    let root: URL;
    try { root = new URL(base); } catch { throw new QlooError("configuration"); }
    // Prevent credentials being sent to an arbitrary host through misconfiguration.
    if (root.protocol !== "https:" || root.hostname !== "hackathon.api.qloo.com" || root.port || root.username || root.password) {
      throw new QlooError("configuration");
    }
    const url = new URL(endpoint, root.origin);
    Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).forEach(([k, v]) => url.searchParams.set(k, v));
    let cache = partitions.get(key);
    if (!cache) {
      if (partitions.size >= 4) partitions.delete(partitions.keys().next().value!);
      cache = new Map(); partitions.set(key, cache);
    }
    for (const [k, v] of cache) if (v.expiry <= Date.now()) cache.delete(k);
    const cacheKey = url.toString();
    const cached = cache.get(cacheKey);
    if (cached) { metric(endpoint).cacheHits++; return schema.parse(cached.data); }
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (options.signal?.aborted) throw new QlooError("timeout");
      const controller = new AbortController();
      const abort = () => controller.abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, options.timeoutMs ?? (endpoint === "/v2/insights" ? 20_000 : 10_000));
      let retryDelay = options.backoffMs ?? 2000;
      const startedAt = Date.now();
      let reservation: number | undefined;
      let status: number | undefined;
      let outcome = "network-or-timeout";
      let resultCount: number | undefined;
      let fingerprints: string[] | undefined;
      try {
        if (attempts >= maxAttempts) throw new QlooError("budget");
        if (durable) {
          try { reservation = await durable.reserve(endpoint, params); }
          catch { throw new QlooError("budget"); }
        }
        attempts++;
        metric(endpoint).count++;
        const response = await fetcher(url, {
          headers: { "X-Api-Key": key, Accept: "application/json" },
          signal: controller.signal, cache: "no-store", redirect: "error",
        });
        status = response.status;
        outcome = response.ok ? "contract-error" : "http-error";
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          const retryAfter = Number(response.headers.get("retry-after"));
          if (Number.isFinite(retryAfter) && retryAfter > 0) retryDelay = Math.min(5000, retryAfter * 1000);
          if (!retryable || attempt === retries) throw new QlooError(response.status === 429 ? "rate-limit" : "upstream");
        } else {
          let body: unknown;
          try { body = await response.json(); } catch { throw new QlooError(controller.signal.aborted ? "timeout" : "contract"); }
          let container: unknown;
          try { container = endpoint === "/v2/analysis/compare"
            ? (body && typeof body === "object" && "results" in body ? (body as { results: unknown }).results : body)
            : unwrapQlooResponse(body, endpoint === "/v2/tags" ? "tags" : "entities");
          } catch { throw new QlooError("contract"); }
          const parsed = schema.safeParse(container);
          if (!parsed.success) throw new QlooError("contract");
          outcome = "schema-valid";
          const value = parsed.data as { entities?: unknown[]; tags?: unknown[] };
          resultCount = value.entities?.length ?? value.tags?.length;
          if (durable && value.entities) fingerprints = value.entities.map((e) => createHash("sha256").update((e as { entity_id: string }).entity_id.toLowerCase()).digest("hex"));
          if (cache.size >= 256) cache.delete(cache.keys().next().value!);
          cache.set(cacheKey, { data: parsed.data, expiry: Date.now() + TTL });
          return parsed.data;
        }
      } catch (error) {
        if (error instanceof QlooError) throw error;
        outcome = controller.signal.aborted ? "timeout" : "network-error";
        if (options.signal?.aborted) throw new QlooError("timeout");
        if (attempt === retries) throw new QlooError(controller.signal.aborted ? "timeout" : "network");
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        if (reservation !== undefined) await durable!.settle(reservation, status, outcome, resultCount, fingerprints, Date.now() - startedAt);
      }
      await wait(retryDelay, options.signal);
    }
    throw new QlooError("upstream");
  }
  return {
    available,
    remainingAttempts: () => Math.max(0, maxAttempts - attempts),
    searchEntities: (query, types) => request("/search", searchParameters(query, types), EntitiesSchema),
    searchTags: (query) => request("/v2/tags", tagParameters(query), TagsSchema),
    getInsights: (input) => {
      try { return request("/v2/insights", insightParameters(input), EntitiesSchema.refine(
        (result) => result.entities.every((entity) => entity.type === input.filterType),
        "Unexpected recommendation category.",
      )); }
      catch { return Promise.reject(new QlooError("contract")); }
    },
    // Retained as a tool, but not used to assert whole-group compatibility.
    compareEntities: (a, b) => request("/v2/analysis/compare", { entity_ids: [a, b].join(",") },
      z.object({ compatibility_score: z.number().optional(), analysis: z.string().optional() })),
  };
}
