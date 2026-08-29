# InspectAfrica Standard™
## WordPress Bridge Plugin — Admin Dashboard UI Design Prompt
**Version:** 1.0 | **Surface:** WordPress Admin Plugin Page | **March 2026**

---

## Context

This is not a standalone app. It is a single admin page that lives inside
the WordPress admin panel at:
`inspectafrica.org/wp-admin/admin.php?page=inspectafrica-bridge`

It appears in the WordPress left sidebar under "InspectAfrica" as a menu item.
The person using it is Casper — the same sole operator who uses the main admin
console. He opens this page for three reasons:

1. Something is broken and he wants to know why
2. He wants to check the API is being used correctly
3. He needs to rotate an API key or update a setting

The WordPress admin context means the design must work within WordPress's
existing chrome — the WP admin sidebar is always present on the left,
the WP top bar is always present. The plugin page occupies the main content
area to the right of the sidebar.

It must look deliberately designed within that context — not fighting WordPress
styles, but clearly more polished than a default WP settings page.

---

## Design Constraints

- **Width:** Content area is approximately 960px (after WP sidebar at ~160px)
- **WordPress admin context:** WP top bar (#23282D dark) always present at top.
  WP sidebar always present on left. Plugin content fills the remaining area.
- **No custom nav:** This is one page with tabs — not a multi-page plugin.
- **Colour system:** Must harmonise with the InspectAfrica brand but
  acknowledge the WordPress admin environment. Use brand green `#0F4726`
  for primary actions and active states. WP admin uses `#2271B1` blue by
  default — override this for primary buttons within the plugin only.
- **Typography:** WordPress admin uses system fonts. The plugin page can
  introduce Inter via a scoped stylesheet — use Inter for all plugin content.

---

## The Four Tabs

The plugin dashboard has exactly four tabs.
They live in a horizontal tab strip below the plugin page title.

```
InspectAfrica Bridge Plugin                          v1.0.0

[Overview]  [API Activity]  [Inspectors]  [Settings]
```

---

## TAB 1: OVERVIEW

The default landing tab. Answers one question immediately:
**Is the connection between the LMS and the app working?**

### Connection Health Section

Three status cards in a row:

```
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│  LearnPress LMS     │  │  App API             │  │  Last Sync          │
│                     │  │                      │  │                     │
│  🟢 Connected       │  │  🟢 Active           │  │  3 minutes ago      │
│                     │  │                      │  │                     │
│  lp/v1 responding   │  │  Key: ia_live_***    │  │  ACHI-2026-00089    │
│  [Test connection]  │  │  [Rotate key]        │  │  verified           │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘
```

**Card states:**
- Green (`#059669`): healthy / active
- Amber (`#F59E0B`): degraded / warning
- Red (`#DC2626`): error / disconnected

Each card has a single action link at the bottom.
"Test connection" fires a live ping to LearnPress REST API and
updates the card state in real time. No page reload.

### 30-Day Activity Summary

Three metric tiles in a row:

```
Total Verifications    Successful     Failed / Blocked
      247                 241              6
  this month          97.6% success    2.4% blocked
```

Successful: green number. Failed: red. Totals: dark.

### Recent Verification Log

Compact table — last 10 verification requests:

| Time | ACHI Number | Result | Source |
|------|-------------|--------|--------|
| 14:32 today | ACHI-2026-00089 | ✓ Valid | PWA App |
| 14:31 today | ACHI-2026-00094 | ✓ Valid | PWA App |
| 11:05 today | ACHI-2026-00031 | ✗ Expired | PWA App |
| Yesterday | ACHI-2026-XXXXX | 🚫 Blocked | Unknown IP |

Result column:
- ✓ Valid — green text
- ✗ Invalid / Expired — amber text
- 🚫 Blocked — red text with tooltip: "Rate limit exceeded — IP blocked for 1hr"

"View full log →" link below table → Tab 2.

---

## TAB 2: API ACTIVITY

Full verification log. The audit trail.

### Filter bar (compact, single row):
`Result: [All ▼]` · `Date: [Last 7 days ▼]` · `Search ACHI number...`

### Full log table:

| Timestamp | ACHI Number | Inspector Name | Result | IP Address | Response Time |
|-----------|-------------|----------------|--------|------------|---------------|
| Mar 22 14:32:01 | ACHI-2026-00089 | Chidi Okonkwo | ✓ Valid | 102.xxx | 84ms |
| Mar 22 14:31:45 | ACHI-2026-00094 | Amina Bello | ✓ Valid | 102.xxx | 91ms |
| Mar 22 11:05:12 | ACHI-2026-00031 | — | ✗ Expired | 102.xxx | 76ms |
| Mar 21 09:14:58 | ACHI-2026-XXXXX | — | 🚫 Blocked | 41.xxx | — |

ACHI numbers in JetBrains Mono 12px.
Response times in muted text — Casper watches for anything above 300ms.
Blocked rows: `#FEF2F2` background tint, red left border.
Invalid/expired rows: `#FFFBEB` tint, amber left border.

**Pagination:** 25 rows per page.
**Export:** "Export CSV" — top right, ghost button.

### Blocked IPs summary (below table if any blocked):
Compact table: IP · Block reason · Block time · Attempts · `[Unblock]` action.
Only shown if active blocks exist. Hidden otherwise.

---

## TAB 3: INSPECTORS

A read-only mirror of inspector certification data as WordPress sees it.
Not for editing — editing happens in LearnPress user profiles.
This tab is for Casper to confirm what the bridge plugin actually knows
about each inspector, and to spot discrepancies between LMS data and
what the app is using.

### Inspector table:

| Inspector | ACHI Number | Status | Issued | Expires | App Verified |
|-----------|-------------|--------|--------|---------|--------------|
| Chidi Okonkwo | ACHI-2026-00089 | ✓ Certified | Jan 2026 | Jan 2028 | 3 hrs ago |
| Amina Bello | ACHI-2026-00094 | ✓ Certified | Mar 2026 | Mar 2028 | 1 day ago |
| Tunde Adeyemi | ACHI-2026-00102 | ✓ Certified | Feb 2026 | Dec 2027 | 5 days ago |
| Joseph Eze | ACHI-2025-00071 | ⚠ Expiring | Oct 2024 | Apr 2026 | 2 days ago |

Status column:
- ✓ Certified — green
- ⚠ Expiring (within 30 days) — amber, tooltip: "Expires in 12 days"
- ✗ Expired — red
- — Candidate — muted

"App Verified" column: when the app last successfully verified this
inspector's cert. Stale (>7 days) shows amber — means the app may be
serving a cached result.

**Search:** Top right — "Search inspector name or ACHI number..."
**"Refresh from LMS"** button — top right, ghost. Pulls fresh data from
LearnPress user meta and updates the plugin's local cache.

### Expiring certs alert (shown above table if any expiring within 30 days):
Amber strip:
"⚠  1 inspector certification expires within 30 days.
    Joseph Eze — ACHI-2025-00071 — expires April 14, 2026.
    Expiry warning emails have been sent (30-day and 7-day notices)."

---

## TAB 4: SETTINGS

Clean settings form. Not a sea of WordPress options — just what the plugin needs.

### API Key Management

```
┌─────────────────────────────────────────────────────────┐
│  Live API Key                                           │
│  ──────────────────────────────────────────────────     │
│  ia_live_••••••••••••••••••••••••••   [Show] [Copy]    │
│                                                         │
│  Created: January 15, 2026  ·  Last used: 3 mins ago   │
│                                                         │
│  [Rotate Key]  ← red ghost button                      │
│  Rotating generates a new key. The old key stops        │
│  working immediately. Update the app environment        │
│  variable before rotating.                              │
└─────────────────────────────────────────────────────────┘
```

### Rate Limiting

```
Max requests per IP per hour:   [100      ] (default: 100)
Block duration after exceeded:  [60       ] minutes
Max failed attempts before block: [10     ] attempts
```

Simple number inputs. "Save" applies immediately. Current values shown.

### Certificate Number Format

```
Format:  ACHI - [YYYY] - [XXXXX]
Preview: ACHI-2026-00089

Auto-increment counter:  247  [Reset counter — requires confirmation]
```

Counter is read-only except for reset (which requires typing "RESET" to confirm).

### Webhook Settings

```
App webhook URL:
[https://api.inspectafrica.org/api/v1/certs/webhook       ]

Events to send:
[✓] Certification completed
[✓] Certification expired
[✓] Inspector suspended
[ ] Certificate revoked (manual)

[Test Webhook]  ← sends a test payload, shows response inline
```

"Test Webhook" fires a test POST and shows the response below the button:
```
Response: 200 OK  ·  84ms
{"received": true, "event": "test"}
```
Or on failure:
```
Response: 503 Service Unavailable  ·  timeout after 5000ms
Check that the app API is running and the URL is correct.
```

### Save

Single "Save Settings" green button, full width of settings area.
Success toast: "Settings saved." — appears top right, fades after 3 seconds.

---

## Full Prompt for Design AI

```
SYSTEM CONTEXT

You are designing the admin dashboard for the InspectAfrica Bridge Plugin —
a custom WordPress plugin that connects the InspectAfrica LMS (LearnPress)
to the InspectAfrica PWA inspection app. This dashboard page lives inside
WordPress admin at /wp-admin/.

The user is Casper — sole operator, one person, no team.
He opens this page to check the connection is healthy, review API activity,
and manage settings. He is technically capable but not a developer.

═══════════════════════════════════════════════════
CONTEXT: WORDPRESS ADMIN ENVIRONMENT
═══════════════════════════════════════════════════
This page lives inside the WordPress admin interface.
The WordPress admin chrome is always visible:
  - Top admin bar (#23282D, 32px height) — standard WordPress
  - Left sidebar (~160px) — standard WordPress menu
    with "InspectAfrica" menu item active, highlighted green
  - Plugin content fills the remaining area (~960px wide)

The plugin content area must look polished and intentionally designed
compared to default WordPress settings pages — but it must not clash
with the WordPress admin chrome. It sits inside it, not above it.

The plugin content area has:
  - White background (#FFFFFF)
  - Standard WordPress admin page wrapper padding (20px)

═══════════════════════════════════════════════════
COLOUR SYSTEM — WITHIN PLUGIN CONTENT AREA
═══════════════════════════════════════════════════
Background (page):          #F7F7F5  (warm off-white for main bg)
Card / panel background:    #FFFFFF
Card border:                #E8E8E6
Divider:                    #F0F0EE

Brand primary:              #0F4726  (override WP default blue for buttons)
Brand hover:                #1A5C35
Brand pale:                 #EBF5EF

Text primary:               #111827
Text secondary:             #374151
Text muted:                 #6B7280
Monospace text:             #374151

Status — healthy/valid:     #059669  text · #ECFDF5  background
Status — warning/expiring:  #F59E0B  text · #FFFBEB  background
Status — error/blocked:     #DC2626  text · #FEF2F2  background
Status — inactive/muted:    #6B7280  text · #F9FAFB  background

Tab strip active:           #0F4726 bottom border 2px · #0F4726 text
Tab strip inactive:         #6B7280 text · no border

═══════════════════════════════════════════════════
TYPOGRAPHY
═══════════════════════════════════════════════════
Font: Inter (loaded by plugin stylesheet, scoped to plugin content)
Monospace: JetBrains Mono — ACHI numbers, API keys, IP addresses, timestamps

Plugin page title:   Inter 600  20px  #111827
Tab labels:          Inter 500  14px
Section heading:     Inter 600  14px  #111827  (small, not large)
Table header:        Inter 500  11px  #6B7280  UPPERCASE  letter-spacing 0.05em
Table cell primary:  Inter 400  13px  #111827
Table cell meta:     Inter 400  12px  #6B7280
Status text:         Inter 600  11px  UPPERCASE
Monospace values:    JetBrains Mono 400  12px
Setting labels:      Inter 500  13px  #374151
Setting inputs:      Inter 400  13px
Button text:         Inter 600  13px

═══════════════════════════════════════════════════
LAYOUT
═══════════════════════════════════════════════════
Content area width: ~960px (WP sidebar takes remaining space)
Plugin page header: plugin title left + version number muted right
Tab strip: directly below header, horizontal, border-bottom on strip
Tab content area: 20px padding, white background card panels

Cards: white · 8px radius · 1px border #E8E8E6 · 16px padding
Card gap: 16px
Stat tiles: 3-column grid · equal width
Table: full content width · no horizontal scroll if possible
Input fields: WP-style but with brand green focus ring

═══════════════════════════════════════════════════
COMPONENT DETAILS
═══════════════════════════════════════════════════

CONNECTION STATUS CARDS (Overview tab):
  3 cards in a row — equal width
  Each card: icon (20px) + status label + detail text + action link
  Healthy: green left border 3px
  Warning: amber left border 3px
  Error: red left border 3px
  Status dot: filled circle, 8px, colour matches state

METRIC TILES (Overview tab):
  3 tiles in a row — no borders, just numbers
  Large number: Inter 700 28px
  Label below: Inter 400 12px muted
  Trend note: Inter 400 12px, green or red

LOG TABLE ROWS:
  Blocked rows: #FEF2F2 background + red left border 3px
  Invalid/expired rows: #FFFBEB background + amber left border 3px
  Valid rows: standard white
  ACHI numbers always in JetBrains Mono

SETTINGS FORM:
  Each setting group in a white card
  Label above input (not inline)
  Help text below input in muted 12px
  WordPress-standard input height (32px) but with green focus ring

API KEY DISPLAY:
  Masked by default: "ia_live_••••••••••••••••"
  [Show] and [Copy] as small text buttons to the right
  Rotate button: red ghost — communicates danger/irreversibility

═══════════════════════════════════════════════════
WHAT TO AVOID
═══════════════════════════════════════════════════
❌ No full-width hero sections — this is a utility page inside WP admin
❌ No large illustrations or decorative elements
❌ No blue buttons — override WP default blue with brand green
❌ No sidebar navigation — tabs only
❌ No WordPress default grey boxes (.postbox style) — use clean cards instead
❌ No modal dialogs — inline confirmations only
❌ No pagination on the overview recent log (10 rows max, "View all" link)
❌ No colour-only status — always icon or text + colour
❌ Do not try to style the WordPress chrome (top bar, left sidebar)
   — only style the plugin content area

═══════════════════════════════════════════════════
SCREENS TO GENERATE
═══════════════════════════════════════════════════

Show the full browser at 1280px width. Include:
- WordPress admin top bar (#23282D) at top
- WordPress left sidebar with InspectAfrica menu item highlighted green
- Plugin content area filling the rest

Generate 4 screens — one per tab.

──────────────────────────────────────────────────
SCREEN 1: OVERVIEW TAB (active)
──────────────────────────────────────────────────
Plugin page title: "InspectAfrica Bridge Plugin"
Version badge right: "v1.0.0" — muted pill

Tabs: [Overview ← active] [API Activity] [Inspectors] [Settings]

Connection health — 3 cards:
Card 1 (green, healthy): "LearnPress LMS" · 🟢 Connected ·
  "lp/v1 responding · 98ms" · [Test connection]
Card 2 (green, healthy): "App API" · 🟢 Active ·
  "Key: ia_live_•••••3f2a" · Last used 3 mins ago · [Rotate key]
Card 3 (green): "Last Sync" · 3 minutes ago ·
  "ACHI-2026-00089 verified" · [View log]

30-day activity tiles:
Total: 247 · Successful: 241 (97.6%) · Failed/Blocked: 6 (2.4%)
241 in green, 6 in red.

Recent verification log (10 rows):
Show mix: 7 Valid (green) · 2 Expired (amber) · 1 Blocked (red with row tint)
Use real-looking ACHI numbers and timestamps.
"View full log →" link below table.

──────────────────────────────────────────────────
SCREEN 2: API ACTIVITY TAB
──────────────────────────────────────────────────
Same plugin chrome, "API Activity" tab active.

Filter bar: Result [All ▼] · Date [Last 7 days ▼] · Search input
Export CSV button (ghost) top right.

Full log table — 15 rows showing mix of:
Valid rows (white background)
1 Expired row (amber tint, left border)
1 Blocked row (red tint, left border) with IP shown as 41.xxx

Below table: pagination "Showing 1–25 of 247 verifications"

Blocked IPs section below table:
Amber card: "1 currently blocked IP"
Table: 41.xxx.xxx.xxx · "Rate limit exceeded" · Blocked 2hrs ago ·
  12 attempts · [Unblock] text button red

──────────────────────────────────────────────────
SCREEN 3: INSPECTORS TAB
──────────────────────────────────────────────────
"Inspectors" tab active.

Amber alert strip at top (because one cert is expiring):
"⚠  1 inspector certification expires within 30 days.
    Joseph Eze — ACHI-2025-00071 — expires April 14, 2026."

"Refresh from LMS" ghost button top right.
Search input right of it.

Inspector table (6 rows):
Chidi Okonkwo    · ACHI-2026-00089 · ✓ Certified · Jan 2026 · Jan 2028 · 3 hrs ago
Amina Bello      · ACHI-2026-00094 · ✓ Certified · Mar 2026 · Mar 2028 · 1 day ago
Tunde Adeyemi    · ACHI-2026-00102 · ✓ Certified · Feb 2026 · Dec 2027 · 5 days ago
Emeka Okonkwo    · ACHI-2026-00118 · ✓ Certified · Jun 2026 · Feb 2028 · 2 days ago
Joseph Eze       · ACHI-2025-00071 · ⚠ Expiring  · Oct 2024 · Apr 2026 · 2 days ago
Fatima Aliyu     · Pending         · — Candidate · —        · —        · Never

Joseph Eze row: amber text, amber left border, #FFFBEB tint.
Cert Expiry for Joseph: "Apr 14, 2026" in amber bold.

──────────────────────────────────────────────────
SCREEN 4: SETTINGS TAB
──────────────────────────────────────────────────
"Settings" tab active.

Three settings cards stacked:

CARD 1: API Key Management
  "Live API Key" section heading
  Masked key: ia_live_••••••••••••••••••••••3f2a
  [Show] [Copy] small text buttons inline
  "Created: January 15, 2026 · Last used: 3 minutes ago"
  [Rotate Key] — red ghost button below
  Warning text: "Rotating generates a new key immediately.
  Update the app API before rotating."

CARD 2: Rate Limiting
  3 labelled number inputs:
  "Max requests per IP per hour" — value: 100
  "Block duration (minutes)" — value: 60
  "Max failed attempts before block" — value: 10

CARD 3: Webhook
  "App Webhook URL" — input with value: https://api.inspectafrica.org/api/v1/certs/webhook
  Checkbox list:
  ✓ Certification completed
  ✓ Certification expired
  ✓ Inspector suspended
  ☐ Certificate revoked
  [Test Webhook] ghost button below checkboxes
  Show test response inline below the button:
  "Response: 200 OK · 84ms · {"received": true, "event": "test"}"
  (green text, monospace)

"Save Settings" — full-width green button at bottom.

═══════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════
1280px browser viewport.
Show full browser including WordPress admin chrome (don't design the WP
chrome — just show it as the grey/dark context it provides).
Label each screen by tab name.
After all screens: component inventory for the plugin page only.
```

---

## Iteration Notes

1. **WordPress chrome** — the model may try to redesign the WP sidebar.
   It should not. The WP chrome is context, not canvas.

2. **The tab strip** — must look like it belongs in a polished admin page,
   not like default WP tabs. The active tab indicator is a 2px green
   bottom border, not a box or a raised tab.

3. **Connection health cards** — the coloured left borders are the primary
   status signal. If the model uses only coloured icons or only background
   tints, the hierarchy is weaker. Border + label + icon = three layers
   of redundancy. All three matter.

4. **The API key** — always masked by default. The [Show] button is small
   and inline, not a large call to action. The [Rotate Key] button being
   red communicates irreversibility without a wall of warning text.

5. **Blocked IP table** — should only appear if blocks exist. If the
   model shows it on the clean overview, it means it didn't read the
   conditional rendering note.

6. **The webhook test response** — should appear inline, below the
   button, in monospace. Not a modal. Not a toast. Inline.

---

*Single plugin page. Four tabs. One user. Done.*
