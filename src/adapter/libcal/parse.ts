import { DAY_END } from "../../domain/time.js";
import type { FreeWindow, Room } from "../../domain/types.js";
import { LibraryFormatError } from "../../domain/errors.js";

/*
 * Parsers for two unofficial LibCal responses. Anything unrecognised raises
 * LibraryFormatError rather than returning wrong data.
 *
 * POST /spaces/availability/grid: one 30-minute slot per space per bookable half
 * hour. A className means taken; no slot means closed.
 * GET /space/{eid}: an inline `resources` array and `searchFilters` map.
 */

/** Bookable hours and free windows of one space on one date. */
export interface GridDay {
  open: FreeWindow[];
  free: FreeWindow[];
}

/** Parses the grid JSON into per-space hours and free windows for `date`. */
export function parseGrid(json: string, date: string): Map<number, GridDay> {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new LibraryFormatError("Availability grid is not JSON");
  }
  const slots = (data as { slots?: unknown })?.slots;
  if (!Array.isArray(slots)) throw new LibraryFormatError("Availability grid has no slots");

  const byRoom = new Map<number, GridDay>();
  const sorted = [...(slots as Record<string, unknown>[])].sort((a, b) => String(a.start).localeCompare(String(b.start)));
  for (const slot of sorted) {
    const id = slot.itemId;
    if (typeof id !== "number" || typeof slot.start !== "string" || typeof slot.end !== "string") {
      throw new LibraryFormatError("Availability slot is missing its itemId, start or end");
    }
    const start = minutesOn(slot.start, date);
    if (start === null) continue;
    const end = minutesOn(slot.end, date) ?? DAY_END;
    const day = byRoom.get(id) ?? { open: [], free: [] };
    append(day.open, start, end);
    if (!slot.className) append(day.free, start, end);
    byRoom.set(id, day);
  }
  return byRoom;
}

/** Adds [start, end) to sorted windows, merging it into the last one when they touch. */
function append(windows: FreeWindow[], start: number, end: number): void {
  const last = windows[windows.length - 1];
  if (last && last.end === start) last.end = end;
  else windows.push({ start, end });
}

/** "2026-11-24 14:30:00" -> 870, or null when the stamp is on another date. */
function minutesOn(stamp: string, date: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):\d{2}$/.exec(stamp);
  if (!m) throw new LibraryFormatError(`Unexpected time "${stamp}"`);
  return m[1] === date ? Number(m[2]) * 60 + Number(m[3]) : null;
}

const FEATURE_NAMES: Record<string, keyof Room["features"]> = {
  "Accessible Seat/Space": "accessible",
  "Power Available": "power",
  "Video Conferencing": "videoConferencing",
};

/** Parses one space page into the Room it describes. */
export function parseSpacePage(html: string, eid: number): Room {
  const block = new RegExp(`\\{\\s*id: "eid_${eid}",([\\s\\S]*?)\\n\\s*\\},`).exec(html)?.[1];
  if (!block) throw new LibraryFormatError(`Space page for ${eid} has no resource entry`);

  const name = jsString(new RegExp(`"eid_${eid}": "((?:[^"\\\\]|\\\\.)*)"`).exec(html)?.[1], "name");
  const grouping = jsString(/grouping: "((?:[^"\\]|\\.)*)"/.exec(block)?.[1], "grouping").trim();
  const capacity = Number(/capacity: (\d+)/.exec(block)?.[1]);
  if (!Number.isInteger(capacity) || capacity < 1) throw new LibraryFormatError(`Space ${eid} has no capacity`);

  const filterIds = (/filterIds: \[([\d,\s]*)\]/.exec(block)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  let filters: Record<string, { name: string }> = {};
  const filtersJson = /searchFilters: (\{.*\}),\s*$/m.exec(html)?.[1];
  if (filtersJson) {
    try {
      filters = JSON.parse(filtersJson);
    } catch {
      throw new LibraryFormatError(`Space ${eid} has unreadable amenity filters`);
    }
  }
  const features = { accessible: false, power: false, videoConferencing: false };
  for (const fid of filterIds) {
    const key = FEATURE_NAMES[filters[fid]?.name ?? ""];
    if (key) features[key] = true;
  }
  return { id: eid, name, grouping, capacity, features };
}

/** Decodes a JS string literal body ("1-B group room") or throws. */
function jsString(raw: string | undefined, label: string): string {
  if (raw === undefined) throw new LibraryFormatError(`Space page is missing its ${label}`);
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    throw new LibraryFormatError(`Space page has an unreadable ${label}`);
  }
}
