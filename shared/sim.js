import { waveRng } from "./rng.js";

const DT = 1 / 30;
export const W = { X: 24, YMIN: 2, YMAX: 18, SPAWN_Z: -230, DESPAWN_Z: 8 };
export const HULL_MAX = 8;
const BULLET_SPEED = 130, FIRE_GAP = 0.22, FIRE_LINKED = 0.15, HIT_R = 1.7;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, u) => a + (b - a) * u;
const r1 = (v) => Math.round(v * 10) / 10;

// each pattern returns [{ at, x, y }], `at` = seconds after the wave starts
const PATTERNS = {
  scatter: (rnd, n) => Array.from({ length: n }, (_, i) =>
    ({ at: i * 0.35, x: lerp(-W.X, W.X, rnd()), y: lerp(W.YMIN + 1, W.YMAX - 1, rnd()) })),
  wall: (rnd) => {
    const hole = Math.floor(rnd() * 7), out = [];
    for (let c = 0; c < 7; c++) if (c !== hole) for (const y of [3, 7, 11, 15]) out.push({ at: 0, x: -W.X + c * 8, y });
    return out;
  },
  snake: (rnd, n) => {
    const ph = rnd() * 6.28, y = lerp(5, 15, rnd());
    return Array.from({ length: Math.min(n, 14) }, (_, i) => ({ at: i * 0.28, x: 18 * Math.sin(ph + i * 0.6), y }));
  },
  pincer: (rnd, n) => {
    const y = lerp(5, 15, rnd());
    return Array.from({ length: Math.min(Math.ceil(n / 2), 8) }, (_, i) => {
      const x = Math.max(2, W.X - i * 3.5);
      return [{ at: i * 0.3, x, y }, { at: i * 0.3, x: -x, y }];
    }).flat();
  },
};

export function createGame(seed) {
  return { seed, state: "lobby", t: 0, tick: 0, score: 0, hull: HULL_MAX, ships: new Map(),
           enemies: [], bullets: [], queue: [], waveIdx: 0, nextWave: 0, nextId: 1, events: [] };
}

export function startGame(g, seed = g.seed) {
  Object.assign(g, { seed, state: "play", score: 0, hull: HULL_MAX, enemies: [], bullets: [], queue: [], waveIdx: 0, nextWave: g.t + 2 });
  for (const s of g.ships.values()) { s.inv = 1.5; s.kills = 0; }
}

// one ship per player; `on` = connected right now. crew = wing pair (shared colour and link bonus). crew == null removes the ship.
export function syncShip(g, id, crew, on) {
  if (crew == null) return void g.ships.delete(id);
  let s = g.ships.get(id);
  if (!s) g.ships.set(id, s = { id, crew, x: ((id * 9) % 41) - 20, y: 8, vx: 0, vy: 0, r: 0, p: 0, firing: false, cool: 0, inv: 0, on: false, linked: false, kills: 0 });
  s.crew = crew; s.on = on;
  if (!on) { s.firing = false; s.r = s.p = 0; }
}

export function setInput(g, id, r, p) {
  const s = g.ships.get(id);
  if (s) { s.r = clamp(+r || 0, -1, 1); s.p = clamp(+p || 0, -1, 1); }
}

export function setFiring(g, id, on) {
  const s = g.ships.get(id);
  if (s) s.firing = !!on && s.on;
}

