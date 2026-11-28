# Sprint 2 — Bus Error

**Project:** MCP server that lets an AI assistant find MRU Library study rooms and open the Book Now page

## Team

| Member | Role |
|---|---|
| Liam K | Developer / Project Coordinator |
| Liam M | Developer / Project Coordinator |
| Robel A | Developer / Project Coordinator |
| Harper K | Security Engineer / Project Coordinator / Developer |

## 1. Sprint 2 goal

Build the top layer of the Week 1 architecture: the MCP tool layer and the settings file, plus the browser hand-off (FR4). The goal is for a student to go from a request in Claude Desktop to the right room's Book Now page. This sprint also finishes the remaining Should and Could requirements.

## 2. Features implemented

| Area | What works | Where |
|---|---|---|
| MCP tool layer | Seven tools over stdio: `list_rooms`, `get_availability`, `search_rooms`, `next_free_slot`, `open_booking_page`, `get_settings`, `update_settings`. Zod input schemas. Every failure becomes a clear `isError` message with a code. | `src/mcp.ts` |
| Browser hand-off | Opens `librarycal.mtroyal.ca/space/{id}?date=…` in the default browser using the `open` package. It first checks that the site lists that room on that date, so it never opens the wrong room. If no browser opens, it returns the link. | `src/mcp.ts`, `client.ts` |
| Full-day availability adapter | One `POST /spaces/availability/grid` gives every room's slots for a day, including opening hours, and is reused for 60 s. Room details come from a snapshot of each room's page. Unknown rooms are read live once, and "temporarily unavailable" rooms are skipped. Rate limit raised to the plan's 1 request per second. | `src/adapter/libcal/` |
| Opening hours rule | A search outside every suitable room's bookable hours returns a rule error that names the hours. | `search-service.ts` |
| Room list, day view, next free | `listRooms`, `roomDay` and `nextFree`. The next-free scan reads one day at a time and stops at the first hit. | `search-service.ts` |
| Settings file | Default party size and favourite rooms in `~/.bookin5/settings.json`. Unknown keys are dropped, so it can never hold a password. | `src/settings.ts` |
| README | Install steps for Mac and Windows, the Claude Desktop config, usage and tools, replacing the old pre-Week-1 plan. | `README.md` |
| Tests | 65 offline unit tests and 2 live read-only tests, all passing. | `test/` |

## 3. Requirement progress

| ID | Requirement | Status | Notes |
|---|---|---|---|
| FR1 | List rooms | **Complete** | `list_rooms`: 29 group rooms (pods excluded, as in search), with floor/room number, capacity, amenities and favourite flag. |
| FR2 | A room's free slots for a date | **Complete** | `get_availability`: bookable hours plus free windows, past times dropped. |
| FR3 | Search by window, duration, group size | **Complete** | Now an MCP tool. Verified live through the stdio server. |
| FR4 | Open the Book Now page | **Complete** | `open_booking_page`; student signs in and books on the library site. |
| FR5 | Rank best match first | **Complete** | Earliest start, then smallest room that fits. |
| FR6 | Nearest alternatives | **Complete** | Now considers the whole day (from the grid), closest to the requested start, up to 5. |
| FR7 | Booking rules | **Complete** | Adds opening hours. The 120-minute maximum still needs confirming with the library. |
| FR8 | Next free slot for a room | **Complete** | `next_free_slot`, up to 7 days ahead. |
| FR9 | Filter by features | **Complete** | Unchanged from Sprint 1, now on the tool. |
| FR10 | Save group size and favourites | **Complete** | `search_rooms` uses the saved party size when none is given; `favouritesOnly` filter. |

| ID | Status | Evidence |
|---|---|---|
| NFR1 Performance | **Met** | 10 cold searches (4 people, 13:00–17:00, 2 h, over the next 7 days): 405, 119, 152, 129, 135, 129, 119, 117, 128, 124 ms. All under 5 s. |
| NFR2 Usability | **Ready to test** | One message to search, one to open the page. Classmate observation still to do. |
| NFR3 Reliability | **Met (unit level)** | Site down, blocked, slow or changed all return `LIBRARY_UNAVAILABLE` / `LIBRARY_FORMAT_CHANGED` through every tool. Failed reads are never cached. Not yet re-run by blocking the URL on a laptop. |
| NFR4 Security | **Met** | No tool input takes a password; the only hosts contacted are the public LibCal pages; the settings loader drops unknown keys. |
| NFR5 Compatibility | **Partly verified** | Runs on macOS with Node 20+. The Windows install from the README has not been tested yet. |
| NFR6 7-day horizon | **Met** | Applies to every tool that takes a date. |

## 4. Development challenges

**a) The Sprint 1 search page could not do a full-day view and was hiding rooms.**
- *Why it mattered:* FR2 and FR8 need a whole day or several days. The search page answers one window per request, so a search would need up to 9 requests, or about 9 s at the planned 1 request/s (NFR1). Cross-checking against the grid then showed the page caps results ("Showing 17 best matches"). At 19:00 on 30 November it left out four free group rooms, which appeared when we searched the 1st floor alone.
- *What we did:* moved back to the availability grid, which Sprint 1 had dropped. One read covers every room for a day. A room snapshot avoids the 45 page reads that made the grid slow in Sprint 1. We checked "a slot with a class is taken" against the search page: the 13:00–15:00 results matched exactly.

**b) Six rooms are listed but cannot be booked.**
- *Why it mattered:* the grid shows them all free, but their pages say "This resource is temporarily unavailable", so offering them would send students to a dead end.
- *What we did:* the snapshot records them as unavailable and they are skipped. A room whose page cannot be read at runtime is skipped too.

**c) The temporary Sprint 1 demo server lived only on a side branch.**
- *Why it mattered:* `dist/mcp.js` existed without its source on `main`, and the SDK was not listed in `package.json`, so a fresh install could not run it.
- *What we did:* wrote the real tool layer in `src/mcp.ts`, added the dependencies and a `prepare` build step, and deleted the temporary branch.

## 5. Open items

1. Confirm the library's real maximum booking length (currently 120 min).
2. Observe 3 classmates using it (NFR2), and install it on a Windows laptop (NFR5).
3. Re-snapshot `rooms.ts` if the library changes its rooms.
