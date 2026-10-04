export type Dir = 0 | 1 | 2 | 3; // down, left, right, up (matches sprite sheet rows)
export type Face = "down" | "left" | "right" | "up";
/** [x, y, w, h] in room pixels (room images are 1280x720). */
export type Rect = [number, number, number, number];
export interface AppDef { name: string; url: string }
export interface AgentDef { name: string; title: string; owns: string[]; links: string[]; body: string; hair: string; skin: string }
export interface DoorDef { id: string; rect: Rect; spawn: [number, number]; face: Face; to: string; toDoor: string }
export interface BoardDef { x: number; y: number; kind: string; title: string }
export interface RoomDef {
  id: string; name: string; owner?: string; theme: string; w: number; h: number;
  /** Minimap cell [col, row] or [col, row, colSpan, rowSpan]. */
  map: number[];
  spawn: [number, number]; board?: BoardDef; links: string[];
  /** Optional wall strip that also opens the board (Trading Floor red flags). */
  redflags?: Rect;
  agents: { id: string; x: number; y: number }[]; doors: DoorDef[];
  /** Feet-walkable floor = union of walkable rects minus blocked rects. */
  walkable: Rect[]; blocked: Rect[];
}
export interface PlayerDef { id: string; name: string; body: string; hair: string; skin: string }
export interface World {
  version: number; cell: number; startRoom: string; priorityRooms: string[]; spriteHeight: number; player: PlayerDef;
  apps: Record<string, AppDef>; plannedApps: string[]; agents: Record<string, AgentDef>; rooms: RoomDef[];
}
