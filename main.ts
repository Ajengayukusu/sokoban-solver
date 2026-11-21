// Push-optimal Sokoban solver: each level is a hallway with independent
// rooms, so the level's push-optimal count is the sum of its rooms'
// optima. Rooms are solved on their own with push-based A* (a state is the
// boxes plus the player's reachable region, a step is one push, the
// estimate is the cheapest box-to-goal matching), then the player walks
// between rooms through the hallway. No clock, no dice: searches are
// bounded by a fixed number of expansions and ties break by insertion
// order, so two runs write byte-identical answers.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Expansion budgets. A* runs first; when it runs out, a weighted search
// (still a solution, just not necessarily the cheapest) is tried.
const ASTAR_CAP = 250_000;
const WEIGHTED_CAP = 120_000;
// One budget for the whole set, spent by count, never by the clock.
let budgetLeft = 2_000_000;

const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];
const LETTER = ['u', 'd', 'l', 'r'];

type Level = {
  w: number;
  h: number;
  wall: boolean[];
  goals: number[];
  goalSet: Set<number>;
  boxes: number[];
  player: number;
};

function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall: boolean[] = new Array(w * h).fill(true);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = 0;
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row[x] ?? '#';
      const i = y * w + x;
      wall[i] = ch === '#';
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goals, goalSet: new Set(goals), boxes, player };
}

type Room = {
  cells: Set<number>; // room floor, door cell included
  door: number; // the floor cell where the room meets the hallway
  entry: number; // the hallway cell just outside the door
  boxes: number[];
  goals: number[];
};

// The hallway is the player's row, walked left and right from the player.
// A door is a floor cell off the hallway that touches it; each room is
// the flood fill from its door through floor that is not hallway.
function findRooms(lv: Level): Room[] {
  const { w, wall } = lv;
  const hall = new Set<number>();
  const py = Math.floor(lv.player / w);
  const px = lv.player % w;
  for (let x = px; x >= 0 && !wall[py * w + x]; x--) hall.add(py * w + x);
  for (let x = px + 1; x < w && !wall[py * w + x]; x++) hall.add(py * w + x);
  const claimed = new Set<number>();
  const rooms: Room[] = [];
  for (const c of [...hall].sort((a, b) => a - b)) {
    for (let d = 0; d < 4; d++) {
      const n = c + DY[d] * w + DX[d];
      if (n < 0 || n >= w * lv.h || wall[n] || hall.has(n) || claimed.has(n)) continue;
      const cells = new Set<number>();
      const stack = [n];
      claimed.add(n);
      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (cells.has(cur)) continue;
        cells.add(cur);
        for (let e = 0; e < 4; e++) {
          const m = cur + DY[e] * w + DX[e];
          if (m < 0 || m >= w * lv.h || wall[m] || hall.has(m) || cells.has(m)) continue;
          stack.push(m);
        }
      }
      for (const cell of cells) claimed.add(cell);
      rooms.push({
        cells,
        door: n,
        entry: c,
        boxes: lv.boxes.filter((b) => cells.has(b)),
        goals: lv.goals.filter((g) => cells.has(g)),
      });
    }
  }
  return rooms;
}

// Every box and goal must sit in exactly one room, with as many boxes
// as goals in each; otherwise the caller solves the whole level as one room.
function roomsCover(lv: Level, rooms: Room[]): boolean {
  if (rooms.length === 0) return false;
  const seenBoxes = new Set<number>();
  const seenGoals = new Set<number>();
  for (const r of rooms) {
    if (r.boxes.length !== r.goals.length || r.boxes.length === 0) return false;
    for (const b of r.boxes) seenBoxes.add(b);
    for (const g of r.goals) seenGoals.add(g);
  }
  return seenBoxes.size === lv.boxes.length && seenGoals.size === lv.goals.length;
}