export function step(g) {
  g.tick++; g.t += DT; g.events.length = 0;
  const k = 1 - Math.exp(-DT * 12), live = g.state !== "over";

  const ships = [...g.ships.values()];
  for (const a of ships) {                                            // linked = wingmate within range: faster fire, double points
    a.linked = a.on && ships.some((b) => b !== a && b.on && b.crew === a.crew && Math.abs(a.x - b.x) < 9 && Math.abs(a.y - b.y) < 6);
  }
  for (const s of ships) {
    s.vx += (s.r * 22 - s.vx) * k;
    s.vy += (s.p * 16 - s.vy) * k;
    s.x = clamp(s.x + s.vx * DT, -W.X, W.X);
    s.y = clamp(s.y + s.vy * DT, W.YMIN, W.YMAX);
    s.inv = Math.max(0, s.inv - DT); s.cool -= DT;
    if (!s.on) s.inv = Math.max(s.inv, 0.2);                           // a dropped phone's ship can't be hit while it reconnects
    if (live && s.firing && s.cool <= 0) {
      g.bullets.push({ id: g.nextId++, o: s.id, x: s.x, y: s.y, z: -1.5, pz: -1.5 });
      s.cool = s.linked ? FIRE_LINKED : FIRE_GAP;
      g.events.push(["f", s.id]);
    }
  }
  if (!live) return;

  if (g.state === "play") {
    if (!g.queue.length && g.t >= g.nextWave) {
      const rnd = waveRng(g.seed, g.waveIdx);
      const names = g.waveIdx < 2 ? ["scatter"] : Object.keys(PATTERNS);
      const n = Math.min(30, 5 + Math.round(g.waveIdx * 0.6) + Math.round(g.ships.size * 1.5));
      const name = names[Math.floor(rnd() * names.length)];
      for (const e of PATTERNS[name](rnd, n))
        g.queue.push({ at: g.t + e.at, x: clamp(e.x, -W.X, W.X), y: clamp(e.y, W.YMIN, W.YMAX) });
      g.events.push(["w", g.waveIdx + 1, name]);
      g.queue.sort((a, b) => a.at - b.at);
      g.nextWave = g.queue[g.queue.length - 1].at + Math.max(1.6, 4 - g.waveIdx * 0.12);
      g.waveIdx++;
    }
    while (g.queue.length && g.queue[0].at <= g.t) {
      const q = g.queue.shift();
      g.enemies.push({ id: g.nextId++, x: q.x, y: q.y, z: W.SPAWN_Z, pz: W.SPAWN_Z, sp: 38 + Math.min(g.score / 60, 40) });
    }
  }

  for (const b of g.bullets) { b.pz = b.z; b.z -= BULLET_SPEED * DT; }
  for (const e of g.enemies) { e.pz = e.z; e.z += e.sp * DT; }

  const deadB = new Set(), deadE = new Set(), levelBefore = Math.floor(g.score / 250);
  // bullets and enemies close at ~170 units/s, so test the z gap swept over the tick, not just its end
  for (const b of g.bullets) for (const e of g.enemies) {
    if (deadE.has(e)) continue;
    const d0 = b.pz - e.pz, d1 = b.z - e.z;
    if (Math.min(d0, d1) <= 1.5 && Math.max(d0, d1) >= -1.5 && Math.hypot(b.x - e.x, b.y - e.y) < HIT_R) {
      const owner = g.ships.get(b.o);
      deadB.add(b); deadE.add(e); g.score += owner?.linked ? 20 : 10;
      if (owner) owner.kills++;
      g.events.push(["k", r1(e.x), r1(e.y), r1(e.z), b.o]);
      break;
    }
  }
  for (const e of g.enemies) {
    if (deadE.has(e)) continue;
    for (const s of g.ships.values()) {
      if (e.pz <= 1.8 && e.z >= -1.8 && Math.abs(e.x - s.x) < 3.4 && Math.abs(e.y - s.y) < 2.4) {
        if (s.inv > 0) continue;
        s.inv = 1.4; g.hull--; deadE.add(e); g.events.push(["h", s.id, r1(e.x), r1(e.y)]);
        break;
      }
    }
  }
  g.bullets = g.bullets.filter((b) => !deadB.has(b) && b.z > W.SPAWN_Z - 20);
  g.enemies = g.enemies.filter((e) => !deadE.has(e) && e.z < W.DESPAWN_Z);

  if (g.hull <= 0) { g.state = "over"; g.events.push(["o"]); }
  else if (Math.floor(g.score / 250) > levelBefore && g.hull < HULL_MAX) { g.hull++; g.events.push(["+"]); }
}

export const snapshot = (g) => ({
  s: g.state, n: g.tick, sc: g.score, h: g.hull,
  sh: [...g.ships.values()].map((s) => [s.id, s.crew, r1(s.x), r1(s.y), s.inv > 0 ? 1 : 0, s.linked ? 1 : 0, r1(s.vx), r1(s.vy), s.on ? 1 : 0, s.kills]),
  en: g.enemies.map((e) => [e.id, r1(e.x), r1(e.y), r1(e.z)]),
  bu: g.bullets.map((b) => [b.id, r1(b.x), r1(b.y), r1(b.z)]),
  ev: g.events.slice(),
});
