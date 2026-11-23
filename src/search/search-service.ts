import { formatHHMM } from "../domain/time.js";
import type { FreeWindow, Room, RoomSource } from "../domain/types.js";
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
  /** Rooms free for the whole requested window, smallest suitable capacity first. */
  matches: RoomOffer[];
  /**
   * When there are no matches, the earliest times on the same date that fit the
   * requested duration. Empty when there are matches.
   */
  nextAvailable: RoomOffer[];
}

const MAX_NEXT_AVAILABLE = 5;

/**
 * Finds group rooms that can take a party for a time window.
 *
 * Validates the request with the policy, asks the room source for that day's
 * availability, then matches rooms by capacity and by free windows. Makes no
 * changes to the library.
 */
export class SearchService {
  constructor(
    private readonly rooms: RoomSource,
    private readonly policy: SearchPolicy = DEFAULT_SEARCH_POLICY,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async findRooms(req: SearchRequest): Promise<SearchResult> {
    const valid = validateSearch(req, this.policy, this.clock());
    const duration = valid.endMin - valid.startMin;

    const availability = await this.rooms.getAvailability(valid.date);
    const eligible = availability
      .filter((a) => !this.policy.groupRoomsOnly || isGroupRoom(a.room))
      .filter((a) => a.room.capacity >= valid.partySize)
      .sort((a, b) => a.room.capacity - b.room.capacity || a.room.id - b.room.id);

    const matches: RoomOffer[] = [];
    for (const { room, free } of eligible) {
      if (free.some((w) => covers(w, valid.startMin, valid.endMin))) {
        matches.push(offer(room, valid.startMin, valid.endMin));
      }
    }

    const nextAvailable: RoomOffer[] = [];
    if (matches.length === 0) {
      const candidates: RoomOffer[] = [];
      for (const { room, free } of eligible) {
        for (const w of free) {
          if (w.end - w.start >= duration) {
            candidates.push(offer(room, w.start, w.start + duration));
          }
        }
      }
      candidates.sort((a, b) => a.start.localeCompare(b.start) || a.room.capacity - b.room.capacity);
      // Keep one offer per start time so the list is useful to a student.
      const seen = new Set<string>();
      for (const c of candidates) {
        if (seen.has(c.start)) continue;
        seen.add(c.start);
        nextAvailable.push(c);
        if (nextAvailable.length === MAX_NEXT_AVAILABLE) break;
      }
    }

    return { date: valid.date, partySize: valid.partySize, matches, nextAvailable };
  }
}

/** Group rooms, including hybrid group rooms; excludes individual pods. */
export function isGroupRoom(room: Room): boolean {
  return /group rooms?/i.test(room.grouping);
}

function offer(room: Room, startMin: number, endMin: number): RoomOffer {
  return { room, start: formatHHMM(startMin), end: formatHHMM(endMin) };
}

/** True when a free window fully covers [start, end). */
function covers(window: FreeWindow, start: number, end: number): boolean {
  return window.start <= start && window.end >= end;
}
