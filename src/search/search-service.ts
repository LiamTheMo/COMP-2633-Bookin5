import { DAY_END, formatHHMM, localNow, parseHHMM } from "../domain/time.js";
import type { Room, RoomAvailability, RoomSource } from "../domain/types.js";
import { DEFAULT_SEARCH_POLICY, SearchPolicy, SearchRequest, validateSearch } from "./policy.js";

export interface RoomOffer {
  room: Room;
  /** HH:mm, local time. */
  start: string;
  /** HH:mm, local time. */
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

const MAX_NEXT_AVAILABLE = 5;

/**
 * Finds group rooms that can take a party for a time window.
 *
 * Validates the request with the policy, asks the room source for rooms free
 * for the requested window and for the same-length window at every slot in the
 * following policy.lookaheadMinutes, then matches rooms by capacity, category,
 * features and free time. Makes no changes to the library.
 */
export class SearchService {
  constructor(
    private readonly rooms: RoomSource,
    private readonly policy: SearchPolicy = DEFAULT_SEARCH_POLICY,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async findRooms(req: SearchRequest): Promise<SearchResult> {
    const valid = validateSearch(req, this.policy, this.clock());
    const duration = valid.durationMin;
    const latestStart = valid.endMin - duration; // equals startMin when the booking is the whole window

    const eligible = (await this.lookAhead(valid.date, valid.startMin, latestStart, duration))
      .filter((a) => !this.policy.groupRoomsOnly || isGroupRoom(a.room))
      .filter((a) => a.room.capacity >= valid.partySize)
      .filter((a) => valid.category === undefined || a.room.grouping === valid.category)
      .filter((a) => valid.needs.every((f) => a.room.features[f]))
      .sort((a, b) => a.room.capacity - b.room.capacity || a.room.id - b.room.id);

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
    // Never suggest a time that has already passed today.
    const today = localNow(this.clock());
    const notBefore = valid.date === today.date ? Math.ceil(today.minutes / slot) * slot : 0;
    const matched = new Set(matches.map((m) => m.room.id));
    const candidates: RoomOffer[] = [];
    for (const { room, free } of eligible) {
      if (matched.has(room.id)) continue; // a matched room is never also an alternative
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

  /**
   * Queries a booking-length window at every slot start in the requested
   * window, then at each later slot up to lookaheadMinutes past it, so rooms
   * that free up soon after are offered. Merges the results per room.
   * ponytail: one room-source call per slot, so a wide window means many paced
   * requests (8:00-22:00 for 1 h is ~30 calls); query the whole window once if that gets slow.
   */
  private async lookAhead(date: string, startMin: number, latestStart: number, duration: number): Promise<RoomAvailability[]> {
    const last = Math.min(latestStart + this.policy.lookaheadMinutes, DAY_END - duration);
    const byRoom = new Map<number, RoomAvailability>();
    for (let s = startMin; s <= last; s += this.policy.slotMinutes) {
      for (const { room, free } of await this.rooms.getAvailability(date, s, s + duration)) {
        const entry = byRoom.get(room.id) ?? { room, free: [] };
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
