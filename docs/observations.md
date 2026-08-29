### My observations from manually testing the software

1. Date picker on https://app.inspectafrica.org/client/book is not intuitive, the icon which brings up the picker is almost hidden to the far right. Instead, clicking any part of the input field should pop up the dat selector.
2. "Confirm Booking" button on the page right after the above one is distorted. The icon and the text on the button are clearly mis-aligned.
3. During "Observation Identified", warn when clicking done on a "Photo Required" observation. Currently it only rejects on final submit, and easily gets missed during the initial observation.
4. Even after adding the required photos. the final "Submit for review" button is still disabled.  Showing the "Photo required before submitting" error highlights above the button. And on clicking the highlights, I do find my uploaded photos, why then can I not submit.

### Admin use case bug reports/observations
5. Text visibility is absolutely dead on the generated report link at http://localhost:5173/reports/access/6836b0e7-4cc5-4318-90e1-a07154819f47
6. On the http://localhost:5173/admin/inspections/4cc27b39-bbed-48f3-8c5d-b1fc75098210 page, titled Control Room, the content has a max width, but feels off being left aligned. It should either span full width, or preferably, maintain it's contained width but centered.
7. The dark dialog underlay should either be full screen, or fit the main content section off the topbar and sidebar, currently, it fills the screen, up to about halfway up the topbar, which feels off.
8. "Flag Inspection" has an API error api.ts:164  PUT http://localhost:3000/api/v1/inspections/d1d06af3-b773-40cd-8973-fba61ff23490/flag 400 (Bad Request) throws the below error with no toast feedback for the user. Also, this 10 character validation should be handled client side and displayed on the user under the comment textarea field. {
    "data": null,
    "error": {
        "code": "BAD_REQUEST",
        "message": "reason must be at least 10 characters"
    }
}
9. Token purchase call http://localhost:3000/api/v1/solo/tokens/purchases failed first time, but went through on the second attempt, not sure why, just documenting this for investigation.
10. Clicking "+ Add note" after typing an admin not on a section of an inspection, the note saves correctly, but unnecessarily opens a new empty note field.
11. Clicking the added photo in an inspection to view it, only brings up the dark dialog underlay which covers the whole page, with neither an actual dialog, or image at all. (Update: Thiis eventually worked with another image, but the marker line added on the inspector's side isn't relfected to the admin when they view the image)
12. The admin notification in the top bar should reflect any pending token purchase verification, as this isn't even reflected on the main dashboard for the admin. Also review all other operations that may need admin attention and ensure that they make the notification.
13. When revision has been requested by an admin, the inspection should reflect this state somehow, and disable the "Request Revision" button, instead of every subsequent revision request just updating the reason with no indication that it's awaiting to be picked up for a revision.
14. On the http://localhost:5173/admin/inspections?tab=approved the approved tab specifically, the location always says N/A even for inspections that reflected location on the other tabs.


### Inspector use case bugs/observations
1. "Invalid or expired token" on an API request. We need to implement a refresh system, or actually log users out when their sessions expire, find the better approach other than tokens expiring silently. This could also have been because I opened the app in a new tab and got logged into a fresh inspector session, investigate.
2. 

