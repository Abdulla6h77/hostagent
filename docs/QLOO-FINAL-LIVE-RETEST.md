# Phase 1.8 — Final controlled LIVE planner retest

## Observed outcome

**The actual production `POST /api/plan` returned HTTP 200, `mode=qloo`, and all four domains with `source=qloo` (UI label LIVE). Total planner execution time: 13,015 ms. No SAMPLE or BASELINE fallback occurred in the live plan.**

This was one real end-to-end run, not mocked endpoint success. The harness launched the compiled standalone application in a fresh process and used the same route, orchestrator, request builders, parsing, and scoring as the browser UI. Input was Guest A: Miles Davis, jazz, Italian food; Guest B: Inception, electronic music, Japanese food. Both guests resolved all three seeds through actual lookups; no identifiers were guessed or supplied as fixtures.

Run started on October 23, 2026 in Asia/Karachi (first upstream attempt `2026-10-22T20:20:53.880Z`). The owned validation server was stopped afterward. No push or deployment occurred.

## Budget and request evidence

**Exactly 12 of 12 authorized real HTTP attempts were used. Zero remain.** No automatic retries, repeated live plan, or changed-taste live comparison ran. Attempts were durably reserved before fetch; redirects were disabled. The new private ledger is `.local/qloo-final-twelve-attempts.json`, authorization `phase-1.8-2026-10-23`. It cannot reuse any prior authorization.

| Attempt | Endpoint/category | Duration (ms) | HTTP | Parsed results |
| --- | --- | ---: | ---: | ---: |
| 1 | Entity search | 1,123 | 200 | 10 |
| 2 | Tag lookup | 845 | 200 | 10 |
| 3 | Tag lookup | 844 | 200 | 10 |
| 4 | Entity search | 218 | 200 | 10 |
| 5 | Tag lookup | 227 | 200 | 10 |
| 6 | Tag lookup | 231 | 200 | 10 |
| 7 | Primary artist / music | 517 | 200 | 10 |
| 8 | Primary place / food | 10,118 | 200 | 10 |
| 9 | Primary movie / film | 3,775 | 200 | 10 |
| 10 | Primary brand / vibe | 964 | 200 | 10 |
| 11 | Individual artist / Guest A | 325 | 200 | 10 |
| 12 | Individual artist / Guest B | 318 | 200 | 10 |

Durations measure the client request interval, including durable reservation overhead and response parsing; they are not server-only processing times. Requests overlap, so their sum is not planner wall time. All four primary queries contained both resolved entity signals and both genre signals. Dining additionally contained both cuisine tag filters. All primary domains finished before attempts 11–12 began.

The Phase 1.5 nine-attempt, Phase 1.6 twelve-attempt, and Phase 1.7 zero-of-four ledgers were hash-checked before and after and **all remained unchanged**. Phase 1.7's allowance was not repurposed. The new ledger and redacted summary are excluded from Git and Docker contexts. Credentials, authentication headers, full API responses, and raw identifiers were not logged or persisted.

## Domain results and provenance

| Domain | Source / UI label | Primary duration | Displayed picks | Category validation | Completed individual checks |
| --- | --- | ---: | ---: | --- | ---: |
| Music | qloo / LIVE | 0.517 s | 3 | Artist: passed | 2 |
| Food | qloo / LIVE | 10.118 s | 3 | Place: passed | 0 |
| Film | qloo / LIVE | 3.775 s | 3 | Movie: passed | 0 |
| Vibe | qloo / LIVE | 0.964 s | 3 | Brand: passed | 0 |

Every displayed LIVE entity ID matched a SHA-256 fingerprint from its actual primary-domain response. The production client accepted the normalized category of every upstream entity. All four domains had three distinct IDs and three distinct normalized titles; no within-domain duplicate was found. No synthetic recommendation was labeled LIVE.

Every affinity value was null. Music named guest attribution matched the corresponding actual separate guest-response fingerprints: Guest A supported one displayed music pick, Guest B two, and no displayed music pick had both guests' support. Food, film, and vibe claimed no named guest support and reported that individual checks were skipped due to the budget. Those zero support counts mean unchecked compatibility, not measured dislike.

Two additional local BASELINE route requests (before and after the live run) consumed zero Qloo calls, returned identical fixed domain content for different input tastes, and did not change the ledger. Each LIVE domain's first pick differed from its baseline first pick. This is evidence of different Qloo-derived output, not proof of sensitivity to a controlled taste change.

## Timeout conclusion

The unchanged patched settings were sufficient **for this run**: 20 seconds per insights request, 10 seconds per lookup, at most two concurrent primary requests with staggered starts, and a 45-second overall planner deadline. Dining exceeded the former 10-second limit and completed under the new limit. Film also completed, but its faster result does not establish why the earlier run timed out. No timeout was increased in this phase.

One successful run does not establish a latency percentile or guarantee future all-domain availability. Longer client timeouts allow slow upstream work to complete but retain concurrent resources longer; bounded concurrency and the overall deadline continue to limit that cost. A slow second wave can still lose time to the overall deadline and honestly fall back.

## Changes and offline verification

- `src/lib/qloo-planner-budget.ts`: added an explicit, separate Phase 1.8 destination/authorization and optional request-duration metadata; preserved the earlier authorization.
- `src/lib/qloo.ts`: records duration when settling a validation request; no request parameter, timeout, scoring, or fallback behavior was changed.
- `scripts/validate-final-planner.mjs`: new controlled production-route harness with prior-ledger integrity checks, timing summaries, and primary-response fingerprint verification. Default invocation is a network-free dry run; an already-used authorization refuses another live run.
- `tests/planner-budget.test.ts`: added Phase 1.8 isolation/timing/authentication-stop coverage, including refusal to target Phase 1.7's ledger.

Actual checks after the code changes: **lint passed with zero warnings; typecheck passed; 68 tests across 5 files passed; production build passed**. Tests were offline. Build ran with an explicitly empty Qloo key and live/validation access disabled; standalone preparation excluded environment files. The harness dry run reported zero used before execution. No implementation defect requiring a post-live code repair was discovered.

## Remaining product limits and deployment recommendation

The four-domain LIVE workflow is now proven locally for this exact group. No failing category or fallback remains in this observed run. Broader production readiness remains separate:

1. Individual compatibility is verified only for music, with no observed shared pick. Other domains lack individual evidence, and stronger group consensus is unproven.
2. Category validity and distinct titles do not establish semantic relevance or cultural diversity. In particular, brand suggestions do not automatically constitute a useful dress code.
3. City remains context-only; local venue suitability, dietary requirements, and availability are not verified.
4. No controlled changed-taste live comparison or repeated latency/reliability sample was affordable.
5. Public service still requires distributed quota/rate protection, production secret configuration, CI/security review, and hosted validation. The local validation ledger is a controlled-run safeguard, not public traffic quota infrastructure. Previously flagged credentials still require manual rotation; this phase did not rotate them.

**Recommendation:** proceed to deployment hardening and GitLab automation as a separately authorized phase. The core local LIVE integration gate passed, but do not declare the public service production-ready or deploy without completing the remaining operational controls and hosted checks. Any further live request requires new authorization; preserve this exhausted ledger and all earlier ledgers.
