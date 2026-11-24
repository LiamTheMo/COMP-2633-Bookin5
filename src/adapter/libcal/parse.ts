import { DAY_END } from "../../domain/time.js";
import type { RoomAvailability } from "../../domain/types.js";
import { LibraryFormatError } from "../../domain/errors.js";

/*
 * Parser for LibCal's server-rendered space search page:
 *   GET /spaces?m=t&lid=...&date=...&start=HH:mm&end=HH:mm
 *
 * The page lists one "booking suggestion" block per offer. Blocks inside
 * #s-lc-eq-search-results are free for the whole requested window; blocks in
 * #s-lc-eq-search-other-results are LibCal's nearest alternatives of the same
 * duration. Each block's "Book Now" form carries the exact eid/start/end,
 * and its icons (span titles) list the room's amenities.
 * Rooms the library has switched off are not listed at all.
 *
 * The page is unofficial and can change. Anything unrecognised raises
 * LibraryFormatError so the caller can report LIBRARY_FORMAT_CHANGED.
 */

const RESULTS_MARKER = 'id="s-lc-eq-search-results"';
const BLOCK_START = '<div class="media s-lc-booking-suggestion"';

/** Parses the search page into offered windows per room, for one date. */
export function parseSearchPage(html: string, date: string): RoomAvailability[] {
  const resultsAt = html.indexOf(RESULTS_MARKER);
  if (resultsAt < 0) throw new LibraryFormatError("Search page has no results section");

  const byRoom = new Map<number, RoomAvailability>();
  for (const block of html.slice(resultsAt).split(BLOCK_START).slice(1)) {
    const id = Number(field(block, /name="eid" value="(\d+)"/, "eid"));
    const start = splitStamp(field(block, /name="start" value="([^"]+)"/, "start"), date);
    const end = splitStamp(field(block, /name="end" value="([^"]+)"/, "end"), date);
    if (start === null) continue; // an offer on another day
    const entry = byRoom.get(id) ?? {
      room: {
        id,
        name: text(field(block, /s-lc-suggestion-heading">\s*<a[^>]*>([\s\S]*?)<\/a>/, "name")),
        grouping: text(field(block, /class="s-lc-booking-group">([\s\S]*?)<\/div>/, "grouping")),
        capacity: Number(field(block, /title="The capacity of this space">[\s\S]*?<\/i>\s*(\d+)/, "capacity")),
        features: {
          accessible: block.includes('title="Accessible Seat/Space"'),
          power: block.includes('title="Power Available"'),
          videoConferencing: block.includes('title="Video Conferencing"'),
        },
      },
      free: [],
    };
    entry.free.push({ start, end: end ?? DAY_END });
    byRoom.set(id, entry);
  }

  const rooms = [...byRoom.values()];
  for (const r of rooms) r.free.sort((a, b) => a.start - b.start);
  return rooms;
}

function field(block: string, pattern: RegExp, label: string): string {
  const m = pattern.exec(block);
  if (!m) throw new LibraryFormatError(`Search result is missing its ${label}`);
  return m[1]!;
}

/** "2026-11-24 14:30:00" -> 870, or null when the stamp is on another date (e.g. a midnight end). */
function splitStamp(stamp: string, date: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):\d{2}$/.exec(stamp);
  if (!m) throw new LibraryFormatError(`Unexpected time "${stamp}"`);
  return m[1] === date ? Number(m[2]) * 60 + Number(m[3]) : null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Strips tags, decodes HTML entities and collapses whitespace. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (whole, e: string) =>
      e[0] === "#" ? String.fromCodePoint(Number(e[1] === "x" ? `0${e.slice(1)}` : e.slice(1))) : (ENTITIES[e] ?? whole),
    )
    .replace(/\s+/g, " ")
    .trim();
}
