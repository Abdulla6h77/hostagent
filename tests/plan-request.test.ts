import { describe, expect, it, vi } from "vitest";
import { requestPlan } from "@/lib/plan-request";
import { PlanRequestSchema } from "@/lib/validation";
import { buildPlan } from "@/lib/orchestrator";

const guests = [{ name: "A", seeds: ["jazz", "Inception", "Italian food"] }, { name: "B", seeds: ["electronic", "ramen", "Dune"] }];
const input = PlanRequestSchema.parse({ guests, sampleOnly: true });

describe("frontend request recovery, offline", () => {
  it("validates a real generated demo response", async () => {
    const plan = await buildPlan(guests, input);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(plan)));
    expect((await requestPlan(input)).mode).toBe("sample");
  });
  it("accepts baseline and partial fallback response shapes", async () => {
    const plan = await buildPlan(guests, { useQloo: false });
    const transport = vi.fn(async () => Response.json(plan)); vi.stubGlobal("fetch", transport);
    expect((await requestPlan(input)).mode).toBe("baseline");
    plan.mode = "sample"; plan.domains[0].source = "qloo";
    expect((await requestPlan(input)).domains[0].source).toBe("qloo");
  });
  it("replaces raw network exceptions with helpful private messages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("private upstream details"); }));
    await expect(requestPlan(input)).rejects.toThrow("Check your connection");
  });
  it.each([400, 413, 429, 500, 502])("sanitizes HTTP %i without trusting response text", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private upstream details", { status })));
    await expect(requestPlan(input)).rejects.not.toThrow("private upstream details");
  });
  it("handles non-JSON success and malformed response shapes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>proxy page</html>")));
    await expect(requestPlan(input)).rejects.toThrow("unreadable plan");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ mode: "qloo" })));
    await expect(requestPlan(input)).rejects.toThrow("incomplete plan");
  });
  it("rejects repeated or missing result categories", async () => {
    const plan = await buildPlan(guests, input); plan.domains[1] = plan.domains[0];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(plan)));
    await expect(requestPlan(input)).rejects.toThrow("incomplete plan");
  });
  it("times out once without automatic retry and clears its timer", async () => {
    vi.useFakeTimers();
    const transport = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Abort", "AbortError")), { once: true })));
    vi.stubGlobal("fetch", transport);
    const result = requestPlan(input).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(55_000);
    expect(await result).toMatchObject({ message: expect.stringContaining("took too long") });
    expect(transport).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("supports cancellation and subsequent recovery", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Abort", "AbortError")), { once: true }))));
    const result = requestPlan(input, controller.signal); controller.abort();
    await expect(result).rejects.toThrow("cancelled");
    const plan = await buildPlan(guests, { useQloo: false });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(plan)));
    expect((await requestPlan(input)).mode).toBe("baseline");
  });
});
