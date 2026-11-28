import type { Room } from "../../domain/types.js";

/** Snapshot of every space's /space/{id} page, taken 2026-11-28. Re-snapshot if rooms change. */

const room = (id: number, name: string, grouping: string, capacity: number, accessible: boolean, power: boolean, videoConferencing: boolean): Room => ({
  id,
  name,
  grouping,
  capacity,
  features: { accessible, power, videoConferencing },
});

export const KNOWN_ROOMS: Room[] = [
  room(7560, "1-A group room (1st floor, EL1134)", "Group Rooms - 1st Floor", 5, false, true, false),
  room(7561, "1-B group room (1st floor, EL1136)", "Group Rooms - 1st Floor", 5, false, true, false),
  room(7562, "1-C group room (1st floor, EL1138)", "Group Rooms - 1st Floor", 4, false, true, false),
  room(7563, "1-D group room (1st floor, EL1140)", "Group Rooms - 1st Floor", 5, false, true, false),
  room(7564, "1-E group room (1st floor, EL1142)", "Group Rooms - 1st Floor", 4, false, true, false),
  room(7565, "1-F group room (1st floor, EL1144)", "Group Rooms - 1st Floor", 5, false, true, false),
  room(7566, "1-G group room (1st floor, EL1146)", "Group Rooms - 1st Floor", 5, false, true, false),
  room(7567, "1-H group room (1st floor, EL1253)", "Group Rooms - 1st Floor", 5, false, true, false),
  room(7568, "1-I group room (1st floor, EL1348)", "Group Rooms - 1st Floor", 5, false, true, false),
  room(7569, "1-L group room (1st floor, EL1310)", "Group Rooms - 1st Floor", 5, false, true, false),
  room(7570, "2-A quiet group room (2nd floor, EL2121)", "Group Rooms - 2nd & 3rd Floor", 2, false, true, false),
  room(7571, "2-B group room (2nd floor, EL2135)", "Group Rooms - 2nd & 3rd Floor", 5, false, true, false),
  room(7572, "2-C group room (2nd floor, EL2145)", "Group Rooms - 2nd & 3rd Floor", 5, false, true, false),
  room(7573, "2-D group room (2nd floor, EL2151)", "Group Rooms - 2nd & 3rd Floor", 5, false, true, false),
  room(7574, "2-E group room (2nd floor, EL2254)", "Group Rooms - 2nd & 3rd Floor", 5, false, true, false),
  room(7575, "2-F group room (2nd floor, EL2252)", "Group Rooms - 2nd & 3rd Floor", 5, false, true, false),
  room(7576, "1-J Hybrid Group Room (1st floor, EL1337)", "Hybrid Group Rooms", 10, true, true, true),
  room(7577, "1-K Hybrid Group Room (1st floor, EL1341)", "Hybrid Group Rooms", 8, true, true, true),
  room(7578, "2-G group room (2nd floor, EL2155)", "Group Rooms - 2nd & 3rd Floor", 5, false, true, false),
  room(7579, "2-H group room (2nd floor, EL2258)", "Group Rooms - 2nd & 3rd Floor", 5, false, true, false),
  room(7580, "2-I group room (2nd floor, EL2256)", "Group Rooms - 2nd & 3rd Floor", 5, true, true, false),
  room(7581, "2-J group room (2nd floor, EL2342)", "Group Rooms - 2nd & 3rd Floor", 5, false, true, false),
  room(7582, "2-K group room (2nd floor, EL2344)", "Group Rooms - 2nd & 3rd Floor", 5, false, true, false),
  room(7583, "2-N group room (2nd floor, EL2441A)", "Group Rooms - 2nd & 3rd Floor", 5, false, true, false),
  room(7584, "2-O group room (2nd floor, EL2441B)", "Group Rooms - 2nd & 3rd Floor", 5, false, true, false),
  room(7585, "2-P group room (2nd floor, EL2405)", "Group Rooms - 2nd & 3rd Floor", 5, false, true, false),
  room(7586, "2-Q group room (2nd floor, EL2407)", "Group Rooms - 2nd & 3rd Floor", 5, false, true, false),
  room(7589, "3-C group room (3rd floor, EL3353)", "Group Rooms - 2nd & 3rd Floor", 5, false, true, false),
  room(7592, "3-F group room (3rd floor, EL3355)", "Group Rooms - 2nd & 3rd Floor", 5, false, true, false),
  room(33285, "Pod 1", "Individual Study Pods", 1, false, true, false),
  room(33305, "Pod 2", "Individual Study Pods", 1, false, true, false),
  room(33307, "Pod 3", "Individual Study Pods", 1, false, true, false),
  room(33308, "Pod 4", "Individual Study Pods", 1, false, true, false),
  room(33309, "Pod 5", "Individual Study Pods", 1, false, true, false),
  room(33310, "Pod 6", "Individual Study Pods", 1, false, true, false),
  room(33311, "Pod 7", "Individual Study Pods", 1, false, true, false),
  room(33317, "Pod 8", "Individual Study Pods", 1, false, true, false),
  room(33379, "Pod 9 (Priority Seating for Accessibility)", "Individual Study Pods", 1, true, true, false),
  room(35064, "1-M group room (1st floor, EL1132)", "Group Rooms - 1st Floor", 5, false, false, false),
];

/** Spaces marked "temporarily unavailable" at snapshot time. */
export const UNAVAILABLE_ROOM_IDS: number[] = [7587, 7588, 7590, 7591, 33380, 35502];
