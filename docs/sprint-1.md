# Sprint 1 — Bus Error

**Project:** MRU library group-room booking through an AI chat assistant (MCP server)
**Sprint window:** November 23 – November 29 (due Sunday, November 29, 11:59 PM)
**Weight:** 3% of course grade (internal marks: 10)

## Team

| Member | Role |
|---|---|
| Liam K | Developer / Project Coordinator |
| Liam M | Developer / Project Coordinator |
| Robel A | Developer / Project Coordinator |
| Harper K | Security Engineer / Project Coordinator / Project Manager |

---

## 1. Sprint 1 goal

Move from the Week 1 plan to a working first version. Sprint 1 covers the **search service** and the **library site adapter**, which together let the system find real, free MRU group rooms for a given date, time and party size.

Booking, cancellation, sign-in and the chat interface are planned for later sprints.

## 2. Development progress summary

The system is a TypeScript project (Node 22+) in this repository. The adapter reads MRU's room-booking site (LibCal) and the search service turns that data into search results.

### Features implemented

| Area | What works | Where |
|---|---|---|
| Library site adapter | Live reads of the library's space search page: rooms free for the window (name, grouping, capacity) plus the library's nearest alternatives. Switched-off rooms are not listed. No caching. Rate-limited, time-limited requests. | `src/adapter/libcal/` |
| Response parsing | Turns the search page into rooms and offered time windows. Throws a clear error if the library's format changes. | `src/adapter/libcal/parse.ts` |
| Request validation | Rejects bad dates, times off the 30-minute grid, durations out of range, past times, dates beyond the booking horizon, and invalid party sizes, before any library request. | `src/search/policy.ts` |
| Search service | Finds group rooms that seat the party and are free for the whole window, smallest suitable room first. Pods are excluded. Optional filters for category (floor or hybrid) and for accessible, power and video-conferencing rooms. It also checks every start time in the 2 hours after the request and suggests the closest alternatives, never in the past. | `src/search/search-service.ts` |
| Tests | 47 offline unit tests, plus 2 live read-only tests against the real site (`npm run test:live` with `LIVE=1`). | `test/` |

### Verified against the live site

- Room 1-B (EL1136) is free 15:00–16:00 and from 20:00 on 23 November. The adapter returns exactly those windows from the captured data, and the live search page shows the same.
- The live test run found three real site quirks (below), which are now handled and covered by tests.

## 3. Requirement progress

> **Note:** The official Week 1 requirement list was not in the repository. The rows below use the goals from the project README and must be matched to the Week 1 IDs before submission.

| ID | Requirement | Status | Notes |
|---|---|---|---|
| R1 | Find free group rooms by date, time and party size | **Complete** (search side) | Validated, matched, suggests alternatives. Verified against the live site. |
| R2 | Show which group rooms exist (name, capacity, location) | **Complete** (read side) | Adapter reads name, grouping and capacity. |
| R3 | Enforce library booking rules before contacting the library | **In progress** | Slot size, duration, past times and party size are enforced. The 120-minute maximum and 14-day horizon are placeholders until the library confirms them. |
| R4 | Book a room with a confirmation step | **Not started** | Next sprint. Needs the booking method decided (see open questions). |
| R5 | View and cancel my bookings | **Not started** | Next sprint. |
| R6 | Student sign-in via MyMRU, with no password stored by the system | **Not started** | Design is in the README (§7). Mechanism still to confirm with the library. |
| R7 | Conversational interface through an MCP chat client | **Not started** | The MCP tool layer is the next build step. |

**Next to build (Sprint 2 priority):** wire R1 and R2 into MCP tools so a chat client can call them, then start R4 (booking) with a confirmation step.

### New requirements added this sprint

None yet.

## 4. Development challenges

**a) Node.js was not installed on the development machine.**
- *Why it mattered:* nothing could be built or tested until it was.
- *What we did:* installed Node 26 with winget. The project targets Node 22 or newer.

**b) The library's availability endpoint rejects requests that don't look like they came from its own page.**
- *Why it mattered:* the first requests returned "Invalid Referrer" and no data.
- *What we did:* the adapter now sends the `Referer` and `Origin` headers the site expects.

