// gf-three world generator (track D, "worlds"): a template's recipe + a size class + a seed → a concrete layout
// (config/world.json). Pure: no three.js, no DOM, no files; create, upgrade, the lint and verify (Node) and world.js
// (the browser) all expand a recipe the same way. Templates stay data (kit/world/templates/<id>.json).
//
//   generateLayout(recipe, { size: 'small' | 'medium' | 'large', seed })  → layout
//   SIZE_CLASSES, sizeClassOf(area), sizeOf(recipe, size)
//
// Two kinds of recipe:
//   indoor  (office, warehouse, school): a closed building. The size class picks the footprint and a room program
//           (bands of rooms along the outside walls, the main room in the middle). Rooms are joined by real doorways
//           (a spanning tree from the main room, plus loops from medium up); rooms marked `entry` get a door to the
//           outside, which is where enemies come in (`entries`). Walls stand on a 2 m module (windows on the outside,
//           glass where a room asks for it), a ceiling covers every room (world.js draws it as a cutaway: seen from
//           below, gone when the camera is above it), lamps hang from it, and each room is dressed by its zone
//           recipe from the template's furniture groups. Outside: a street (sidewalk, road, street lights) and city
//           blocks all round, so every window and doorway shows a place, not a plain.
//   outdoor (backyard, plaza, arena): the template's own hand-dressed layout is the small world. Larger sizes push
//           everything near an edge out with that edge (the middle keeps its set-pieces), fill the new floor with the
//           recipe's groups, and close the edge again: the recipe's edge pieces run all round with gaps only at the
//           gates (`entries`), and the backdrop ring moves out with it.
import { rng as makeRng, turn } from './layout.js';

// ---------- size classes ----------
// The play area per class, for 1–4 players (bots fill seats) and the third-person camera (5.2 m behind the shoulder,
// 60° field of view, so about 10–12 m of floor reads clearly in front of a player; walking speed 5.2 m/s):
//   small   one main space a party can see across: 350–950 m² (crossing it takes about 5 s; every player in view)
//   medium  several spaces joined by doors or paths: 1000–1800 m² (about 7 s across; players split up and regroup,
//           enemies come from two or more sides, rooms break the sightlines)
//   large   a building or park to roam: 1900–3200 m² (about 9 s across; several routes between any two spaces)
export const SIZE_CLASSES = {
  small: { area: [350, 950], spaces: 1, entries: 1, describe: 'one main space everyone can see across (about 5 s to cross)' },
  medium: { area: [1000, 1800], spaces: 3, entries: 2, describe: 'several rooms or areas joined by doors and paths (about 7 s to cross)' },
  large: { area: [1900, 3200], spaces: 5, entries: 3, describe: 'a building or park to roam, with more than one route between spaces (about 9 s to cross)' },
};
export const SIZES = Object.keys(SIZE_CLASSES);
export function sizeClassOf(area) { for (const [k, c] of Object.entries(SIZE_CLASSES)) if (area >= c.area[0] && area <= c.area[1]) return k; return area < SIZE_CLASSES.small.area[0] ? 'tiny' : area > SIZE_CLASSES.large.area[1] ? 'huge' : 'between'; }
/** The footprint [W, D] a recipe gives a size class. */
export function sizeOf(recipe, size = 'small') { return recipe.sizes?.[size] ?? recipe.sizes?.small ?? recipe.size ?? [24, 24]; }

