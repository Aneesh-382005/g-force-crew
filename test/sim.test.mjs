import test from "node:test";
import assert from "node:assert/strict";
import { createGame, startGame, syncCrew, setInput, setFiring, step, snapshot, HULL_MAX, W } from "../shared/sim.js";

const crewed = (seed = 1) => {
  const g = createGame(seed);
  syncCrew(g, 1, { pilot: true, gunner: true });
  return g;
};

test("same seed and inputs give identical games", () => {
  const run = () => {
    const g = crewed(7); startGame(g, 7);
    for (let i = 0; i < 900; i++) { setInput(g, 1, Math.sin(i / 20), 0); setFiring(g, 1, i % 40 < 20); step(g); }
    return JSON.stringify(snapshot(g));
  };
  assert.equal(run(), run());
});

test("different seeds give different waves", () => {
  const first = (seed) => { const g = crewed(seed); startGame(g, seed); for (let i = 0; i < 200; i++) step(g); return JSON.stringify(g.enemies.map((e) => [e.x, e.y])); };
  assert.notEqual(first(1), first(2));
});

test("a bullet cannot tunnel through a fast enemy", () => {
  let missed = 0;
  for (let sp = 38; sp <= 78; sp += 4) {
    const g = crewed(); startGame(g); g.queue = []; g.nextWave = 1e9;
    const s = g.ships.get(1); s.x = 0; s.y = 8; s.firing = true;
    g.enemies.push({ id: 99, x: 0, y: 8, z: -100, pz: -100, sp });
    for (let i = 0; i < 90 && g.enemies.length; i++) step(g);
    if (g.score === 0) missed++;
  }
  assert.equal(missed, 0);
});

test("a hit costs one hull, then the ship is invulnerable", () => {
  const g = crewed(); startGame(g); g.nextWave = 1e9;
  const s = g.ships.get(1); s.x = 0; s.y = 8; s.firing = false; s.cool = 99; s.inv = 0;
  g.enemies.push({ id: 1, x: 0, y: 8, z: -2, pz: -2, sp: 60 }, { id: 2, x: 0, y: 8, z: -4, pz: -4, sp: 60 });
  for (let i = 0; i < 12; i++) step(g);
  assert.equal(g.hull, HULL_MAX - 1);
});

test("hull reaching zero ends the game and freezes enemies", () => {
  const g = crewed(); startGame(g); g.hull = 1; g.nextWave = 1e9;
  const s = g.ships.get(1); s.x = 0; s.y = 8; s.cool = 99; s.inv = 0;
  g.enemies.push({ id: 1, x: 0, y: 8, z: -2, pz: -2, sp: 60 });
  for (let i = 0; i < 10; i++) step(g);
  assert.equal(g.state, "over");
  g.enemies.push({ id: 2, x: 5, y: 5, z: -50, pz: -50, sp: 60 });
  step(g);
  assert.equal(g.enemies.at(-1).z, -50);
});

test("every spawned enemy stays inside the flight area", () => {
  const g = crewed(3); startGame(g, 3); g.ships.get(1).inv = 1e9;
  const seen = [];
  for (let i = 0; i < 30 * 120; i++) { step(g); for (const e of g.enemies) if (e.z === W.SPAWN_Z + e.sp / 30) seen.push(e); }
  assert.ok(seen.length > 40);
  assert.ok(seen.every((e) => Math.abs(e.x) <= W.X && e.y >= W.YMIN && e.y <= W.YMAX));
});

test("a crew with no gunner auto-fires, a gunner must hold fire", () => {
  const g = createGame(1);
  syncCrew(g, 1, { pilot: true, gunner: false });
  syncCrew(g, 2, { pilot: true, gunner: true });
  const shots = { 1: 0, 2: 0 };
  for (let i = 0; i < 60; i++) { step(g); for (const ev of g.events) if (ev[0] === "f") shots[ev[1]]++; }
  assert.ok(shots[1] >= 2);
  assert.equal(shots[2], 0);
  setFiring(g, 2, true);
  for (let i = 0; i < 30; i++) { step(g); for (const ev of g.events) if (ev[0] === "f") shots[ev[1]]++; }
  assert.ok(shots[2] >= 3);
});
