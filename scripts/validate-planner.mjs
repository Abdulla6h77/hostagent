import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

const file = path.resolve(".local/qloo-planner-twelve-attempts.json");
const oldFile = path.resolve(".local/qloo-live-nine-attempts.json");
const digest = (data) => createHash("sha256").update(data).digest("hex");
async function ledger() {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return { attempts: 0, records: [] }; throw new Error("Unreadable planner ledger."); }
}
if (!process.argv.includes("--execute-authorized-twelve")) {
  const state = await ledger();
  console.log(JSON.stringify({ dryRun: true, used: state.attempts, remaining: 12 - state.attempts, automaticRetries: false }));
  process.exit(0);
}
const originalHash = digest(await readFile(oldFile));
const before = await ledger();
if (before.attempts) { console.error("This planner authorization has already been used. Refusing a repeated live run."); process.exit(1); }
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
if (!process.env.QLOO_API_KEY?.trim()) { console.error("No credential available; no requests made."); process.exit(1); }
const base = "http://127.0.0.1:3106";
const child = spawn(process.execPath, [".next/standalone/server.js"], { stdio: ["ignore", "pipe", "pipe"], env: {
  ...process.env, HOSTNAME: "127.0.0.1", PORT: "3106", QLOO_LIVE_ENABLED: "true", QLOO_MAX_HTTP_ATTEMPTS: "12", QLOO_MAX_RETRIES: "0", QLOO_PLANNER_VALIDATION: "true", QLOO_PLANNER_LEDGER_FILE: file,
} });
// Consume framework output without printing upstream/credential-bearing exceptions.
let announcedReady = false;
child.stdout.on("data", (data) => { if (data.toString().includes("Ready in")) announcedReady = true; }); child.stderr.on("data", () => {});
let exited = false; child.on("exit", () => { exited = true; });
const guests = [{ name: "Guest A", seeds: ["Miles Davis", "jazz", "Italian food"] }, { name: "Guest B", seeds: ["Inception", "electronic music", "Japanese food"] }];
const post = async (input) => {
  const response = await fetch(base + "/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(60_000) });
  if (response.status !== 200) throw new Error("Local planner API did not complete successfully.");
  return response.json();
};
try {
  let ready = false;
  for (let spin = 0; spin < 80; spin++) {
    if (exited) throw new Error("Validation server exited before readiness.");
    try { ready = announcedReady && (await fetch(base + "/api/health", { signal: AbortSignal.timeout(500) })).ok; } catch { /* Local readiness polling only, never Qloo. */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Local validation server did not become ready.");
  const firstBaseline = await post({ guests, useQloo: false });
  const baselineBefore = (await ledger()).attempts;
  const started = Date.now();
  const plan = await post({ guests, useQloo: true });
  const elapsedMs = Date.now() - started;
  const after = await ledger();
  const secondBaseline = await post({ guests: guests.map((g) => ({ ...g, seeds: ["other one", "other two", "other three"] })), useQloo: false });
  const final = await ledger();
  const entityHash = (id) => digest(id.toLowerCase());
  const individual = final.records.filter((r) => r.endpoint === "/v2/insights" && r.domain === "urn:entity:artist" && r.entitySignals === 1);
  const evidence = new Map(guests.map((g, index) => [g.name, new Set(individual[index]?.fingerprints ?? [])]));
  const perGuest = (source) => Object.fromEntries(guests.map((g) => [g.name, Object.fromEntries(plan.domains.filter((d) => d.source === source).map((d) => [d.domain, d.picks.filter((p) => p.bridgingGuests.includes(g.name)).length]))]));
  const summary = {
    authorization: "phase-1.6-2026-10-23", httpStatus: 200, mode: plan.mode, elapsedMs,
    realAttempts: final.attempts, remaining: 12 - final.attempts,
    allAttemptsHttp200: final.records.every((r) => r.status === 200),
    domainResults: plan.domains.map((d) => ({ domain: d.domain, source: d.source, picks: d.picks.length,
      uniqueIds: new Set(d.picks.flatMap((p) => p.entityId ? [p.entityId.toLowerCase()] : [])).size, uniqueNames: new Set(d.picks.map((p) => p.title.toLowerCase().trim())).size,
      checkedGuests: d.source === "qloo" ? d.picks[0]?.support?.checked ?? 0 : null, supportKind: d.source === "sample" ? "synthetic-keyword" : "qloo-retrieval", supportCounts: d.picks.map((p) => p.support?.count ?? 0),
      differentTopFromBaseline: d.source === "qloo" ? d.picks[0]?.title !== firstBaseline.domains.find((b) => b.domain === d.domain)?.picks[0]?.title : null,
      reason: d.reason,
    })),
    resolutionCoverage: plan.resolutionCoverage, unresolvedSeeds: plan.unresolvedSeeds,
    livePerGuestAttributedPicks: perGuest("qloo"), syntheticKeywordMatches: perGuest("sample"),
    noFabricatedAffinity: plan.domains.every((d) => d.picks.every((p) => p.affinity === null)),
    musicAttributionsMatchActualResponseFingerprints: plan.domains.find((d) => d.domain === "music")?.picks.every((p) => p.bridgingGuests.every((name) => evidence.get(name)?.has(entityHash(p.entityId)))),
    uncheckedDomainsHaveNoAttribution: plan.domains.filter((d) => d.source === "qloo").every((d) => d.picks.every((p) => p.support?.checked !== 0 || p.bridgingGuests.length === 0)),
    baseline: { mode: firstBaseline.mode, attemptsBeforeLive: baselineBefore, attemptsAfterLive: final.attempts - after.attempts, inputIndependent: JSON.stringify(firstBaseline.domains) === JSON.stringify(secondBaseline.domains), qlooCalls: firstBaseline.qlooCalls.length + secondBaseline.qlooCalls.length },
    requestMetricsMatchLedger: plan.qlooCalls.reduce((sum, c) => sum + c.count, 0) === after.attempts,
    warnings: plan.warnings,
    previousNineAttemptLedgerUnchanged: digest(await readFile(oldFile)) === originalHash,
    changedTasteComparison: "Not run: an uncached second group requires at least four primary insight queries; no such budget was reserved.",
  };
  await writeFile(path.resolve(".local/planner-validation-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary));
  if (final.attempts > 12 || !summary.previousNineAttemptLedgerUnchanged || !summary.noFabricatedAffinity) process.exitCode = 1;
} catch {
  console.error("Planner validation stopped safely; inspect the redacted ledger. No automatic retry or second live plan was attempted."); process.exitCode = 1;
} finally {
  child.kill();
  if (digest(await readFile(oldFile)) !== originalHash) { console.error("Previous ledger integrity check failed."); process.exitCode = 1; }
}