// The cells the player can stand on from `from`, walking around boxes.
function floodRegion(from: number, boxes: Set<number>, floor: Set<number>, w: number): Set<number> {
  const seen = new Set<number>([from]);
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    for (let d = 0; d < 4; d++) {
      const n = c + DY[d] * w + DX[d];
      if (floor.has(n) && !boxes.has(n) && !seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return seen;
}

// Walk from one cell to another, stepping around boxes. Fixed direction
// order, so the walk is the same every run.
function walkPath(from: number, to: number, boxes: Set<number>, floor: Set<number>, w: number): string | null {
  if (from === to) return '';
  const prev = new Map<number, number>([[from, -1]]);
  const prevDir = new Map<number, number>();
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    for (let d = 0; d < 4; d++) {
      const n = c + DY[d] * w + DX[d];
      if (!floor.has(n) || boxes.has(n) || prev.has(n)) continue;
      prev.set(n, c);
      prevDir.set(n, d);
      if (n === to) {
        let s = '';
        let cur = n;
        while (cur !== from) {
          s = LETTER[prevDir.get(cur)!] + s;
          cur = prev.get(cur)!;
        }
        return s;
      }
      q.push(n);
    }
  }
  return null;
}

// Cells a box can ever sit on and still reach a goal, found by pulling
// boxes backwards from the goals with the player free to stand anywhere.
// A box outside this set can never be saved, so such states are pruned.
function liveCells(floor: Set<number>, goals: number[], w: number): Set<number> {
  const live = new Set<number>(goals);
  const q = [...goals];
  for (let h = 0; h < q.length; h++) {
    const cell = q[h];
    for (let d = 0; d < 4; d++) {
      const prev = cell - DY[d] * w - DX[d];
      const stand = cell - 2 * DY[d] * w - 2 * DX[d];
      if (floor.has(prev) && floor.has(stand) && !live.has(prev)) {
        live.add(prev);
        q.push(prev);
      }
    }
  }
  return live;
}

// All orderings of n items, for the box-to-goal matching.
function permutations(n: number): number[][] {
  const out: number[][] = [];
  const a = Array.from({ length: n }, (_, i) => i);
  const gen = (k: number): void => {
    if (k === n) {
      out.push([...a]);
      return;
    }
    for (let i = k; i < n; i++) {
      [a[k], a[i]] = [a[i], a[k]];
      gen(k + 1);
      [a[k], a[i]] = [a[i], a[k]];
    }
  };
  gen(0);
  return out;
}

type RoomSolution = {
  moves: string;
  endPlayer: number;
  endBoxes: number[];
  pushes: number;
};

// Push-based A* for one room. The player starts on the hallway cell
// outside the door. `weight` 1 is exact A*; a larger weight trades
// optimality for speed when the exact search runs out of budget.
function solveRoom(
  lv: Level,
  room: Room,
  startBoxes: number[],
  startPlayer: number,
  requireExit: boolean,
  weight: number,
  cap: number,
): RoomSolution | null {
  const w = lv.w;
  const floor = new Set<number>(room.cells);
  floor.add(room.entry);
  const goalSet = new Set(room.goals);
  const perms = permutations(room.goals.length);
  // Shortest walking distances between floor cells, boxes ignored.
  const dist = new Map<number, Int32Array>();
  for (const c of floor) {
    const d = new Int32Array(w * lv.h).fill(-1);
    d[c] = 0;
    const q = [c];
    for (let h = 0; h < q.length; h++) {
      const cur = q[h];
      for (let k = 0; k < 4; k++) {
        const n = cur + DY[k] * w + DX[k];
        if (floor.has(n) && d[n] < 0) {
          d[n] = d[cur] + 1;
          q.push(n);
        }
      }
    }
    dist.set(c, d);
  }
  const live = liveCells(floor, room.goals, w);
  // Cheapest pairing of boxes to goals over the walking distances. A push
  // moves one box one step, so this never overestimates the pushes left.
  const heuristic = (bs: number[]): number => {
    let best = Infinity;
    for (const p of perms) {
      let sum = 0;
      for (let i = 0; i < bs.length; i++) {
        const d = dist.get(bs[i])![room.goals[p[i]]!];
        if (d < 0) {
          sum = Infinity;
          break;
        }
        sum += d;
      }
      if (sum < best) best = sum;
    }
    return best;
  };
  // A 2x2 block of boxes with no goal in it can never come apart.
  const frozen = (bs: Set<number>, cell: number): boolean => {
    const x = cell % w;
    const tops = [cell, cell - 1, cell - w, cell - w - 1];
    for (const t of tops) {
      if (t < 0 || t % w > w - 2) continue;
      const block = [t, t + 1, t + w, t + w + 1];
      if (block.every((c) => bs.has(c)) && !block.some((c) => goalSet.has(c))) return true;
    }
    return false;
  };
  const regionRep = (region: Set<number>): number => {
    let rep = Infinity;
    for (const c of region) if (c < rep) rep = c;
    return rep;
  };

  // Heap of [f, h, seq, state], smallest first, ties by insertion order.
  const heap: [number, number, number, number][] = [];
  const less = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
  const heapPush = (e: [number, number, number, number]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const heapPop = (): [number, number, number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1]!, heap[c]!)) c++;
        if (!less(heap[c]!, heap[i]!)) break;
        [heap[i], heap[c]] = [heap[c]!, heap[i]!];
        i = c;
      }
    }
    return top;
  };

  const sBoxes: number[][] = [ [...startBoxes].sort((a, b) => a - b) ];
  const sPlayer: number[] = [startPlayer];
  const sG: number[] = [0];
  const sParent: number[] = [-1];
  const sPush: { behind: number; dir: number; from: number; to: number }[] = [
    { behind: -1, dir: -1, from: -1, to: -1 },
  ];
  const best = new Map<string, number>();
  let seq = 0;
  const h0 = heuristic(sBoxes[0]!);
  if (h0 === Infinity) return null;
  best.set(`${sBoxes[0]!.join(',')}|${regionRep(floodRegion(startPlayer, new Set(startBoxes), floor, w))}`, 0);
  heapPush([h0, h0, seq++, 0]);
  let expanded = 0;
  const limit = Math.min(cap, budgetLeft);
  while (heap.length > 0 && expanded < limit) {
    const [, , , s] = heapPop();
    const bs = sBoxes[s]!;
    const p = sPlayer[s]!;
    const g = sG[s]!;
    const key = `${bs.join(',')}|${regionRep(floodRegion(p, new Set(bs), floor, w))}`;
    if (best.get(key) !== s) continue;
    const boxSet = new Set(bs);
    if (bs.every((b) => goalSet.has(b))) {
      if (!requireExit || floodRegion(p, boxSet, floor, w).has(room.door)) {
        // Rebuild the move string: walks plus pushes, in order.
        const pushes: { behind: number; dir: number; from: number; to: number; state: number }[] = [];
        for (let t = s; t > 0; t = sParent[t]!) pushes.push({ ...sPush[t]!, state: t });
        pushes.reverse();
        let moves = '';
        let curPlayer = startPlayer;
        let curBoxes = [...startBoxes].sort((a, b) => a - b);
        for (const pu of pushes) {
          const walk = walkPath(curPlayer, pu.behind, new Set(curBoxes), floor, w);
          if (walk === null) return null;
          moves += walk + LETTER[pu.dir];
          curBoxes = curBoxes.map((b) => (b === pu.from ? pu.to : b)).sort((a, b) => a - b);
          curPlayer = pu.from;
        }
        budgetLeft -= expanded;
        return { moves, endPlayer: p, endBoxes: bs, pushes: g };
      }
      continue; // solved, but the player cannot get back out: dead end
    }
    expanded++;
    const region = floodRegion(p, boxSet, floor, w);
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i]!;
      for (let d = 0; d < 4; d++) {
        const to = b + DY[d] * w + DX[d];
        const behind = b - DY[d] * w - DX[d];
        if (!region.has(behind) || !floor.has(to) || boxSet.has(to)) continue;
        if (!live.has(to)) continue;
        const nb = [...bs];
        nb[i] = to;
        nb.sort((a, b2) => a - b2);
        const nbSet = new Set(nb);
        if (frozen(nbSet, to)) continue;
        const h = heuristic(nb);
        if (h === Infinity) continue;
        const rep = regionRep(floodRegion(b, nbSet, floor, w));
        const k = `${nb.join(',')}|${rep}`;
        if (best.has(k)) continue;
        const t = sBoxes.length;
        sBoxes.push(nb);
        sPlayer.push(b);
        sG.push(g + 1);
        sParent.push(s);
        sPush.push({ behind, dir: d, from: b, to });
        best.set(k, t);
        heapPush([g + 1 + weight * h, h, seq++, t]);
      }
    }
  }
  budgetLeft -= expanded;
  return null;
}

