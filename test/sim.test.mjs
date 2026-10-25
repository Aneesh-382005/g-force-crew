import test from "node:test";
import assert from "node:assert/strict";
import { createGame, startGame, syncShip, setInput, setFiring, step, snapshot, HULL_MAX, W } from "../shared/sim.js";

const solo = (seed = 1) => {
  const g = createGame(seed);
  syncShip(g, 1, 1, true);
  return g;
};
const place = (s, x, y) => Object.assign(s, { x, y, inv: 0, cool: 99 });

test("same seed and inputs give identical games", () => {
  const run = () => {
    const g = solo(7); startGame(g, 7);
    for (let i = 0; i < 900; i++) { setInput(g, 1, Math.sin(i / 20), 0); setFiring(g, 1, i % 40 < 20); step(g); }
    return JSON.stringify(snapshot(g));
  };
  assert.equal(run(), run());
});

test("different seeds give different waves", () => {
  const first = (seed) => { const g = solo(seed); startGame(g, seed); for (let i = 0; i < 200; i++) step(g); return JSON.stringify(g.enemies.map((e) => [e.x, e.y])); };
  assert.notEqual(first(1), first(2));
});

test("a bullet cannot tunnel through a fast enemy", () => {
  let missed = 0;
  for (let sp = 38; sp <= 78; sp += 4) {
    const g = solo(); startGame(g); g.queue = []; g.nextWave = 1e9;
    const s = g.ships.get(1); s.x = 0; s.y = 8; setFiring(g, 1, true);
    g.enemies.push({ id: 99, x: 0, y: 8, z: -100, pz: -100, sp });
    for (let i = 0; i < 90 && g.enemies.length; i++) step(g);
    if (g.score === 0) missed++;
  }
  assert.equal(missed, 0);
});

test("a hit costs one hull, then the ship is invulnerable", () => {
  const g = solo(); startGame(g); g.nextWave = 1e9;
  place(g.ships.get(1), 0, 8);
  g.enemies.push({ id: 1, x: 0, y: 8, z: -2, pz: -2, sp: 60 }, { id: 2, x: 0, y: 8, z: -4, pz: -4, sp: 60 });
  for (let i = 0; i < 12; i++) step(g);
  assert.equal(g.hull, HULL_MAX - 1);
});

test("hull reaching zero ends the game and freezes enemies", () => {
  const g = solo(); startGame(g); g.hull = 1; g.nextWave = 1e9;
  place(g.ships.get(1), 0, 8);
  g.enemies.push({ id: 1, x: 0, y: 8, z: -2, pz: -2, sp: 60 });
  for (let i = 0; i < 10; i++) step(g);
  assert.equal(g.state, "over");
  g.enemies.push({ id: 2, x: 5, y: 5, z: -50, pz: -50, sp: 60 });
  step(g);
  assert.equal(g.enemies.at(-1).z, -50);
});

test("every spawned enemy stays inside the flight area", () => {
  const g = solo(3); startGame(g, 3); g.ships.get(1).inv = 1e9;
  const seen = [];
  for (let i = 0; i < 30 * 120; i++) { step(g); for (const e of g.enemies) if (e.z === W.SPAWN_Z + e.sp / 30) seen.push(e); }
  assert.ok(seen.length > 40);
  assert.ok(seen.every((e) => Math.abs(e.x) <= W.X && e.y >= W.YMIN && e.y <= W.YMAX));
});

test("a ship only fires while its player holds fire", () => {
  const g = createGame(1);
  syncShip(g, 1, 1, true); syncShip(g, 2, 2, true);
  setFiring(g, 2, true);
  const shots = { 1: 0, 2: 0 };
  for (let i = 0; i < 60; i++) { step(g); for (const ev of g.events) if (ev[0] === "f") shots[ev[1]]++; }
  assert.equal(shots[1], 0);
  assert.ok(shots[2] >= 5);
});

test("wingmates close together are linked: faster fire, double points", () => {
  const killScore = (dx) => {
    const g = createGame(1); syncShip(g, 1, 1, true); syncShip(g, 2, 1, true); startGame(g); g.queue = []; g.nextWave = 1e9;
    g.ships.get(1).x = 0; g.ships.get(1).y = 8; g.ships.get(2).x = dx; g.ships.get(2).y = 8;
    setFiring(g, 1, true);
    g.enemies.push({ id: 99, x: 0, y: 8, z: -100, pz: -100, sp: 40 });
    for (let i = 0; i < 90 && g.enemies.length; i++) step(g);
    return [g.score, g.ships.get(1).kills, g.ships.get(1).linked];
  };
  assert.deepEqual(killScore(5), [20, 1, true]);
  assert.deepEqual(killScore(20), [10, 1, false]);
});

test("players from different crews never link", () => {
  const g = createGame(1); syncShip(g, 1, 1, true); syncShip(g, 2, 2, true);
  g.ships.get(2).x = g.ships.get(1).x + 2; g.ships.get(2).y = g.ships.get(1).y;
  step(g);
  assert.equal(g.ships.get(1).linked, false);
});

test("a ship whose phone dropped cannot be hit or fire", () => {
  const g = solo(); startGame(g); g.nextWave = 1e9;
  place(g.ships.get(1), 0, 8); g.ships.get(1).inv = 0;
  syncShip(g, 1, 1, false);
  setFiring(g, 1, true);
  g.enemies.push({ id: 1, x: 0, y: 8, z: -2, pz: -2, sp: 60 });
  for (let i = 0; i < 10; i++) step(g);
  assert.equal(g.hull, HULL_MAX);
  assert.equal(g.bullets.length, 0);
});

test("starting a new game resets kills", () => {
  const g = solo(); g.ships.get(1).kills = 5; startGame(g);
  assert.equal(g.ships.get(1).kills, 0);
});

test("each wave is announced once, with its number and pattern", () => {
  const g = solo(); startGame(g); g.ships.get(1).inv = 1e9;
  const waves = [];
  for (let i = 0; i < 30 * 40; i++) { step(g); for (const ev of g.events) if (ev[0] === "w") waves.push(ev.slice(1)); }
  assert.ok(waves.length >= 4);
  assert.deepEqual(waves.map((w) => w[0]), waves.map((_, i) => i + 1));
  assert.ok(waves.slice(0, 2).every((w) => w[1] === "scatter"), "the first two waves are gentle");
});
