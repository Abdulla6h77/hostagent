import { describe, it, expect, vi } from "vitest";
import { createQlooClient, QlooError, clearQlooCache } from "@/lib/qloo";
import type { QlooCall } from "@/types";
const entities = { entities: [{ entity_id: "invented-test-id", name: "Invented test entity", type: "urn:entity", subtype: "urn:entity:artist" }] };
const input = { filterType: "urn:entity:artist", interestEntityIds: ["seed-b", "seed-a", "seed-a"] };
// Every response in this file is hand-authored, not captured from Qloo.
const client = (fetcher: typeof fetch, calls: QlooCall[] = []) => createQlooClient({ key: "unit-test-placeholder", enabled: true, fetcher, calls, backoffMs: 0, timeoutMs: 50 });
describe("Qloo HTTP client, fully mocked", () => {
  it("search uses query, not q, and parses the documented results array", async () => {
    const fetcher = vi.fn(async () => Response.json({ results: [{ entity_id: "invented-film", name: "Invented Film", types: ["urn:entity", "urn:entity:movie"] }] }));
    const result = await client(fetcher).searchEntities("Invented Film", ["urn:entity:movie"]);
    const url = (fetcher.mock.calls[0] as unknown as [URL])[0];
    expect(url.pathname).toBe("/search"); expect(url.searchParams.get("query")).toBe("Invented Film");
    expect(url.searchParams.has("q")).toBe(false); expect(url.searchParams.get("types")).toBe("urn:entity:movie");
    expect(result.entities[0].type).toBe("urn:entity:movie");
  });
  it("tag search uses filter.query and normalizes id to tag_id", async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true, results: { tags: [{ id: "urn:tag:invented:cuisine", name: "Invented Cuisine", types: ["urn:entity:place"] }] } }));
    const result = await client(fetcher).searchTags("Invented Cuisine");
    const url = (fetcher.mock.calls[0] as unknown as [URL])[0];
    expect(url.searchParams.get("filter.query")).toBe("Invented Cuisine"); expect(url.searchParams.has("q")).toBe(false);
    expect(result.tags[0].tag_id).toBe("urn:tag:invented:cuisine");
  });
  it("rejects success=false even if the response contains entities", async () => {
    await expect(client(vi.fn(async () => Response.json({ success: false, ...entities }))).getInsights(input)).rejects.toMatchObject({ code: "contract" });
  });
  it("refuses a wrong category even when HTTP and entity parsing succeed", async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true, results: { entities: [{ entity_id: "invented-movie", name: "Invented", type: "urn:entity", subtype: "urn:entity:movie" }] } }));
    await expect(client(fetcher).getInsights(input)).rejects.toMatchObject({ code: "contract" });
  });
  it("sends documented parameters and server-side auth", async () => {
    const fetcher = vi.fn(async () => Response.json(entities));
    await client(fetcher).getInsights(input);
    const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/v2/insights"); expect(url.searchParams.get("signal.interests.entities")).toBe("seed-a,seed-b");
    expect(options.headers).toMatchObject({ "X-Api-Key": "unit-test-placeholder" }); expect(options.redirect).toBe("error");
  });
  it("counts failed attempts and retries 429 once", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 429 })).mockResolvedValueOnce(Response.json(entities));
    const calls: QlooCall[] = []; await client(fetcher, calls).getInsights(input);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(calls[0]).toMatchObject({ count: 2, cacheHits: 0 });
  });
  it("retries 5xx once and stops", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    await expect(client(fetcher).getInsights(input)).rejects.toMatchObject({ code: "upstream" }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not retry unauthorized responses or leak upstream content", async () => {
    const fetcher = vi.fn(async () => new Response("private upstream body", { status: 401 }));
    await expect(client(fetcher).getInsights(input)).rejects.toThrow("Qloo request unavailable (upstream)."); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retries network failure once", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("private network message")).mockResolvedValueOnce(Response.json(entities));
    expect((await client(fetcher).getInsights(input)).entities[0]).toMatchObject({ type: "urn:entity:artist", subtype: "urn:entity:artist" }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("aborts timed out calls, retries once, and cleans up", async () => {
    const fetcher = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    await expect(client(fetcher).getInsights(input)).rejects.toMatchObject({ code: "timeout" }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not retry after overall deadline abort", async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = vi.fn(); const c = createQlooClient({ enabled: true, key: "unit-test-placeholder", signal: controller.signal, fetcher });
    await expect(c.getInsights(input)).rejects.toMatchObject({ code: "timeout" }); expect(fetcher).not.toHaveBeenCalled();
  });
  it("accepts results envelope and rejects invalid schemas", async () => {
    expect((await client(vi.fn(async () => Response.json({ success: true, results: entities }))).getInsights(input)).entities[0].type).toBe("urn:entity:artist");
    clearQlooCache(); await expect(client(vi.fn(async () => Response.json({ entities: [{ name: "Missing ID" }] }))).getInsights(input)).rejects.toMatchObject({ code: "contract" });
  });
  it("accepts empty results for the orchestrator to handle", async () => {
    expect(await client(vi.fn(async () => Response.json({ entities: [] }))).getInsights(input)).toEqual({ entities: [] });
  });
  it("cache avoids duplicate requests and expires after five minutes", async () => {
    vi.useFakeTimers(); const fetcher = vi.fn(async () => Response.json(entities)); const calls: QlooCall[] = []; const c = client(fetcher, calls);
    await c.getInsights(input); await c.getInsights(input); expect(fetcher).toHaveBeenCalledTimes(1); expect(calls[0].cacheHits).toBe(1);
    vi.setSystemTime(Date.now() + 300_001); await c.getInsights(input); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("refuses missing credentials, disabled requests, and arbitrary credential destinations", async () => {
    const fetcher = vi.fn();
    for (const options of [{ key: "", enabled: true }, { key: "unit-test-placeholder", enabled: false }, { key: "unit-test-placeholder", enabled: true, baseUrl: "https://example.com" }]) {
      await expect(createQlooClient({ ...options, fetcher }).getInsights(input)).rejects.toBeInstanceOf(QlooError);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not make unsignaled insight calls", async () => {
    const fetcher = vi.fn(); await expect(client(fetcher).getInsights({ ...input, interestEntityIds: [] })).rejects.toMatchObject({ code: "contract" }); expect(fetcher).not.toHaveBeenCalled();
  });
  it("enforces the shared attempt cap, including retries", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    const c = createQlooClient({ key: "unit-test-placeholder", enabled: true, fetcher, maxAttempts: 1, backoffMs: 0 });
    await expect(c.getInsights(input)).rejects.toMatchObject({ code: "budget" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
