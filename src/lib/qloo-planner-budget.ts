import "server-only";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const AUTHORIZATIONS: Record<string, string> = {
  "qloo-planner-twelve-attempts.json": "phase-1.6-2026-10-23",
  "qloo-final-twelve-attempts.json": "phase-1.8-2026-10-23",
};
export const PLANNER_LIMIT = 12;
interface RecordEntry { attempt: number; endpoint: string; domain?: string; entitySignals: number; tagSignals: number; tagFilters: number; at: string; status?: number; outcome: string; count?: number; fingerprints?: string[]; durationMs?: number }
interface Ledger { authorization: string; limit: number; attempts: number; records: RecordEntry[]; stopped?: boolean }
export interface PlannerBudget {
  reserve(endpoint: string, params: Record<string, string>): Promise<number>;
  settle(attempt: number, status: number | undefined, outcome: string, count?: number, fingerprints?: string[], durationMs?: number): Promise<void>;
}
export function createPlannerBudget(file: string): PlannerBudget {
  const authorization = AUTHORIZATIONS[path.basename(file)];
  if (!authorization) throw new Error("Invalid planner ledger destination.");
  async function change<T>(fn: (ledger: Ledger) => T): Promise<T> {
    await mkdir(path.dirname(file), { recursive: true });
    let lock;
    for (let spin = 0; spin < 100; spin++) {
      try { lock = await open(file + ".lock", "wx"); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    if (!lock) throw new Error("Planner ledger is locked.");
    try {
      let ledger: Ledger;
      try { ledger = JSON.parse(await readFile(file, "utf8")); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Invalid planner ledger.");
        ledger = { authorization: authorization, limit: PLANNER_LIMIT, attempts: 0, records: [] };
      }
      if (ledger.authorization !== authorization || ledger.limit !== PLANNER_LIMIT || !Number.isInteger(ledger.attempts) || ledger.attempts < 0 || ledger.attempts > PLANNER_LIMIT || ledger.records.length !== ledger.attempts) throw new Error("Invalid planner ledger.");
      const result = fn(ledger);
      await writeFile(file + ".tmp", JSON.stringify(ledger, null, 2) + "\n", { mode: 0o600 });
      await rename(file + ".tmp", file);
      return result;
    } finally { await lock.close(); await unlink(file + ".lock"); }
  }
  const count = (value?: string) => value ? value.split(",").length : 0;
  return {
    reserve: (endpoint, params) => change((ledger) => {
      if (ledger.stopped || ledger.attempts >= PLANNER_LIMIT) throw new Error("Planner budget exhausted or stopped.");
      const attempt = ++ledger.attempts;
      ledger.records.push({ attempt, endpoint, domain: params["filter.type"], entitySignals: count(params["signal.interests.entities"]), tagSignals: count(params["signal.interests.tags"]), tagFilters: count(params["filter.tags"]), at: new Date().toISOString(), outcome: "reserved" });
      return attempt;
    }),
    settle: (attempt, status, outcome, count, fingerprints, durationMs) => change((ledger) => {
      const record = ledger.records.find((r) => r.attempt === attempt);
      if (!record) throw new Error("Missing planner attempt.");
      Object.assign(record, { status, outcome, count, fingerprints, durationMs });
      if (status === 401 || status === 403) ledger.stopped = true;
    }),
  };
}