// Solve one level: split it into rooms, solve each, and walk the player
// between rooms through the hallway. Returns '' when a room cannot be
// solved (the level then scores 0, but the other levels still run).
function solveLevel(lv: Level): string {
  const allFloor = new Set<number>();
  for (let i = 0; i < lv.w * lv.h; i++) if (!lv.wall[i]) allFloor.add(i);
  let rooms = findRooms(lv);
  let requireExit = true;
  if (!roomsCover(lv, rooms)) {
    // No usable split: treat the whole level as one room.
    rooms = [
      {
        cells: new Set(allFloor),
        door: lv.player,
        entry: lv.player,
        boxes: [...lv.boxes],
        goals: [...lv.goals],
      },
    ];
    requireExit = false;
  }
  let boxes = [...lv.boxes];
  let player = lv.player;
  let moves = '';
  const remaining = [...rooms];
  while (remaining.length > 0) {
    // Take the reachable room whose door the player can walk to soonest.
    let pick = -1;
    let pickWalk: string | null = null;
    for (let i = 0; i < remaining.length; i++) {
      const walk = walkPath(player, remaining[i]!.entry, new Set(boxes), allFloor, lv.w);
      if (walk !== null && (pickWalk === null || walk.length < pickWalk.length)) {
        pick = i;
        pickWalk = walk;
      }
    }
    if (pick < 0) return '';
    const room = remaining.splice(pick, 1)[0]!;
    moves += pickWalk!;
    player = room.entry;
    const roomBoxes = boxes.filter((b) => room.cells.has(b));
    let solved = solveRoom(lv, room, roomBoxes, player, requireExit, 1, ASTAR_CAP);
    if (solved === null) solved = solveRoom(lv, room, roomBoxes, player, requireExit, 3, WEIGHTED_CAP);
    if (solved === null) return '';
    moves += solved.moves;
    boxes = boxes.filter((b) => !room.cells.has(b)).concat(solved.endBoxes).sort((a, b) => a - b);
    player = solved.endPlayer;
    // Walk back out through the door to the hallway.
    const out = walkPath(player, room.door, new Set(boxes), allFloor, lv.w);
    if (out === null) return '';
    moves += out;
    player = room.door;
    if (room.entry !== room.door) {
      // One step from the door to the hallway cell outside it.
      let step = -1;
      for (let d = 0; d < 4; d++) {
        if (room.door + DY[d] * lv.w + DX[d] === room.entry) step = d;
      }
      if (step < 0) return '';
      moves += LETTER[step]!;
      player = room.entry;
    }
  }
  return moves;
}

for (const id of readdirSync(IN_DIR).sort()) {
  const moves = solveLevel(parseLevel(readFileSync(join(IN_DIR, id, 'level.txt'), 'utf8')));
  mkdirSync(join(OUT_DIR, id), { recursive: true });
  writeFileSync(join(OUT_DIR, id, 'solution.txt'), `${moves}\n`);
}
