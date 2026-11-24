import { PolicyViolationError } from "../domain/errors.js";
import type { RoomFeatures } from "../domain/types.js";
import { addDays, formatHHMM, isValidIsoDate, localNow, parseHHMM, SLOT_MINUTES } from "../domain/time.js";

/**
 * Booking rules the search enforces before any request reaches the library.
 *
 * Only the slot size is confirmed on the library site. The booking horizon is
 * set by NFR6 (7 days). The duration cap is a placeholder until the library
 * confirms it; it is kept here so changing it is one edit.
 */
export interface SearchPolicy {
  slotMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  /** Bookings may be made this many days ahead of today (local time). */
  maxDaysAhead: number;
  /** Only rooms whose grouping contains "group rooms" are searched. Pods are excluded. */
  groupRoomsOnly: boolean;
  /** Each search also checks start times this many minutes past the requested start. */
  lookaheadMinutes: number;
  /** Categories a request may name: LibCal groupings, exactly as the site shows them. */
  categories: string[];
}

export const DEFAULT_SEARCH_POLICY: SearchPolicy = {
  slotMinutes: SLOT_MINUTES,
  minDurationMinutes: 30,
  maxDurationMinutes: 120, // UNVERIFIED: confirm with the library
  maxDaysAhead: 7, // NFR6: queries only up to 7 days ahead
  groupRoomsOnly: true,
  lookaheadMinutes: 120,
  categories: ["Group Rooms - 1st Floor", "Group Rooms - 2nd & 3rd Floor", "Hybrid Group Rooms"],
};

export interface SearchRequest {
  /** ISO date, YYYY-MM-DD, in the library's local timezone. */
  date: string;
  /** Start time, HH:mm. */
  start: string;
  /** End time, HH:mm. */
  end: string;
  partySize: number;
  /** Optional: only rooms in this category (one of policy.categories, any case). */
  category?: string;
  /** Optional feature filters: true means the room must have it; false or omitted means either. */
  accessible?: boolean;
  power?: boolean;
  videoConferencing?: boolean;
}

export interface ValidatedRequest {
  date: string;
  startMin: number;
  endMin: number;
  partySize: number;
  /** The canonical category name, or undefined for any. */
  category: string | undefined;
  /** Features every returned room must have. */
  needs: (keyof RoomFeatures)[];
}

const FEATURES = ["accessible", "power", "videoConferencing"] as const;

/**
 * Validates a search request. Throws PolicyViolationError with a message the
 * assistant can show the student. Pure: `now` is passed in.
 */
export function validateSearch(req: SearchRequest, policy: SearchPolicy, now: Date): ValidatedRequest {
  if (!isValidIsoDate(req.date)) {
    throw new PolicyViolationError(`Date "${req.date}" is not a valid YYYY-MM-DD date.`);
  }

  const startMin = safeParseTime(req.start, "start");
  const endMin = safeParseTime(req.end, "end");

  if (!Number.isInteger(req.partySize) || req.partySize < 1) {
    throw new PolicyViolationError("Party size must be a whole number of at least 1.");
  }

  for (const [label, minutes] of [
    ["start", startMin],
    ["end", endMin],
  ] as const) {
    if (minutes % policy.slotMinutes !== 0) {
      throw new PolicyViolationError(`The ${label} time must be on a ${policy.slotMinutes}-minute boundary.`);
    }
  }

  const duration = endMin - startMin;
  if (duration <= 0) {
    throw new PolicyViolationError("The end time must be after the start time.");
  }
  if (duration < policy.minDurationMinutes) {
    throw new PolicyViolationError(`Bookings must be at least ${policy.minDurationMinutes} minutes long.`);
  }
  if (duration > policy.maxDurationMinutes) {
    throw new PolicyViolationError(`Bookings can be at most ${policy.maxDurationMinutes} minutes long.`);
  }

  const today = localNow(now);
  if (req.date < today.date) {
    throw new PolicyViolationError(`${req.date} is in the past.`);
  }
  if (req.date > addDays(today.date, policy.maxDaysAhead)) {
    throw new PolicyViolationError(`Rooms can only be booked up to ${policy.maxDaysAhead} days ahead.`);
  }
  if (req.date === today.date && startMin < today.minutes) {
    throw new PolicyViolationError(`${formatHHMM(startMin)} has already passed today.`);
  }

  let category: string | undefined;
  if (req.category !== undefined) {
    category = policy.categories.find((c) => c.toLowerCase() === String(req.category).trim().toLowerCase());
    if (!category) {
      throw new PolicyViolationError(`Unknown category "${req.category}". Choose one of: ${policy.categories.join(", ")}.`);
    }
  }

  const needs = FEATURES.filter((f) => {
    const value = req[f];
    if (value !== undefined && typeof value !== "boolean") {
      throw new PolicyViolationError(`${f} must be true or false.`);
    }
    return value === true;
  });

  return { date: req.date, startMin, endMin, partySize: req.partySize, category, needs };
}

function safeParseTime(value: string, label: string): number {
  try {
    return parseHHMM(value);
  } catch {
    throw new PolicyViolationError(`The ${label} time "${value}" must be in HH:mm format.`);
  }
}
