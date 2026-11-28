import { PolicyViolationError } from "../domain/errors.js";
import type { RoomFeatures } from "../domain/types.js";
import { addDays, formatHHMM, isValidIsoDate, localNow, parseHHMM, SLOT_MINUTES } from "../domain/time.js";

/** Booking rules checked before any request reaches the library. */
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
  // Library Group Room FAQ: up to 4 hours per student per day, up to 7 days in advance.
  maxDurationMinutes: 240,
  maxDaysAhead: 7,
  groupRoomsOnly: true,
  lookaheadMinutes: 120,
  categories: ["Group Rooms - 1st Floor", "Group Rooms - 2nd & 3rd Floor", "Hybrid Group Rooms"],
};

export interface SearchRequest {
  /** ISO date, YYYY-MM-DD, in the library's local timezone. */
  date: string;
  /** Start time, HH:mm. With durationMinutes, the earliest start. */
  start: string;
  /** End time, HH:mm. With durationMinutes, the latest end. */
  end: string;
  /** Optional booking length. Omitted means the booking is the whole start-end window. */
  durationMinutes?: number;
  partySize: number;
  /** Optional: only rooms in this category (one of policy.categories, any case). */
  category?: string;
  /** Optional feature filters: true means the room must have it; false or omitted means either. */
  accessible?: boolean;
  power?: boolean;
  videoConferencing?: boolean;
  /** Optional: only these room ids (e.g. the student's favourites). */
  roomIds?: number[];
}

export interface ValidatedRequest {
  date: string;
  /** The window the booking must fit in. */
  startMin: number;
  endMin: number;
  /** Booking length; equals endMin - startMin when no duration was given. */
  durationMin: number;
  partySize: number;
  /** The canonical category name, or undefined for any. */
  category: string | undefined;
  /** Features every returned room must have. */
  needs: (keyof RoomFeatures)[];
  roomIds: number[] | undefined;
}

const FEATURES = ["accessible", "power", "videoConferencing"] as const;

/** Validates a search request. Throws PolicyViolationError with a message for the student. */
export function validateSearch(req: SearchRequest, policy: SearchPolicy, now: Date): ValidatedRequest {
  validateDate(req.date, policy, now);

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

  if (endMin <= startMin) {
    throw new PolicyViolationError("The end time must be after the start time.");
  }
  const duration = req.durationMinutes ?? endMin - startMin;
  if (!Number.isInteger(duration) || duration % policy.slotMinutes !== 0) {
    throw new PolicyViolationError(`The duration must be a whole number of ${policy.slotMinutes}-minute slots.`);
  }
  if (duration > endMin - startMin) {
    throw new PolicyViolationError(`A ${duration}-minute booking does not fit between ${req.start} and ${req.end}.`);
  }
  if (duration < policy.minDurationMinutes) {
    throw new PolicyViolationError(`Bookings must be at least ${policy.minDurationMinutes} minutes long.`);
  }
  if (duration > policy.maxDurationMinutes) {
    throw new PolicyViolationError(`Bookings can be at most ${policy.maxDurationMinutes} minutes long.`);
  }

  const today = localNow(now);
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

  if (req.roomIds !== undefined && (!Array.isArray(req.roomIds) || req.roomIds.length === 0)) {
    throw new PolicyViolationError("No rooms to search: the room list is empty.");
  }

  return {
    date: req.date,
    startMin,
    endMin,
    durationMin: duration,
    partySize: req.partySize,
    category,
    needs,
    roomIds: req.roomIds,
  };
}

/** Checks a date is real, not past, and within the booking horizon. */
export function validateDate(date: string, policy: SearchPolicy, now: Date): void {
  if (!isValidIsoDate(date)) {
    throw new PolicyViolationError(`Date "${date}" is not a valid YYYY-MM-DD date.`);
  }
  const today = localNow(now).date;
  if (date < today) {
    throw new PolicyViolationError(`${date} is in the past.`);
  }
  if (date > addDays(today, policy.maxDaysAhead)) {
    throw new PolicyViolationError(`Rooms can only be booked up to ${policy.maxDaysAhead} days ahead.`);
  }
}

function safeParseTime(value: string, label: string): number {
  try {
    return parseHHMM(value);
  } catch {
    throw new PolicyViolationError(`The ${label} time "${value}" must be in HH:mm format.`);
  }
}
