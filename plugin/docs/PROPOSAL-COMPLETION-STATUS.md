# InspectAfrica LMS Integration — Contract Completion Checklist & Plan

Evaluated strictly against the **signed proposal** (`docs/InspectAfrica_LMS_Final.pdf`, ₦500,000 fixed fee, April 2026, "Outside main contract — separate engagement"). The client's later membership/subscription spec is a separate scope-change conversation (`CLAUDE-WEB-CONTEXT-ia-lms.md`, `CLIENT-QUESTIONS-LMS-MEMBERSHIP.md`) — not tracked here.

Last updated: 2026-07-06, plugin v1.0.34.

---

## ✅ DONE (verified in code / proven live)

| # | Contract item | Evidence |
|---|---|---|
| A3 | ACHI number auto-generation hook (`ACHI-YYYY-XXXXX`) on course completion, written to user profile | `IAB_LMS_Sync::check_required_courses_completion()` → `issue_certificate()`. Proven live end-to-end: real accounts promoted with correct data confirmed in Postgres. **The "written to user profile" gap is closed** — `achi_number`/`achi_status` now written to WP user meta on issuance and every status change (v1.0.33), plus a one-time backfill endpoint for certs issued before this existed. |
| A3b *(beyond the literal contract, client-requested)* | Personalized ACHI certificate image + static badge, emailed on issuance | New: `IAB_Certificate_Generator` composites the inspector's name (auto-shrinking script font for long names), ACHI number, and issue date onto the client's certificate artwork using GD — confirmed rendering correctly on the live server. Attached automatically to the existing issuance email via `wp_mail()`. Badge is a static asset (no personalization, per client direction), shipped in the plugin for the App/site to use. |
| A4 | Candidate / Certified / Suspended roles | `class-roles.php`; auto-synced on enrollment, issuance, expiry, suspension, reinstatement. |
| B1 | Verification endpoint, POST as specified | `verify-cert` now accepts both POST (contract spec) and GET (back-compat) — was GET-only, silently breaking the App→LMS chain until fixed (v1.0.33). |
| B2 | API key auth, unauthenticated calls blocked | `IAB_Auth::verify_api_key()` on every protected route; unauthenticated → 401, wrong key → 403 (verified live). |
| B3 | LearnPress webhook pushing cert updates to the app | Proven live: real `cert_issued` delivery → `apps/api` → Postgres row confirmed by direct query. Per-event routes, correct payload shape, separate outbound key. |
| B4 | Fraud protection — rate limiting + invalid-attempt logging | `class-rate-limiter.php` + `is_ip_blocked()` on `verify-cert`; every attempt logged to `iab_api_activity` with result success/invalid/expired/blocked. |
| B5 | Admin dashboard — call log, failed verifications, sync status | Activity tab (call log + result filters + webhook delivery log), Overview stats, Sync Now. |
| C1 | Live cert check in the PWA | Inspector Profile has a working re-verify flow (`certApi.verify()` → `apps/api` → `CertCacheService` → WordPress `verify-cert`). Registration collects + format-validates ACHI numbers. **Now actually working end-to-end** — was silently broken by the B1 GET/POST mismatch until fixed. |
| C2 | Error states | Profile re-verify now correctly distinguishes: valid → success, LMS unreachable → amber "temporarily unavailable" (not a false failure), suspended/expired/not-found → clear message. Previously *every* response showed generic "success" regardless of actual outcome — a real bug caught while implementing this. |
| C3 | On-device caching, 7-day stale refresh | Dedicated `StaleWhileRevalidate` service-worker rule for `/api/v1/certs/verify/` @ 7 days — was lumped into the generic 24h API cache before. |
| C4 (partial) | E2E validation | 3 new Playwright specs (`apps/web/e2e/app.spec.ts`) using network interception to deterministically test the valid/unreachable/expired branches — including a direct regression test for the C2 bug. Full live human E2E (real course completion → real App verification) still to be run once client quiz content exists. |

## ⏳ UNDONE (blocked on client content, not engineering)

