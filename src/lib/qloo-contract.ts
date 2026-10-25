import { z } from "zod";

// Public contract helpers only: no environment reads, credentials, HTTP, or logging.
const RawEntity = z.object({
  entity_id: z.string().min(1), name: z.string().min(1),
  type: z.string().optional(), subtype: z.string().optional(),
  types: z.array(z.string()).optional(),
  properties: z.record(z.unknown()).optional(),
}).transform((entity) => {
  const category = entity.subtype ?? entity.types?.find((type) => type.startsWith("urn:entity:")) ?? entity.type;
  return category ? { ...entity, type: category } : entity;
});
export const EntitiesSchema = z.object({ entities: z.array(RawEntity) });
const RawTag = z.object({
  tag_id: z.string().min(1).optional(), id: z.string().min(1).optional(), name: z.string().min(1),
  type: z.string().optional(), subtype: z.string().optional(), types: z.array(z.string()).optional(),
}).refine((tag) => Boolean(tag.tag_id || tag.id), "A tag identifier is required.")
  .transform((tag) => ({ ...tag, tag_id: tag.tag_id ?? tag.id! }));
export const TagsSchema = z.object({ tags: z.array(RawTag) });
export type Entity = z.infer<typeof RawEntity>;
export type InsightsResult = z.infer<typeof EntitiesSchema>;
export type SearchResult = InsightsResult;
export type TagsResult = z.infer<typeof TagsSchema>;
export function isDiningTag(tag: TagsResult["tags"][number]): boolean {
  return tag.types?.includes("urn:entity:place") === true
    || [tag.tag_id, tag.type, tag.subtype].some((value) => value !== undefined && /:(place|restaurant|cuisine)(:|$)/.test(value));
}
export interface InsightsInput { filterType: string; interestEntityIds: string[]; interestTagIds?: string[]; tagIds?: string[]; take?: number }

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
export function unwrapQlooResponse(body: unknown, kind: "entities" | "tags"): unknown {
  const root = object(body);
  if (!root || root.success === false) throw new Error("Invalid Qloo response.");
  if (Array.isArray(root.results)) return { [kind]: root.results };
  if (root.results !== undefined) return root.results;
  return root;
}
export function parseEntities(body: unknown): InsightsResult { return EntitiesSchema.parse(unwrapQlooResponse(body, "entities")); }
export function parseTags(body: unknown): TagsResult { return TagsSchema.parse(unwrapQlooResponse(body, "tags")); }
export function searchParameters(query: string, types?: string[]): Record<string, string> {
  const params: Record<string, string> = { query: z.string().trim().min(1).parse(query), take: "10" };
  if (types?.length) params.types = [...new Set(types)].join(",");
  return params;
}
export function tagParameters(query: string): Record<string, string> {
  return { "filter.query": z.string().trim().min(1).parse(query), take: "10" };
}
export function insightParameters({ filterType, interestEntityIds, interestTagIds = [], tagIds = [], take = 10 }: InsightsInput): Record<string, string> {
  if ((!interestEntityIds.length && !interestTagIds.length) || [...interestEntityIds, ...interestTagIds].some((id) => !id.trim())) throw new Error("Taste signals are required.");
  const params: Record<string, string> = {
    "filter.type": filterType,
    take: String(z.number().int().min(1).max(50).parse(take)),
  };
  if (interestEntityIds.length) params["signal.interests.entities"] = [...new Set(interestEntityIds)].sort().join(",");
  if (interestTagIds.length) params["signal.interests.tags"] = [...new Set(interestTagIds)].sort().join(",");
  if (tagIds.length) params["filter.tags"] = [...new Set(tagIds)].sort().join(",");
  return params;
}
