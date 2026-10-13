import type { World } from '../physics/World';
import type { Vec2 } from '../physics/Vec2';
import type { RampPoint } from '../physics/types';
import { DEG } from '../core/math';

/**
 * Flagship table: "Diamond Stadium".
 *
 * Coordinates are table units: x across (0 = left edge, 22 = right edge
 * including the launch lane), y up the table (0 = drain, 44 = top of the arc).
 * The playable field proper spans x 0..20.2; the launch lane is x 20.2..22.
 */
export const TABLE = {
  width: 22,
  playWidth: 20.2,
  length: 44,
  arcCenter: { x: 11, y: 33 },
  arcRadius: 11,
  launchX: 21.1,
  ballRadius: 0.5,
} as const;

/** Mirror an x coordinate across the centre of the playfield proper. */
export const mx = (x: number): number => TABLE.playWidth - x;

export interface WallDef {
  id: string;
  points: Vec2[];
  /** Visual height of the wall above the playfield. */
  height: number;
  style: 'wood' | 'metal' | 'rubber' | 'plastic' | 'fence';
}
export interface PostDef {
  id: string;
  pos: Vec2;
  radius: number;
}
export interface BumperDef {
  id: string;
  pos: Vec2;
  radius: number;
}
export interface TargetDef {
  id: string;
  a: Vec2;
  b: Vec2;
  bank: 'leftField' | 'rightField' | 'bases';
  label: string;
  kind: 'drop' | 'standup';
}
export interface LampDef {
  id: string;
  pos: Vec2;
  color: number;
  label?: string;
}
export interface RampVisualDef {
  id: string;
  path: RampPoint[];
  color: number;
  entrance: { a: Vec2; b: Vec2 };
}
export interface FlipperVisualDef {
  id: string;
  side: 'left' | 'right';
  pivot: Vec2;
  length: number;
  baseRadius: number;
  tipRadius: number;
}
export interface SlingshotDef {
  id: string;
  points: [Vec2, Vec2, Vec2];
  kickFaceIndex: number;
}
export interface LaneDef {
  id: string;
  a: Vec2;
  b: Vec2;
  label: string;
}

export interface TableDef {
  walls: WallDef[];
  posts: PostDef[];
  bumpers: BumperDef[];
  targets: TargetDef[];
  lamps: LampDef[];
  ramps: RampVisualDef[];
  flippers: FlipperVisualDef[];
  slingshots: SlingshotDef[];
  lanes: LaneDef[];
  saucer: { pos: Vec2; radius: number };
  launch: { x: number; bottomY: number; topY: number };
  diamond: DiamondDef;
  kickback: { pos: Vec2 };
  /** The pitcher's mound post target in the middle of the diamond. */
  mound: { pos: Vec2; radius: number };
  /** Temporary rebound surfaces that close the outlanes during WALL BOUNCE. */
  blockers: Array<{ id: string; a: Vec2; b: Vec2 }>;
  /** Outfield wall sections (arc segment id ranges) with their distance markers. */
  wallSections: Array<{ id: 'left' | 'center' | 'right'; from: number; to: number; marker: string; pos: Vec2 }>;
  /** The miniature-world attractions wired into the table. */
  attractions: AttractionLayout;
}

/**
 * Physical anchors of the attractions. The city lives on the left wing deck
 * (negative table x, outside the playfield) and is reached through a diverter
 * on the left ramp; the reactor core sits in the middle of the pop-bumper nest
 * and is fed by the centre lane.
 */
export interface AttractionLayout {
  city: {
    /** Diverted ramp: shares the left ramp's mouth and first points, ends parked in the garage. */
    track: RampPoint[];
    /** Skyway back to the left inlane. */
    returnTrack: RampPoint[];
    garage: RampPoint;
    /** Main Street: the race runs from `start` (back) to `end` (front) on the deck. */
    street: { x: number; start: number; end: number; laneWidth: number; deckH: number };
    /** The stunt kicker at the end of Main Street and the rooftop it jumps to. */
    stunt: { ramp: Vec2; roof: Vec2; roofH: number };
    /** Wing deck footprint (table coordinates). */
    deck: { minX: number; maxX: number; minY: number; maxY: number; h: number };
  };
  reactor: { core: Vec2; radius: number; ejectVel: Vec2 };
  midway: { deck: { minX: number; maxX: number; minY: number; maxY: number; h: number } };
}

