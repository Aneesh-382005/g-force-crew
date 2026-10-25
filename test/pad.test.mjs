import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

// Loads the phone page, joins, feeds fake deviceorientation events, and reads what it would send.
async function pad({ land, angle, early = false }) {
  const els = new Map(), listeners = {}, sockets = [], timers = [];
  const el = (id) => els.get(id) || els.set(id, { style: {}, classList: { toggle() {}, add() {}, remove() {} }, value: "", textContent: "", innerHTML: "", getBoundingClientRect: () => ({}) }).get(id);
  const mem = { gfc: { "gfc.land": land ? "1" : "0" } };
  const win = {
    document: { getElementById: el, body: { classList: { toggle() {} } } },
    localStorage: { getItem: (k) => mem.gfc[k] ?? null, setItem() {} }, sessionStorage: {},
    location: { protocol: "https:", host: "x", search: "?room=ABCD" }, navigator: { wakeLock: { request: async () => {} } },
    screen: { orientation: { angle } }, console, Math, JSON, Promise, Date, Number, String, Array, Object, URLSearchParams, setTimeout, clearTimeout,
    addEventListener: (e, f) => (listeners[e] ||= []).push(f), removeEventListener: (e, f) => { listeners[e] = (listeners[e] || []).filter((x) => x !== f); },
    setInterval: (f) => timers.push(f),
    WebSocket: class { constructor() { this.readyState = 1; this.sent = []; sockets.push(this); } send(m) { this.sent.push(m); } close() {} },
    DeviceOrientationEvent: Object.assign(function () {}, { requestPermission: async () => "granted" }),
  };
  win.window = win;
  vm.runInNewContext(readFileSync("public/pad.html", "utf8").match(/<script>([\s\S]*?)<\/script>/)[1], win);
  el("room").value = "ABCD";
  if (early) listeners.deviceorientation.forEach((f) => f({ gamma: 0, beta: 90 }));   // the one event a still phone fires at page load
  const click = el("go").onclick();
  await new Promise((r) => setTimeout(r, 10));
  if (!early) listeners.deviceorientation.slice().forEach((f) => f({ gamma: 0, beta: 90 }));
  await click;
  sockets[0].onmessage({ data: '{"t":"joined","crew":1}' });
  const feed = (beta, gamma) => { listeners.deviceorientation.forEach((f) => f({ beta, gamma })); sockets[0].sent.length = 0; timers[0](); return JSON.parse(sockets[0].sent[0]); };
    return { feed, sockets, el, status: () => el("status").textContent };
}

test("portrait tray: lean right steers right, top toward you climbs, shake is ignored", async () => {
  const { feed } = await pad({ land: false, angle: 0 });
  feed(90, 0);                                              // first reading = level
  assert.deepEqual([feed(90, 0).r, feed(90, 0).p], [0, 0]);
  assert.ok(feed(90, 15).r > 0.3 && feed(90, 40).r === 1);
  assert.ok(feed(110, 0).p > 0.5 && feed(70, 0).p < -0.5);
  assert.equal(feed(90, 2).r, 0);
});

// Physical poses for a phone held sideways like a wheel (screen up = user's up). Neutral, then twisted/tilted by 20 degrees.
// device-left landscape (angle 90): neutral is beta 0 / gamma -90; twist clockwise = beta +20; top toward you = beta 180 / gamma 70.
test("landscape wheel, rotated 90: twist clockwise steers right, top toward you climbs", async () => {
  const { feed } = await pad({ land: true, angle: 90 });
  feed(0, -90);
  const neutral = feed(0, -90);
  assert.deepEqual([neutral.r, neutral.p], [0, 0]);
  const twist = feed(20, -90), pull = feed(180, 70);
  assert.ok(twist.r > 0.3 && Math.abs(twist.p) < 0.05, `twist ${JSON.stringify(twist)}`);
  assert.ok(pull.p > 0.3 && Math.abs(pull.r) < 0.05, `pull ${JSON.stringify(pull)}`);
  assert.ok(feed(-20, -90).r < -0.3, "twist counter-clockwise steers left");
  assert.ok(feed(0, -70).p < -0.3, "top away dives");
});

test("landscape wheel reads the same for the other landscape side (angle 270)", async () => {
  // device-right landscape: neutral is beta 0 / gamma +90; clockwise twist = beta -20
  const { feed } = await pad({ land: true, angle: 270 });
  feed(0, 90);
  assert.deepEqual([feed(0, 90).r, feed(0, 90).p], [0, 0]);
  assert.ok(feed(-20, 90).r > 0.3, "clockwise twist steers right");
  assert.ok(feed(20, 90).r < -0.3, "counter-clockwise twist steers left");
});

test("a phone lying still still counts as having a sensor", async () => {
  const { status } = await pad({ land: false, angle: 0, early: true });   // no event after Join, only the one from page load
  assert.match(status(), /Tilt to fly/);
});

test("switching mode forgets the other mode's reading, so an early Recenter cannot use it", async () => {
  const { feed, el } = await pad({ land: false, angle: 90 });
  feed(0, -90);                                             // read in portrait mode: raw gamma -90
  el("mode").onclick();                                     // now landscape wheel
  el("recenter").onclick();
  feed(0.3, -90);
  assert.ok(Math.abs(feed(0.6, -90).r) < 0.05, "level stays level");
  assert.ok(feed(20.6, -90).r > 0.3, "and twisting still steers");
});
