# LMS UX Improvement Plan

Goal: improve the visual/UX quality of the courses page, enrollment, purchase, quiz-taking UI, and certification display on `inspectafrica.org` — **without touching backend logic**. The bridge plugin, LearnPress core behavior, and WooCommerce checkout logic all stay exactly as-is; this is a front-end/theme layer change only.

## Why this approach

LearnPress and WooCommerce already handle the hard, stateful parts correctly — cart state, order/payment status, quiz progress and grading, evaluation-mode logic. Reimplementing any of that to get a custom look would mean rebuilding behavior that already works, for no functional gain. The standard, low-risk path is to **restyle what's already there**, not replace it.

## Two workstreams

### 1. LearnPress/WooCommerce template overrides (theme layer)

LearnPress and WooCommerce both support overriding their default templates by copying them into the active theme (or a child theme). This covers:
- Course archive/listing page
- Single course page (curriculum, price, "Enroll Now" / "Add to Cart")
- Enrollment / checkout flow (WooCommerce templates)
- Quiz-taking UI (LearnPress's own JS-driven quiz app — lower-risk to leave as-is or restyle lightly via CSS rather than deep template overrides, since it's more stateful/JS-heavy)

**Trade-off:** safe and fast — all cart state, order status, and quiz grading logic keeps working exactly as LearnPress/WooCommerce intend. Less design freedom than a full custom rebuild, but far less risk.

### 2. Custom certification badge/verification page (Elementor)

Build a dedicated page (via Elementor, already connected to this site) that calls the bridge plugin's existing public endpoint:
```
GET /wp-json/inspectafrica/v1/verify-cert?achi_number=ACHI-YYYY-NNNNN
```
to render a polished certificate/badge display — no plugin changes needed, this endpoint already exists and is public/rate-limited.

**Trade-off:** full design freedom since it's a new page, not an override of existing LearnPress markup. Straightforward to prototype live since Elementor is already wired up via MCP.

## Suggested order

1. Prototype the certification badge page in Elementor first — smallest scope, no dependency on curriculum being finalized, good way to validate the approach before touching the bigger course/enrollment pages.
2. Course archive + single course page template overrides.
3. Enrollment/checkout (WooCommerce) template overrides.
4. Light CSS-only pass on the quiz-taking UI (avoid deep template overrides there given its JS-driven state).

## Open items

- Confirm with the client what "improved UX" specifically means for the course/enrollment pages — no explicit design direction given yet, so first pass should stay close to LearnPress/WooCommerce defaults structurally and focus on visual polish (typography, spacing, branding) rather than restructuring flows.
- Once real pricing/coupon-gating (see `CLAUDE-WEB-CONTEXT-ia-lms.md`) is decided, the enrollment/checkout template work should happen after that, not before — no point polishing a purchase flow that's about to change mechanism (free → WooCommerce coupon-gated).
