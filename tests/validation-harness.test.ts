import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createValidationTransport, readLedger } from "../scripts/qloo-validation-core.mjs";

let directory: string | undefined;
async function ledgerPath() {
  directory = await mkdtemp(path.join(tmpdir(), "host-agent-budget-"));
  return path.join(directory, "budget.json");
}
afterEach(async () => {
  if (directory) {
    // Only delete files in the exact disposable directory created by this test.
    for (const entry of await readdir(directory)) await rm(path.join(directory, entry));
    await rmdir(directory); directory = undefined;
  }
});
describe("validation transport safety (no real HTTP)", () => {
  it("charges failures, refuses attempt ten, and preserves the budget on restart", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const ledgerFile = await ledgerPath();
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    const transport = await createValidationTransport({ ledgerFile, key: "unit-test-placeholder", fetcher });
    for (let i = 0; i < 9; i++) await transport.probe("test", "/search", { query: "Invented" }, () => ({}));
    await expect(transport.probe("ten", "/search", {}, () => ({}))).rejects.toThrow("budget exhausted");
    const restarted = await createValidationTransport({ ledgerFile, key: "unit-test-placeholder", fetcher });
    await expect(restarted.probe("restart", "/search", {}, () => ({}))).rejects.toThrow("budget exhausted");
    expect(fetcher).toHaveBeenCalledTimes(9); expect((await readLedger(ledgerFile)).attempts).toBe(9);
  });
  it.each([401, 403])("stops after authentication status %i, with no retry", async (status) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetcher = vi.fn(async () => new Response(null, { status }));
    const transport = await createValidationTransport({ ledgerFile: await ledgerPath(), key: "unit-test-placeholder", fetcher });
    await expect(transport.probe("auth", "/search", {}, () => ({}))).rejects.toThrow("Authentication failed");
    await expect(transport.probe("again", "/search", {}, () => ({}))).rejects.toThrow("Authentication failure previously observed");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(transport.ledger.attempts).toBe(1);
  });
  it("counts network failure once and does not log key or response body", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const ledgerFile = await ledgerPath();
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("private detail"))
      .mockResolvedValueOnce(Response.json({ results: [{ entity_id: "invented", name: "DO NOT LOG ENTITY CONTENT", type: "urn:entity:movie" }] }));
    const transport = await createValidationTransport({ ledgerFile, key: "unit-test-placeholder", fetcher });
    await transport.probe("network", "/search", {}, () => ({}));
    expect(transport.ledger.attempts).toBe(1); expect(fetcher).toHaveBeenCalledTimes(1);
    await transport.probe("success", "/search", {}, () => ({}));
    const output = JSON.stringify(log.mock.calls) + JSON.stringify(await readLedger(ledgerFile));
    expect(output).not.toMatch(/unit-test-placeholder|private detail|DO NOT LOG ENTITY CONTENT/);
    expect(transport.ledger.attempts).toBe(2);
  });
});
