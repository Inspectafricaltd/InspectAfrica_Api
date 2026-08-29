# InspectAfrica LMS & Certification — Administrator Guide

**Who this is for:** InspectAfrica staff and whoever manages `inspectafrica.org` day to day. No coding knowledge needed — this covers what to click, what each setting means, and what happens automatically behind the scenes.

**Not covered here:** how the App (the mobile/PWA inspection tool) is built, or the underlying code. This is about running the LMS and certification side of things.

---

## 1. The big picture

Here's the whole journey, start to finish:

1. A candidate registers on the website and enrolls in the ACHI training courses.
2. They work through the courses — lessons, then quizzes.
3. Once they've **passed every course that's been marked as "required for certification"**, the system automatically:
   - Generates their unique **ACHI number** (format `ACHI-2026-00001`)
   - Promotes their account to "Certified"
   - Emails them a **personalized certificate** (their name and ACHI number stamped onto your certificate design) as a file attachment
   - Notifies the InspectAfrica App backend, so their certified status shows up there too
4. Anyone can later verify that ACHI number is real and active — the App does this automatically when a certified inspector's profile is checked.

None of step 3 requires a staff member to do anything manually. It's fully automatic, the moment a candidate finishes the required courses.

---

## 2. Managing courses (LearnPress)

Courses themselves are managed the normal LearnPress way — **WP Admin → LearnPress → Courses**. Nothing about creating a course, adding lessons, or building curriculum is different because of the certification system. The certification plugin only watches for course completions; it doesn't change how you build course content.

### 2.1 Adding a course to the certification requirement

