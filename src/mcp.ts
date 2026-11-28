#!/usr/bin/env node
/*
 * MCP server over stdio. No tool takes or sends MRU credentials: the student
 * signs in on the library site in their own browser.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import open from "open";
import { z } from "zod";
import { LibCalClient } from "./adapter/libcal/client.js";
import { LibCalRoomSource } from "./adapter/libcal/libcal-room-source.js";
import { PolicyViolationError } from "./domain/errors.js";
import { localNow } from "./domain/time.js";
import { DEFAULT_SEARCH_POLICY } from "./search/policy.js";
import { SearchService } from "./search/search-service.js";
import { loadSettings, saveSettings, SETTINGS_PATH } from "./settings.js";

const source = new LibCalRoomSource(new LibCalClient());
const search = new SearchService(source);
const server = new McpServer({ name: "mru-rooms", version: "0.2.0" });

const RULES =
  "Times are Calgary local time (HH:mm, 24-hour) on a 30-minute grid; bookings are " +
  `${DEFAULT_SEARCH_POLICY.minDurationMinutes}-${DEFAULT_SEARCH_POLICY.maxDurationMinutes} minutes, ` +
  `from today up to ${DEFAULT_SEARCH_POLICY.maxDaysAhead} days ahead. ` +
  "The library allows each student 4 hours of bookings per day and 3 bookings per week.";
const date = z.string().describe("YYYY-MM-DD, Calgary local date");
const roomId = z.number().int().describe("Room id from list_rooms or search_rooms");

/** Runs a tool body; any failure becomes an isError message prefixed with its error code. */
async function run(body: () => Promise<unknown>) {
  try {
    const result = await body();
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text" as const, text: typeof code === "string" ? `${code}: ${message}` : message }] };
  }
}

const today = () => localNow(new Date()).date;

server.registerTool(
  "list_rooms",
  {
    title: "List MRU study rooms",
    description: "Every bookable MRU Library group study room with its id, name (includes floor and room number), grouping, capacity and amenities. Favourites are marked.",
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  () =>
    run(async () => {
      const { favouriteRoomIds } = await loadSettings();
      return (await search.listRooms()).map((room) => ({ ...room, favourite: favouriteRoomIds.includes(room.id) }));
    }),
);

server.registerTool(
  "get_availability",
  {
    title: "One room's free times",
    description: `A room's bookable hours and free time windows on a date (past times today are left out). ${RULES}`,
    inputSchema: { roomId, date },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  ({ roomId, date }) => run(async () => ({ today: today(), ...(await search.roomDay(roomId, date)) })),
);

server.registerTool(
  "search_rooms",
  {
    title: "Search MRU study rooms",
    description:
      "Find group study rooms free for a booking (live, read-only). " +
      `${RULES} Give durationMinutes to search for a booking of that length anywhere between start and end ` +
      '(e.g. "2 hours between 1 and 5 pm"); omit it to book exactly start to end. ' +
      "Returns matches (earliest start, then smallest suitable room) plus the nearest alternative times. " +
      "partySize defaults to the student's saved default. Then offer open_booking_page for the chosen room.",
    inputSchema: {
      date,
      start: z.string().describe("Earliest start, HH:mm (24-hour)"),
      end: z.string().describe("Latest end, HH:mm (24-hour); 24:00 means midnight"),
      durationMinutes: z
        .number()
        .int()
        .optional()
        .describe(`Booking length in minutes (multiple of 30, max ${DEFAULT_SEARCH_POLICY.maxDurationMinutes}). Omit to book the whole start-end window.`),
      partySize: z.number().int().min(1).optional().describe("Number of people; omit to use the saved default"),
      category: z.enum(DEFAULT_SEARCH_POLICY.categories).optional(),
      accessible: z.boolean().optional(),
      power: z.boolean().optional(),
      videoConferencing: z.boolean().optional(),
      favouritesOnly: z.boolean().optional().describe("Only search the student's saved favourite rooms"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  ({ favouritesOnly, partySize, ...req }) =>
    run(async () => {
      const settings = await loadSettings();
      const size = partySize ?? settings.defaultPartySize;
      if (size === undefined) {
        throw new PolicyViolationError("How many people? Give partySize, or save a default with update_settings.");
      }
      if (favouritesOnly && settings.favouriteRoomIds.length === 0) {
        throw new PolicyViolationError("No favourite rooms are saved yet. Add some with update_settings.");
      }
      const result = await search.findRooms({
        ...req,
        partySize: size,
        ...(favouritesOnly && { roomIds: settings.favouriteRoomIds }),
      });
      return { today: today(), ...result };
    }),
);

server.registerTool(
  "next_free_slot",
  {
    title: "When is a room next free?",
    description: `The first free slot for one room from now, looking up to ${DEFAULT_SEARCH_POLICY.maxDaysAhead} days ahead.`,
    inputSchema: {
      roomId,
      durationMinutes: z.number().int().optional().describe(`Minimum free length in minutes (30-${DEFAULT_SEARCH_POLICY.maxDurationMinutes}, default 30)`),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  ({ roomId, durationMinutes }) =>
    run(async () => {
      const slot = await search.nextFree(roomId, durationMinutes);
      return slot ?? { message: `Room ${roomId} has no free slot in the next ${DEFAULT_SEARCH_POLICY.maxDaysAhead} days.` };
    }),
);

server.registerTool(
  "open_booking_page",
  {
    title: "Open the Book Now page",
    description:
      "Opens the room's Book Now page on the library site in the student's default browser, on the chosen date. " +
      "The student signs in with their MRU account and picks the time there; this server never books or sees credentials. " +
      "Tell the student which time to pick.",
    inputSchema: { roomId, date },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  ({ roomId, date }) =>
    run(async () => {
      // Throws if the site doesn't list this room on this date, so we never open the wrong room.
      const { room } = await search.roomDay(roomId, date);
      const url = source.bookingUrl(room.id, date);
      try {
        await open(url);
      } catch {
        return { opened: false, url, message: `Could not open a browser. Open this link to book ${room.name}: ${url}` };
      }
      return { opened: true, url, room: room.name, date, message: "Sign in with your MRU account and choose the time on the page." };
    }),
);

server.registerTool(
  "get_settings",
  {
    title: "Show saved preferences",
    description: "The student's saved default party size and favourite room ids.",
    annotations: { readOnlyHint: true },
  },
  () => run(async () => ({ path: SETTINGS_PATH, ...(await loadSettings()) })),
);

server.registerTool(
  "update_settings",
  {
    title: "Save preferences",
    description: "Save the default party size and/or favourite room ids (replaces the favourites list). Stored in a local JSON file.",
    inputSchema: {
      defaultPartySize: z.number().int().min(1).max(20).optional(),
      favouriteRoomIds: z.array(z.number().int()).optional().describe("Room ids from list_rooms; replaces the saved list"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  (changes) => run(async () => ({ path: SETTINGS_PATH, ...(await saveSettings(changes)) })),
);

await server.connect(new StdioServerTransport());
