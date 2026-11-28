import { PolicyViolationError } from "../domain/errors.js";
import { addDays, DAY_END, formatHHMM, localNow, parseHHMM } from "../domain/time.js";
import type { FreeWindow, Room, RoomAvailability, RoomSource } from "../domain/types.js";
import { DEFAULT_SEARCH_POLICY, SearchPolicy, SearchRequest, validateDate, validateSearch } from "./policy.js";

export interface RoomOffer {
  room: Room;
  start: string;
  end: string;
}

export interface SearchResult {
  date: string;
  partySize: number;
  /**
   * Rooms with a free gap of the booking length inside the requested window, at
   * the earliest such start; earliest start first, then smallest suitable capacity.
   */
  matches: RoomOffer[];
  /**
   * Other rooms and times on the same date, closest to the requested start
   * first, that fit the requested duration (never in the past). Rooms already
   * in `matches` are never repeated here. Returned whether or not there are matches.
   */
  nextAvailable: RoomOffer[];
}

/** One room's day: when it can be booked at all, and when it is free. */
export interface RoomDay {
  room: Room;
  date: string;
  /** Bookable hours (HH:mm), when the source knows them. */
  open?: { start: string; end: string }[];
  /** Free windows (HH:mm), never in the past. */
  free: { start: string; end: string }[];
}

const MAX_NEXT_AVAILABLE = 5;