Creating a course does **not** automatically make it "count" toward ACHI certification. A course only counts if its ID is added to the **Required Courses** list (see [Section 3.3](#33-required-courses-for-certification)). This is deliberate — it means you can have other, unrelated courses on the site (electives, previews, anything) that don't affect certification at all.

**To find a course's ID:** open the course for editing in wp-admin — the ID is in the URL (`post.php?post=1234&action=edit` → the ID is `1234`), or hover over the course title in the course list and check the link at the bottom of the browser.

### 2.2 Quizzes and passing grades — two separate settings, easy to mix up

There are **two different "pass" thresholds** in play, and both matter:

1. **Each individual quiz has its own passing grade.** This is set when you create the quiz itself (inside the course, under the quiz's own settings). A student either passes or fails *that specific quiz* based on this number.
2. **The course overall has a passing condition** — a percentage of quizzes that must be passed for the *course* to count as passed. For example, at 80%, a student needs to pass 8 out of 10 quizzes in a course to pass the course — not necessarily every single one.

**Important:** setting the course-level percentage does nothing on its own if the individual quizzes don't have their own passing grades set. Both need to be configured for evaluation to work correctly.

### 2.3 Bulk-setting the course-level passing grade

Rather than opening all 27 courses one by one, the bridge plugin has a bulk tool for this — see [Section 3.4](#34-apply-evaluation-settings).

---

## 3. The InspectAfrica Bridge plugin — Settings tab

Find this at **WP Admin → InspectAfrica → Settings**. Here's what every field does.

### 3.1 API Key

This is the secret key that lets *other systems* (the browser-based test tool, or anyone calling the site's API directly) prove they're allowed to talk to this site. It's hidden by default — click **Show** to reveal it, **Regenerate** to issue a brand new one (this immediately invalidates the old one everywhere it's used).

**Treat this like a password.** Anyone with this key can pull certificate data from the site. Don't paste it into chat messages, screenshots, or anywhere public. If you ever suspect it's been exposed, click Regenerate immediately.

### 3.2 Fastify API Base URL

This is the address of the InspectAfrica App's backend server — where certificate updates get sent whenever someone is issued, suspended, or their certificate expires. This should already be correctly configured (`https://api.inspectafrica.org/api/v1/wordpress`) and shouldn't need changing unless the App's backend moves to a new address.

### 3.3 Required Courses for Certification

**This is the most important setting in the whole plugin.** It's a list of course IDs (comma-separated), and it defines exactly which courses a candidate must pass to become ACHI certified.

- Click **Preview titles** after saving to see the actual course names next to their IDs — a quick way to confirm you've got the right ones listed, not just a list of numbers.
- To add a course to the requirement: add its ID to the list (comma-separated), then click **Save Settings** at the bottom of the page.
- To remove a course from the requirement (e.g. it's being retired, or made elective instead): delete its ID from the list, then save.

**What happens if you change this list:** it only affects *new* certifications going forward. It does not retroactively certify or de-certify anyone who's already been through the process.

### 3.4 Apply Evaluation Settings

This bulk-applies a passing grade to **every course currently in the Required Courses list** at once, so you don't have to open each course individually. Enter the percentage (default 80%) and click **Apply to required courses**.

This sets each course to require passing that percentage of its quizzes. It does **not** set individual quiz passing grades — that's still done per-quiz, inside each quiz's own settings (see [2.2](#22-quizzes-and-passing-grades--two-separate-settings-easy-to-mix-up)).

This button acts immediately — it is *not* part of the "Save Settings" button at the bottom of the page.

### 3.5 Apply Course Price

Bulk-sets the price on every course in the Required Courses list. Enter `0` and click Apply to make all required courses free (this changes the "Add to Cart" button to "Enroll Now" automatically). Also acts immediately, independent of "Save Settings."

### 3.6 Auto Sync

When checked, the system runs a daily automatic check for anyone who's completed all required courses but somehow didn't get certified in real time (this is a safety net, not the main mechanism — certification normally happens instantly the moment someone finishes their last required course).

### 3.7 Rate Limiting

Controls how many verification requests (e.g. from the App checking a certificate) are allowed per time window before being temporarily blocked, as protection against abuse. The defaults (100 requests per hour) are sensible for normal use — you're unlikely to need to change these.

---

## 4. How ACHI certification actually works — the exact rules

- **Format:** `ACHI-YYYY-NNNNN` — the year of issuance, then a unique 5-digit number. Generated automatically, guaranteed unique.
- **Trigger:** the moment a candidate has passed *every single course* in the Required Courses list — no partial credit, no purchase step, nothing manual.
- **What happens automatically on certification:**
  1. ACHI number generated and saved
  2. Candidate's account role upgrades to "Certified"
  3. A personalized certificate (their name + ACHI number stamped on your certificate design) and the InspectAfrica badge are emailed to them
  4. Certificate valid for **1 year** from issue date
  5. The App backend is notified so their certified status appears there
- **Expiry warnings:** the system automatically emails a warning 30 days and again 7 days before a certificate expires.
- **Expiry:** once the 1-year mark passes, the certificate automatically moves to "Expired" status, the candidate's role drops back down, and they're emailed to let them know.

### Suspending or reinstating a certificate

Go to the **Inspectors** tab. Each certified inspector with an **Active** certificate has a **Suspend** button; each **Suspended** one has a **Reinstate** button. Both ask for confirmation before acting, and both take effect immediately:

- **Suspend** — downgrades the inspector's account role, sends them a suspension notice email, and notifies the App backend. Use this for misconduct or any case where certification needs to be revoked without waiting for natural expiry.
- **Reinstate** — restores the "Certified" role, sends a reinstatement email, and notifies the App backend.

Expired certificates don't show either button here — expiry is handled automatically by the system (see above) and isn't something to manually toggle back on from this screen.

---

## 5. Monitoring — the three dashboard tabs

**WP Admin → InspectAfrica** has three tabs beyond Settings:

### 5.1 Overview

At-a-glance counts: total certificates issued, how many are active, expired, or expiring within 30 days, plus API request volume over the last 7 days. Good for a quick health check.

### 5.2 Activity

A detailed log of every certificate-verification request that's hit the site (who checked what ACHI number, from what IP, whether it came back valid), plus a separate table showing whether certificate update notifications actually reached the InspectAfrica App successfully. Useful for troubleshooting — e.g. if someone says "my certificate isn't showing in the app," this tab shows whether the notification was actually sent and accepted.

### 5.3 Inspectors

A list of every certified inspector — their ACHI number, name, email, current status, expiry date, and how many times their certificate has been checked/verified. Filterable by status (Active / Expired / Suspended / Candidate). This is also where you suspend or reinstate a certificate — see [Section 4](#suspending-or-reinstating-a-certificate) above.

---

## 6. Quick reference / glossary

| Term | Meaning |
|---|---|
| **ACHI number** | The unique certification ID, format `ACHI-YYYY-NNNNN` |
| **Required Courses list** | The plugin setting defining which courses must be passed to get certified |
| **Evaluation mode** | How LearnPress decides if a course is passed — currently based on quiz results |
| **Course-level passing condition** | The % of a course's quizzes that must be passed for the course to count |
| **Per-quiz passing grade** | The score needed to pass one specific quiz — set on the quiz itself |
| **API Key** | The secret credential that authenticates requests into the site — keep private |
| **Fastify API Base URL** | The address of the App's backend, where certificate updates get sent |

---

## 7. What NOT to do

- **Don't share the API Key** anywhere outside trusted internal use.
- **Don't remove a course from the Required Courses list without knowing why it was there** — this changes what "counts" for every future candidate immediately.
- **Don't expect changes to the Required Courses list to retroactively affect anyone already certified** — it only governs new certifications going forward.
- **Don't assume "Apply Evaluation Settings" also sets per-quiz passing grades** — it only sets the course-level percentage; quizzes still need their own grades set individually.
