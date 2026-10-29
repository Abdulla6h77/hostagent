# Host Agent

Plan music, food, film, and aesthetic inspiration around the tastes of 2–4 guests. Add 3–5 tastes per guest and compare recommendations with a fixed generic baseline.

The actual production planner returned all four domains LIVE in 13.015 seconds during a controlled local test. See [validation evidence](docs/QLOO-FINAL-LIVE-RETEST.md). This verifies that run, not hosted reliability or deployment readiness.

## Run locally

Use Node.js 22.12+ and npm:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. SAMPLE mode works without credentials. A configured local `.env` can enable live calls: set `QLOO_LIVE_ENABLED=false` for offline demos. Never put private keys into the browser.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

The production build prepares standalone output without environment files. `npm start` loads private local configuration at runtime. The unit and API tests use mocks and block unexpected network requests.

## Configuration

Copy `.env.example` to `.env.local` if needed. Keep actual values private.

| Variable | Purpose |
| --- | --- |
| `QLOO_API_KEY` | Server-side Qloo credential. Missing credentials select SAMPLE. |
| `QLOO_LIVE_ENABLED` | Exactly `true` enables live requests when a key exists; default false. |
| `QLOO_BASE_URL` | Defaults to `https://hackathon.api.qloo.com`; only that HTTPS host is allowed. |
| `QLOO_MAX_HTTP_ATTEMPTS` | Per-plan request cap, including retries; default 48. Not a global quota. |
| `QLOO_MAX_RETRIES` | Default 1; set 0 to disable automatic retries. |

The credential previously exposed in original project notes requires manual revocation/rotation. Redaction and exclusion do not revoke it. Rotation has not been confirmed.

## Sources and behavior

- **LIVE**: actual Qloo recommendations. Each domain exposes its own source.
- **SAMPLE**: synthetic ideas, including honest per-domain fallback when upstream requests fail.
- **BASELINE**: fixed generic suggestions, independent of tastes and without Qloo calls.

Genre and cuisine tags and exact entity-name matches resolve taste seeds. Primary insights run with at most two concurrent requests and staggered starts. Lookups allow 10 seconds, insights 20 seconds, within a 45-second planner deadline. Individual support checks follow all primary requests if budget allows. Retrieval overlap is not an affinity probability; unchecked guests are not attributed. The explicit SAMPLE demo bypasses live requests even when credentials are configured. City and occasion are context only; venue location, dietary suitability, and availability are not verified.

## Group coverage

For each LIVE domain, the planner keeps the existing group candidate pool and individual retrieval checks. It selects up to three picks that maximize the number of guests with verified individual retrieval support across the selected set. Equal-coverage sets use the existing candidate ranking lexicographically; displayed picks retain that order. This adds no Qloo calls.

Per-pick evidence distinguishes supported, checked but not retrieved, and unchecked. Domain notes identify guests without a supporting pool candidate, guests whose checks were unavailable, and exclusions forced by the three-pick limit. Coverage is not affinity, dislike, unanimous consensus, or support for unresolved inputs. With no individual evidence, the original ranked selection remains unchanged. SAMPLE and BASELINE recommendations are not assigned verified coverage.

## Reading the evidence

Results show unique guests with verified representation across selected LIVE recommendations. SAMPLE keyword matches and BASELINE ideas do not count. Incomplete individual checks remain explicit; coverage is not affinity or unanimous agreement. Short explanations lead each card, while “How this was chosen” retains technical evidence and per-guest checked/unchecked states.

Unresolved tastes appear outside collapsed planning notes. They were not used as Qloo taste signals in that run; curated SAMPLE ideas can still use keyword matches. Category-based suggestions are unverified examples, generated locally without API calls. Edit a guest’s taste chips and regenerate to retry resolution; the displayed plan keeps its original guest snapshot until then.

## Project structure

- `src/app`: responsive frontend and production API routes.
- `src/lib`: request contracts, seed resolution, orchestration, fallback, and validation budget safeguards.
- `tests`: offline regressions for core logic, API behavior, and request caps.
- `scripts`: local startup, standalone preparation, and controlled validation harnesses.
- `docs/QLOO-FINAL-LIVE-RETEST.md`: final local LIVE evidence and remaining limitations.

`POST /api/plan` validates bounded JSON input; Qloo credentials and requests stay server-side. `GET /api/health` checks process health, not Qloo availability. Live validation scripts require explicit authorization and durable ledgers; do not reset or reuse exhausted ledgers.

## Manual publication

Publish application source, tests, scripts, configs, lockfile, README, LICENSE, and final validation report. `.gitignore` excludes private environment files, `.local` ledgers/archive, dependency folders, and generated output. `.vercelignore` and `.dockerignore` also exclude private state. Keep `.env.example` with empty/example values.

Before committing, inspect `git status --short` and `git diff --cached --name-only`. Never stage `.env`, `.env.local`, `.local`, keys, logs, or caches. This folder has not been initialized as a Git repository by this cleanup. Confirm the remote destination before pushing; do not overwrite existing remote history.

A Vercel deployment is reported by the owner; this local revision has not been deployed or verified there. The Node route exports a 60-second maximum duration for a 45-second planner, but hosted limits require verification. Server-side shared-budget and visitor protection is implemented but requires manually provisioned Upstash configuration and storage-only verification. Keep LIVE disabled until those controls are ready. See [LIVE protection setup and rollback](docs/LIVE-PROTECTION.md).

## License

MIT; see [LICENSE](LICENSE).
