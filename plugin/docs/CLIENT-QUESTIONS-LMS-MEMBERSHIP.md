# InspectAfrica LMS — Questions for Client Sign-off

Thanks for the implementation requirements document — the membership model, pricing, and Launch Package structure are clear. Before we can build the certification and membership flow to match it, we need answers to the items below. Grouped by topic, roughly in priority order.

## 1. Curriculum

**Audit complete (Mike):** 30 courses exist on the site, matching the original proposal. 27 are complete with modules; 3 are dummy/draft courses that were never finished. **None of the 30 courses have any quizzes or assignments.**

- What should happen to the 3 incomplete courses — finish them, or drop them from the certification pathway entirely?
- The quiz questions and correct answers for each of the 27 complete courses — this is the main blocker right now. Certification can't be evaluated at all until quiz content exists.
- The passing threshold for each quiz, and the passing threshold for a course overall.
- Which of the 30/27 courses are **core** (required for ACHI certification) and which are **elective**? We have a separate "Elective Modules Certificate" design file, so it looks like electives are a distinct track with their own certificate — please confirm which courses fall into which group.
- What exactly is the "final certification assessment" mentioned in your document — is it a standalone final exam, or the combined result of all the individual course quizzes?

## 2. Membership rules

- If a member's subscription lapses (payment fails, they cancel, etc.):
  - Do they lose access to courses they've *already completed*, or only to starting new ones?
  - If they were **already ACHI-certified** before the lapse, does their certification get suspended, or does it remain valid permanently once earned, independent of ongoing membership?

## 3. Launch Package ($200 one-time fee)

- What exactly is included in the "Professional Starter Pack"? Is it a physical item that needs to be shipped, or fully digital?
- What should the "Digital Membership ID" actually contain/look like — a generated ID card, a QR code, a PDF, something else?

## 3b. Currency — needs resolving before any payment integration

Your document prices membership in **US$30 / US$300**, but Paystack and Flutterwave are African payment processors whose merchant accounts are built around local currencies (NGN, GHS, KES, ZAR, etc.) — USD isn't a standard supported settlement currency for most merchant accounts on either platform.

- Should the actual charge be in a local currency (e.g. NGN), with the USD figure shown only as a reference price?
- Or should Paystack/Flutterwave be used only for customers paying in their local currency, with Stripe handling USD payments separately?
- This affects which gateway integration work happens first, so we need an answer before starting payment work.

## 4. Inspection Tokens

- Please confirm: is the token system already live in the InspectAfrica App today (used for booking inspections), or is this something new we're introducing alongside the LMS work?
- Confirming the crediting rule: 20 tokens are credited once, when membership is first activated (not on every renewal) — correct?
- 50 additional tokens are credited once, when the Launch Package is completed — correct?

## 5. Offline payment / redemption codes

- When an organization (corporate, government, university, NGO) pays offline, how should the admin confirm payment before issuing a code — a manual step in the dashboard, an email process, something else?
- Is each redemption code single-use (one person per code), or can one code be redeemed multiple times for bulk/group enrollment?

## 6. Badges & certificates

- Please send a mapping of the badge/certificate design files to the actual course names — the files themselves are graphics only, with no labels we can match to specific courses.
- For certificates: which fields need to be filled in per person (name, ACHI number, date issued, etc.)?
- File formats: can you confirm the badge graphics are usable as-is for display inside the App (PNG/SVG), and the certificates are usable for PDF generation?

## 7. Testing

- Please provide one test candidate (name + email) we can run through the **complete** flow: register → buy membership → complete all courses → pass final assessment → buy Launch Package → certificate + badge issued → log into the App → confirm everything displays correctly. (The test account in your document is for membership testing — we need a separate one that can go all the way through to certification.)

---

Once we have these, we can move ahead with building the membership, eligibility, and certification-issuance flow to match your spec.
