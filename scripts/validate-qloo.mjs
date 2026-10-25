import { mkdir, open, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createValidationTransport, readLedger, LIMIT } from "./qloo-validation-core.mjs";
import { parseEntities, parseTags, searchParameters, tagParameters, insightParameters, isDiningTag } from "../src/lib/qloo-contract.ts";

const directory = path.resolve(".local");
const ledgerFile = path.join(directory, "qloo-live-nine-attempts.json");
const lockFile = path.join(directory, "qloo-live-validation.lock");
if (!process.argv.includes("--execute-authorized-nine")) {
  const ledger = await readLedger(ledgerFile);
  console.log(JSON.stringify({ dryRun: true, used: ledger.attempts, remaining: LIMIT - ledger.attempts, automaticRetries: false, fullPlanner: false }));
  process.exit(0);
}
await mkdir(directory, { recursive: true });
let lock;
try {
  lock = await open(lockFile, "wx");
  const require = createRequire(import.meta.url);
  require("@next/env").loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const transport = await createValidationTransport({ ledgerFile, key: process.env.QLOO_API_KEY });
  const { probe, ledger } = transport;
  const resumeSix = process.argv.includes("--resume-remaining-six");
  if (ledger.attempts > 0 && !(resumeSix && ledger.attempts === 3 && ledger.records.every((record) => record.status === 200))) throw new Error("A live run is already recorded. Refusing to repeat its probes; inspect the ledger and obtain authorization before any new run.");
  const exact = (result, name, type) => result?.entities.find((entity) => entity.name.toLowerCase() === name.toLowerCase() && entity.type === type);
  const movieResults = resumeSix ? undefined : await probe("search-film-Inception", "/search", searchParameters("Inception", ["urn:entity:movie"]), parseEntities);
  const movie = exact(movieResults, "Inception", "urn:entity:movie");
  const artistResults = await probe("search-artist-Miles-Davis", "/search", searchParameters("Miles Davis", ["urn:entity:artist"]), parseEntities);
  const artist = exact(artistResults, "Miles Davis", "urn:entity:artist");
  const tagResults = await probe("resolve-cuisine-Italian", "/v2/tags", tagParameters("Italian"), parseTags, "tags");
  const cuisine = tagResults?.tags.find((tag) => tag.name.toLowerCase() === "italian" && isDiningTag(tag));
  const seeds = [artist, movie].filter(Boolean).map((entity) => entity.entity_id);
  const domain = async (label, filterType, ids, tagIds = []) => {
    if (!ids.length) { console.log(JSON.stringify({ skipped: label, reason: "No validated seed ID." })); return; }
    return probe(label, "/v2/insights", insightParameters({ filterType, interestEntityIds: ids, tagIds, take: 3 }), (body) => {
      const result = parseEntities(body);
      if (result.entities.some((entity) => entity.type !== filterType)) throw new Error("Unexpected entity category.");
      return result;
    });
  };
  const artistPicks = await domain("artist-insights-Miles-Davis", "urn:entity:artist", artist ? [artist.entity_id] : seeds);
  await domain(movie ? "film-insights-Inception" : "film-insights-artist-cross-domain", "urn:entity:movie", movie ? [movie.entity_id] : seeds);
  if (cuisine) await domain("dining-insights-Italian", "urn:entity:place", seeds, [cuisine.tag_id]);
  else console.log(JSON.stringify({ skipped: "dining-insights-Italian", reason: "No validated Italian dining tag; no invented tag sent." }));
  await domain("brand-insights-combined", "urn:entity:brand", seeds);
  // Remaining attempts compare a genuinely different artist signal; never call the full planner.
  if (ledger.attempts <= LIMIT - 2 && artistPicks?.entities.length) {
    const secondResults = await probe("search-artist-Daft-Punk", "/search", searchParameters("Daft Punk", ["urn:entity:artist"]), parseEntities);
    const second = exact(secondResults, "Daft Punk", "urn:entity:artist");
    if (second) {
      const changed = await domain("artist-insights-Daft-Punk", "urn:entity:artist", [second.entity_id]);
      if (changed?.entities.length) {
        const left = artistPicks.entities.map((e) => e.entity_id);
        const right = changed.entities.map((e) => e.entity_id);
        const summary = { changedSignalComparison: { sameOrderedIds: JSON.stringify(left) === JSON.stringify(right), sharedCount: left.filter((id) => right.includes(id)).length, leftCount: left.length, rightCount: right.length } };
        await writeFile(path.join(directory, "qloo-signal-comparison.json"), JSON.stringify(summary, null, 2) + "\n");
        console.log(JSON.stringify(summary));
      }
    }
  }
  console.log(JSON.stringify({ used: ledger.attempts, remaining: LIMIT - ledger.attempts, automaticRetries: false, fullPlanner: false }));
} catch (error) {
  // Only our own fixed messages are surfaced; never dump upstream or fetch exceptions.
  const allowed = ["Missing server credential; no requests made.", "Authentication failed; stopped without retries.", "Authorized attempt budget exhausted.", "A live run is already recorded. Refusing to repeat its probes; inspect the ledger and obtain authorization before any new run."];
  console.error(allowed.includes(error?.message) ? error.message : "Validation stopped safely. Inspect the redacted ledger; no automatic retry was made.");
  process.exitCode = 1;
} finally { if (lock) { await lock.close(); await unlink(lockFile); } }