const r2 = v => Math.round(v * 100) / 100;
const norm = a => ((Math.round(a) % 360) + 360) % 360;
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function shuffle(list, R) { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const clone = v => JSON.parse(JSON.stringify(v));

/** A recipe + size + seed → a layout. The seed defaults to one per template and size (the same world every time). */
export function generateLayout(recipe, { size = 'small', seed = null } = {}) {
  if (!SIZE_CLASSES[size]) throw new Error(`gf-three world: unknown size "${size}" (${SIZES.join(', ')})`);
  const s = Number.isFinite(seed) ? seed >>> 0 : hash(`${recipe.template}|${size}`);
  const out = recipe.kind === 'indoor' ? building(recipe, size, s) : yard(recipe, size, s);
  out.generated = { by: 'kit/world/generate.js', recipe: recipe.template, size, seed: s };
  return out;
}

// ======================================================================================================== indoor
function building(recipe, size, seed) {
  const R = makeRng(seed);
  const [W, D] = sizeOf(recipe, size);
  const G = recipe.grid ?? 2;
  const shell = recipe.shell;
  const wallScale = shell.wallScale ?? [1, 1, 1];
  const wallTop = r2((shell.wallHeight ?? 2.579) * wallScale[1]);
  // the ceiling sits above the third-person camera's usual height (about 3.1 m), so the view under it shows the
  // ceiling; world.js closes the gap above the wall pieces with a band
  const H = Math.max(wallTop, recipe.ceiling?.height ?? wallTop);
  const prog = recipe.program[size];
  const flip = R() < 0.5 ? -1 : 1;                              // mirror left and right: same program, other hand

  // ---- rooms: bands along the outside walls, the main room in the middle ----
  let rest = [-W / 2, -D / 2, W / 2, D / 2];
  const rooms = [];
  const ids = new Map();
  const idFor = kind => { const n = (ids.get(kind) ?? 0) + 1; ids.set(kind, n); return n > 1 ? `${kind}-${n}` : kind; };
  for (const band of prog.bands ?? []) {
    let side = band.side;
    if (flip < 0 && (side === 'left' || side === 'right')) side = side === 'left' ? 'right' : 'left';
    const [x0, z0, x1, z1] = rest;
    const along = side === 'back' || side === 'front' ? x1 - x0 : z1 - z0;
    const d = band.depth;
    const brect = side === 'back' ? [x0, z0, x1, z0 + d] : side === 'front' ? [x0, z1 - d, x1, z1] : side === 'left' ? [x0, z0, x0 + d, z1] : [x1 - d, z0, x1, z1];
    rest = side === 'back' ? [x0, z0 + d, x1, z1] : side === 'front' ? [x0, z0, x1, z1 - d] : side === 'left' ? [x0 + d, z0, x1, z1] : [x0, z0, x1 - d, z1];
    // split the band along its length by the rooms' weights, on the grid (a room keeps at least 6 m)
    const list = band.order === 'fixed' ? band.rooms : shuffle(band.rooms, R);
    const total = list.reduce((n, r) => n + (r.weight ?? 1), 0);
    let at = 0;
    list.forEach((r, i) => {
      let len = i === list.length - 1 ? along - at : Math.max(6, Math.round((along * (r.weight ?? 1) / total) / G) * G);
      if (i < list.length - 1 && along - at - len < 6) len = along - at - 6;
      const a = at, b = at + len; at = b;
      const rect = side === 'back' || side === 'front' ? [brect[0] + a, brect[1], brect[0] + b, brect[3]] : [brect[0], brect[1] + a, brect[2], brect[1] + b];
      rooms.push({ id: idFor(r.kind), kind: r.kind, label: recipe.rooms[r.kind]?.label ?? r.kind, rect: rect.map(r2), ...(r.entry ? { entry: r.entry } : {}) });
    });
  }
  const main = { id: idFor(prog.main.kind), kind: prog.main.kind, label: recipe.rooms[prog.main.kind]?.label ?? prog.main.kind, rect: rest.map(r2), main: true, ...(prog.main.entry ? { entry: prog.main.entry } : {}) };
  rooms.unshift(main);

  // ---- walls: every room edge, split where rooms meet (a segment knows the rooms on its two sides) ----
  const segs = [];   // { axis: 'x' (runs along x at z = c) | 'z', c, a, b (from, to), rooms: [inside-or-low, high] }
  const edgesOf = r => { const [x0, z0, x1, z1] = r.rect; return [{ axis: 'x', c: z0, a: x0, b: x1, side: -1 }, { axis: 'x', c: z1, a: x0, b: x1, side: 1 }, { axis: 'z', c: x0, a: z0, b: z1, side: -1 }, { axis: 'z', c: x1, a: z0, b: z1, side: 1 }]; };
  const bx0 = -W / 2, bz0 = -D / 2, bx1 = W / 2, bz1 = D / 2;
  for (const r of rooms) for (const e of edgesOf(r)) {
    const outer = (e.axis === 'x' && (Math.abs(e.c - bz0) < 1e-6 || Math.abs(e.c - bz1) < 1e-6)) || (e.axis === 'z' && (Math.abs(e.c - bx0) < 1e-6 || Math.abs(e.c - bx1) < 1e-6));
    if (outer) { segs.push({ axis: e.axis, c: e.c, a: e.a, b: e.b, rooms: [r.id], outer: true, out: e.side }); continue; }
    // shared with the rooms across: one segment per overlap, recorded once (from the room on the low side)
    if (e.side !== 1) continue;
    for (const o of rooms) {
      if (o === r) continue;
      for (const f of edgesOf(o)) {
        if (f.axis !== e.axis || f.side !== -1 || Math.abs(f.c - e.c) > 1e-6) continue;
        const a = Math.max(e.a, f.a), b = Math.min(e.b, f.b);
        if (b - a >= G - 1e-6) segs.push({ axis: e.axis, c: e.c, a, b, rooms: [r.id, o.id], outer: false });
      }
    }
  }
  const modulesOf = s => { const n = Math.round((s.b - s.a) / G); return Array.from({ length: n }, (_, i) => s.a + G / 2 + i * G); };
  const doorModule = (s, prefer = null) => {
    const m = modulesOf(s);
    const ok = m.length >= 3 ? m.slice(1, -1) : m;                // keep doors off the corners
    if (prefer !== null) return ok.reduce((b, v) => (Math.abs(v - prefer) < Math.abs(b - prefer) ? v : b), ok[0]);
    return ok[Math.floor(R() * ok.length)];
  };
  // ---- doors between rooms: a spanning tree from the main room, then loops ----
  const inner = segs.filter(s => !s.outer && Math.round((s.b - s.a) / G) >= 2);
  const connected = new Set([main.id]);
  const doors = [];
  const doorOn = new Map();   // segment → module centre
  const addDoor = s => {
    const m = doorModule(s);
    doorOn.set(s, [...(doorOn.get(s) ?? []), m]);
    const at = s.axis === 'x' ? [r2(m), 0, s.c] : [s.c, 0, r2(m)];
    doors.push({ at, rooms: [...s.rooms], normal: s.axis === 'x' ? [0, 1] : [1, 0], width: shell.doorWidth ?? 1.71 });
  };
  for (let guard = 0; guard < 50 && connected.size < rooms.length; guard++) {
    // prefer a door into the main room; else into any room already reached
    const cands = inner.filter(s => connected.has(s.rooms[0]) !== connected.has(s.rooms[1]));
    if (!cands.length) break;
    const toMain = cands.filter(s => s.rooms.includes(main.id));
    const pick = (toMain.length ? toMain : cands)[Math.floor(R() * (toMain.length ? toMain.length : cands.length))];
    addDoor(pick);
    for (const id of pick.rooms) connected.add(id);
  }
  const loops = prog.loops ?? 0;
  for (const s of shuffle(inner.filter(x => !doorOn.has(x)), R).slice(0, loops)) addDoor(s);

  // ---- entries: a door to the outside for each room that asks (on its longest outside wall) ----
  const entries = [];
  for (const r of rooms) {
    if (!r.entry) continue;
    const outs = segs.filter(s => s.outer && s.rooms[0] === r.id).sort((a, b) => (b.b - b.a) - (a.b - a.a) || (a.axis === 'x' ? -1 : 1));
    const pref = r.entry === 'front' ? outs.find(s => s.axis === 'x' && s.out === 1) : r.entry === 'back' ? outs.find(s => s.axis === 'x' && s.out === -1) : null;
    const s = pref ?? outs[0];
    if (!s) continue;
    const [cx, cz] = [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2];
    const m = doorModule(s, s.axis === 'x' ? cx : cz);
    doorOn.set(s, [...(doorOn.get(s) ?? []), m]);
    const at = s.axis === 'x' ? [r2(m), 0, s.c] : [s.c, 0, r2(m)];
    const normal = s.axis === 'x' ? [0, s.out] : [s.out, 0];
    const name = r.main ? 'entrance' : entries.some(e => e.name === 'entrance') || r.entry !== 'front' ? `door-${r.id}` : 'entrance';
    entries.push({ name, room: r.id, at, normal, width: shell.doorWidth ?? 1.71 });
  }

  // ---- wall pieces ----
  const props = [];
  const place = (prop, at, rot = 0, scale = 1) => props.push({ prop, at: at.map(r2), rot: norm(rot), scale });
  const roomById = new Map(rooms.map(r => [r.id, r]));
  for (const s of segs) {
    const mods = modulesOf(s);
    const doorsHere = doorOn.get(s) ?? [];
    const rr = s.rooms.map(id => recipe.rooms[roomById.get(id)?.kind] ?? {});
    const glass = !s.outer && rr.some(x => x.partition === 'glass');
    mods.forEach((m, i) => {
      let piece = shell.wall;
      if (doorsHere.some(d => Math.abs(d - m) < 1e-6)) piece = shell.door;
      else if (s.outer) { const pat = shell.windows ?? [1, 1, 0]; piece = pat[(i + (s.axis === 'x' ? 0 : 1)) % pat.length] && i > 0 && i < mods.length - 1 ? shell.window : shell.wall; }
      else if (glass && i > 0 && i < mods.length - 1) piece = shell.window;
      const at = s.axis === 'x' ? [m, 0, s.c] : [s.c, 0, m];
      place(piece, at, s.axis === 'x' ? 0 : 90, wallScale);
    });
  }
  if (shell.corner) for (const [x, z] of [[bx0, bz0], [bx1, bz0], [bx0, bz1], [bx1, bz1]]) place(shell.corner, [x, 0, z], 0, wallScale);

  // ---- dressing: each room by its zone recipe ----
  const occupied = [];   // axis-aligned rects [x0, z0, x1, z1] nothing else may enter (furniture, door lanes, the atrium)
  const free = (q, pad = 0) => occupied.every(o => q[2] + pad <= o[0] || q[0] - pad >= o[2] || q[3] + pad <= o[1] || q[1] - pad >= o[3]);
  const lane = (at, normal, width, depth) => { const [nx, nz] = normal; const hw = width / 2 + 0.45; for (const k of [1, -1]) { const ex = at[0] + nx * k * depth, ez = at[2] + nz * k * depth; occupied.push([Math.min(at[0], ex) - (nx ? 0 : hw), Math.min(at[2], ez) - (nz ? 0 : hw), Math.max(at[0], ex) + (nx ? 0 : hw), Math.max(at[2], ez) + (nz ? 0 : hw)]); } };
  for (const d of doors) lane(d.at, d.normal, d.width, 2.4);
  for (const e of entries) lane(e.at, e.normal, e.width, 2.8);
  if (shell.corner) for (const [x, z] of [[bx0, bz0], [bx1, bz0], [bx0, bz1], [bx1, bz1]]) occupied.push([x - 0.7, z - 0.7, x + 0.7, z + 0.7]);
  const C = [r2((main.rect[0] + main.rect[2]) / 2), r2((main.rect[1] + main.rect[3]) / 2)];
  const clearR = recipe.rooms[main.kind]?.keepClear ?? 4.5;
  occupied.push([C[0] - clearR, C[1] - clearR, C[0] + clearR, C[1] + clearR]);
  const groups = recipe.groups ?? {};
  const putGroup = (gid, cx, cz, yaw) => {
    const g = groups[gid];
    for (const q of g.props) {
      const [lx, lz] = turn(q.at[0], q.at[2], yaw);
      props.push({ prop: q.prop, at: [r2(cx + lx), r2(q.at[1] ?? 0), r2(cz + lz)], rot: norm((q.rot ?? 0) + yaw), scale: q.scale ?? 1 });
    }
  };
  const extent = (g, yaw) => (norm(yaw) % 180 === 0 ? [g.size[0], g.size[1]] : [g.size[1], g.size[0]]);
  const inset = 0.12;
  for (const room of rooms) {
    const zr = recipe.rooms[room.kind] ?? {};
    const [x0, z0, x1, z1] = room.rect;
    for (const f of zr.fill ?? []) {
      const g = groups[f.group]; if (!g) continue;
      // how many: a [min, max] range, or `per100` per 100 m² of the room's floor
      const area = (x1 - x0) * (z1 - z0);
      const [lo, hi] = f.per100 ? [Math.round(area / 100 * f.per100), Math.round(area / 100 * f.per100)] : Array.isArray(f.count) ? f.count : [f.count ?? 1, f.count ?? 1];
      const want = lo + Math.floor(R() * (hi - lo + 1));
      let n = 0;
      const tryAt = (cx, cz, yaw) => {
        const [w, d] = extent(g, yaw);
        const q = [cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2];
        if (q[0] < x0 + inset - 1e-6 || q[2] > x1 - inset + 1e-6 || q[1] < z0 + inset - 1e-6 || q[3] > z1 - inset + 1e-6) return false;
        if (!free(q, f.gap ?? 0.5)) return false;
        occupied.push(q); putGroup(f.group, cx, cz, yaw); n++; return true;
      };
      if (f.where === 'wall' || f.where === 'corner') {
        // the group's back against a wall, its front (+z in the group) into the room
        // `side`: only the room's back (−z), front (+z, the street side) or its two ends (left/right as built)
        const all4 = [{ yaw: 0, fixed: z0 + inset, axis: 'x', name: 'back' }, { yaw: 180, fixed: z1 - inset, axis: 'x', name: 'front' }, { yaw: 90, fixed: x0 + inset, axis: 'z', name: 'end' }, { yaw: 270, fixed: x1 - inset, axis: 'z', name: 'end' }];
        const sides = shuffle(f.side ? all4.filter(sd => sd.name === f.side) : all4, R);
        for (const sd of sides) {
          if (n >= want) break;
          const [w, d] = extent(g, sd.yaw);
          const half = sd.axis === 'x' ? w / 2 : d / 2, deep = sd.axis === 'x' ? d / 2 : w / 2;
          const lo2 = (sd.axis === 'x' ? x0 : z0) + inset + half, hi2 = (sd.axis === 'x' ? x1 : z1) - inset - half;
          if (hi2 < lo2) continue;
          const sign = sd.yaw === 0 || sd.yaw === 90 ? 1 : -1;
          const fixed = sd.fixed + sign * deep;
          const spots = f.where === 'corner' ? [lo2, hi2] : shuffle(Array.from({ length: Math.floor((hi2 - lo2) / 0.5) + 1 }, (_, k) => lo2 + k * 0.5), R);
          for (const v of spots) { if (n >= want) break; if (sd.axis === 'x' ? tryAt(v, fixed, sd.yaw) : tryAt(fixed, v, sd.yaw)) if (f.where === 'wall' && !f.spread) break; }
        }
      } else if (f.where === 'centre') {
        // the middle of the room, else slid along its long side until it clears the door lanes
        const yaw = f.yaw ?? ((x1 - x0) >= (z1 - z0) ? 0 : 90);
        const offs = [];
        for (const a of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 3, -3]) for (const b of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) offs.push([a, b]);
        offs.sort((p, q) => Math.hypot(...p) - Math.hypot(...q));
        for (const [a, b] of offs) if (n < want && tryAt((x0 + x1) / 2 + a, (z0 + z1) / 2 + b, yaw)) break;
      } else {   // 'grid': rows of groups in the open floor, aisles between
        const yaw = f.yaw ?? (R() < 0.5 ? 0 : 90);
        const [w, d] = extent(g, yaw);
        const aisle = f.aisle ?? 1.6;
        const nx = Math.floor((x1 - x0 - 2 * aisle + aisle) / (w + aisle)), nz = Math.floor((z1 - z0 - 2 * aisle + aisle) / (d + aisle));
        const ox = (x0 + x1) / 2 - ((nx - 1) * (w + aisle)) / 2, oz = (z0 + z1) / 2 - ((nz - 1) * (d + aisle)) / 2;
        const cells = [];
        for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) cells.push([ox + i * (w + aisle), oz + j * (d + aisle)]);
        for (const [cx, cz] of shuffle(cells, R)) { if (n >= want) break; tryAt(cx, cz, yaw); }
      }
    }
    // lamps hang from the ceiling on a grid
    if (recipe.ceiling?.lamp) {
      const every = recipe.ceiling.lampEvery ?? 4;
      const nx = Math.max(1, Math.round((x1 - x0) / every)), nz = Math.max(1, Math.round((z1 - z0) / every));
      const ls = recipe.ceiling.lampScale ?? 1;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) place(recipe.ceiling.lamp, [x0 + (i + 0.5) * (x1 - x0) / nx, r2(H - (recipe.ceiling.lampDrop ?? 0.69) * ls), z0 + (j + 0.5) * (z1 - z0) / nz], 0, ls);
    }
  }

  // ---- spawns: a ring round the main room's middle (the atrium the goal stands in), facing it ----
  const spawns = [];
  const ringR = recipe.spawnRing ?? 3.2;
  for (let k = 0; k < 8; k++) { const a = (k + 0.5) * Math.PI / 4; spawns.push([r2(C[0] + Math.sin(a) * ringR), 0, r2(C[1] + Math.cos(a) * ringR)]); }

  // ---- zones: the middle, each room, the entrance ----
  const zones = { centre: { shape: 'circle', at: [C[0], 0, C[1]], size: [recipe.centreRadius ?? 1.4] } };
  for (const r of rooms) { const [a, b, c, d] = r.rect; zones[r.id] = { shape: 'box', at: [r2((a + c) / 2), 0, r2((b + d) / 2)], size: [r2(c - a - 1), 3, r2(d - b - 1)] }; }
  for (const e of entries) zones[e.name] = { shape: 'circle', at: [r2(e.at[0] - e.normal[0] * 1.6), 0, r2(e.at[2] - e.normal[1] * 1.6)], size: [1.2] };

  // ---- outside: a street and city blocks all round ----
  outsideStreet(recipe.outside, { W, D, R, place, props });

  const ground = clone(recipe.ground);
  return {
    template: recipe.template, label: recipe.label, describe: describeOf(recipe, size, rooms), kind: 'indoor', sizeClass: size, size: [W, D],
    ground, bounds: { walls: true, height: Math.max(4, H + 0.5) },
    ceiling: { height: H, ...clone(recipe.ceiling.look ?? {}) },
    bench: { stage: [C[0], 0, r2(C[1] + 2.4)], facing: 0 },
    rooms, doors, entries, props, scatter: [], spawns, zones,
  };
}

