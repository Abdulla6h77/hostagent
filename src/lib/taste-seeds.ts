import { isDiningTag, type TagsResult } from "./qloo-contract";
export const normalizeSeed = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const MUSIC = new Set(["jazz", "electronic", "techno", "bossa nova", "classic rock", "rock", "pop", "hip hop", "classical", "soul", "disco", "funk"]);
const FOOD = new Set(["italian", "japanese", "ramen", "tacos", "mezze", "bbq", "sushi", "pizza", "pasta", "curry", "pho", "burger"]);
export function classifySeed(seed: string): { kind: "entity" | "music-tag" | "cuisine-tag"; query: string } {
  const value = normalizeSeed(seed);
  const music = value.replace(/ music$/, "");
  if (MUSIC.has(music)) return { kind: "music-tag", query: music };
  const cuisine = value.replace(/ (food|cuisine)$/, "");
  if (FOOD.has(cuisine) || cuisine !== value) return { kind: "cuisine-tag", query: cuisine };
  return { kind: "entity", query: value };
}
export function selectTasteTag(tags: TagsResult["tags"], kind: "music-tag" | "cuisine-tag", query: string) {
  return tags.find((tag) => normalizeSeed(tag.name).replace(/ music$/, "") === query && (kind === "cuisine-tag" ? isDiningTag(tag)
    : tag.types?.includes("urn:entity:artist") || [tag.tag_id, tag.type, tag.subtype].some((s) => s && /:(music|artist)(:|$)/.test(s))));
}
