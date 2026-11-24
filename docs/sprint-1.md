# Sprint 1 — Bus Error

**Project:** MCP server that lets an AI assistant find MRU Library study rooms and open the Book Now page
**Sprint window:** November 23 – November 29 (due Sunday, November 29, 11:59 PM)
**Weight:** 3% of course grade (internal marks: 10)

## Team

| Member | Role |
|---|---|
| Liam K | Developer / Project Coordinator |
| Liam M | Developer / Project Coordinator |
| Robel A | Developer / Project Coordinator |
| Harper K | Security Engineer / Project Coordinator / Project Manager |

---|---|
| Liam K | Developer / Project Coordinator |
| Liam M | Developer / Project Coordinator |
| Robel A | Developer / Project Coordinator |
| Harper K | Security Engineer / Project Coordinator / Project Manager |

---

## 1. Sprint 1 goal

Move from the Week 1 plan to a working first version. Sprint 1 covers the **search service** and the **library site adapter**, the two bottom layers of the Week 1 architecture. Together they let the system find real, free MRU group rooms for a given date, time and group size.

We scoped Sprint 1 to these two layers on purpose: they carry the biggest risk (how the library site returns its data), and everything above them depends on them. The MCP tool layer, opening the Book Now page (FR4) and the settings file (FR10) are planned for later sprints.

## 2. Development progress summary

The system is a TypeScript project (Node 20+, per NFR5) in this repository. The adapter reads MRU's room-booking site (LibCal) and the search service turns that data into search results.

### Features implemented

| Area | What works | Where |
|---|---|---|
| Library site adapter | Live reads of the library's space search page: rooms free for the window (name, grouping, capacity) plus the library's nearest alternatives. Switched-off rooms are not listed. No caching. Rate-limited, time-limited requests. | `src/adapter/libcal/` |
| Response parsing | Turns the search page into rooms and offered time windows. Throws a clear error if the library's format changes. | `src/adapter/libcal/parse.ts` |
| Request validation | Rejects bad dates, times off the 30-minute grid, durations out of range, past times, dates beyond the booking horizon, and invalid party sizes, before any library request. | `src/search/policy.ts` |
| Search service | Finds group rooms that seat the party and are free for the whole window, smallest suitable room first. Pods are excluded. Optional filters for category (floor or hybrid) and for accessible, power and video-conferencing rooms. It also checks every start time in the 2 hours after the request and suggests the closest alternatives, never in the past. | `src/search/search-service.ts` |
| Tests | 48 offline unit tests, plus 2 live read-only tests against the real site (`npm run test:live` with `LIVE=1`). | `test/` |

### Verified against the live site

- Room 1-B (EL1136) is free 15:00–16:00 and from 20:00 on 23 November. The adapter returns exactly those windows from the captured data, and the live search page shows the same.
- The live test run found three real site quirks (below), which are now handled and covered by tests.

## 3. Requirement progress

IDs match the Week 1 System Analysis & Planning document.

| ID | Requirement | Priority / Size | Status | Notes |
|---|---|---|---|---|
| FR1 | List bookable rooms with name, location and capacity | Must / S | **In progress** | The adapter reads name, grouping (floor) and capacity. The `list_rooms` MCP tool is not built yet. |
| FR2 | Show a room's free time slots for a date | Must / M | **In progress** | The adapter returns free windows per room for a time window. The `get_availability` tool and full-day view are not built yet. |
| FR3 | Search all rooms by date, window, duration and group size | Must / M | **Complete** (service layer) | Capacity ≥ group size and free for the whole window. Verified against the live site. Not yet exposed as an MCP tool. |
| FR4 | Open the chosen room's Book Now page in the browser | Must / M | **Not started** | Sprint 2. |
| FR5 | Rank results best match first | Should / S | **Complete** | Smallest suitable capacity first; alternatives sorted by closeness to the requested start. |
| FR6 | Suggest nearest free alternatives | Should / S | **Complete** | Scans the 2 hours after the request; returns up to 5 alternatives, closest first, never in the past. |
| FR7 | Check library booking rules first | Should / M | **In progress** | 30-minute grid, min/max duration, past times, group size and the 7-day horizon (NFR6) are enforced. The 120-minute maximum is a placeholder until the library confirms it. |
| FR8 | Next free slot for a specific room | Could / S | **Not started** | |
| FR9 | Filter rooms by features | Could / S | **Complete** (pulled forward) | Accessible, power and video-conferencing filters, plus floor/hybrid category. The search page already lists features, so it cost very little. |
| FR10 | Save default group size and favourite rooms | Could / S | **Not started** | |

