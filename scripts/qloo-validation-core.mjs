import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";

export const AUTHORIZATION = "host-agent-nine-attempts-2026-10-22";
export const LIMIT = 9;
export async function readLedger(file) {
  try {
    const ledger = JSON.parse(await readFile(file, "utf8"));
    if (ledger.authorization !== AUTHORIZATION || ledger.limit !== LIMIT || !Number.isInteger(ledger.attempts) || ledger.attempts < 0 || ledger.attempts > LIMIT) throw new Error("ledger");
    return ledger;
  } catch (error) {
    if (error.code === "ENOENT") return { authorization: AUTHORIZATION, limit: LIMIT, attempts: 0, records: [] };
    throw new Error("Validation ledger is invalid; refusing network access.");
  }
}
async function save(file, ledger) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file + ".tmp", JSON.stringify(ledger, null, 2) + "\n", { mode: 0o600 });
  await rename(file + ".tmp", file);
}
const SAFE_TYPES = new Set(["urn:entity", "urn:entity:artist", "urn:entity:movie", "urn:entity:place", "urn:entity:brand", "urn:entity:tv_show"]);
export function responseShape(body, kind) {
  const object = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const result = object.results;
  const array = Array.isArray(result) ? result : result?.[kind] ?? object[kind];
  const first = Array.isArray(array) ? array[0] : undefined;
  const path = Array.isArray(result) ? "results[]" : Array.isArray(result?.[kind]) ? `results.${kind}[]` : Array.isArray(object[kind]) ? `${kind}[]` : "unrecognized";
  return { path, count: Array.isArray(array) ? array.length : null,
    fields: ["entity_id", "name", "type", "subtype", "properties", "tags", "id", "tag_id", "types", "query"].filter((key) => first && Object.hasOwn(first, key)),
    categories: [...new Set((Array.isArray(array) ? array : []).flatMap((item) => [item.subtype, item.type, ...(Array.isArray(item.types) ? item.types : [])]).filter((type) => SAFE_TYPES.has(type)))],
  };
}
export async function createValidationTransport({ ledgerFile, key, fetcher = fetch }) {
  if (!key?.trim()) throw new Error("Missing server credential; no requests made.");
  const ledger = await readLedger(ledgerFile);
  let authStopped = ledger.records.some((record) => record.status === 401 || record.status === 403);
  return {
    ledger,
    async probe(label, endpoint, params, parser, kind = "entities") {
      if (authStopped) throw new Error("Authentication failure previously observed; refusing further requests.");
      if (ledger.attempts >= LIMIT) throw new Error("Authorized attempt budget exhausted.");
      if (!["/search", "/v2/tags", "/v2/insights"].includes(endpoint)) throw new Error("Endpoint is outside the validation scope.");
      const url = new URL(endpoint, "https://hackathon.api.qloo.com");
      for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
      const record = { attempt: ++ledger.attempts, label, endpoint, parameterNames: Object.keys(params).sort(), at: new Date().toISOString(), outcome: "reserved" };
      ledger.records.push(record);
      // Persist before transmitting. A failed/uncertain transmission still consumes an attempt.
      await save(ledgerFile, ledger);
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20_000);
      let parsed;
      try {
        const response = await fetcher(url, { method: "GET", headers: { "X-Api-Key": key, Accept: "application/json" }, redirect: "error", signal: controller.signal });
        record.status = response.status;
        if (response.status === 401 || response.status === 403) authStopped = true;
        const body = await response.json().catch(() => undefined);
        record.shape = responseShape(body, kind);
        if (!response.ok) {
          record.outcome = authStopped ? "authentication-stop" : "http-error";
          // Only recognized parameter names, never upstream error messages/values.
          const text = JSON.stringify(body ?? {});
          record.errorParameterHints = [...new Set(text.match(/(?:filter|signal)\.[a-z_.]+|\bquery\b|\btake\b/g) ?? [])].slice(0, 12);
        } else {
          try { parsed = parser(body); record.outcome = "schema-valid"; }
          catch { record.outcome = "schema-mismatch"; }
        }
      } catch { record.outcome = controller.signal.aborted ? "timeout" : "network-error"; }
      finally { clearTimeout(timer); await save(ledgerFile, ledger); }
      console.log(JSON.stringify(record));
      if (authStopped) throw new Error("Authentication failed; stopped without retries.");
      return parsed;
    },
  };
}
