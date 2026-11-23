# COMP-2633-Bookin5

An MCP (Model Context Protocol) server that lets an AI chat assistant book **MRU library group study rooms** for a student through natural conversation. Instead of clicking through the library calendar, a student says something like *"book a room for 3 people tomorrow at 2pm for an hour"* and the assistant checks availability, confirms the details, and reserves the room.

This document describes what we are building, how it will be implemented, how it will be hosted, and how we will know it works. It is a living plan: sections marked **Open question** need a decision before the work that depends on them starts.

---

## Table of contents

1. [Goals and non-goals](#1-goals-and-non-goals)
2. [Background: how MRU room booking works today](#2-background-how-mru-room-booking-works-today)
3. [User experience](#3-user-experience)
4. [System architecture](#4-system-architecture)
5. [MCP server design](#5-mcp-server-design)
6. [Booking backend: how we talk to the library system](#6-booking-backend-how-we-talk-to-the-library-system)
7. [Authentication and user identity](#7-authentication-and-user-identity)
8. [Tech stack](#8-tech-stack)
9. [Repository layout](#9-repository-layout)
10. [Hosting and deployment](#10-hosting-and-deployment)
11. [Security and privacy](#11-security-and-privacy)
12. [Testing strategy](#12-testing-strategy)
13. [Observability and operations](#13-observability-and-operations)
14. [Milestones](#14-milestones)
15. [Risks](#15-risks)
16. [Open questions](#16-open-questions)
17. [Getting started (developers)](#17-getting-started-developers)

---

## 1. Goals and non-goals

### Goals

- **Conversational booking.** A student can find, book, view, and cancel MRU group study rooms from any MCP-capable AI chat client without leaving the conversation.
- **Respect library policy.** The server enforces the same rules the library enforces (eligibility, booking windows, duration and capacity limits, cancellation rules). It must never book something the library website would refuse.
- **Safe by default.** The assistant never books or cancels without an explicit confirmation from the student, and never sees or stores a student's MyMRU password.
- **Easy to run.** A single container can run the server for a small group of students, and a student can also run it locally.

### Non-goals (for the first release)

- Booking individual study spaces, carrels, equipment, or non-library rooms. Only group rooms are in scope.
- Booking on behalf of someone else, or for people who are not MRU students, faculty, or staff.
- Replacing the library's own booking website. The website remains the source of truth and the fallback.
- Building our own chat interface. We rely on existing MCP-compatible clients.

---

## 2. Background: how MRU room booking works today

Facts we have confirmed from MRU's public pages:

- Group rooms are booked through the library's live space calendar at `librarycal.mtroyal.ca` (a LibCal instance), which lists group rooms alongside other bookable spaces.
- Only current MRU students, faculty, and staff can book a group room, and they sign in with their **MyMRU** username and password.
- If a group does not show up and the room stays empty during its booking, the booking is **forfeited** and the room becomes available to drop-in users for the rest of the booking window.

Facts we have **not yet confirmed** and must check before implementation (see [Open questions](#16-open-questions)):

- Room list, capacities, and which rooms are bookable online.
- Maximum booking length, how far ahead bookings can be made, and daily or weekly limits per student.
- Whether LibCal exposes a booking API that works for a signed-in student, or whether booking is only possible through the web UI.
- Check-in rules and the exact forfeit timer.

The authoritative sources are the library's own pages: the booking page at `library.mtroyal.ca/spaces/booking` and the Group Room FAQ at `libraryhelp.mtroyal.ca/faq/204484`.

---

## 3. User experience

### Example conversation

> **Student:** Can you book a group room for tomorrow afternoon for 3 people?
>
> **Assistant:** *(calls `find_rooms` with date = tomorrow, time window 12:00–18:00, party size 3)*
> I found 3 rooms free for 3 people tomorrow:
> - Room A (4 seats) — 1:00–2:00 pm, 2:00–3:00 pm, 3:00–4:00 pm
> - Room B (6 seats) — 2:00–3:00 pm, 4:00–5:00 pm
> - Room C (4 seats) — 1:00–3:00 pm
>
> Which would you like, and for how long?
>
> **Student:** Room A, 2pm for an hour.
>
> **Assistant:** To confirm: **Room A, 2:00–3:00 pm tomorrow, for 3 people, under your MRU account.** Shall I book it?
>
> **Student:** Yes.
>
> **Assistant:** *(calls `book_room`)* Booked. Confirmation **#123456**. Room A, 2:00–3:00 pm. Note that the room is forfeited if nobody checks in within the grace period set by the library.

### Interaction rules

1. **Search before booking.** The assistant always looks up availability first. It never guesses a room or time.
2. **Confirm before writing.** Booking, cancelling, or changing a booking requires a clear "yes" from the student after the assistant states the room, date, time, and party size.
3. **Say what the library says.** If the library refuses (for example, the limit is reached), the assistant reports the library's own message rather than a paraphrase.
4. **Fail toward the website.** If the server cannot complete a booking, it says so and gives the student the direct booking link instead of retrying blindly. Blind retries could double-book.

---

## 4. System architecture

```
┌──────────────────┐   MCP (stdio or HTTP)   ┌────────────────────────────┐   HTTPS / browser   ┌──────────────────────┐
│  AI chat client  │ ──────────────────────▶ │  MRU Room Booking MCP      │ ──────────────────▶ │  MRU LibCal          │
│  (MCP host, e.g. │ ◀────────────────────── │  server (this repo)        │ ◀────────────────── │  librarycal.mtroyal  │
│  MCP client)     │   tools / resources     │                            │                     │  .ca                 │
└──────────────────┘                         │  ├─ tool handlers          │                     └──────────────────────┘
                                             │  ├─ policy engine          │
                                             │  ├─ booking adapter        │
                                             │  ├─ auth / session store   │
                                             │  └─ audit log              │
                                             └────────────────────────────┘
```

### Components

| Component | Responsibility |
|---|---|
| **MCP transport layer** | Speaks the MCP protocol to the chat client. Uses stdio for a local install and Streamable HTTP for a hosted install. |
| **Tool handlers** | Thin functions that validate input, call the policy engine and booking adapter, and return structured results. |
| **Policy engine** | Pure logic with no network calls. Encodes library rules (booking window, max duration, party size vs. room capacity, slot alignment, per-student limits). Easy to unit-test. |
| **Booking adapter** | The only code that talks to MRU's library system. Hides whichever integration method we choose (see [section 6](#6-booking-backend-how-we-talk-to-the-library-system)) behind a small interface. |
| **Auth and session store** | Holds the student's authenticated session for the minimum time needed. Never stores the MyMRU password (see [section 7](#7-authentication-and-user-identity)). |
| **Audit log** | Append-only record of every write attempt (booking, cancellation) with timestamp, user, room, slot, and outcome. Contains no passwords or session tokens. |

Keeping the booking adapter separate is the most important structural decision. The library may change its website or API, and the rest of the server should not need to change when it does.

---

## 5. MCP server design

### Tools

Tools are the actions the assistant can take. All tools return structured JSON plus a short human-readable summary.

| Tool | Type | Inputs | Output |
|---|---|---|---|
| `list_rooms` | read | none | Bookable group rooms with name, capacity, and location. |
| `find_rooms` | read | `date`, `start_time`, `end_time`, `party_size`, optional `room_id` | Free slots that fit the party size and time window. |
| `check_eligibility` | read | none | Whether the signed-in student may book now, and their remaining booking allowance if the library reports one. |
| `list_my_bookings` | read | optional `include_past` | The student's upcoming (and optionally past) room bookings. |
| `book_room` | write | `room_id`, `date`, `start_time`, `end_time`, `party_size`, `confirmation_token` | Booking ID and confirmation details, or a library error message. |
| `cancel_booking` | write | `booking_id`, `confirmation_token` | Cancellation result. |

**`confirmation_token`:** a write tool does not run unless it receives a token that the server issued in a preview step (`book_room` with `dry_run` returns the preview and a token). The token is single-use and expires in a few minutes. This makes "the assistant forgot to ask" a server-enforced rule rather than a prompt instruction.

### Resources

Read-only context the client can pull in:

- `booking-policy://rules`: a plain-language summary of the current library rules, refreshed from the library's published pages. Helps the assistant explain *why* a request was refused.
- `booking-policy://hours`: library operating hours for group rooms.

### Prompts

One suggested prompt, `plan-study-session`, that walks the student through choosing a time and party size. Optional; it can be added after the core tools work.

### Error model

Every error has a stable `code` the assistant can reason about:

| Code | Meaning | Assistant behaviour |
|---|---|---|
| `NOT_AUTHENTICATED` | No valid student session. | Ask the student to sign in through the link returned by the server. |
| `NOT_ELIGIBLE` | Library refuses this student. | Explain using the library's message. |
| `SLOT_UNAVAILABLE` | Race: someone else booked it. | Re-run `find_rooms` and offer alternatives. |
| `POLICY_VIOLATION` | Our policy engine rejected the request before contacting the library (e.g., too long). | Explain the rule and suggest a valid option. |
| `LIBRARY_UNAVAILABLE` | Upstream error or timeout. | Say so; give the booking link; do not retry automatically. |
| `TOKEN_INVALID` | Confirmation token expired or already used. | Re-preview and ask again. |

---

## 6. Booking backend: how we talk to the library system

MRU's room calendar is LibCal. There are three ways to integrate. We will choose one after a short spike (see [milestone 0](#14-milestones)).

| Option | How it works | Pros | Cons |
|---|---|---|---|
| **A. Official LibCal API** | Use the Springshare LibCal REST API with OAuth. | Stable, documented, no scraping. | Usually issued to library staff for the library's own apps. A student-scoped booking may not be allowed. Needs library approval. |
| **B. Browser automation** | Drive the LibCal web flow with a headless browser (Playwright) as the signed-in student. | Works with whatever the website allows. | Fragile when the UI changes. Heavier to host. Must handle MyMRU login and MFA. |
| **C. Reverse-engineered internal endpoints** | Call the same HTTP endpoints the website's JavaScript calls. | Light and fast. | Undocumented, can break without notice, and may breach terms of use. **Not recommended** without written permission from the library. |

**Recommendation:** pursue **A** first by asking the library whether a student-scoped integration is possible. If not, build **B** behind the booking adapter so the rest of the server is unaffected. Do not build **C**.

Whatever option we pick:

- Every outgoing request is rate-limited and has a timeout (for example 10 seconds).
- Responses are validated against a schema before any tool returns them.
- We cache room lists and policy text for a short time (for example 10 minutes). We never cache availability for longer than a minute, because stale data causes double-bookings.

---

## 7. Authentication and user identity

Booking requires the student to be signed in as themselves. We must not become a way to borrow or harvest MyMRU credentials.

### Rules

1. **Never collect or store the MyMRU password** in the server, the repo, logs, or the chat transcript.
2. **The student signs in with MRU's own login page** (directly, or through the library system's sign-in flow) in a browser the student controls.
3. **The server keeps only a short-lived session** (cookie or OAuth token) tied to that student's MCP session. Sessions expire after a fixed idle period (for example 30 minutes) and are deleted on sign-out.
4. **Sessions are never shared** between students. A session is looked up by an opaque ID that the student's MCP client presents, and each tool call is checked against it.
5. **Logs redact** cookies, tokens, and anything that looks like a password.

### Flow (hosted mode)

1. The student's client calls any tool. The server responds with `NOT_AUTHENTICATED` and a sign-in URL.
2. The student opens the URL and signs in with MRU's login page.
3. The server receives the completed sign-in (OAuth callback, or a one-time code the student pastes back), binds it to the student's MCP session, and returns to normal operation.

### Local mode

A student running the server on their own machine signs in once through a local browser window. The session stays on that machine.

**Open question:** exactly which login mechanism LibCal/MyMRU exposes for this (see [section 16](#16-open-questions)).

---

## 8. Tech stack

| Area | Choice | Why |
|---|---|---|
| Language | **TypeScript on Node.js 22 LTS** | Official MCP SDK support, good typing for the structured tool schemas, strong Playwright support if we need browser automation. |
| MCP SDK | `@modelcontextprotocol/sdk` | Official SDK; supports stdio and Streamable HTTP transports. |
| Schema validation | `zod` | Shared between tool input schemas and runtime validation. |
| HTTP client | Built-in `fetch` with timeouts | No extra dependency for simple REST calls. |
| Browser automation (if needed) | `playwright` | Only if the booking adapter uses option B. |
| Tests | `vitest` | Fast, TypeScript-native. |
| Lint / format | `eslint` + `prettier` | Standard. |
| Packaging | Docker (multi-stage build, non-root user) | One artifact that runs the same locally and in hosting. |
| CI | GitHub Actions | Runs lint, type-check, tests, and builds the image on every push. |

If the team prefers Python, the same design works with the MCP Python SDK and `pydantic`. Pick one language before milestone 1 and do not mix them.

---

## 9. Repository layout

```
COMP-2633-Bookin5/
├── README.md                  # This document
├── package.json
├── tsconfig.json
├── Dockerfile
├── .github/workflows/ci.yml   # lint, type-check, test, image build
├── src/
│   ├── index.ts               # entry point; picks stdio or HTTP transport
│   ├── server.ts              # registers tools, resources, prompts
│   ├── tools/                 # one file per tool (list_rooms.ts, book_room.ts, ...)
│   ├── policy/                # pure rules: windows, limits, slot alignment
│   ├── booking/               # booking adapter interface + implementation(s)
│   ├── auth/                  # session store, sign-in flow, redaction
│   ├── audit/                 # append-only write log
│   └── config.ts              # env-var parsing and validation
├── test/
│   ├── policy/                # unit tests (no network)
│   ├── tools/                 # tool handler tests with a fake booking adapter
│   └── e2e/                   # optional: runs against a staging/test LibCal, if one exists
└── docs/
    ├── library-rules.md       # the rules we encoded, with links to MRU sources
    └── decisions/             # short ADRs for each major choice
```

---

## 10. Hosting and deployment

We will support two ways of running the server. They share the same code and image.

### Mode 1: local (stdio) — for individual students

- The student runs `npm start` (or the Docker image) and adds the server to their MCP client config.
- Transport: stdio. No public network exposure.
- Sign-in happens in a local browser window; the session never leaves the machine.
- Best for development, demos, and testing.

Example client config (illustrative; the exact file depends on the client):

```json
{
  "mcpServers": {
    "mru-room-booking": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": { "MRU_BOOKING_MODE": "stdio" }
    }
  }
}
```

### Mode 2: hosted (Streamable HTTP) — for a shared deployment

- The container runs behind HTTPS on a small managed container host (for example Azure Container Apps, Fly.io, or Render). We pick one after checking what the team has access to.
- Transport: Streamable HTTP on `/mcp`, served only over TLS.
- Configuration comes from environment variables, and secrets come from the host's secret store (never committed):

| Variable | Purpose |
|---|---|
| `MRU_BOOKING_MODE` | `stdio` or `http` |
| `PORT` | HTTP port (default 8080) |
| `PUBLIC_BASE_URL` | Public HTTPS origin, used to build sign-in callback links |
| `SESSION_SECRET` | Key for signing session IDs |
| `SESSION_IDLE_MINUTES` | Idle timeout (default 30) |
| `LIBRARY_BASE_URL` | Defaults to `https://librarycal.mtroyal.ca` |
| `AUDIT_LOG_PATH` | Where the write audit log is stored |
| `LOG_LEVEL` | `info` by default |

- **Storage:** sessions live in memory for a single instance. If we need more than one instance, move sessions to Redis or a managed key-value store. The audit log goes to a persistent volume or a database table.
- **Scaling:** one instance is enough for the expected load (a few dozen students at peak). Scale out only after measuring.
- **Deploy pipeline:** merge to `main` → CI runs → image is built and tagged with the commit SHA → deployed to a staging environment → manually promoted to production.
- **Rollback:** redeploy the previous image tag. Because writes are idempotent by confirmation token, a rollback never replays a booking.

### Environments

| Environment | Purpose | Booking target |
|---|---|---|
| `local` | Developer machines | Mocked booking adapter by default; real adapter only with explicit opt-in |
| `staging` | Pre-release testing | A test LibCal space, if the library provides one; otherwise a mock server |
| `production` | Real students | Real MRU LibCal |

**Important:** we do not run automated tests that create real bookings on the production calendar. Real bookings consume other students' rooms.

---

## 11. Security and privacy

- **No credentials in the repo.** `.env` is git-ignored. `.env.example` lists variable names with placeholder values only.
- **Least privilege.** The server only calls LibCal endpoints needed for the six tools. It does not browse arbitrary URLs.
- **Confirmation enforced by the server**, through single-use tokens (see [section 5](#5-mcp-server-design)).
- **Input validation.** Dates, times, and IDs are validated with `zod` before they reach the policy engine or the booking adapter. Times are checked against the library's slot grid.
- **Rate limits.** Per-student limits on write tools (for example, 5 write attempts per minute) to prevent runaway loops in a client.
- **Personal data minimisation.** We store the student's MRU user ID only for the duration of a session and for the audit record of their own bookings. We do not store names, emails, or chat transcripts.
- **Audit log access** is limited to the maintainers, and entries are kept for a fixed retention period (proposed: 90 days), then deleted.
- **Dependency hygiene.** Dependabot (or equivalent) is enabled, and the Docker base image is pinned and rebuilt on security updates.
- **Responsible use.** The server acts only for the signed-in student and only within library rules. Automated booking of rooms for resale, hoarding, or bypassing per-student limits is out of scope and will be refused by the policy engine.

---

## 12. Testing strategy

| Level | What it covers | Runs in CI? |
|---|---|---|
| **Unit: policy engine** | Booking window, duration, capacity, slot alignment, limit counting, edge cases around midnight and daylight-saving changes. | Yes |
| **Unit: tool handlers** | Input validation, error mapping, confirmation-token lifecycle (issued, used once, expired). Uses a fake booking adapter. | Yes |
| **Contract: booking adapter** | Recorded fixtures (saved, sanitised responses from LibCal) replayed against the adapter parser. Detects when the library changes its response format. | Yes |
| **Integration: auth flow** | Sign-in callback binds the session correctly; expired sessions are rejected; sessions are isolated between students. | Yes |
| **End-to-end: MCP client** | A test MCP client calls the real server over stdio against the mock adapter, runs a full find → preview → confirm → book → cancel flow. | Yes |
| **Staging smoke test** | Against the staging environment only, a manual checklist before each production release. | No (manual) |

### Definition of done for a tool

- Unit tests for the happy path and each documented error code.
- Input schema documented in the tool's description so the assistant can use it correctly.
- Appears in the end-to-end flow test.
- Audit entry written for every write attempt (including failed ones).

---

## 13. Observability and operations

- **Structured logs** (JSON) with a request ID per tool call. Logs never include passwords, cookies, or tokens.
- **Metrics** to track: tool call counts and latency, sign-in success/failure, booking success rate, `LIBRARY_UNAVAILABLE` rate. A dashboard is optional for the first release; logs alone are fine.
- **Alerts** (once hosted): error rate above 5% for 10 minutes, or no successful health check for 5 minutes.
- **Health endpoint** at `/healthz` that checks the server is up. It does **not** call LibCal, so a library outage does not mark our service unhealthy.
- **Runbook** in `docs/runbook.md` (to be written during milestone 4): how to rotate `SESSION_SECRET`, how to roll back, and what to do when the library changes its site.

---

## 14. Milestones

Each milestone ends with something that runs and can be demonstrated.

**Milestone 0 — Feasibility spike (about 1 week)**
- Read the library's Group Room FAQ and booking rules; record them in `docs/library-rules.md`.
- Inspect the LibCal booking flow as a signed-in student (manually, in a browser).
- Ask the library whether an API or student-scoped integration is possible. Record the answer.
- **Exit criterion:** the booking method (A, B, or C) is chosen and written up in `docs/decisions/0001-booking-backend.md`.

**Milestone 1 — Local read-only server**
- Project scaffold, CI, and Docker build.
- `list_rooms`, `find_rooms`, and `list_my_bookings` against recorded fixtures.
- Policy engine with unit tests.
- **Exit criterion:** An MCP client can list and find rooms over stdio.

**Milestone 2 — Booking with confirmation**
- `book_room` and `cancel_booking` with the preview → confirm token flow.
- Audit log.
- **Exit criterion:** end-to-end test passes against the mock adapter; manual test against staging passes.

**Milestone 3 — Authentication and hosted mode**
- Sign-in flow, session store, idle timeout.
- Streamable HTTP transport, Docker image, staging deployment.
- **Exit criterion:** two students can use the hosted server at the same time without seeing each other's bookings.

**Milestone 4 — Production readiness**
- Observability, alerts, runbook.
- Security review of the auth flow and the write path.
- Pilot with a small group of students; collect feedback and failure cases.
- **Exit criterion:** pilot runs for two weeks with no double-bookings and no unhandled errors.

---

## 15. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Library does not allow student-scoped booking through any API | Medium | High | Milestone 0 checks this early. Fallback is browser automation (B), or a read-only assistant that links to the booking page. |
| Library website changes and breaks the adapter | High | Medium | Adapter isolated behind one interface; contract tests with fixtures catch breakage; fallback to the booking link. |
| Double-booking from a race or retry | Medium | High | Confirmation tokens are single-use; no automatic retry on write failure; check availability right before writing. |
| Students share MyMRU credentials with the server | Low | High | Server never asks for passwords; sign-in happens on MRU's own page. |
| Terms of service forbid automated booking | Medium | High | Get written permission from the library before hosting for students. |
| Automated booking is used to hoard rooms | Medium | Medium | Per-student limits enforced in the policy engine; rate limits. |
| Session token leaked from logs | Low | High | Redaction tests; logs reviewed in milestone 4. |

---

## 16. Open questions

These must be answered before the milestone that depends on them.

1. **Booking method (Milestone 0).** Can a student book through a LibCal API, or only through the web UI? Who at the library can approve an integration?
2. **Sign-in mechanism.** Does LibCal use MyMRU SSO directly, and can our server receive a completed sign-in without seeing the password?
3. **Rules.** What are the exact maximum duration, booking window, per-student limit, party size per room, and check-in/forfeit timer?
4. **Permission.** Has the library been told about this project? Is hosting it for students allowed?
5. **Hosting.** Which platform does the team have access to (school account, personal account, or a free tier), and is there a budget?
6. **Language.** TypeScript (recommended here) or Python?
7. **Who uses it.** Only the project team for the course demo, or a real pilot with other students?

---

## 17. Getting started (developers)

> The project is in planning. These steps describe the target setup once milestone 1 lands.

Prerequisites: Node.js 22 LTS, npm, Docker (optional), and an MCP client for testing.

```powershell
# 1. Install dependencies
npm install

# 2. Copy the example environment file and fill in local values
Copy-Item .env.example .env

# 3. Run the test suite (no network calls, uses the mock booking adapter)
npm test

# 4. Start the server in local stdio mode
npm start
```

To run in Docker:

```powershell
docker build -t mru-room-booking .
docker run --rm -p 8080:8080 --env-file .env mru-room-booking
```

Never commit `.env`, real session secrets, or recorded fixtures that contain personal data. Sanitise fixtures before adding them to `test/`.

---

## Contributing

- Create a feature branch from `main`; open a pull request; CI must pass before merging.
- Record any significant design decision as a short file in `docs/decisions/`.
- Booking code changes need a passing end-to-end test against the mock adapter, and a note in the PR about any manual staging test performed.

## Status

Planning. No runtime code yet. The next step is Milestone 0, which needs answers to the questions in [section 16](#16-open-questions).
