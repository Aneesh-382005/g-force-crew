import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createGame, startGame, syncShip, setInput, setFiring, step, snapshot } from "../shared/sim.js";

// Runs the big-screen script with the real Three.js scene graph (no GPU) and fake browser pieces.
const stub = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === "length" ? 0 : k === "then" ? undefined : stub()),
  apply: () => stub(), construct: () => stub(), set: () => true,
});

test("planes, enemies, bullets and the wing beam all end up in the scene", () => {
  const sockets = [], raf = [];
  const mem = { getItem: () => null, setItem() {} };
  const ctx = vm.createContext({
    document: { getElementById: () => stub(), createElement: () => stub(), body: stub() },
    localStorage: mem, sessionStorage: mem, location: { protocol: "http:", host: "x", origin: "http://x" },
    performance, console, Math, JSON, Promise, Float32Array, Event: class {}, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    addEventListener() {}, dispatchEvent() {}, setTimeout, fetch: () => Promise.reject(), AudioContext: stub(), qrcode: stub(),
    requestAnimationFrame: (f) => raf.push(f),
    WebSocket: class { constructor() { sockets.push(this); this.readyState = 1; } send() {} },
  });
  ctx.window = ctx.self = ctx;
  vm.runInContext(readFileSync("public/vendor/three.min.js", "utf8"), ctx);
  ctx.THREE.WebGLRenderer = class { constructor() { this.domElement = stub(); } setPixelRatio() {} setSize() {} render() {} };
  vm.runInContext(readFileSync("public/screen.html", "utf8").match(/<script>([\s\S]*?)<\/script>/)[1], ctx);

  const ws = sockets[0];
  ws.onmessage({ data: JSON.stringify({ t: "roster", players: [{ id: 1, crew: 1, name: "a", on: true }, { id: 2, crew: 1, name: "b", on: true }] }) });
  const g = createGame(5); syncShip(g, 1, 1, true); syncShip(g, 2, 1, true); startGame(g, 5);
  let now = 1000, seen = { planes: 0, enemies: 0, bullets: 0, beams: 0 };
  for (let i = 0; i < 400; i++) {
    setInput(g, 1, Math.sin(i / 25), 0); setInput(g, 2, Math.sin(i / 25), 0); setFiring(g, 1, true); step(g);
    ws.onmessage({ data: JSON.stringify({ t: "snap", ...snapshot(g) }) });
    now += 33; raf.splice(0).forEach((f) => f(now));
    const count = (geo) => vm.runInContext(`scene.children.filter((c) => c.geometry === ${geo}).length`, ctx);
    seen.enemies = Math.max(seen.enemies, count("enemyGeo")); seen.bullets = Math.max(seen.bullets, count("bulletGeo"));
    seen.planes = Math.max(seen.planes, vm.runInContext("planes.size", ctx));
    seen.beams = Math.max(seen.beams, vm.runInContext("beams.size", ctx));
  }
  assert.equal(seen.planes, 2, "both planes in scene");
  assert.ok(seen.beams >= 1, "a beam is drawn between linked wingmates");
  assert.ok(seen.enemies >= 1, `enemies in scene (saw ${seen.enemies})`);
  assert.ok(seen.bullets >= 1, `bullets in scene (saw ${seen.bullets})`);
});