function describeOf(recipe, size, rooms) {
  const names = rooms.map(r => r.label.toLowerCase());
  return `${recipe.describe} ${size[0].toUpperCase()}${size.slice(1)}: ${names.length} ${names.length === 1 ? 'space' : 'rooms'} (${names.join(', ')}).`;
}

/** A street round a building: sidewalk slabs, a road ring with crossings at the corners, street lights, and city blocks. */
function outsideStreet(o, { W, D, R, place }) {
  if (!o) return;
  const sw = o.sidewalk?.width ?? 4, rw = o.road?.width ?? 8;
  // sidewalk slabs (4 m) round the walls
  if (o.sidewalk) {
    for (let x = -W / 2 - sw / 2; x <= W / 2 + sw / 2 + 1e-6; x += sw) for (const z of [-D / 2 - sw / 2, D / 2 + sw / 2]) place(o.sidewalk.prop, [x, 0, z], 0);
    for (let z = -D / 2 + sw / 2; z <= D / 2 - sw / 2 + 1e-6; z += sw) for (const x of [-W / 2 - sw / 2, W / 2 + sw / 2]) place(o.sidewalk.prop, [x, 0, z], 0);
  }
  // the road ring (8 m tiles; the footprints are multiples of 8 so the tiles meet)
  const ex = W / 2 + sw + rw / 2, ez = D / 2 + sw + rw / 2;
  if (o.road) {
    for (const [x, z] of [[-ex, -ez], [ex, -ez], [-ex, ez], [ex, ez]]) place(o.road.cross, [x, 0, z], 0);
    // the tile's lanes run along its x: roads along x stay at 0, roads along z turn 90
    for (let x = -ex + rw; x <= ex - rw + 1e-6; x += rw) for (const z of [-ez, ez]) place(o.road.prop, [x, 0, z], 0);
    for (let z = -ez + rw; z <= ez - rw + 1e-6; z += rw) for (const x of [-ex, ex]) place(o.road.prop, [x, 0, z], 90);
  }
  // street lights on the sidewalk's outer edge, arms over the road
  if (o.lights) {
    const every = o.lights.every ?? 12, off = sw - 0.5;
    for (let x = -W / 2 + every / 2; x <= W / 2; x += every) { place(o.lights.prop, [x, 0, -D / 2 - off], 180); place(o.lights.prop, [x, 0, D / 2 + off], 0); }
    for (let z = -D / 2 + every / 2; z <= D / 2; z += every) { place(o.lights.prop, [-W / 2 - off, 0, z], 270); place(o.lights.prop, [W / 2 + off, 0, z], 90); }
  }
  // city blocks across the road, fronts to the street; towers on the corners; a far skyline
  const b0 = rw / 2 + 2;                                   // from the road's centre line to the buildings' fronts
  const sizes = o.sizes ?? {};
  const pick = list => list[Math.floor(R() * list.length)];
  // a row of blocks along one side, between the corner towers: each block that still fits, a small gap between
  const row = (len, put) => {
    let at = -len / 2;
    for (let guard = 0; guard < 40 && at < len / 2 - 4; guard++) {
      const fits = o.buildings.filter(id => at + (sizes[id]?.[0] ?? 8) <= len / 2 + 0.5);
      if (!fits.length) break;
      const id = pick(fits);
      const [w, d] = sizes[id] ?? [8, 8];
      put(id, at + w / 2, d);
      at += w + 0.6 + R() * 1.4;
    }
  };
  const fx = ex + b0, fz = ez + b0;
  row(2 * fx - 2, (id, u, d) => { place(id, [u, 0, -(fz + d / 2)], 0); });
  row(2 * fx - 2, (id, u, d) => { place(id, [u, 0, fz + d / 2], 180); });
  row(2 * fz - 2, (id, u, d) => { place(id, [-(fx + d / 2), 0, u], 90); });
  row(2 * fz - 2, (id, u, d) => { place(id, [fx + d / 2, 0, u], 270); });
  if (o.towers) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const id = pick(o.towers); const [w, d] = sizes[id] ?? [10, 10]; place(id, [sx * (fx + w / 2 + 1.5), 0, sz * (fz + d / 2 + 1.5)], sz < 0 ? 0 : 180); }
  if (o.skyline) {
    const n = o.skyline.count ?? 10, rad = Math.max(ex, ez) + (o.skyline.distance ?? 45);
    for (let k = 0; k < n; k++) { const a = (k + R() * 0.6) / n * Math.PI * 2; place(pick(o.skyline.props), [Math.sin(a) * rad, 0, Math.cos(a) * rad], norm(a * 180 / Math.PI + 180)); }
  }
}

