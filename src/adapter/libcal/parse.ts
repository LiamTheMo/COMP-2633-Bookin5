import { z } from "zod";
import { DAY_END, formatHHMM } from "../../domain/time.js";
import type { FreeWindow, Room } from "../../domain/types.js";
import { LibraryFormatError } from "../../domain/errors.js";

/*
 * Parsers for the two LibCal responses the adapter depends on.
 *
 * 1. POST /spaces/availability/grid  -> JSON list of 30-minute slots per room.
 *    Observed: a slot with a `className` is taken (seen: "s-lc-eq-checkout");
 *    a slot without one is free. Rooms with no slot for a time are not offered.
 *
 * 2. GET /space/{id}?date=...        -> HTML page with an embedded JS object
 *    that carries the room's title ("... (Capacity 5)"), grouping and id.
 *
 * Both formats are unofficial and can change. Failures raise LibraryFormatError
 * so the caller can report LIBRARY_FORMAT_CHANGED instead of guessing.
 */

const GridSchema = z.object({
  slots: z.array(
    z.object({
      start: z.string(),
      end: z.string(),
      itemId: z.number().int(),
      className: z.string().optional(),
    }),
  ),
});

interface GridSlot {
  date: string;
  startMin: number;
  endMin: number;
  taken: boolean;
}

/** Converts "2026-11-23 14:30:00" into { date, minutes }. */
function splitStamp(stamp: string): { date: string; minutes: number } {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):\d{2}$/.exec(stamp);
  if (!m) throw new LibraryFormatError(`Unexpected slot timestamp "${stamp}"`);
  return { date: m[1]!, minutes: Number(m[2]) * 60 + Number(m[3]) };
}

/**
 * Groups grid slots by room for one date and merges back-to-back free slots
 * into FreeWindows. Slots that belong to other dates (the grid can include the
 * following midnight) are ignored; a slot that ends at midnight ends at 1440.
 */
export function parseGrid(json: unknown, date: string): Map<number, FreeWindow[]> {
  const parsed = GridSchema.safeParse(json);
  if (!parsed.success) {
    throw new LibraryFormatError(`Availability grid did not match expected shape: ${parsed.error.message}`);
  }

  const byRoom = new Map<number, GridSlot[]>();
  for (const raw of parsed.data.slots) {
    const start = splitStamp(raw.start);
    if (start.date !== date) continue;
    const end = splitStamp(raw.end);
    const endMin = end.date === date ? end.minutes : DAY_END;
    const list = byRoom.get(raw.itemId) ?? [];
    list.push({
      date,
      startMin: start.minutes,
      endMin,
      taken: raw.className !== undefined,
    });
    byRoom.set(raw.itemId, list);
  }

  const result = new Map<number, FreeWindow[]>();
  for (const [roomId, slots] of byRoom) {
    slots.sort((a, b) => a.startMin - b.startMin);
    const windows: FreeWindow[] = [];
    for (const slot of slots) {
      if (slot.taken) continue;
      const last = windows[windows.length - 1];
      if (last && last.end === slot.startMin) {
        last.end = slot.endMin;
      } else {
        windows.push({ start: slot.startMin, end: slot.endMin });
      }
    }
    result.set(roomId, windows);
  }
  return result;
}

const ROOM_TITLE = /id:\s*"eid_(\d+)",\s*title:\s*"((?:[^"\\]|\\.)*)"/;
const GROUPING = /grouping:\s*"((?:[^"\\]|\\.)*)"/;
const CAPACITY = /capacity:\s*(\d+)/;

/** Decodes a JS string literal body (handles \uXXXX escapes). */
function decodeJsString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    throw new LibraryFormatError("Could not decode a room title string");
  }
}

/** LibCal's message for a room that is switched off. Such rooms cannot be booked. */
const UNAVAILABLE_MESSAGE = "This resource is temporarily unavailable.";
/** LibCal's "Whoops!" page for ids that are listed in the grid but have no detail page. */
const NOT_FOUND_MARKER = 'id="errorcode"';

/**
 * Extracts a room's id, name, grouping and capacity from its detail page.
 * Returns null for a room that cannot be booked through the site: switched off,
 * or listed in the grid but with no detail page (LibCal's 404 page).
 * Throws LibraryFormatError for any other page it does not recognise.
 */
export function parseSpacePage(html: string, expectedId: number): Room | null {
  const title = ROOM_TITLE.exec(html);
  if (!title) {
    if (html.includes(UNAVAILABLE_MESSAGE) || html.includes(NOT_FOUND_MARKER)) return null;
    throw new LibraryFormatError(`Room page ${expectedId} has no room title object`);
  }
  const id = Number(title[1]);
  if (id !== expectedId) {
    throw new LibraryFormatError(`Room page for ${expectedId} describes room ${id}`);
  }
  // Grouping and capacity live in the same JS object, so search only nearby.
  const object = html.slice(title.index, title.index + 800);
  const grouping = GROUPING.exec(object);
  const capacity = CAPACITY.exec(object);
  if (!grouping || !capacity) {
    throw new LibraryFormatError(`Room page ${expectedId} is missing grouping or capacity`);
  }
  const fullTitle = decodeJsString(title[2]!);
  const name = fullTitle.replace(/\s*\(Capacity \d+\)\s*$/, "").trim();
  return {
    id,
    name,
    grouping: decodeJsString(grouping[1]!),
    capacity: Number(capacity[1]),
  };
}

/** Formats a window for logs and error messages, e.g. "15:00-16:00". */
export function describeWindow(w: FreeWindow): string {
  return `${formatHHMM(w.start)}-${formatHHMM(w.end)}`;
}
