import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import WebSocket from "ws";

const PORT = 18900, URL = `ws://localhost:${PORT}`;
let server;
before(async () => {
  server = spawn("node", ["server.js"], { env: { ...process.env, PORT: String(PORT), PUBLIC_URL: "https://play.example.com/" }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((r) => server.stdout.once("data", r));
});
after(() => server.kill());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client() {
  const ws = new WebSocket(URL), msgs = [];
  ws.on("message", (d) => msgs.push(JSON.parse(d)));
  const ready = new Promise((r) => ws.on("open", r));
  return { ws, msgs, ready, send: (o) => ws.send(JSON.stringify(o)), last: (t) => msgs.findLast((m) => m.t === t) };
}
async function screen(code) {
  const s = client(); await s.ready; s.send({ t: "create", code }); await sleep(100); return s;
}
async function phone(room, name, token) {
  const p = client(); await p.ready; p.send({ t: "join", room, name, token }); await sleep(100); return p;
}

test("players are paired into wing crews of two", async () => {
  const s = await screen();
  const { code, url } = s.last("room");
  assert.match(code, /^[A-HJ-NP-Z]{4}$/);
  assert.equal(url, "https://play.example.com");
  const a = await phone(code.toLowerCase(), "ann", "tok-a"), b = await phone(code, "bo", "tok-b"), c = await phone(code, "cy", "tok-c");
  assert.deepEqual([a, b, c].map((p) => p.last("joined").crew), [1, 1, 2]);
  const [ca, cb, cc] = [a, b, c].map((p) => p.last("joined").color);
  assert.ok(ca === cb && ca !== cc, "wingmates share a colour, other crews differ");
  assert.equal(s.last("room").colors[0], ca, "the screen gets the same palette");
  assert.equal(s.last("roster").players.length, 3);
  for (const x of [s, a, b, c]) x.ws.close();
});

test("a second screen can watch the same room but not start it", async () => {
  const host = await screen(); const { code } = host.last("room");
  await phone(code, "ann", "tok-w");
  const viewer = client(); await viewer.ready; viewer.send({ t: "watch", room: code.toLowerCase() }); await sleep(150);
  assert.equal(viewer.last("room").code, code);
  assert.equal(viewer.last("roster").players.length, 1);
  viewer.send({ t: "start" }); await sleep(150);
  assert.equal(host.last("snap").s, "lobby", "a viewer cannot start the game");
  host.send({ t: "start" }); await sleep(250);
  assert.equal(viewer.last("snap").s, "play", "the viewer sees the same game");
  viewer.ws.close(); await sleep(100);
  assert.ok(host.last("snap"), "host keeps working after a viewer leaves");
  const lost = client(); await lost.ready; lost.send({ t: "watch", room: "ZZZZ" }); await sleep(100);
  assert.equal(lost.last("error").msg, "no such room");
  for (const x of [host, lost]) x.ws.close();
});

test("unknown room is refused", async () => {
  const p = await phone("ZZZZ", "x", "tok-x");
  assert.equal(p.last("error").msg, "no such room");
});

test("only the screen can start; a flying, firing player scores kills; a phone can reconnect to its seat", async () => {
  const s = await screen(); const { code } = s.last("room");
  const pilot = await phone(code, "ann", "tok-1"), gunner = await phone(code, "bo", "tok-2");   // wingmates; ann flies and fires
  pilot.send({ t: "start" }); await sleep(150);                                  // ignored: not the screen
  assert.equal(s.last("snap").s, "lobby");
  s.send({ t: "start" }); await sleep(100);
  assert.equal(s.last("snap").s, "play");

  pilot.send({ t: "fire", on: 1 });
  const autopilot = setInterval(() => {
    const snap = s.last("snap"), me = snap?.sh.find((x) => x[0] === 1);
    const e = snap?.en.filter((x) => x[3] < -15).sort((a, b) => b[3] - a[3])[0];
    if (me && e) pilot.send({ t: "in", r: Math.max(-1, Math.min(1, (e[1] - me[2]) / 5)), p: Math.max(-1, Math.min(1, (e[2] - me[3]) / 4)) });
  }, 33);
  await sleep(9000);
  clearInterval(autopilot);
  const snap = s.last("snap");
  assert.ok(snap.sc > 0, `expected kills, score was ${snap.sc}`);
  const hud = pilot.last("hud");
  assert.ok(hud && hud.k > 0 && hud.w === "bo", `hud shows own kills and wingmate (${JSON.stringify(hud)})`);

  gunner.ws.close(); await sleep(150);
  const back = await phone(code, "bo", "tok-2");                                 // same token = same seat
  assert.equal(back.last("joined").crew, 1);
  assert.equal(s.last("roster").players.length, 2);

  s.ws.close(); await sleep(100);
  const s2 = await screen(code);                                                 // screen reloads and reclaims the room
  assert.equal(s2.last("room").code, code);
  assert.equal(s2.last("roster").players.length, 2);
  for (const x of [s2, pilot, back]) x.ws.close();
});

test("garbage input never crashes the server", async () => {
  const s = await screen(); const { code } = s.last("room");
  const p = await phone(code, "<img src=x onerror=alert(1)>", "tok-evil");
  assert.ok(!/[<>"&]/.test(s.last("roster").players[0].name), "markup is stripped from names");
  for (const raw of ["not json", '{"t":"in","r":"NaN","p":1e999}', '{"t":"fire"}', "{}", '{"t":"join"}', "[]", "null"]) p.ws.send(raw);
  await sleep(150);
  const ok = await fetch(`http://localhost:${PORT}/healthz`);
  assert.equal(ok.status, 200);
  for (const x of [s, p]) x.ws.close();
});
