# V1 Wrap-Up — Outstanding Items

Audit run: 2026-06-23

---

## 🔴 High Priority — broken or missing

### 1. Shared package enum drift — ✅ done (2026-06-23)
All three mismatches corrected in `packages/shared/src/index.ts`:
- `ConditionSeverity`: now `acceptable | monitor | repair_required | unsafe`
- `InspectionType`: now `shi | mic | cib | fsi | pcc | hhc | snag`
- `InspectionSection.status`: now `pending | pass | observations`

### 2. Admin TokenPurchases UI — ✅ done (2026-06-23)
Pending tab added as default view with live count badge. Approve button approves and credits tokens immediately. Reject opens a modal requiring a reason, which is included in the rejection email. Both actions email the inspector automatically via existing `NotificationService` templates.

### 3. Offline photo lost silently — ✅ done (2026-06-23)
`processUploadPhoto` in `offlineQueue.ts` now throws when the blob is absent instead of silently returning success. The queue processor catches it, calls `onError`, and shows the inspector a message asking them to retake the photo.

---

## 🟡 Medium Priority — incomplete but non-blocking

### 4. No client self-registration — ✅ done (2026-06-23)
`/register` was hard-redirecting to splash. Root cause: `Register` component existed and was exported but was not imported in `App.tsx`. Fixed by importing `Register` and replacing the `<Navigate>` stub with `<Register />`.

### 5. Public report share link — ✅ already done
`ShareLinkCard` component (copy + regenerate) is rendered in both Inspector and Client `ReportView` screens. Inspector view passes `canRegenerate`, client view shows copy-only. Token-access route (`/reports/access/:token`) is wired in the router. Audit entry was stale.

### 6. Admin notification log — ✅ done (2026-06-23)
New screen at `/admin/notifications` with status filter (sent/failed/all), type dropdown, paginated table showing type, recipient, status badge, timestamp, and error message. Sidebar link added. API endpoint and `adminApi.getNotificationLog` were already present.

### 7. No zero-condition submit warning — ✅ done (2026-06-23)
Amber warning banner added in `ReviewScreen.tsx` when `allConditions.length === 0`. Non-blocking — inspector can still submit a pass-only report.

### 8. Weather snapshot — ✅ already done
`CoverCaptureSheet` calls `inspectionApi.patch` with `weather_snapshot` on every inspection start (both solo and booking flows). Inspector `ReportView` displays the weather with icon. PDF includes it in the cover page. Audit entry was stale.

---

## 🟢 Low Priority — nits and stubs

- `Inspector/OpenPool.tsx` — ✅ done (2026-06-23): state and inspection-type filter dropdowns added, derived from live pool data, hidden when only one value exists
- `Inspector/Clients.tsx` — ✅ done (2026-06-23): last inspection type now shown per client using API's `lastInspectionType` field
- Duplicate booking prevention — ✅ done (2026-06-23): `BookingService.create` now checks for an existing active booking (open/pending/accepted/in_progress) with same client + address + date before inserting
- Confirmation dialog — ✅ done (2026-06-23): inline Cancel/Remove confirm added to both `ConditionCard` and `AdditionalObservationCard` in `SectionDetail.tsx`
- Admin sidebar labels — ✅ already correct: Condition Library, Limitation Library, Token Purchases all have proper labels (audit entry was stale)

---

## Second Audit — 2026-06-23

### 🔴 High

**A. Client data leak in `GET /inspections`** — ✅ fixed (2026-06-23)
`InspectionService.list()` added no `WHERE` clause for `client` role, exposing all inspections to any authenticated client. Fixed: added `eq(bookings.clientId, user.id)` for client role and added the missing `leftJoin(bookings)` to the count query.

**B. `ReviewScreen.handleSubmit` spinlock on error** — ✅ fixed (2026-06-23)
`mutateAsync` calls had no try/catch — any network or 4xx error left `submitting = true` forever with no feedback. Fixed: wrapped in try/catch, reset `submitting`, added red error banner above Submit button.

**C. Route order conflict (`/access/:token` vs `/:inspectionId`)** — ✅ false positive
Fastify uses a radix tree where static path segments always take priority over parametric ones. `/access/:token` resolves correctly before `/:inspectionId`.

### 🟡 Medium

**D. `shared` `NotificationType` missing 4 API types** — ✅ fixed (2026-06-23)
`welcome_client`, `welcome_inspector`, `admin_booking_stale`, `password_reset` were present in `NotificationService.ts` but absent from the shared union. Admin notification log type filter now includes all 16 types.

**E. `SectionDetail` annotation save/delete has no error handling** — ✅ fixed (2026-06-23)
`handleSaveAnnotation` now checks the API response `error` field and throws — `PhotoAnnotator` already had a try/catch that shows the error inside the open modal so the inspector's work is preserved. `handleDelete` now checks the response and calls `toast` on failure instead of silently swallowing the error.

**F. `TokenBuy.tsx` hardcoded price/max constants** — ✅ fixed (2026-06-23)
`PRICE_PER_TOKEN = 5000` and `MAX_TOKENS = 20` were frontend constants. Now read from `tokenApi.getBalance()` response `config.pricePerTokenNgn` / `config.maxTokensPerPurchase`, with the old values as fallbacks.

**G. Admin bookings page missing** — ✅ fixed (2026-06-23)
New `Bookings.tsx` screen at `/admin/bookings`. Shows all unassigned open bookings with inspection type, address, client name/email, requested date, and a colour-coded wait-time badge (green < 24 h, amber < 72 h, red ≥ 72 h). Auto-refreshes every 60 s. Sidebar link added under Token Purchases.

**H. `offlineStore` IDB writes are dead code** — ✅ fixed (2026-06-23)
Removed `idbSet`/`idbDel` calls and the `idb-keyval` import from `offlineStore.ts`. Zustand's `localStorage` persist is the sole persistence layer for the action queue; the IDB writes were never read back on hydration.

### 🟢 Low

**I. `NotificationLog` field casing** — ✅ non-issue (confirmed)
`getLogHistory` returns Drizzle camelCase fields. `NotificationLog.tsx` already uses `?? ` fallback for both casing variants. Closed.

**J. `supabase.ts` dead file** — ✅ fixed (2026-06-23)
`apps/web/src/lib/supabase.ts` had no importers after the Supabase migration. Deleted.