export const CITY_DECK_H = 1.2;

/** The diverted left ramp: up the left side, over the orbit and the wall, down into the city garage. */
export const CITY_TRACK: RampPoint[] = [
  { x: 4.5, y: 25.5, h: 0 },
  { x: 4.4, y: 28.6, h: 1.1 },
  { x: 4.0, y: 32.2, h: 2.3 },
  { x: 2.6, y: 33.4, h: 3.0 },
  { x: 0.4, y: 33.0, h: 3.3 },
  { x: -1.8, y: 31.6, h: 3.1 },
  { x: -3.7, y: 29.6, h: 2.6 },
  { x: -5.0, y: 28.0, h: 2.1 },
  { x: -5.2, y: 26.9, h: CITY_DECK_H + 0.5 },
];

/** The skyway home: along the far side of the city, across the front and back into the left inlane. */
export const CITY_RETURN: RampPoint[] = [
  { x: -5.2, y: 26.9, h: CITY_DECK_H + 0.5 },
  { x: -6.8, y: 25.6, h: 3.0 },
  { x: -9.0, y: 22.0, h: 4.4 },
  { x: -9.0, y: 13.5, h: 4.4 },
  { x: -7.6, y: 10.8, h: 4.2 },
  { x: -4.2, y: 12.4, h: 3.8 },
  { x: -0.6, y: 13.3, h: 3.1 },
  { x: 1.5, y: 13.4, h: 2.1 },
  { x: 2.5, y: 13.1, h: 0.9 },
  { x: 2.7, y: 12.4, h: 0 },
];

export interface DiamondDef {
  home: Vec2;
  first: Vec2;
  second: Vec2;
  third: Vec2;
  mound: Vec2;
  /** Default fielder positions keyed by position code. */
  fielders: Record<string, Vec2>;
  batter: Vec2;
  catcher: Vec2;
  onDeck: Vec2;
  /** Centre of the outfield wall arc (same as the table arc). */
  wallCenter: Vec2;
  wallRadius: number;
}

export const DIAMOND: DiamondDef = {
  home: { x: 10.1, y: 15.0 },
  first: { x: 14.1, y: 19.0 },
  second: { x: 10.1, y: 23.0 },
  third: { x: 6.1, y: 19.0 },
  mound: { x: 10.1, y: 18.6 },
  fielders: {
    P: { x: 10.1, y: 18.6 },
    C: { x: 10.1, y: 13.9 },
    '1B': { x: 14.9, y: 19.9 },
    '2B': { x: 12.6, y: 22.3 },
    SS: { x: 7.6, y: 22.3 },
    '3B': { x: 5.3, y: 19.9 },
    LF: { x: 5.2, y: 33.6 },
    CF: { x: 10.3, y: 39.6 },
    RF: { x: 15.4, y: 33.6 },
  },
  batter: { x: 10.95, y: 15.1 },
  catcher: { x: 10.1, y: 13.9 },
  onDeck: { x: 12.9, y: 13.0 },
  wallCenter: { x: 11, y: 33 },
  wallRadius: 11,
};

const arcPoints = (fromDeg: number, toDeg: number, steps: number, c = TABLE.arcCenter, r = TABLE.arcRadius): Vec2[] => {
  const pts: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (fromDeg + ((toDeg - fromDeg) * i) / steps) * DEG;
    pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return pts;
};

const mirrorPath = (path: RampPoint[]): RampPoint[] => path.map((p) => ({ x: mx(p.x), y: p.y, h: p.h }));

