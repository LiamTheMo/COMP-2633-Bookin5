import type { RoomAvailability, RoomSource, Room } from "../../domain/types.js";
import { LibCalClient } from "./client.js";
import { parseGrid, parseSpacePage } from "./parse.js";

export interface LibCalRoomSourceOptions {
  /** How long room names and capacities are reused before re-reading them. */
  roomCacheMs: number;
}

interface CachedRoom {
  room: Room;
  fetchedAt: number;
}

/**
 * The library site adapter: implements RoomSource by reading MRU LibCal.
 *
 * Read-only. Availability comes from the grid endpoint on each call (it changes
 * quickly, so it is never cached). Room names and capacities change rarely, so
 * they are cached for roomCacheMs.
 */
export class LibCalRoomSource implements RoomSource {
  private readonly rooms = new Map<number, CachedRoom>();

  constructor(
    private readonly client: LibCalClient,
    private readonly options: LibCalRoomSourceOptions = { roomCacheMs: 24 * 60 * 60 * 1000 },
    private readonly now: () => number = () => Date.now(),
  ) {}

  async getAvailability(date: string): Promise<RoomAvailability[]> {
    const grid = await this.client.fetchGrid(date);
    const windowsByRoom = parseGrid(grid, date);
    const roomIds = [...windowsByRoom.keys()].sort((a, b) => a - b);

    const out: RoomAvailability[] = [];
    for (const id of roomIds) {
      const room = await this.roomDetails(id, date);
      // Switched-off rooms have no details and cannot be booked, so they are left out.
      if (room) out.push({ room, free: windowsByRoom.get(id) ?? [] });
    }
    return out;
  }

  /** Returns cached room metadata, reading the room page when missing or stale. Null when switched off. */
  private async roomDetails(id: number, date: string): Promise<Room | null> {
    const cached = this.rooms.get(id);
    if (cached && this.now() - cached.fetchedAt < this.options.roomCacheMs) {
      return cached.room;
    }
    const html = await this.client.fetchRoomPage(id, date);
    const room = parseSpacePage(html, id);
    if (room) this.rooms.set(id, { room, fetchedAt: this.now() });
    return room;
  }
}
