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
  features: RoomFeatures;
}

/** Amenities LibCal lists for a room (the icons on each search result). */
export interface RoomFeatures {
  accessible: boolean;
  power: boolean;
  videoConferencing: boolean;
}

/** A continuous period when a room is free. `end` may be 1440 (midnight). */
export interface FreeWindow {
  start: number;
  end: number;
}

export interface RoomAvailability {
  room: Room;
  /** Free windows on the requested date, sorted by start. */
  free: FreeWindow[];
}

/**
 * Anything that can say which rooms are free around a requested window.
 * Must return at least every room free for the whole of [startMin, endMin);
 * may also return nearby windows as alternatives. The LibCal adapter is one
 * implementation; tests use fakes.
 */
export interface RoomSource {
  getAvailability(date: string, startMin: number, endMin: number): Promise<RoomAvailability[]>;
}