export const LEFT_RAMP_PATH: RampPoint[] = [
  { x: 4.5, y: 25.5, h: 0 },
  { x: 4.4, y: 28.6, h: 1.1 },
  { x: 4.0, y: 32.2, h: 2.3 },
  { x: 4.3, y: 36.2, h: 3.3 },
  { x: 6.6, y: 40.4, h: 3.9 },
  { x: 11.0, y: 42.3, h: 4.1 },
  { x: 15.4, y: 40.6, h: 3.9 },
  { x: 18.5, y: 36.8, h: 3.5 },
  { x: 19.4, y: 32.0, h: 3.0 },
  { x: 19.4, y: 26.0, h: 2.3 },
  { x: 18.6, y: 19.0, h: 1.3 },
  { x: 17.6, y: 13.8, h: 0.5 },
  { x: 17.5, y: 12.4, h: 0 },
];

export const RIGHT_RAMP_PATH: RampPoint[] = mirrorPath(LEFT_RAMP_PATH).map((p, i) =>
  // The right ramp crosses above the left ramp at the top of the table.
  i >= 3 && i <= 7 ? { ...p, h: p.h + 1.1 } : p,
);

export const HOME_RUN_PATH: RampPoint[] = [];

/**
 * Builds every physical element of the flagship table into the world and
 * returns the matching visual definition for the renderer.
 */
