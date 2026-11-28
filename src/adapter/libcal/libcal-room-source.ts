import type { Room, RoomAvailability, RoomSource } from "../../domain/types.js";
import { addDays } from "../../domain/time.js";
import { LibraryUnavailableError } from "../../domain/errors.js";
import { LibCalClient } from "./client.js";
import { parseGrid, parseSpacePage } from "./parse.js";
import { KNOWN_ROOMS, UNAVAILABLE_ROOM_IDS } from "./rooms.js";

/** Grid reads are reused this long, so one search costs one request. */
const GRID_TTL_MS = 60_000;

/**
 * RoomSource backed by the LibCal availability grid: every room's whole day in
 * one read. Room details come from KNOWN_ROOMS; a room missing from it is read
 * from its own page once. Rooms whose page can't be read are skipped.
 */
export class LibCalRoomSource implements RoomSource {
  private readonly rooms = new Map<number, Room | null>([
    ...KNOWN_ROOMS.map((r) => [r.id, r] as const),
    ...UNAVAILABLE_ROOM_IDS.map((id) => [id, null] as const),
  ]);
  private readonly days = new Map<string, { at: number; value: Promise<RoomAvailability[]> }>();

  constructor(
    private readonly client: LibCalClient,
    private readonly now: () => number = () => Date.now(),
  ) {}

  getAvailability(date: string): Promise<RoomAvailability[]> {
    const cached = this.days.get(date);
    if (cached && this.now() - cached.at < GRID_TTL_MS) return cached.value;
    const value = this.readDay(date);
    this.days.set(date, { at: this.now(), value });
    value.catch(() => this.days.delete(date));
    return value;
  }

  bookingUrl(roomId: number, date: string): string {
    return this.client.bookingUrl(roomId, date);
  }

  private async readDay(date: string): Promise<RoomAvailability[]> {
    const grid = parseGrid(await this.client.fetchGrid(date, addDays(date, 1)), date);
    const result: RoomAvailability[] = [];
    for (const [id, day] of grid) {
      const room = await this.room(id);
      if (room) result.push({ room, free: day.free, open: day.open });
    }
    return result;
  }

  private async room(id: number): Promise<Room | null> {
    if (this.rooms.has(id)) return this.rooms.get(id) ?? null;
    try {
      const room = parseSpacePage(await this.client.fetchSpacePage(id), id);
      this.rooms.set(id, room);
      return room;
    } catch (err) {
      // A format problem is remembered; an outage is retried next time.
      if (!(err instanceof LibraryUnavailableError)) this.rooms.set(id, null);
      return null;
    }
  }
}