/** Finds, lists and checks rooms. Read-only. */
export class SearchService {
  constructor(
    private readonly rooms: RoomSource,
    private readonly policy: SearchPolicy = DEFAULT_SEARCH_POLICY,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async findRooms(req: SearchRequest): Promise<SearchResult> {
    const valid = validateSearch(req, this.policy, this.clock());
    const duration = valid.durationMin;
    const latestStart = valid.endMin - duration;

    const eligible = (await this.lookAhead(valid.date, valid.startMin, latestStart, duration))
      .filter((a) => !this.policy.groupRoomsOnly || isGroupRoom(a.room))
      .filter((a) => a.room.capacity >= valid.partySize)
      .filter((a) => valid.category === undefined || a.room.grouping === valid.category)
      .filter((a) => valid.needs.every((f) => a.room.features[f]))
      .filter((a) => valid.roomIds === undefined || valid.roomIds.includes(a.room.id))
      .sort((a, b) => a.room.capacity - b.room.capacity || a.room.id - b.room.id);

    // Refuse a window no suitable room is open for, when the source knows opening hours.
    if (eligible.length > 0 && eligible.every((a) => a.open)) {
      const fits = (w: FreeWindow) => Math.min(w.end, valid.endMin) - Math.max(w.start, valid.startMin) >= duration;
      if (!eligible.some((a) => a.open!.some(fits))) {
        const hours = [...new Set(eligible.flatMap((a) => a.open!.map((w) => `${formatHHMM(w.start)}-${formatHHMM(w.end)}`)))];
        throw new PolicyViolationError(
          `No suitable room can be booked between ${req.start} and ${req.end} on ${valid.date}; ` +
            `bookable hours that day: ${hours.join(", ") || "none"}.`,
        );
      }
    }

    const slot = this.policy.slotMinutes;
    const matches: RoomOffer[] = [];
    for (const { room, free } of eligible) {
      // Earliest slot-aligned start in the window with a free gap of `duration`.
      const starts = free
        .map((w) => Math.ceil(Math.max(w.start, valid.startMin) / slot) * slot)
        .filter((s, i) => s <= latestStart && s + duration <= free[i]!.end);
      if (starts.length > 0) {
        const s = Math.min(...starts);
        matches.push(offer(room, s, s + duration));
      }
    }
    // Stable sort: rooms are already smallest capacity first, so ties keep that order.
    matches.sort((a, b) => a.start.localeCompare(b.start));

    const nextAvailable: RoomOffer[] = [];
    const notBefore = this.notBefore(valid.date);
    const matched = new Set(matches.map((m) => m.room.id));
    const candidates: RoomOffer[] = [];
    for (const { room, free } of eligible) {
      if (matched.has(room.id)) continue;
      for (const w of free) {
        // The start inside this window closest to the requested start.
        const lo = Math.max(w.start, notBefore);
        const hi = w.end - duration;
        if (lo > hi) continue;
        const start = Math.min(Math.max(valid.startMin, lo), hi);
        candidates.push(offer(room, start, start + duration));
      }
    }
    // Distance from the window of allowed starts [startMin, latestStart].
    const distance = (o: RoomOffer) => {
      const s = parseHHMM(o.start);
      return Math.max(0, valid.startMin - s, s - latestStart);
    };
    candidates.sort(
      (a, b) => distance(a) - distance(b) || a.start.localeCompare(b.start) || a.room.capacity - b.room.capacity,
    );
    // Keep one offer per start time so the list is useful to a student.
    const seen = new Set<string>();
    for (const c of candidates) {
      if (seen.has(c.start)) continue;
      seen.add(c.start);
      nextAvailable.push(c);
      if (nextAvailable.length === MAX_NEXT_AVAILABLE) break;
    }

    return { date: valid.date, partySize: valid.partySize, matches, nextAvailable };
  }

  /** Every bookable group room, by grouping then name. */
  async listRooms(): Promise<Room[]> {
    const today = localNow(this.clock()).date;
    return (await this.rooms.getAvailability(today, 0, DAY_END))
      .map((a) => a.room)
      .filter((r) => !this.policy.groupRoomsOnly || isGroupRoom(r))
      .sort((a, b) => a.grouping.localeCompare(b.grouping) || a.name.localeCompare(b.name));
  }

  /** One room's bookable hours and free windows on a date. */
  async roomDay(roomId: number, date: string): Promise<RoomDay> {
    validateDate(date, this.policy, this.clock());
    const a = (await this.rooms.getAvailability(date, 0, DAY_END)).find((r) => r.room.id === roomId);
    if (!a) throw new PolicyViolationError(`The library site does not list room ${roomId} on ${date}. Use list_rooms for valid ids.`);
    const notBefore = this.notBefore(date);
    const toHHMM = (w: FreeWindow) => ({ start: formatHHMM(w.start), end: formatHHMM(w.end) });
    return {
      room: a.room,
      date,
      ...(a.open && { open: a.open.map(toHHMM) }),
      free: a.free
        .filter((w) => w.end > notBefore)
        .map((w) => toHHMM({ start: Math.max(w.start, notBefore), end: w.end })),
    };
  }

  /** First free slot of `durationMin` for a room within the horizon, or null. */
  async nextFree(roomId: number, durationMin = this.policy.minDurationMinutes): Promise<(RoomOffer & { date: string }) | null> {
    if (durationMin < this.policy.minDurationMinutes || durationMin > this.policy.maxDurationMinutes || durationMin % this.policy.slotMinutes) {
      throw new PolicyViolationError(
        `Duration must be ${this.policy.minDurationMinutes}-${this.policy.maxDurationMinutes} minutes in ${this.policy.slotMinutes}-minute steps.`,
      );
    }
    const today = localNow(this.clock()).date;
    let seen = false;
    for (let d = 0; d <= this.policy.maxDaysAhead; d++) {
      const date = addDays(today, d);
      const a = (await this.rooms.getAvailability(date, 0, DAY_END)).find((r) => r.room.id === roomId);
      if (!a) continue;
      seen = true;
      const notBefore = this.notBefore(date);
      for (const w of a.free) {
        const start = Math.ceil(Math.max(w.start, notBefore) / this.policy.slotMinutes) * this.policy.slotMinutes;
        if (start + durationMin <= w.end) return { date, ...offer(a.room, start, start + durationMin) };
      }
    }
    if (!seen) throw new PolicyViolationError(`The library site does not list room ${roomId}. Use list_rooms for valid ids.`);
    return null;
  }

  /** The first slot-aligned minute that is not in the past on `date`. */
  private notBefore(date: string): number {
    const now = localNow(this.clock());
    return date === now.date ? Math.ceil(now.minutes / this.policy.slotMinutes) * this.policy.slotMinutes : 0;
  }

  /** Queries every slot start in the window plus lookaheadMinutes past it, merged per room. */
  private async lookAhead(date: string, startMin: number, latestStart: number, duration: number): Promise<RoomAvailability[]> {
    const last = Math.min(latestStart + this.policy.lookaheadMinutes, DAY_END - duration);
    const byRoom = new Map<number, RoomAvailability>();
    for (let s = startMin; s <= last; s += this.policy.slotMinutes) {
      for (const { room, free, open } of await this.rooms.getAvailability(date, s, s + duration)) {
        const entry = byRoom.get(room.id) ?? { room, free: [], ...(open && { open }) };
        for (const w of free) {
          if (!entry.free.some((f) => f.start === w.start && f.end === w.end)) entry.free.push(w);
        }
        byRoom.set(room.id, entry);
      }
    }
    return [...byRoom.values()];
  }
}

/** Group rooms, including hybrid group rooms; excludes individual pods. */
export function isGroupRoom(room: Room): boolean {
  return /group rooms?/i.test(room.grouping);
}

function offer(room: Room, startMin: number, endMin: number): RoomOffer {
  return { room, start: formatHHMM(startMin), end: formatHHMM(endMin) };
}
