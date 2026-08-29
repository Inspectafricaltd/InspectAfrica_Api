# InspectAfrica LMS — Progress Update

Hi Casper,

Quick update on where the LMS/certification integration stands.

## What's done

- The full certification pipeline is built and confirmed working end-to-end: a candidate completing the required courses automatically generates their ACHI number, updates their WordPress role, and syncs to the App — verified with real test data, not just in theory.
- **Your certificate and badge designs are live.** Every certified inspector now automatically receives a personalized certificate (their name, ACHI number, and issue date merged onto your certificate artwork) attached to their certification email — no manual work on your end per candidate.
- The App's certificate verification (checking a candidate's ACHI number is valid, active, expired, etc.) is fully working, including graceful handling if the LMS is ever briefly unreachable.
- Admin tools for managing all of this — which courses count toward certification, quiz pass thresholds, pricing — are now built directly into the WordPress dashboard, not a separate technical tool.

## What's blocking further progress — this is on your side, not ours

We audited the 30 ACHI courses already on the site. Here's exactly where things stand:

**27 courses are complete with content. 3 are still empty drafts.** We need a decision on those 3 — should they be finished and added to the certification requirement, or left out?

**None of the 30 courses have any quiz questions yet.** This is the one thing actually stopping certification from going live for real students. The mechanism is fully built and tested — the moment quiz content exists, it takes one click to activate. Specifically, we need:
- The quiz questions and correct answers for each of the 27 complete courses
- Confirmation of the passing threshold — we've defaulted to 80% (a student must pass 80% of a course's quizzes to pass that course), but this should be confirmed as final
- Confirmation of the intended course order/sequence, if there is one (several course titles already reference module numbers, so this may already be mostly decided)
- **Final pricing for each course, in Naira** — the bulk pricing tool is built and ready to apply it the moment you confirm figures

Nothing else on our end is waiting on anything. Once quiz content lands, we can move straight to a full live test with a real candidate and have the whole thing verified within the same day.

Happy to hop on a call if it's easier to walk through the quiz content requirements together.

Mike
