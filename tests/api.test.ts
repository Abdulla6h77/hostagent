import { describe, it, expect, vi } from "vitest";
import { POST } from "@/app/api/plan/route";
import { GET } from "@/app/api/health/route";
import * as orchestrator from "@/lib/orchestrator";
const guests = [{ name: "Mina", seeds: ["jazz", "ramen", "minimalism"] }, { name: "Omar", seeds: ["techno", "tacos", "Marvel"] }];
const request = (body: unknown) => new Request("http://localhost/api/plan", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
describe("plan API, offline", () => {
  it("returns baseline and no-store without Qloo calls", async () => {
    const response = await POST(request({ guests, useQloo: false }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json(); expect(body.mode).toBe("baseline"); expect(body.domains).toHaveLength(4); expect(fetch).not.toHaveBeenCalled();
  });
  it("returns honest SAMPLE with no credentials", async () => {
    vi.stubEnv("QLOO_LIVE_ENABLED", "true");
    const response = await POST(request({ guests })); const body = await response.json();
    expect(response.status).toBe(200); expect(body.mode).toBe("sample"); expect(body.qlooCalls).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{}, { guests: [] }, { guests: [guests[0]] }, { guests: [{ name: " ", seeds: [] }, guests[1]] }])("returns 400 for schema errors %#", async (body) => {
    expect((await POST(request(body))).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });
  it("malformed JSON is 400 rather than 500", async () => {
    const response = await POST(new Request("http://localhost/api/plan", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
  });
  it("missing request body is 400", async () => expect((await POST(new Request("http://localhost/api/plan", { method: "POST" }))).status).toBe(400));
  it("rejects oversized bodies with and without content-length", async () => {
    const response = await POST(request({ padding: "x".repeat(17_000) })); expect(response.status).toBe(413);
    const req = request({ guests }); req.headers.set("content-length", "20000"); expect((await POST(req)).status).toBe(413);
  });
  it("does not disclose configured secrets in responses", async () => {
    vi.stubEnv("QLOO_API_KEY", "unit-test-placeholder");
    expect(await (await POST(request({ guests }))).text()).not.toContain("unit-test-placeholder");
  });
  it("health reports process health without touching Qloo", async () => {
    const response = await GET(); const body = await response.json();
    expect(body.status).toBe("ok"); expect(body.uptime).toBeGreaterThanOrEqual(0); expect(fetch).not.toHaveBeenCalled();
  });
  it("returns partial SAMPLE through the real route/client with mocked HTTP", async () => {
    vi.stubEnv("QLOO_LIVE_ENABLED", "true"); vi.stubEnv("QLOO_API_KEY", "unit-test-placeholder");
    const transport = vi.fn(async (url: URL) => {
      if (url.pathname === "/search") {
        const q = url.searchParams.get("query")!;
        return Response.json({ entities: [{ entity_id: `synthetic-${q}`, name: q, types: ["urn:entity:artist"] }] });
      }
      if (url.pathname === "/v2/tags") return Response.json({ tags: [{ id: "urn:tag:genre:place:synthetic", name: "Dining" }] });
      const type = url.searchParams.get("filter.type");
      return Response.json({ entities: type === "urn:entity:brand" ? [] : [{ entity_id: `synthetic-pick-${type}`, name: "Invented test recommendation", type: "urn:entity", subtype: type }] });
    });
    vi.stubGlobal("fetch", transport);
    const response = await POST(request({ guests })); const body = await response.json();
    expect(response.status).toBe(200); expect(body.mode).toBe("sample");
    expect(body.domains.map((d: { source: string }) => d.source)).toEqual(["qloo", "qloo", "qloo", "sample"]);
    expect(body.domains[3].picks).toHaveLength(3);
    expect(body.qlooCalls.reduce((n: number, c: { count: number }) => n + c.count, 0)).toBe(transport.mock.calls.length);
  }, 10_000);
  it("unexpected failures return a helpful redacted 500 without logging raw errors", async () => {
    vi.spyOn(orchestrator, "buildPlan").mockRejectedValueOnce(new Error("private upstream detail"));
    const log = vi.spyOn(console, "error");
    const response = await POST(request({ guests })); expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private upstream detail"); expect(log).not.toHaveBeenCalled();
  });
});


describe("guest counts and explicit offline demo", () => {
  const group = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `Guest ${i + 1}`, seeds: ["jazz", "Inception", "Italian food"] }));
  it.each([2, 3, 4])("accepts %i complete guests and makes no network calls in demo mode", async (count) => {
    vi.stubEnv("QLOO_LIVE_ENABLED", "true");
    vi.stubEnv("QLOO_API_KEY", "unit-test-placeholder");
    vi.stubEnv("QLOO_PLANNER_VALIDATION", "true");
    const response = await POST(request({ guests: group(count), sampleOnly: true }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.mode).toBe("sample");
    expect(body.domains.map((domain: { source: string }) => domain.source)).toEqual(["sample", "sample", "sample", "sample"]);
    expect(body.qlooCalls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([1, 5])("rejects %i guests", async (count) => {
    expect((await POST(request({ guests: group(count), sampleOnly: true }))).status).toBe(400);
  });
  it("identifies an incomplete fourth guest without rejecting a complete three-person group", async () => {
    const response = await POST(request({ guests: [...group(3), { name: "", seeds: [] }], sampleOnly: true }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.details.map((detail: { path: string }) => detail.path)).toEqual(expect.arrayContaining(["guests.3.name", "guests.3.seeds"]));
  });
  it("requires a third committed taste and distinct names", async () => {
    const incomplete = group(3); incomplete[2].seeds.pop();
    expect((await POST(request({ guests: incomplete }))).status).toBe(400);
    const duplicate = group(3); duplicate[2].name = duplicate[0].name;
    expect((await POST(request({ guests: duplicate }))).status).toBe(400);
  });
});
