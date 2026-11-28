/** Times are minutes from local midnight (14:30 is 870). Dates are "YYYY-MM-DD". */

export interface Room {
  id: number;
  name: string;
  grouping: string;
  capacity: number;
  features: RoomFeatures;
}

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
  /** When the room can be booked at all that day (opening hours), if the source knows. */
  open?: FreeWindow[];
}

/** Must return at least every room free for the whole of [startMin, endMin); may return more. */
export interface RoomSource {
  getAvailability(date: string, startMin: number, endMin: number): Promise<RoomAvailability[]>;
}