> **Filed.** All carry the `manual-observation` label so they sort ahead of audit-sourced work.
>
> | Observation | Issue | Priority |
> |---|---|---|
> | 1 — booking date picker | #52 | P3 |
> | 2 — Confirm Booking button alignment | #53 | P3 |
> | 3 — warn on photo-required "Done" | #54 | P2 |
> | 4 — Submit stays disabled | #55 | **fixed, PR #64** |
> | 5 — report link unreadable | #74 | P1 |
> | 6 — detail page not centred | #82 | P3 |
> | 7 — dialog overlay vs topbar | #83 | P3 |
> | 8 — flag validation + hidden error | #76 | P2 |
> | 9 — token purchase 500 | #81 | P2 |
> | 10 — note editor reopens empty | #78 | P3 |
> | 11 — photo viewer blank / annotations missing | #75 | P1 |
> | 12 — admin bell misses pending work | #80 | P2 |
> | 13 — "revision requested" has no state | #79 | P2 |
> | 14 — Approved tab location N/A | #77 | P2 |
> | Inspector 1 — expired token, no recovery | #84 | P1 |
>
> Root causes found while filing: #74 is the public report route rendering outside
> `ClientLayout`'s dark shell (white on white); #77 is the address living on the booking
> while the list reads the inspection's own null column; #78 sets the draft to `''`
> instead of deleting the key; #76's error renders behind the `z-50` dialog; #84 is 13
> screens bypassing the refresh-aware API client (details added to #12).

---

## 2026-07-25 — first local end-to-end run (API-level)

Run against a fresh local Postgres seeded with staging's reference data, with real R2
credentials. Covers the full lifecycle: registration → booking → accept → inspection →
photo → submit → flag → request_revision → resubmit → approve → PDF → client access link,
plus the admin management surfaces. The browser walkthrough is still to come; everything
below was reproducible through the API.

### New

5. **Condition observations never appear in the report PDF.** `ReportService` assembles
   `observations` for every condition and hands them to the renderer, but `lib/pdf.ts`
   contains no reference to them at all — only section-level `additionalObservations`
   render. So both the inspector's per-condition notes and the admin's review notes are
   silently dropped from the client-facing report. The admin detail screen even shows an
   orange "click Regenerate Report" hint after editing a note, implying the opposite.
   Reproduced: added an admin observation, regenerated, and got a byte-identical PDF
   (708,417 bytes for both v1 and v2).

6. **Every booking acceptance loses its audit-log entry.** `BookingService.accept` writes a
   revision event with `inspectionId` set to the *booking* id. `revision_events.inspection_id`
   has a foreign key to `inspections.id`, so the insert always fails with
   `revision_events_inspection_id_inspections_id_fk`. `RevisionService.log` swallows the
   error, so nothing surfaces except a log line and the audit trail is quietly incomplete.

7. **The admin Notification Log's "Error" column is always blank.** The API returns the
   failure reason as `error`; `NotificationLog.tsx` reads `log.error_message ?? log.errorMessage`,
   neither of which exists, so it always renders "—". During this run every email failed with
   "API key is invalid" and the admin screen showed no reason at all. The shared
   `NotificationLog` type also declares `errorMessage` and `responseTimeMs`; the table has
   neither.

8. **`/api/v1/health` reports `resend: "ok"` without checking anything.** The Resend branch is
   `if (process.env.RESEND_API_KEY) results.resend = 'ok'` — its own comment says "just check
   env var". Health reported all-green through a session in which every single email send
   returned 401. The db, storage and wordpress checks are real, which makes the one fake
   check invisible.

9. **An admin can suspend an inspector and then be unable to reinstate them.**
   `reinstateInspector` treats any `CertService.verify` result that isn't `valid: true` as
   fatal — including `status: 'not_configured'` and any WordPress outage — and returns
   "Cannot reinstate — ACHI certificate is not valid. Inspector must renew certification.",
   which blames the certificate for what is an infrastructure problem. The adjacent `catch`
   block reinstates anyway when `verify` *throws*, so the intent clearly isn't to let a
   broken bridge block reinstatement.

10. **Auth and role failures use a different error envelope from every other endpoint.**
    They return `{"error": "Requires role: admin"}` — a bare string — while business errors
    return `{data: null, error: {code, message}}`. Client code reading `res.error.message`
    gets `undefined` for the entire auth/authorization class.

11. **There is no unauthenticated liveness endpoint.** `/api/v1/health` is admin-gated, and
    both `GET /` and `GET /health` 404. Railway health checks and any uptime monitor have
    nothing to probe.

12. **`inspections.country` exists in staging but not in `schema.ts`.** A database built from
    the ORM schema differs from staging by that one column. Nothing reads it.

13. **The `report_versions` row is inserted before the PDF exists.** Between the insert and
    the storage-path update, a reader sees a version row with a null `storage_path`. The
    admin UI navigates to the Approved tab 1.2 s after approving, which lands inside that
    window.

### Already filed — confirmed live

- **#9** (ACHI check computed then ignored): a `candidate` inspector with no valid
  certificate accepted a booking; the API logged `BookingService.accept: cert check skipped`.
- **#21** (suspension lag): after suspending the inspector, login was correctly refused, but
  the bearer token issued moments earlier still listed their inspections.
- **#41** (stale flag fields after approve): resolving a flag with `approve` left `flagged_at`
  and `flagged_by` populated and `flag_reason` holding the resolution notes on an
  `approved` row.

### Verified working

- The merged fixes hold up in a live run: **#2** (resolving a flag with `approve` generates
  the report), **#7/#8** (the client gets exactly one email — `report_ready` — and no
  `report_approved`), **#55**.
