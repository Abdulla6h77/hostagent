import { beforeEach, afterEach, vi } from "vitest";
import { clearQlooCache } from "@/lib/qloo";
beforeEach(() => {
  vi.stubEnv("QLOO_LIVE_ENABLED", "false");
  vi.stubEnv("QLOO_API_KEY", "");
  vi.stubEnv("QLOO_MAX_HTTP_ATTEMPTS", "48");
  vi.stubEnv("QLOO_MAX_RETRIES", "1");
  vi.stubEnv("QLOO_PLANNER_VALIDATION", "false");
  clearQlooCache();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request: all tests must be offline."); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