| ID | Non-functional requirement | Status |
|---|---|---|
| NFR3 | Clear errors when the site is down or changes | **In progress**: the client and parser throw clear `LibraryUnavailableError` / `LibraryFormatError` messages. To be checked through the tools once they exist. |
| NFR4 | Never ask for, store or send MRU credentials | **Met so far**: the adapter is read-only and never signs in. |
| NFR6 | Only allow queries up to 7 days ahead | **Complete**: enforced in `src/search/policy.ts`, tested at both edges. |

**Next to build (Sprint 2):** the MCP tool layer (`list_rooms`, `get_availability`, `search_rooms`) and FR4 `open_booking_page`, so the system can be used from Claude Desktop and the MCP Inspector.

### New requirements added this sprint

None. FR9 (a Could-Have) was pulled forward rather than added.

## 4. Development challenges

**a) Node.js was not installed on the development machine.**
- *Why it mattered:* nothing could be built or tested until it was.
- *What we did:* installed Node 26 with winget. The project targets Node 20 or newer (NFR5), and the tests pass on Node 20 and 26.

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

**g) Booking through our system would mean handling student credentials.**
- *Why it mattered:* the library offers no student booking API, and driving the sign-in flow ourselves would break NFR4.
- *What we did:* kept booking on the library site. FR4 opens the room's Book Now page in the student's own browser, where they sign in and finish the booking.

**h) The new test fixtures were never committed.**
- *Why it mattered:* after switching to the search page, the captured pages the tests read were left out of the commit, so `npm test` failed on `main`.
- *What we did:* recaptured the search pages from the live site for 24 November, pointed the fixture-specific assertions at rooms in the new capture, and committed the fixtures.

## 5. Sprint 1 demo plan

Demo video: **not yet recorded.** The script below follows the required *Graphical Interface → User Interaction → System Response* flow.

1. **Overview (1 min):** show the repository and the README plan; state the Sprint 1 goal.
2. **Code tour (1 min):** show the adapter (`src/adapter/libcal/`), the policy (`src/search/policy.ts`) and the search service (`src/search/search-service.ts`).
3. **Live search (2 min):** run a search for a real date and party size against the live site, and show the matches and suggested times. Run `$env:LIVE = "1"; npm run test:live` to show the live checks passing.
4. **Validation (1 min):** send an invalid request (for example 15:10 start) and show the policy message.
5. **Tests (30 sec):** run `npm test` and show the 48 passing tests.
6. **What's next (1 min):** explain FR4 and the MCP tool layer for Sprint 2.

**Gap to close before recording:** the course requires a graphical interface, and the current system has no interface beyond a terminal. Options: a minimal web page or a chat client connected to the MCP tools. This needs a decision before the demo is recorded.

## 6. Open questions

1. What are the library's real limits: maximum duration and per-student limit?
2. Which interface will the demo use: Claude Desktop or the MCP Inspector?

---

## D2L discussion board post (draft)

**Hackathon #2 – Week 2: Sprint 1 Development Update**

**Team Name:** Bus Error

**Team Members:** Liam K (Developer / Project Coordinator), Liam M (Developer / Project Coordinator), Robel A (Developer / Project Coordinator), Harper K (Security Engineer / Project Coordinator / Project Manager)

**Development Progress Summary:** For Sprint 1 we deliberately built the two bottom layers of our Week 1 architecture: the library site adapter and the search service. These carry our biggest risk, and the tool layer, browser hand-off and settings file all depend on them. The system reads live room availability from the MRU booking site and returns free group rooms for a date, time window and group size. It is read-only and never handles credentials.

**Features Implemented So Far:**
- Library site adapter: live, rate-limited, time-limited reads of the booking site's search page (rooms, floor, capacity, features, free windows)
- Parser that fails with a clear error if the site's format changes
- Booking-rule validation (30-minute grid, duration, past times, group size, 7-day horizon)
- Search service: matching by capacity and free time, best-fit ranking, nearest alternatives, feature and floor filters
- 48 unit tests and 2 live read-only tests against the real site

**Requirement Progress Update:**
- FR1 List rooms: In progress (adapter done; tool next)
- FR2 Room availability: In progress (adapter done; tool next)
- FR3 Search rooms: Complete (service layer)
- FR4 Open Book Now page: Not started (Sprint 2)
- FR5 Rank results: Complete
- FR6 Nearest alternatives: Complete
- FR7 Booking rules: In progress (max duration to confirm)
- FR8 Next free slot: Not started
- FR9 Feature filters: Complete (pulled forward)
- FR10 Saved settings: Not started

**New Requirements Added During This Sprint:** None.

**Development Challenges:** The site rejected requests without the expected referrer headers; the raw availability grid did not say which slots were free and needed 45 requests, so we switched to the library's own search page (one request); some rooms return error pages and are now skipped; a wrong room-count estimate and a rate-limiter bug were caught by tests; test fixtures were left out of a commit and had to be recaptured.

**Sprint 1 Demo Video:** [link to be added after recording; test in a private window with "Anyone with the link can view"]