**c) Nothing in the site's data says outright which slots are free.**
- *Why it mattered:* the search would be wrong if the meaning was guessed incorrectly.
- *What we did:* first we read the raw availability grid and inferred that a slot with a class is taken. That needed one extra request per room (45 in total) to get names and capacities and to spot switched-off rooms. We switched to the library's own search page, which answers a search in one request with exactly the rooms it would let a student book, so no inference or caching is needed.

**d) Some listed rooms cannot be read.**
- *Why it mattered:* one room returned an error page and another said "This resource is temporarily unavailable". The first version of the adapter failed the whole search when it hit either one.
- *What we did:* these rooms are now skipped, since they cannot be booked. Tests cover both cases.

**e) Our first estimate of the room count was wrong.**
- *Why it mattered:* a test expected 40 rooms and got 45. The test had been written from a count taken from a different date range.
- *What we did:* checked the captured data and corrected the expected values.

**f) A pacing bug delayed the first request.**
- *Why it mattered:* the adapter waited before its first request, which is wasteful and was caught only by a test.
- *What we did:* fixed the rate limiter so the wait applies only between requests.

**g) Booking method is still unknown.**
- *Why it matters:* booking (R4) depends on whether the library offers a student-scoped API or whether we must drive the web flow. The library has not been asked yet.
- *What we are doing:* listed as the first open question in the README; to be raised with the library.

## 5. Sprint 1 demo plan

Demo video: **not yet recorded.** The script below follows the required *Graphical Interface → User Interaction → System Response* flow.

1. **Overview (1 min):** show the repository and the README plan; state the Sprint 1 goal.
2. **Code tour (1 min):** show the adapter (`src/adapter/libcal/`), the policy (`src/search/policy.ts`) and the search service (`src/search/search-service.ts`).
3. **Live search (2 min):** run a search for a real date and party size against the live site, and show the matches and suggested times. Run `$env:LIVE = "1"; npm run test:live` to show the live checks passing.
4. **Validation (1 min):** send an invalid request (for example 15:10 start) and show the policy message.
5. **Tests (30 sec):** run `npm test` and show the 47 passing tests.
6. **What's next (1 min):** explain R4–R7 and the booking-method question.

**Gap to close before recording:** the course requires a graphical interface, and the current system has no interface beyond a terminal. Options: a minimal web page or a chat client connected to the MCP tools. This needs a decision before the demo is recorded.

## 6. Open questions

1. Can a student book through the library's API, or only through the web flow? (Blocks R4.)
2. What are the library's real limits: maximum duration, booking horizon, per-student limit?
3. Is there a permitted way to sign students in without the system ever seeing a password? (Blocks R6.)
4. Which chat client and interface will the demo use?

---

## D2L discussion board post (draft)

**Hackathon #2 – Week 2: Sprint 1 Development Update**

**Team Name:** Bus Error
**Team Members:** Liam K, Liam M, Robel A, Harper K

**Development progress summary:** We built the search service and the MRU library site adapter in TypeScript. The system reads real group-room availability from the library's booking site and returns free rooms for a date, time and party size. It is read-only; booking is next sprint.

**Features implemented so far:**
- Library site adapter (reads room availability and details; handles switched-off rooms)
- Request validation against library booking rules
- Search service with matching by capacity and free time, plus suggested alternatives
- 47 unit tests and 2 live read-only tests against the real site

**Requirement progress update:**
- R1 Find free group rooms: Complete (search side)
- R2 Show group rooms: Complete (read side)
- R3 Enforce booking rules: In progress (some limits still to confirm)
- R4 Book with confirmation: Not started (next sprint)
- R5 View and cancel bookings: Not started
- R6 MyMRU sign-in: Not started
- R7 Chat interface via MCP: Not started

**New requirements added this sprint:** None yet.

**Development challenges:** Node.js setup; the library rejects requests without the expected referrer header; inferring availability from the raw grid was slow and fragile, so the adapter now reads the library's own search page in one request; a pacing bug and a wrong room count were caught by tests.

**Sprint 1 demo video:** [link to be added after recording and testing in a private window]
