# Bookin 5 — MRU study room finder (MCP server)

An MCP (Model Context Protocol) server that lets an AI assistant such as Claude Desktop find free **MRU Library group study rooms** and open the room's **Book Now** page in your own browser. Ask *"Find a room for 4 people tomorrow between 1 and 5 for 2 hours"*, pick a result, and the assistant opens the library page for that room and date. You sign in with your MRU account and finish the booking there.

**This server never books, never signs in and never sees your MRU password.** It only reads the library's public availability, at most one request per second.

Team **Bus Error** (COMP 2633): Liam K, Liam M, Robel A, Harper K.

---

## Install (macOS or Windows)

You need [Node.js 20 or newer](https://nodejs.org/) and [Claude Desktop](https://claude.ai/download).

1. Download this repository (green **Code** button → *Download ZIP*, then unzip it), or `git clone` it.
2. Open a terminal in the folder and run:

   ```bash
   npm install
   ```

   This also builds the server into `dist/`.
3. In Claude Desktop, open **Settings → Developer → Edit Config**. Add the server to `claude_desktop_config.json`, using the full path to this folder:

   macOS:
   ```json
   {
     "mcpServers": {
       "mru-rooms": {
         "command": "node",
         "args": ["/Users/you/COMP-2633-Bookin5/dist/mcp.js"]
       }
     }
   }
   ```

   Windows (note the doubled backslashes):
   ```json
   {
     "mcpServers": {
       "mru-rooms": {
         "command": "node",
         "args": ["C:\\Users\\you\\COMP-2633-Bookin5\\dist\\mcp.js"]
       }
     }
   }
   ```
4. Quit and reopen Claude Desktop. The `mru-rooms` tools appear under the tools (🔨) icon.

## Use it

Just ask in plain words, for example:

- "Find a room for 4 people tomorrow between 1 and 5 pm for 2 hours, then open it."
- "Is there an accessible room with video conferencing free Friday at 10?"
- "When is 1-B next free for an hour?"
- "Remember that we're usually 4 people, and that 1-B and 2-F are my favourites."

When the Book Now page opens, sign in with your MRU account and select the time the assistant suggested.

### Rules the server checks first

- Times are Calgary local time, on the half hour.
- Bookings are 30 to 120 minutes long, from now up to 7 days ahead.
- The room must be open (the 2nd & 3rd floor and hybrid rooms keep shorter hours than the 1st floor).

If a request breaks a rule, you get a short explanation instead of a room.

## Tools

| Tool | What it does |
|---|---|
| `list_rooms` | Every bookable group room: id, name (floor and room number), grouping, capacity, amenities, favourite flag. |
| `get_availability` | One room's bookable hours and free windows on a date. |
| `search_rooms` | Rooms free for a booking in a time window, best match first (earliest start, then smallest room that fits), plus the nearest alternatives. Filters: floor/hybrid category, accessible, power, video conferencing, favourites only. Party size defaults to your saved one. |
| `next_free_slot` | The first free slot for one room, up to 7 days ahead. |
| `open_booking_page` | Opens the room's Book Now page on the library site, on the chosen date, in your default browser. If no browser opens, it returns the link. |
| `get_settings` / `update_settings` | Your default party size and favourite rooms, saved in `~/.bookin5/settings.json` (set `BOOKIN5_SETTINGS` to use another path). |

Errors come back as a clear message with a code instead of a crash:

- `POLICY_VIOLATION`: the request broke a rule above.
- `LIBRARY_UNAVAILABLE`: the library site is down, blocked or slow.
- `LIBRARY_FORMAT_CHANGED`: the site changed and the server needs an update.

## How it works

```
Student ─▶ AI assistant (MCP client) ─stdio─▶ Tool layer        src/mcp.ts, src/settings.ts
                                              Search service    src/search/   (rules, filtering, ranking)
                                              Library adapter   src/adapter/libcal/ ─▶ librarycal.mtroyal.ca
                                                    └── Book Now link ─▶ student's browser (MRU sign-in + booking)
```

- **Adapter** (`src/adapter/libcal/`). One `POST /spaces/availability/grid` returns every room's 30-minute slots for a day: a slot with a class is taken, and a missing slot means the room is closed. That single read answers a whole search, a full-day view or one day of a next-free scan, and it is reused for 60 seconds. Room names, capacities and amenities come from `rooms.ts`, a snapshot of each `/space/{id}` page. A room the snapshot lacks is read live once. Rooms marked "temporarily unavailable" are skipped. Requests are serialised, spaced 1 second apart and time out after 10 seconds.
- **Search service** (`src/search/`). Pure logic tested with fake adapters: `policy.ts` holds the rules and `search-service.ts` does matching, ranking, alternatives, the room list, the day view and the next-free scan.
- **Tool layer** (`src/mcp.ts`). The official MCP TypeScript SDK with Zod input schemas, and the `open` package to launch the default browser.

## Develop

```bash
npm install          # install and build
npm run typecheck
npm test             # offline unit tests (fake adapters + captured LibCal fixtures)
LIVE=1 npm run test:live   # read-only checks against the real site (PowerShell: $env:LIVE="1"; npm run test:live)
npx @modelcontextprotocol/inspector node dist/mcp.js   # try the tools in the MCP Inspector
```

After changing `src/`, run `npm run build` and restart Claude Desktop.

**Refreshing the room snapshot.** If the library renames, resizes or adds rooms, regenerate `src/adapter/libcal/rooms.ts` from the `/space/{id}` pages (see `parseSpacePage`). New rooms still work without a refresh, at the cost of one extra request each per server start.

**Assumption to confirm with the library:** the 120-minute maximum booking length (`maxDurationMinutes` in `src/search/policy.ts`). The 7-day horizon is our own rule.

## Project documents

- Sprint 2 report: [docs/sprint-2.md](docs/sprint-2.md)
