# DDS Project Defense — Battle Plan

## 1. The Problem (frame it this way)

> "When someone dies, the information about that death exists immediately —
> but it doesn't become *intelligence* immediately. By the time district and
> national epidemiologists can see a pattern, an outbreak has already had
> days or weeks to spread. The gap is not in recording deaths — it's in the
> **latency between a death occurring and that death becoming actionable
> information** for the people who respond to it."

Why this framing survives questioning:

- It is a *coordination and speed* problem, not a competence problem — you
  can't be challenged on "the system is broken" or "staff do a bad job".
- It is measurable: you can point at a rolling time window and ask "how many
  deaths in this district in this category, and who knew, and when?"
- It invites no debate about whether deaths are recorded — everyone agrees
  they are. The argument is about *when they become visible*.

If a panelist asks "but don't facilities already report deaths?" — answer:
*"Yes, and my system does not replace that. It shortens the distance between
the report and the response. Reporting and surveillance are different
functions — a report is a form; surveillance is what you can do with a
thousand forms."*

## 2. The Solution (one paragraph)

> "The Disease Detection System is a real-time mortality surveillance
> platform. Death notifications flow in from facility officers on web and
> mobile — including offline field capture that syncs later — and the system
> continuously aggregates, forecasts, and scans them for anomalies. It
> answers three questions for public health decision-makers: **how many
> deaths are coming** (prediction), **is something abnormal happening right
> now** (outbreak detection), and **what is killing people** (cause-of-death
> pattern analysis)."

## 3. System Objectives (memorize verbatim)

1. **Predict mortality trends** — forecast expected deaths per period,
   overall, per cause category, and per district, with confidence ranges.
2. **Detect outbreaks early** — statistical alerting on five layers:
   threshold clusters, low-volume early warnings (Poisson CUSUM), instant
   MPDSR alerts for maternal/perinatal deaths, a community-signal layer
   that aggregates field signals and public USSD/WhatsApp reports — **and
   a syndromic layer** that pools facility/lab case counts (REST or FHIR)
   into alerts *before* a death is notified.
3. **Identify cause-of-death patterns** — ICD-10 coding from preliminary
   report through autopsy-verified final cause; category, geographic and
   temporal breakdowns.

## 4. Demo Guide (rehearse this exact walkthrough)

| Step | Where | What you say | What it proves |
|---|---|---|---|
| 1 | Sign-in | "Role-based access — analysts, officers, pathologists, executives each see a different system." | Security, RBAC |
| 2 | Dashboard | "Live KPIs — deaths in the last 7 days, pending reviews, active alerts." | Real-time data |
| 3 | New notification | "A facility officer enters a death — ICD-10 coded at capture." | Data entry + coding |
| 4 | Alerts page | "Within minutes the outbreak engine has scanned every notification in a rolling window. Threshold clusters, CUSUM early warnings and community-signal clusters appear here, pushed to the bell in real time." | **Objective 2** |
| 5 | Predictions page | "Forecast per category and per district, with confidence ranges — seasonal model when history allows." | **Objective 1** |
| 6 | Analytics/map | "Deaths by category and district — pattern identification at a glance." | **Objective 3** |
| 7 | Autopsy | "Final cause verified by a pathologist or certifying medical officer — and once finalized, the verified cause replaces the preliminary one everywhere, including detection and prediction." | Data quality |
| 8 | Audit | "Every action is logged — who did what, when." | Accountability |

Rule: never click around hunting. Each click answers "how does this meet an
objective?" — if a click doesn't, skip it.

## 5. Architecture & Tooling (30-second version)

- **Client**: React + TypeScript + Vite (web), Flutter (mobile, offline-first
  with encrypted local queue).
- **API**: Node.js + Express, PostgreSQL (hosted on Supabase), stateful JWT
  sessions, Argon2id password hashing, role-based authorization, audit log.
- **Analytics**: Python FastAPI microservice — scikit-learn for spatial
  clustering (DBSCAN/haversine), seasonal+linear regression forecasting with
  confidence bands, Poisson CUSUM for low-volume anomaly detection. The API
  keeps working with a Node fallback if the service is down — resilience by
  design.
- **Interop**: DHIS2 data-set pull + push, OpenHIM middleware channel,
  WHO ICD API — designed to sit inside an existing health-information
  ecosystem, not beside it.

## 6. Anticipated Questions (drill these)

| Q | Short answer |
|---|---|
| "Why not just use DHIS2 alone?" | "DHIS2 aggregates — it does not do per-case autopsy verification, real-time anomaly detection, or offline field capture. DDS consumes DHIS2 as a partner, not a competitor." |
| "How do you handle privacy of the deceased?" | "Role-based access, facility scoping, audit trail, Argon2id credentials, session expiry, encrypted mobile storage." |
| "What if the Python service dies?" | "Every ML endpoint has a Node fallback — detection and prediction degrade gracefully, never vanish." |
| "Can it scale nationally?" | "Aggregates are SQL + cached; imports are bounded and idempotent; the detection loop is coalesced and scheduled." |
| "Does it only detect outbreaks after deaths?" | "No — two pre-mortality layers. A community-signal pass aggregates field signals and public USSD/WhatsApp reports per district; and a syndromic pass pools facility case counts arriving over REST or FHIR — a district crossing ten reported cases of a syndrome in a week raises an early-warning alert with zero deaths on file." |
| "What about deaths reported late?" | "The detector windows on when the system *learned* of the death, not only when it occurred — a backdated notification still counts, and the late count is recorded on the alert." |
| "Won't old alerts hide a second wave?" | "No — outbreak and early-warning alerts auto-resolve after a configurable age (default 14 days), so a renewed cluster re-alerts. MPDSR alerts are exempt; they always need human review." |
| "What's novel vs. a spreadsheet?" | "Real-time statistical surveillance, verified cause-of-death pipelines, offline field capture — a spreadsheet does none of these on its own." |
| "Limitations?" | "Honest answer: forecast intervals are approximate residual bands, and real deployment needs production SMTP/DHIS2 credentials. Name the limitation before they do — it builds trust." |

## 7. Delivery Coaching

- **Structure every answer**: claim → evidence in the system → why it matters.
- **Never say "just"**: "it's *just* a web app" kills defenses. It's *a
  real-time surveillance platform*.
- **Silence is fine**: pause 2 seconds before answering; it reads as
  confidence.
- **Don't bluff**: "I haven't implemented X yet — the design leaves room for
  it via Y" beats a wrong answer every time.
- **End on strength**: last word should be about real-time detection —
  that is the system's sharpest edge.
