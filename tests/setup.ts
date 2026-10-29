import { beforeEach, afterEach, vi } from "vitest";
import { clearQlooCache } from "@/lib/qloo";
import { authorizeLiveVisitor, createSharedQuota } from "@/lib/live-protection";
// Existing product/client regressions use explicit offline protection doubles.
// Security tests import the real adapter and inject a mock Redis transport.
vi.mock("@/lib/live-protection", async (original) => ({
  ...await original<typeof import("@/lib/live-protection")>(),
  createSharedQuota: vi.fn(), authorizeLiveVisitor: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(createSharedQuota).mockReset().mockReturnValue({ reserve: vi.fn(async () => {}) });
  vi.mocked(authorizeLiveVisitor).mockReset().mockResolvedValue(undefined);
  vi.stubEnv("QLOO_LIVE_ENABLED", "false");
  vi.stubEnv("QLOO_API_KEY", "");
  vi.stubEnv("QLOO_MAX_HTTP_ATTEMPTS", "48");
  vi.stubEnv("QLOO_MAX_RETRIES", "1");
  vi.stubEnv("QLOO_PLANNER_VALIDATION", "false");
  clearQlooCache();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request: all tests must be offline."); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
