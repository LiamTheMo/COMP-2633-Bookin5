/**
 * Core domain types shared by the adapter and the search service.
 * Times are wall-clock minutes from local midnight (America/Edmonton),
 * so 14:30 is 870. Dates are ISO "YYYY-MM-DD" strings.
 */

export interface Room {
  /** LibCal space id (`eid`), e.g. 7561 for "1-B group room". */
  id: number;
  /** Human name, e.g. "1-B group room (1st floor, EL1136)". */
  name: string;
  /** LibCal grouping, e.g. "Group Rooms - 1st Floor" or "Individual Study Pods". */
  grouping: string;
  /** Maximum number of people the room is listed for. */
  capacity: number;
}

/** A continuous period when a room is free. `end` may be 1440 (midnight). */
export interface FreeWindow {
  start: number;
  end: number;
}

export interface RoomAvailability {
  room: Room;
  /** Sorted, non-overlapping free windows for the requested date. */
  free: FreeWindow[];
}

/**
 * Anything that can say which rooms exist and when they are free.
 * The LibCal adapter is one implementation; tests use fakes.
 */
export interface RoomSource {
  getAvailability(date: string): Promise<RoomAvailability[]>;
}