// ======================================================================================================= outdoor
// The template's own layout is the small world. A bigger class keeps the middle's set-pieces where they are and moves
// what stands near an edge out with that edge; then the recipe's groups dress the new floor, the edge closes again
// and the backdrop ring follows it out.
function yard(recipe, size, seed) {
  const R = makeRng(seed);
  const base = clone(recipe);
  for (const k of ['kind', 'sizes', 'edge', 'grow', 'outside', 'groups', 'footprints', 'setPieces']) delete base[k];
  const [W0, D0] = recipe.size ?? [24, 24];
  const [W, D] = sizeOf(recipe, size);
  const dx = (W - W0) / 2, dz = (D - D0) / 2;
  const band = recipe.grow?.band ?? 4;                       // metres from an old edge that move with it
  const move = (x, z) => {
    let nx = x, nz = z;
    if (dx && Math.abs(x) > W0 / 2 - band) nx = x + Math.sign(x) * dx;
    if (dz && Math.abs(z) > D0 / 2 - band) nz = z + Math.sign(z) * dz;
    return [nx, nz];
  };
  const edge = recipe.edge ?? null;
  const o = recipe.outside ?? {};
  const rows = o.rows && (size !== 'small' || o.rows.small) ? o.rows : null;
  const drop = new Set([...(edge ? [edge.piece, edge.corner, edge.gatePosts, ...(edge.also ?? [])] : []), ...(rows ? rows.buildings : [])].filter(Boolean));
  const out = { ...base, kind: 'outdoor', sizeClass: size, size: [W, D] };
  // the old edge pieces go (the edge is rebuilt below), and the old building rows when new ones are laid; everything
  // else keeps its place or follows its edge. Things that stand together move together (a bucket by its hose reel):
  // props within 1.5 m of each other form a cluster, and the cluster moves by where its middle is
  const kept = (recipe.props ?? []).filter(p => !drop.has(p.prop));
  const parent = kept.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const ground = kept.map(p => (p.at?.[1] ?? 0) <= 12);
  for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) {
    if (!ground[i] || !ground[j]) continue;
    if (Math.hypot(kept[i].at[0] - kept[j].at[0], kept[i].at[2] - kept[j].at[2]) <= 1.5) parent[find(i)] = find(j);
  }
  // ---- the gates: where the edge opens (enemies and visitors come in there; `entries`) ----
  const sidesOf = (w, d) => ({ back: { axis: 'x', c: -d / 2, n: [0, -1], L: w }, front: { axis: 'x', c: d / 2, n: [0, 1], L: w }, left: { axis: 'z', c: -w / 2, n: [-1, 0], L: d }, right: { axis: 'z', c: w / 2, n: [1, 0], L: d } });
  const gatesOf = (list, sd) => (list ?? []).map(g => {
    const s = sd[g.side], u = r2((g.at ?? 0) * s.L / 2), w = g.width ?? recipe.gateWidth ?? 3;
    const at = s.axis === 'x' ? [u, 0, s.c] : [s.c, 0, u];
    return { name: g.name, side: g.side, u, width: w, at, normal: s.n };
  });
  const sides = sidesOf(W, D);
  const gates = gatesOf(recipe.gates?.[size] ?? recipe.gates?.small, sides);
  // a gate's way in: its opening and 0.6 m either side, 3 m inward. A thing the hand layout put there (the small world's
  // own gates) stays; one that growing brings into a gate's way in (a statue by the back wall of a small arena, which a
  // large arena opens a gate behind) steps aside along the edge (the places spike, wave 10)
  const laneOf = (box, list, sd) => list.find(g => {
    const s = sd[g.side], along = s.axis === 'x' ? [box[0], box[2]] : [box[1], box[3]];
    const inward = s.axis === 'x' ? (s.c < 0 ? [box[1] - s.c, box[3] - s.c] : [s.c - box[3], s.c - box[1]]) : (s.c < 0 ? [box[0] - s.c, box[2] - s.c] : [s.c - box[2], s.c - box[0]]);
    return along[1] > g.u - g.width / 2 - 0.6 && along[0] < g.u + g.width / 2 + 0.6 && inward[1] > 0 && inward[0] < 3;
  });
  const handGates = gatesOf(recipe.gates?.small, sidesOf(W0, D0));
  const fpAt = (p, sx = 0, sz = 0) => { const s = recipe.footprints?.[p.prop] ?? [1.2, 1.2]; return [p.at[0] + sx - s[0] / 2, p.at[2] + sz - s[1] / 2, p.at[0] + sx + s[0] / 2, p.at[2] + sz + s[1] / 2]; };
  const boxOf = (list, sx = 0, sz = 0) => list.map(p => fpAt(p, sx, sz)).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  const shiftOf = new Map(), membersOf = new Map();
  for (let i = 0; i < kept.length; i++) {
    const r = find(i); if (shiftOf.has(r)) continue;
    const members = kept.filter((_, k) => find(k) === r);
    const cx = members.reduce((n, p) => n + p.at[0], 0) / members.length, cz = members.reduce((n, p) => n + p.at[2], 0) / members.length;
    const [mx, mz] = move(cx, cz);
    shiftOf.set(r, [mx - cx, mz - cz]);
    if (ground[i]) membersOf.set(r, members);
  }
  // then the ones growing brought into a gate's way in step aside, to the nearer side first, on to where they touch
  // nothing within 3 m; with no room either side they are left out (a gate stays a way in)
  const overlaps = (a, b) => a[2] > b[0] && a[0] < b[2] && a[3] > b[1] && a[1] < b[3];
  for (const [r, members] of membersOf) {
    const [sx, sz] = shiftOf.get(r);
    if (!sx && !sz) continue;
    const g = laneOf(boxOf(members, sx, sz), gates, sides);
    if (!g || laneOf(boxOf(members), handGates, sidesOf(W0, D0))) continue;
    const b = boxOf(members, sx, sz), axisX = sides[g.side].axis === 'x';
    const [lo, hi] = axisX ? [b[0], b[2]] : [b[1], b[3]], mid = (lo + hi) / 2, half = (hi - lo) / 2;
    const others = [...membersOf].filter(([k]) => k !== r && shiftOf.get(k)).map(([k, m]) => boxOf(m, ...shiftOf.get(k)));
    const first = mid >= g.u ? 1 : -1;
    let best = null;
    for (let step = 0; step <= 6 && !best; step++) for (const k of [first, -first]) {
      const to = g.u + k * (g.width / 2 + 0.6 + half + 0.05 + step * 0.5);
      const t = axisX ? [sx + to - mid, sz] : [sx, sz + to - mid], nb = boxOf(members, ...t);
      if (!others.some(o => overlaps(nb, o)) && !laneOf(nb, gates, sides)) { best = t; break; }
    }
    shiftOf.set(r, best);
  }
  out.props = kept.map((p, i) => {
    if (!ground[i] || (!dx && !dz)) return { ...p };
    const shift = shiftOf.get(find(i));
    if (!shift) return null;                                   // no room beside the gate it would stand in
    return { ...p, at: [r2(p.at[0] + shift[0]), p.at[1] ?? 0, r2(p.at[2] + shift[1])] };
  }).filter(Boolean);
  out.scatter = (recipe.scatter ?? []).map(s => {
    if (!dx && !dz) return { ...s };
    const [a, b] = move(s.area[0], s.area[1]), [c, d] = move(s.area[2], s.area[3]);
    return { ...s, area: [r2(a), r2(b), r2(c), r2(d)], clear: (s.clear ?? []).map(([x, z, r]) => [...move(x, z).map(r2), r]) };
  });
  out.spawns = (recipe.spawns ?? []).map(s => [...s]);
  out.zones = Object.fromEntries(Object.entries(recipe.zones ?? {}).map(([n, z]) => {
    if (z.shape === 'box' && (dx || dz)) {        // an area along an edge stretches with it
      const [cx, , cz] = z.at, [w, h, d] = z.size;
      const [ax, az] = move(cx - w / 2, cz - d / 2), [bx, bz] = move(cx + w / 2, cz + d / 2);
      return [n, { ...z, at: [r2((ax + bx) / 2), z.at[1], r2((az + bz) / 2)], size: [r2(bx - ax), h, r2(bz - az)] }];
    }
    const [x, zz] = move(z.at[0], z.at[2]);
    return [n, { ...z, at: [r2(x), z.at[1], r2(zz)] }];
  }));

  const inGate = (side, u, half) => gates.some(g => g.side === side && Math.abs(g.u - u) < g.width / 2 + half - 1e-6);
  out.entries = gates.map(g => ({ name: g.name, at: g.at, normal: g.normal, width: g.width }));

  // ---- the edge: pieces all round, gaps only at the gates ----
  if (edge?.piece) {
    for (const [name, s] of Object.entries(sides)) {
      const count = Math.max(1, Math.round(s.L / edge.length));
      const step = s.L / count, scale = r2(step / edge.length);
      const rot = (s.axis === 'x' ? 0 : 90) + (edge.faceIn && (name === 'front' || name === 'right') ? 180 : 0) + (edge.turn ?? 0);
      for (let i = 0; i < count; i++) {
        const u = -s.L / 2 + step * (i + 0.5);
        if (inGate(name, u, step / 2)) continue;
        const at = s.axis === 'x' ? [u, 0, s.c + (edge.inset ?? 0) * -s.n[1]] : [s.c + (edge.inset ?? 0) * -s.n[0], 0, u];
        const sc = edge.stretch === false ? (edge.scale ?? 1) : [r2(scale * (edge.scale ?? 1)), edge.scale ?? 1, edge.scale ?? 1];
        out.props.push({ prop: edge.piece, at: at.map(r2), rot: norm(rot), scale: sc });
      }
    }
    if (edge.corner) for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) out.props.push({ prop: edge.corner, at: [r2(x), 0, r2(z)], rot: 0, scale: edge.cornerScale ?? edge.scale ?? 1 });
    if (edge.gatePosts) for (const g of gates) for (const k of [-1, 1]) {
      const s = sides[g.side], u = g.u + k * (g.width / 2 + (edge.postHalf ?? 0.6));
      out.props.push({ prop: edge.gatePosts, at: (s.axis === 'x' ? [u, 0, s.c] : [s.c, 0, u]).map(r2), rot: 0, scale: edge.cornerScale ?? edge.scale ?? 1 });
    }
  }
  for (const g of gates) out.zones[g.name] ??= { shape: 'circle', at: [r2(g.at[0] - g.normal[0] * 2), 0, r2(g.at[2] - g.normal[1] * 2)], size: [1.2] };

  // ---- outside: rows of buildings that close a square (plaza), a ring of trees or houses so the world goes on ----
  const outside = [];                                          // rects taken outside the play area
  const sizes = o.sizes ?? {};
  const pick = list => list[Math.floor(R() * list.length)];
  if (rows) {
    for (const [name, s] of Object.entries(sides)) {
      // the rows on the back and front run on past the corners; the side rows stop at them, so the corners never overlap
      const over = s.axis === 'x' ? (rows.overhang ?? 4) : 0;
      let at = -s.L / 2 - over;
      const end = s.L / 2 + over;
      for (let guard = 0; guard < 40 && at < end - 3; guard++) {
        // the row runs up to the next gate on this side and fills the stretch before it with a house that fits there;
        // when none does, it carries on past the gate (before wave 10 it skipped to the gate whenever the house it drew
        // was too wide, leaving 3-8 m of the edge open: check 17 failed most plazas, the places spike found)
        const g = gates.filter(q => q.side === name && q.u + q.width / 2 + 0.2 > at).sort((a, b) => a.u - b.u)[0];
        const stop = g ? g.u - g.width / 2 - 0.2 : Infinity;
        if (g && at >= stop) { at = g.u + g.width / 2 + 0.2; continue; }
        const fits = rows.buildings.filter(id => at + (sizes[id]?.[0] ?? 8) <= Math.min(end + 0.5, stop));
        if (!fits.length) { if (g && stop < end) { at = g.u + g.width / 2 + 0.2; continue; } break; }
        const id = pick(fits), [w, d] = sizes[id] ?? [8, 8];
        const u = at + w / 2;
        const pos = s.axis === 'x' ? [u, 0, Math.sign(s.c) * (D / 2 + d / 2 + (rows.gap ?? 0.5))] : [Math.sign(s.c) * (W / 2 + d / 2 + (rows.gap ?? 0.5)), 0, u];
        // fronts to the square: +z faces the middle
        const rot = name === 'back' ? 0 : name === 'front' ? 180 : name === 'left' ? 90 : 270;
        out.props.push({ prop: id, at: pos.map(r2), rot, scale: 1 });
        const ext = s.axis === 'x' ? [w, d] : [d, w];
        outside.push([pos[0] - ext[0] / 2, pos[2] - ext[1] / 2, pos[0] + ext[0] / 2, pos[2] + ext[1] / 2]);
        at += w + (rows.spacing ?? [0.4, 1.6])[0] + R() * ((rows.spacing ?? [0.4, 1.6])[1] - (rows.spacing ?? [0.4, 1.6])[0]);
      }
    }
  }
  for (const p of out.props) {                                 // what already stands outside (houses, the old trees)
    if (Math.abs(p.at[0]) <= W / 2 + 0.5 && Math.abs(p.at[2]) <= D / 2 + 0.5) continue;
    const s = o.sizes?.[p.prop] ?? [2, 2];
    outside.push([p.at[0] - s[0] / 2, p.at[2] - s[1] / 2, p.at[0] + s[0] / 2, p.at[2] + s[1] / 2]);
  }
  for (const ring of [o.ring, ...(o.rings ?? [])].filter(Boolean)) {
    const [d0, d1] = ring.distance ?? [5, 12];
    for (const [name, s] of Object.entries(sides)) {
      for (let u = -s.L / 2 - d0; u <= s.L / 2 + d0; u += ring.spacing ?? 6) {
        const d = d0 + R() * (d1 - d0), j = (R() - 0.5) * (ring.jitter ?? 2);
        const pos = s.axis === 'x' ? [u + j, 0, Math.sign(s.c) * (D / 2 + d)] : [Math.sign(s.c) * (W / 2 + d), 0, u + j];
        const id = pick(ring.props), [w, dd] = sizes[id] ?? [2, 2];
        const q = [pos[0] - w / 2 - 0.5, pos[2] - dd / 2 - 0.5, pos[0] + w / 2 + 0.5, pos[2] + dd / 2 + 0.5];
        if (outside.some(r => q[2] > r[0] && q[0] < r[2] && q[3] > r[1] && q[1] < r[3])) continue;
        if (gates.some(g => Math.hypot(g.at[0] - pos[0], g.at[2] - pos[2]) < g.width + 2)) continue;   // keep the way in clear
        outside.push(q);
        out.props.push({ prop: id, at: pos.map(r2), rot: Math.floor(R() * 360), scale: 1 });
      }
    }
  }

  // ---- new floor: the recipe's groups in the band the bigger size added, each a named area ----
  const occupied = [];
  const fpOf = p => { const s = recipe.footprints?.[p.prop] ?? [1.2, 1.2]; return [p.at[0] - s[0] / 2, p.at[2] - s[1] / 2, p.at[0] + s[0] / 2, p.at[2] + s[1] / 2]; };
  for (const p of out.props) if (Math.abs(p.at[0]) < W / 2 + 1 && Math.abs(p.at[2]) < D / 2 + 1 && (p.at[1] ?? 0) < 12) occupied.push(fpOf(p));
  for (const s of out.spawns) occupied.push([s[0] - 1.6, s[2] - 1.6, s[0] + 1.6, s[2] + 1.6]);
  for (const z of Object.values(out.zones)) if (z.shape === 'circle') occupied.push([z.at[0] - z.size[0] - 0.8, z.at[2] - z.size[0] - 0.8, z.at[0] + z.size[0] + 0.8, z.at[2] + z.size[0] + 0.8]);
  for (const g of gates) occupied.push([g.at[0] - g.width / 2 - 1.5 - Math.abs(g.normal[0]) * 3, g.at[2] - g.width / 2 - 1.5 - Math.abs(g.normal[1]) * 3, g.at[0] + g.width / 2 + 1.5 + Math.abs(g.normal[0]) * 3, g.at[2] + g.width / 2 + 1.5 + Math.abs(g.normal[1]) * 3]);
  const free = q => occupied.every(r => q[2] <= r[0] || q[0] >= r[2] || q[3] <= r[1] || q[1] >= r[3]);
  const groups = recipe.groups ?? {};
  const put = (gid, cx, cz, yaw) => { for (const q of groups[gid].props) { const [lx, lz] = turn(q.at[0], q.at[2], yaw); out.props.push({ prop: q.prop, at: [r2(cx + lx), r2(q.at[1] ?? 0), r2(cz + lz)], rot: norm((q.rot ?? 0) + yaw), scale: q.scale ?? 1 }); } };
  for (const f of recipe.grow?.[size] ?? []) {
    const g = groups[f.group]; if (!g) continue;
    let n = 0;
    const want = f.count ?? 1;
    const spots = [];
    const m = f.margin ?? 2.5;
    for (let x = -W / 2 + m; x <= W / 2 - m; x += 1) for (let z = -D / 2 + m; z <= D / 2 - m; z += 1) {
      const inBand = Math.abs(x) > W0 / 2 - band || Math.abs(z) > D0 / 2 - band;
      const nearEdge = Math.min(W / 2 - Math.abs(x), D / 2 - Math.abs(z)) < (f.edge ?? 99);
      if ((f.where === 'band' ? inBand : true) && nearEdge) spots.push([x, z]);
    }
    for (const [x, z] of shuffle(spots, R)) {
      if (n >= want) break;
      // facing: toward the middle (seats and stalls look inward), or its back to the nearest edge
      const yaw = f.face === 'none' ? 0 : f.face === 'edge'
        ? (Math.abs(x) / W > Math.abs(z) / D ? (x < 0 ? 90 : 270) : (z < 0 ? 0 : 180))
        : norm(Math.round(Math.atan2(-x, -z) * 180 / Math.PI / 15) * 15);
      // a group turned off the axes takes the square round it
      const ext = norm(yaw) % 90 !== 0 ? [Math.max(...g.size), Math.max(...g.size)] : norm(yaw) % 180 === 0 ? g.size : [g.size[1], g.size[0]];
      const gap = f.gap ?? 1;
      const q = [x - ext[0] / 2 - gap, z - ext[1] / 2 - gap, x + ext[0] / 2 + gap, z + ext[1] / 2 + gap];
      if (!free(q)) continue;
      occupied.push(q); put(f.group, x, z, yaw); n++;
      if (f.zone) out.zones[n > 1 ? `${f.zone}-${n}` : f.zone] = { shape: 'box', at: [r2(x), 0, r2(z)], size: [r2(ext[0] + 1), 3, r2(ext[1] + 1)] };
    }
  }
  if (recipe.ground?.outerSize && (dx || dz)) out.ground = { ...out.ground, outerSize: recipe.ground.outerSize + Math.max(dx, dz) * 2 };
  out.describe = `${recipe.describe} ${size[0].toUpperCase()}${size.slice(1)}: ${W} x ${D} m${gates.length ? `, ${gates.length} ${gates.length === 1 ? 'gate' : 'gates'}` : ''}.`;
  return out;
}
