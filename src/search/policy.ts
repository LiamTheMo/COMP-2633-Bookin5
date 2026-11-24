import { PolicyViolationError } from "../domain/errors.js";
import { addDays, formatHHMM, isValidIsoDate, localNow, parseHHMM, SLOT_MINUTES } from "../domain/time.js";

/**
 * Booking rules the search enforces before any request reaches the library.
 *
 * Only the slot size is confirmed on the library site. The duration cap and the
 * booking horizon are placeholders until the library confirms them (see the
 * README open questions); they are kept here so changing them is one edit.
 */
export interface SearchPolicy {
  slotMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  /** Bookings may be made this many days ahead of today (local time). */
  maxDaysAhead: number;
  /** Only rooms whose grouping contains "group rooms" are searched. Pods are excluded. */
  groupRoomsOnly: boolean;
}

export const DEFAULT_SEARCH_POLICY: SearchPolicy = {
  slotMinutes: SLOT_MINUTES,
  minDurationMinutes: 30,
  maxDurationMinutes: 120, // UNVERIFIED: confirm with the library
  maxDaysAhead: 14, // UNVERIFIED: confirm with the library
  groupRoomsOnly: true,
};

export interface SearchRequest {
  /** ISO date, YYYY-MM-DD, in the library's local timezone. */
  date: string;
  /** Start time, HH:mm. */
  start: string;
  /** End time, HH:mm. */
  end: string;
  partySize: number;
}

export interface ValidatedRequest {
  date: string;
  startMin: number;
  endMin: number;
  partySize: number;
}

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

  return { date: req.date, startMin, endMin, partySize: req.partySize };
}

function safeParseTime(value: string, label: string): number {
  try {
    return parseHHMM(value);
  } catch {
    throw new PolicyViolationError(`The ${label} time "${value}" must be in HH:mm format.`);
  }
}