export function buildTable(world: World): TableDef {
  const def: TableDef = {
    walls: [],
    posts: [],
    bumpers: [],
    targets: [],
    lamps: [],
    ramps: [],
    flippers: [],
    slingshots: [],
    lanes: [],
    saucer: { pos: { x: 18.7, y: 29.0 }, radius: 0.9 },
    launch: { x: TABLE.launchX, bottomY: 1.2, topY: 31.5 },
    diamond: DIAMOND,
    kickback: { pos: { x: 0.9, y: 3.2 } },
    mound: { pos: { x: DIAMOND.mound.x, y: DIAMOND.mound.y }, radius: 0.55 },
    blockers: [],
    wallSections: [
      { id: 'left', from: 0, to: 11, marker: '330', pos: { x: 2.4, y: 38.4 } },
      { id: 'center', from: 12, to: 23, marker: '410', pos: { x: 11, y: 43.2 } },
      { id: 'right', from: 24, to: 35, marker: '330', pos: { x: 19.6, y: 38.4 } },
    ],
    attractions: {
      city: {
        track: CITY_TRACK,
        returnTrack: CITY_RETURN,
        garage: CITY_TRACK[CITY_TRACK.length - 1],
        street: { x: -5.2, start: 25.2, end: 7.4, laneWidth: 1.05, deckH: CITY_DECK_H },
        stunt: { ramp: { x: -5.2, y: 6.6 }, roof: { x: -5.2, y: 2.4 }, roofH: 4.2 },
        deck: { minX: -9.8, maxX: -0.7, minY: -0.4, maxY: 31.8, h: CITY_DECK_H },
      },
      reactor: { core: { x: 10.25, y: 32.5 }, radius: 0.85, ejectVel: { x: -26, y: 26 } },
      midway: { deck: { minX: 22.7, maxX: 31.8, minY: -0.4, maxY: 31.8, h: CITY_DECK_H } },
    },
  };

  const wall = (id: string, points: Vec2[], style: WallDef['style'] = 'wood', height = 1.3, opts: { restitution?: number; kind?: 'wall' | 'rubber' } = {}) => {
    world.addPolyline(id, points, { kind: opts.kind ?? 'wall', restitution: opts.restitution ?? (style === 'rubber' ? 0.75 : 0.45) });
    def.walls.push({ id, points, height, style });
  };
  const post = (id: string, pos: Vec2, radius = 0.32) => {
    world.addCircle(id, pos, radius, { kind: 'post', restitution: 0.8 });
    def.posts.push({ id, pos, radius });
  };

  // ------------------------------------------------------------ outer walls
  const arc = arcPoints(180, 0, 36);
  wall('outer_left', [{ x: 0, y: 0 }, { x: 0, y: 33 }], 'wood', 1.4);
  wall('outer_arc', arc, 'fence', 1.4, { restitution: 0.5 });
  wall('outer_right', [{ x: 22, y: 33 }, { x: 22, y: 0 }], 'wood', 1.4);
  // Launch lane wall and plunger stop.
  wall('launch_wall', [{ x: 20.2, y: 0 }, { x: 20.2, y: 31.5 }], 'metal', 1.0);
  post('launch_wall_top', { x: 20.2, y: 31.5 }, 0.25);
  wall('launch_stop', [{ x: 20.2, y: 1.2 }, { x: 22, y: 1.2 }], 'metal', 0.6);
  // One-way shelf: lets the launched ball out but not back into the lane.
  world.addSegment('launch_gate', { x: 20.2, y: 32.3 }, { x: 22, y: 32.9 }, { kind: 'gate', oneWay: true, restitution: 0.3 });
  def.walls.push({ id: 'launch_gate', points: [{ x: 20.2, y: 32.3 }, { x: 22, y: 32.9 }], height: 0.5, style: 'metal' });
  world.addSensor({ id: 'launch_bottom', shape: { type: 'segment', a: { x: 20.2, y: 2.6 }, b: { x: 22, y: 2.6 } }, direction: { x: 0, y: -1 } });

  // ------------------------------------------------------------ in/out lanes
  wall('left_guide', [{ x: 1.8, y: 0 }, { x: 1.8, y: 12.6 }], 'metal', 1.0);
  post('left_guide_post', { x: 1.8, y: 12.6 }, 0.3);
  wall('left_inlane_floor', [{ x: 1.8, y: 6.4 }, { x: 5.53, y: 4.69 }], 'metal', 1.0);
  wall('right_guide', [{ x: 18.4, y: 0 }, { x: 18.4, y: 12.6 }], 'metal', 1.0);
  post('right_guide_post', { x: 18.4, y: 12.6 }, 0.3);
  wall('right_inlane_floor', [{ x: 18.4, y: 6.4 }, { x: 14.67, y: 4.69 }], 'metal', 1.0);
  // Outlane + inlane rollover sensors.
  world.addSensor({ id: 'left_outlane', shape: { type: 'segment', a: { x: 0, y: 4.2 }, b: { x: 1.8, y: 4.2 } }, direction: { x: 0, y: -1 } });
  world.addSensor({ id: 'right_outlane', shape: { type: 'segment', a: { x: 18.4, y: 4.2 }, b: { x: 20.2, y: 4.2 } }, direction: { x: 0, y: -1 } });
  world.addSensor({ id: 'left_inlane', shape: { type: 'segment', a: { x: 1.8, y: 9.0 }, b: { x: 3.6, y: 9.0 } }, direction: { x: 0, y: -1 } });
  world.addSensor({ id: 'right_inlane', shape: { type: 'segment', a: { x: 16.6, y: 9.0 }, b: { x: 18.4, y: 9.0 } }, direction: { x: 0, y: -1 } });
  def.lamps.push({ id: 'lamp_kickback', pos: { x: 0.9, y: 5.4 }, color: 0x4fd1ff, label: 'KICKBACK' });

  // ------------------------------------------------------------ flippers
  const flipperLen = 4.2;
  world.addFlipper({
    id: 'left_flipper', side: 'left', pivot: { x: 5.3, y: 4.3 }, length: flipperLen,
    baseRadius: 0.5, tipRadius: 0.32, restAngle: -28 * DEG, activeAngle: 30 * DEG,
    omegaUp: 32, omegaDown: 17, restitution: 0.55,
  });
  world.addFlipper({
    id: 'right_flipper', side: 'right', pivot: { x: 14.9, y: 4.3 }, length: flipperLen,
    baseRadius: 0.5, tipRadius: 0.32, restAngle: Math.PI + 28 * DEG, activeAngle: Math.PI - 30 * DEG,
    omegaUp: 32, omegaDown: 17, restitution: 0.55,
  });
  def.flippers.push(
    { id: 'left_flipper', side: 'left', pivot: { x: 5.3, y: 4.3 }, length: flipperLen, baseRadius: 0.5, tipRadius: 0.32 },
    { id: 'right_flipper', side: 'right', pivot: { x: 14.9, y: 4.3 }, length: flipperLen, baseRadius: 0.5, tipRadius: 0.32 },
  );

  // ------------------------------------------------------------ slingshots
  const sling = (id: string, pts: [Vec2, Vec2, Vec2]) => {
    // Edges: 0->1 outer (wall), 1->2 kicker face, 2->0 lower face.
    world.addSegment(`${id}_outer`, pts[0], pts[1], { kind: 'wall', restitution: 0.5 });
    world.addSegment(`${id}_kick`, pts[1], pts[2], { kind: 'slingshot', restitution: 0.6, kick: 95, minEventSpeed: 4 });
    world.addSegment(`${id}_low`, pts[2], pts[0], { kind: 'rubber', restitution: 0.7 });
    def.slingshots.push({ id, points: pts, kickFaceIndex: 1 });
  };
  sling('left_sling', [{ x: 3.4, y: 7.4 }, { x: 3.9, y: 11.4 }, { x: 5.9, y: 8.0 }]);
  sling('right_sling', [{ x: mx(3.4), y: 7.4 }, { x: mx(3.9), y: 11.4 }, { x: mx(5.9), y: 8.0 }]);

  // ------------------------------------------------------------ drop target banks (LEFT FIELD / RIGHT FIELD)
  const bank = (bankId: 'leftField' | 'rightField', mirror: boolean, labels: string[]) => {
    const m = (p: Vec2): Vec2 => (mirror ? { x: mx(p.x), y: p.y } : p);
    const start = m({ x: 1.05, y: 14.3 });
    const end = m({ x: 3.35, y: 18.9 });
    const back0 = m({ x: 0.6, y: 14.0 });
    const back1 = m({ x: 3.05, y: 18.85 });
    const back2 = m({ x: 1.8, y: 20.6 });
    const back3 = m({ x: 0, y: 21.0 });
    const base = m({ x: 0, y: 13.3 });
    wall(`${bankId}_backing`, [base, back0, back1, back2, back3], 'plastic', 1.2);
    const n = labels.length;
    for (let i = 0; i < n; i++) {
      const t0 = (i + 0.08) / n;
      const t1 = (i + 0.92) / n;
      const a = { x: start.x + (end.x - start.x) * t0, y: start.y + (end.y - start.y) * t0 };
      const b = { x: start.x + (end.x - start.x) * t1, y: start.y + (end.y - start.y) * t1 };
      const id = `${bankId}_${i}`;
      world.addSegment(id, a, b, { kind: 'target', restitution: 0.4, minEventSpeed: 5 });
      def.targets.push({ id, a, b, bank: bankId, label: labels[i], kind: 'drop' });
    }
    def.lamps.push({ id: `lamp_${bankId}`, pos: m({ x: 4.4, y: 15.2 }), color: 0xffb13b, label: bankId === 'leftField' ? 'LEFT FIELD' : 'RIGHT FIELD' });
  };
  bank('leftField', false, ['L', 'F', '!']);
  bank('rightField', true, ['R', 'F', '!']);

  // ------------------------------------------------------------ home run lane (far left)
  wall('hr_lane_guide', [{ x: 2.6, y: 24.0 }, { x: 2.6, y: 33.4 }], 'metal', 1.1);
  post('hr_lane_post', { x: 2.6, y: 24.0 }, 0.3);
  world.addSensor({ id: 'hr_lane', shape: { type: 'segment', a: { x: 0, y: 30 }, b: { x: 2.6, y: 30 } }, direction: { x: 0, y: 1 }, minSpeed: 25 });
  def.lanes.push({ id: 'hr_lane', a: { x: 0, y: 30 }, b: { x: 2.6, y: 30 }, label: 'HOME RUN' });
  def.lamps.push({ id: 'lamp_hr', pos: { x: 1.3, y: 26.6 }, color: 0xff3b3b, label: 'HOME RUN' });

  // ------------------------------------------------------------ ramps
  const ramp = (id: string, mirror: boolean, path: RampPoint[], color: number) => {
    const m = (p: Vec2): Vec2 => (mirror ? { x: mx(p.x), y: p.y } : p);
    const lx = 3.0;
    const rx = 6.0;
    const top = 27.6;
    wall(`${id}_wall_l`, [m({ x: lx, y: 24.0 }), m({ x: lx, y: top })], 'metal', 1.0);
    wall(`${id}_wall_r`, [m({ x: rx, y: 24.0 }), m({ x: rx, y: top })], 'metal', 1.0);
    post(`${id}_post_l`, m({ x: lx, y: 24.0 }), 0.3);
    post(`${id}_post_r`, m({ x: rx, y: 24.0 }), 0.3);
    // Back wall catches balls too slow to climb.
    wall(`${id}_back`, [m({ x: lx, y: top }), m({ x: rx, y: top })], 'plastic', 1.0, { restitution: 0.35 });
    const entrance = { a: m({ x: lx, y: 25.5 }), b: m({ x: rx, y: 25.5 }) };
    world.addRamp({ id, entrance, direction: { x: 0, y: 1 }, minSpeed: 42, fullSpeed: 116, path, exitSpeed: 0.75, exitDirection: { x: 0, y: -1 } });
    def.ramps.push({ id, path, color, entrance });
    def.lamps.push({ id: `lamp_${id}`, pos: m({ x: 4.5, y: 22.6 }), color, label: mirror ? 'RIGHT RAMP' : 'LEFT RAMP' });
  };
  ramp('left_ramp', false, LEFT_RAMP_PATH, 0x3bb0ff);
  ramp('right_ramp', true, RIGHT_RAMP_PATH, 0xff8a3b);
  // City diverter tracks: never entered through a mouth, only switched onto.
  const far = { x: -50, y: -50 };
  world.addRamp({ id: 'city_track', entrance: { a: far, b: far }, direction: { x: 0, y: 1 }, minSpeed: 999, fullSpeed: 1000, path: CITY_TRACK, exitSpeed: 0.5, exitDirection: { x: 0, y: -1 }, enabled: false, endHold: { seconds: 25, releaseRamp: 'city_return' } });
  world.addRamp({ id: 'city_return', entrance: { a: far, b: far }, direction: { x: 0, y: 1 }, minSpeed: 999, fullSpeed: 1000, path: CITY_RETURN, exitSpeed: 0.55, exitDirection: { x: 0.05, y: -1 }, enabled: false });
  // Traffic signals that light the city diverter.
  def.lamps.push({ id: 'lamp_city_0', pos: { x: 3.7, y: 21.0 }, color: 0x3bff9a, label: 'CITY' });
  def.lamps.push({ id: 'lamp_city_1', pos: { x: 4.5, y: 21.0 }, color: 0x3bff9a, label: 'CITY' });
  def.lamps.push({ id: 'lamp_city_2', pos: { x: 5.3, y: 21.0 }, color: 0x3bff9a, label: 'CITY' });

  // ------------------------------------------------------------ centre lane (2B) + base standup targets
  wall('center_guide_l', [{ x: 8.9, y: 23.8 }, { x: 8.9, y: 26.8 }], 'metal', 1.0);
  wall('center_guide_r', [{ x: 11.3, y: 23.8 }, { x: 11.3, y: 26.8 }], 'metal', 1.0);
  post('center_post_l', { x: 8.9, y: 23.8 }, 0.3);
  post('center_post_r', { x: 11.3, y: 23.8 }, 0.3);
  post('center_post_lt', { x: 8.9, y: 26.8 }, 0.3);
  post('center_post_rt', { x: 11.3, y: 26.8 }, 0.3);
  world.addSensor({ id: 'center_lane', shape: { type: 'segment', a: { x: 8.9, y: 25.6 }, b: { x: 11.3, y: 25.6 } }, direction: { x: 0, y: 1 }, minSpeed: 12 });
  def.lanes.push({ id: 'center_lane', a: { x: 8.9, y: 25.6 }, b: { x: 11.3, y: 25.6 }, label: '2B' });
  def.lamps.push({ id: 'lamp_2b', pos: { x: 10.1, y: 24.6 }, color: 0xfff176, label: '2B' });
  def.lamps.push({ id: 'lamp_power1', pos: { x: 9.3, y: 21.4 }, color: 0x7cff5a, label: 'POWER' });
  def.lamps.push({ id: 'lamp_power2', pos: { x: 10.1, y: 21.4 }, color: 0x7cff5a, label: 'POWER' });
  def.lamps.push({ id: 'lamp_power3', pos: { x: 10.9, y: 21.4 }, color: 0x7cff5a, label: 'POWER' });

  // Standup base targets fill the gaps between the ramps and the centre lane.
  const standup = (id: string, a: Vec2, b: Vec2, label: string) => {
    world.addSegment(id, a, b, { kind: 'target', restitution: 0.5, minEventSpeed: 5 });
    def.targets.push({ id, a, b, bank: 'bases', label, kind: 'standup' });
  };
  standup('base_3b', { x: 6.0, y: 24.4 }, { x: 8.9, y: 24.4 }, '3B');
  standup('base_1b', { x: 11.3, y: 24.4 }, { x: 14.2, y: 24.4 }, '1B');
  // A single sloped "roof" covers the ramp housings and standups so no ball can
  // ever come to rest on top of them: anything dropping from the bumpers rolls
  // down to the centre lane and back into play.
  wall('roof_left', [{ x: 2.6, y: 29.6 }, { x: 9.2, y: 27.1 }], 'plastic', 1.2, { restitution: 0.3 });
  wall('roof_right', [{ x: 11.0, y: 27.1 }, { x: 17.2, y: 29.6 }], 'plastic', 1.2, { restitution: 0.3 });
  def.lamps.push({ id: 'lamp_3b', pos: { x: 7.45, y: 23.2 }, color: 0xfff176, label: '3B' });
  def.lamps.push({ id: 'lamp_1b', pos: { x: 12.75, y: 23.2 }, color: 0xfff176, label: '1B' });

  // ------------------------------------------------------------ dugout saucer (lock / multiball)
  wall('dugout_pocket', [{ x: 17.2, y: 27.6 }, { x: 17.2, y: 30.6 }, { x: 18.7, y: 31.0 }, { x: 20.2, y: 31.5 }], 'plastic', 1.1, { restitution: 0.25 });
  world.addSensor({ id: 'dugout', shape: { type: 'circle', center: def.saucer.pos, radius: def.saucer.radius }, minSpeed: 0 });
  def.lamps.push({ id: 'lamp_lock', pos: { x: 18.7, y: 26.4 }, color: 0xc77dff, label: 'LOCK' });

  // ------------------------------------------------------------ pop bumpers
  const bumper = (id: string, pos: Vec2) => {
    world.addCircle(id, pos, 1.25, { kind: 'bumper', restitution: 0.4, kick: 105, minEventSpeed: 2 });
    def.bumpers.push({ id, pos, radius: 1.25 });
  };
  bumper('bumper_l', { x: 7.4, y: 31.2 });
  bumper('bumper_r', { x: 13.2, y: 31.2 });
  bumper('bumper_c', { x: 10.3, y: 35.4 });

  // ------------------------------------------------------------ top rollover lanes (skill shot)
  const laneX = [3.4, 5.6, 7.8];
  for (let i = 0; i < laneX.length; i++) {
    wall(`top_divider_${i}`, [{ x: laneX[i], y: 36.4 }, { x: laneX[i], y: 39.6 }], 'metal', 1.0);
    post(`top_divider_${i}_b`, { x: laneX[i], y: 36.4 }, 0.28);
    post(`top_divider_${i}_t`, { x: laneX[i], y: 39.6 }, 0.28);
  }
  const laneBounds = [0.6, 3.4, 5.6, 7.8];
  const laneLabels = ['BALL', 'STRIKE', 'OUT'];
  for (let i = 0; i < 3; i++) {
    const a = { x: laneBounds[i], y: 38.0 };
    const b = { x: laneBounds[i + 1], y: 38.0 };
    world.addSensor({ id: `top_lane_${i}`, shape: { type: 'segment', a, b }, direction: { x: 0, y: -1 }, minSpeed: 4 });
    def.lanes.push({ id: `top_lane_${i}`, a, b, label: laneLabels[i] });
    def.lamps.push({ id: `lamp_top_${i}`, pos: { x: (a.x + b.x) / 2, y: 35.6 }, color: 0xffffff, label: laneLabels[i] });
  }

  // Rubber posts that keep the upper field lively.
  post('upper_post_a', { x: 16.2, y: 36.6 }, 0.34);
  post('upper_post_b', { x: 18.9, y: 34.6 }, 0.34);

  // Kickback sensor region (left outlane, when lit).
  world.addSensor({ id: 'kickback', shape: { type: 'segment', a: { x: 0, y: 2.8 }, b: { x: 1.8, y: 2.8 } }, direction: { x: 0, y: -1 } });

  // ------------------------------------------------------------ the diamond itself
  // Pitcher's mound: a rollover in the middle of the infield (never a post, so
  // the centre-lane shot stays open). Rolling over it fast rattles the pitcher
  // (offense) or fires a strike (defense) and lights home plate.
  world.addSensor({ id: 'mound', shape: { type: 'circle', center: def.mound.pos, radius: def.mound.radius + 0.25 }, minSpeed: 18 });
  def.lamps.push({ id: 'lamp_mound', pos: { x: DIAMOND.mound.x, y: DIAMOND.mound.y - 1.4 }, color: 0xffffff, label: 'MOUND' });
  // Home plate rollover: a lit plate scores the squeeze play.
  world.addSensor({ id: 'home_plate', shape: { type: 'circle', center: DIAMOND.home, radius: 0.9 }, minSpeed: 6 });
  def.lamps.push({ id: 'lamp_plate', pos: { x: DIAMOND.home.x, y: DIAMOND.home.y - 1.3 }, color: 0xff8a3b, label: 'HOME' });
  // Outfield wall distance markers (lit per section during THE WALL).
  for (const ws of def.wallSections) def.lamps.push({ id: `lamp_wall_${ws.id}`, pos: ws.pos, color: 0xffe14d, label: ws.marker });
  // Scoreboard cycle lamp above the centre bumper.
  def.lamps.push({ id: 'lamp_scoreboard', pos: { x: 10.3, y: 37.6 }, color: 0xc77dff, label: 'SCOREBOARD' });

  // ------------------------------------------------------------ reactor core (centre of the bumper nest)
  // A rollover cup: closed it feeds charge, open (CORE READY) it captures the ball.
  const core = def.attractions.reactor;
  world.addSensor({ id: 'reactor_core', shape: { type: 'circle', center: core.core, radius: core.radius }, minSpeed: 0 });
  def.lamps.push({ id: 'lamp_reactor', pos: { x: 10.1, y: 28.6 }, color: 0x4dfff3, label: 'CORE' });

  // ------------------------------------------------------------ WALL BOUNCE blockers (disabled until the modifier runs)
  const blocker = (id: string, a: Vec2, b: Vec2) => {
    world.addSegment(id, a, b, { kind: 'rubber', restitution: 0.9, enabled: false, minEventSpeed: 4 });
    def.blockers.push({ id, a, b });
  };
  blocker('blocker_left', { x: 0.15, y: 12.4 }, { x: 1.8, y: 12.4 });
  blocker('blocker_right', { x: 18.4, y: 12.4 }, { x: 20.05, y: 12.4 });
  blocker('blocker_center', { x: 8.6, y: 1.9 }, { x: 11.6, y: 1.9 });

  return def;
}