| # | Contract item | State | Blocker |
|---|---|---|---|
| A1 | Restructure 30 courses into a sequenced certification pathway | Mechanism targets the real 27 published courses. No deliberate sequencing/reordering pass done. Titles carry module numbers (3, 5, 7–10), so intended order partially exists. | Needs client's intended order for unnumbered courses + decision on the 3 draft courses. |
| A2 | Quiz pass thresholds per module | Bulk-apply tooling built and in wp-admin UI, one click when ready. | **Hard-blocked on client**: zero quizzes exist on any course. Nothing to configure. |
| A2b | LearnPress Certificates add-on configured | Not installed. A custom cert/badge system was built instead and confirmed working (see A3b above) — arguably supersedes this line item already. | Client sign-off recommended (see below), not further engineering. |

## Deviations needing client sign-off (not bugs — just need a written OK)

- **JWT (A5):** contract says "configure JWT Authentication plugin." A native JWT implementation was built instead — and nothing consumes it (the App has its own auth; PWA↔LMS security runs on API keys). Recommend written sign-off that the API-key architecture supersedes it.
- **Certificates add-on (A2b):** a custom certificate/badge generation system was built instead of the ThimPress add-on — and it's now live, tested, and emailing real personalized certificates. Recommend sign-off that this satisfies the intent of A2b rather than installing the add-on as well.
- **Secure key storage (C):** superseded by better architecture — the device never holds the WordPress API key at all (lives server-side in apps/api). Exceeds spec; nothing to build.

---

## What's left, in order

1. **Client content** — quiz questions/answers/passing grades for the 27 courses, a decision on the 3 draft courses, and confirmation of intended course sequencing. This is the only remaining hard blocker on Workstream A, and nothing on the engineering side can close it.
2. **Full live E2E run** — once #1 lands, one real test candidate through the whole flow (register → pass all 27 → ACHI issued → certificate emailed → App shows verified status), screen-recorded for the sign-off.
3. **Sign-offs above** — JWT, Certificates add-on, key storage. Paperwork, not work.

## Testing plan (mapped to the contract's own exit criteria)

**Workstream B exit — "Endpoint returns correct responses. Unauthenticated calls return 401."**
① POST `verify-cert` valid ACHI → `valid:true` + correct name/dates; ② GET same → identical (back-compat); ③ malformed ACHI → 400; ④ unknown ACHI → `valid:false`, not found; ⑤ suspended + expired certs → correct statuses; ⑥ protected route with no key → 401, wrong key → 403; ⑦ hammer `verify-cert` past the rate limit → blocked + logged.

**Workstream A exit — "Inspector completes course → ACHI number auto-generated and stored correctly."**
① `mock-pass-course` with a fresh WP user — cert row, role promotion, webhook delivered, issuance email **with certificate image attached**, `achi_number` present in user meta; ② once client quizzes exist: one real test candidate passes all 27 → same assertions via the real trigger; ③ negative test: user passing 26 of 27 → **no** cert issued.

**Workstream C exit — "Inspector enters ACHI number → live verified status returned. Zero critical findings."**
① In-App: Profile → re-verify with a real ACHI → verified status + correct name/expiry rendered; ② invalid ACHI → clear "invalid" state; ③ LMS unreachable → "temporarily unavailable" state, not "invalid"; ④ offline device with a previously-verified cert → cached status shown (7-day rule); ⑤ Playwright specs automating ①–③ (done); ⑥ confirm device storage holds no WordPress API key.

**Full contract E2E:** fresh WP user → passes all required courses → ACHI generated → certificate + badge emailed → webhook → Postgres profile certified → same inspector logs into the App → badge/status visible → Profile re-verify returns live `valid:true`. Blocked only on client quiz content (step 1 above) — everything else is ready.

---

## Bottom line

- **Workstream B is complete.**
- **Workstream A's machinery is complete and proven live** — what remains is entirely client content, not engineering.
- **Workstream C is complete** — was further along than believed, had one real live bug (silent false-success on re-verify) caught and fixed alongside the planned polish.
- Three small items need a written client sign-off (paperwork), and one thing needs client content (quizzes) before the contract's full E2E exit criterion can be demonstrated.