- Flag lifecycle: flag → `request_revision` keeps the inspection flagged, resubmit clears
  `flag_reason` and returns it to `pending_review`.
- Approve is correctly refused outside `pending_review`, from both entry points.
- Puppeteer PDF generation, R2 upload/download, signed URLs, certificate numbering, and the
  30-day client access link all work end to end.
- Token grant → solo inspection consumes exactly one token; the solo inspection is created
  with its 6 template sections.

### Environment note

The `RESEND_API_KEY` in the lead engineer's `.env` is a mock value (`re_dev_key_…`), so no
email actually sends — every attempt returns 401 and is logged as `failed`. A real key is
needed to test any email content or link.

---

## 2026-07-26 — automated end-to-end run (browser-driven)

A Puppeteer harness driving the real UI: clicking, typing, uploading, going
offline. Three passes — a route sweep across every screen for every role, then
scripted user journeys, then edge cases. Deliberately aimed at what a user
experiences, not at code smells.

### New

15. **Rapid clicks on "Confirm Booking" create duplicate bookings** — three
    clicks produced three real bookings, one millisecond apart, each of which
    enters the open pool separately. The button *is* `disabled={mutation.isPending}`,
    but that only flips after a re-render, and three clicks in one tick all fire
    first. A double-tap on a slow phone does this. Filed as **#97**.

    Same three-click test on the other destructive actions: **Submit for Review**
    fires three times but ends in the right state (noise, not damage);
    **Approve** is safe, because the server rejects the 2nd and 3rd calls with
    "must be in pending_review". The server-side status check is what saves it —
    booking creation has no equivalent.

### Confirmed still open

- **#15** (offline condition library) — worse in practice than filed. Offline,
  the finding picker renders **zero** items, so an inspector who loses signal
  can't record anything at all. The offline indicator itself works.
- **#25** (nested `<a>`) — still on `/inspector`, and the only route with it.
- **#67** (notification log Error column) — 44 failed rows, all showing `—`,
  while the API returns the reason on every one.

### Verified working

Fixes from this session confirmed through the UI, not just tests: the
photo-required warning fires on leaving a section (#54); Review & Submit
correctly blocks then unblocks once a photo is attached (#55); the Approved tab
shows real addresses (#77); the admin photo viewer loads images and draws the
inspector's annotations (#75); flag validation counts down and blocks below ten
characters (#76).

Full journeys that completed end to end: register → log in → book → claim from
pool → start inspection → record a finding → attach a photo → mark sections →
submit → admin review → note → approve → report generated (690 KB) → client
opens the report and rates the inspector; and inspector buys tokens with a
proof upload.

### Clean

- **No crashes, blank screens or error boundaries** on any of ~45 route/role
  combinations.
- **No auth leaks** — signed-out, client and inspector sessions were all
  correctly refused admin screens.
- **Mobile (375px):** zero horizontal overflow on all 14 key screens.
- No broken images, no dead links, no uncaught exceptions.

### Note on method

One finding was a false positive worth recording: a photo upload appeared to
fail (`PUT net-fail` to R2) while the UI showed success. It was the CORS
preflight being reported, not the upload — the object fetches back from R2 at
526 bytes and the report generated correctly. Checked before reporting.
