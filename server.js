import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createGame, startGame, syncCrew, setInput, setFiring, step, snapshot } from "./shared/sim.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 8000;
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const MAX_ROOMS = 8, MAX_PLAYERS = 80, PHONE_GRACE = 20_000, SCREEN_GRACE = 120_000;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mp3": "audio/mpeg" };
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";                   // no I or O
const randSeed = () => (Math.random() * 2 ** 31) | 0;
const send = (ws, msg) => ws && ws.readyState === 1 && ws.send(JSON.stringify(msg));
const alive = (p) => !!p && !!p.ws && p.ws.readyState === 1;
const axis = (v) => Math.max(-1, Math.min(1, +v || 0));

const http = createServer(async (req, res) => {
  let path = new URL(req.url, "http://x").pathname;
  if (path === "/healthz") return res.writeHead(200).end("ok");
  if (path === "/") path = "/screen.html";
  if (path === "/pad") path = "/pad.html";
  const file = normalize(join(ROOT, path.startsWith("/shared/") ? "" : "public", path));
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

// room: { code, screen, game, players: Map(token -> { token, ws, name, crew, role, drop }), crews: Map(id -> { id, pilot, gunner }), ... }
const rooms = new Map();

const syncRoom = (room) => {
  for (const id of [...room.game.ships.keys()]) if (!room.crews.has(id)) syncCrew(room.game, id, null);
  for (const c of room.crews.values())
    syncCrew(room.game, c.id, { pilot: alive(room.players.get(c.pilot)), gunner: alive(room.players.get(c.gunner)) });
  send(room.screen, {
    t: "roster",
    players: [...room.players.values()].map((p) => ({ crew: p.crew, role: p.role, name: p.name, on: alive(p) })),
  });
};

const wss = new WebSocketServer({ server: http, maxPayload: 1024 });
wss.on("connection", (ws) => {
  let room = null, me = null;

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== "object") return;

    if (m.t === "create" && !room) {
      const old = rooms.get(String(m.code || "").toUpperCase());
      if (old && !old.screen) { room = old; room.screen = ws; clearTimeout(room.grace); }
      else if (rooms.size >= MAX_ROOMS) return send(ws, { t: "error", msg: "too many rooms" });
      else {
        let code; do code = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join(""); while (rooms.has(code));
        const r = room = { code, screen: ws, game: createGame(randSeed()), players: new Map(), crews: new Map(), nextCrew: 1, n: 0, grace: null };
        rooms.set(code, r);
        r.loop = setInterval(() => {
          step(r.game);
          const snap = snapshot(r.game);
          send(r.screen, { t: "snap", ...snap });
          for (const ev of snap.ev) if (ev[0] === "h") {
            const c = r.crews.get(ev[1]);
            for (const tok of [c?.pilot, c?.gunner]) send(r.players.get(tok)?.ws, { t: "hit" });
          }
          if (++r.n % 8 === 0) for (const p of r.players.values()) send(p.ws, { t: "hud", s: snap.s, sc: snap.sc, h: snap.h });
        }, 1000 / 30);
      }
      send(ws, { t: "room", code: room.code, url: PUBLIC_URL || null });
      syncRoom(room);

    } else if (m.t === "join" && !room) {
      const r = rooms.get(String(m.room || "").toUpperCase());
      const token = String(m.token || "").slice(0, 40);
      if (!r || !token) return send(ws, { t: "error", msg: "no such room" });
      let p = r.players.get(token);
      if (!p) {
        if (r.players.size >= MAX_PLAYERS) return send(ws, { t: "error", msg: "room is full" });
        p = { token, drop: null };
        r.players.set(token, p);
        // fill a half-empty crew first so people get paired, otherwise start a new crew as its pilot
        const half = [...r.crews.values()].find((c) => !c.pilot !== !c.gunner);
        if (half) { p.role = half.pilot ? "gunner" : "pilot"; p.crew = half.id; half[p.role] = token; }
        else { r.crews.set(r.nextCrew, { id: r.nextCrew, pilot: token, gunner: null }); p.role = "pilot"; p.crew = r.nextCrew++; }
      }
      clearTimeout(p.drop);
      p.ws = ws; p.name = String(m.name || "pilot").replace(/[<>&"'`]/g, "").slice(0, 12);
      room = r; me = p;
      send(ws, { t: "joined", crew: p.crew, role: p.role });
      syncRoom(room);

    } else if (room && ws === room.screen) {
      if (m.t === "start" && room.game.ships.size) startGame(room.game, randSeed());

    } else if (me) {
      if (m.t === "in" && me.role === "pilot") setInput(room.game, me.crew, axis(m.r), axis(m.p));
      else if (m.t === "fire" && me.role === "gunner") setFiring(room.game, me.crew, m.on);
    }
  });

  ws.on("close", () => {
    if (!room) return;
    if (ws === room.screen) {                                  // keep the room briefly so the screen can reload
      room.screen = null;
      room.grace = setTimeout(() => {
        clearInterval(room.loop);
        for (const p of room.players.values()) { clearTimeout(p.drop); send(p.ws, { t: "error", msg: "game ended" }); }
        rooms.delete(room.code);
      }, SCREEN_GRACE);
    } else if (me && me.ws === ws) {                           // hold the seat briefly so a phone can reconnect
      me.ws = null;
      me.drop = setTimeout(() => {
        room.players.delete(me.token);
        const c = room.crews.get(me.crew);
        c[me.role] = null;
        if (!c.pilot && !c.gunner) room.crews.delete(c.id);
        syncRoom(room);
      }, PHONE_GRACE);
      syncRoom(room);
    }
  });
});

http.listen(PORT, () => console.log(`G-Force Crew on http://localhost:${PORT}${PUBLIC_URL ? ` (public ${PUBLIC_URL})` : ""}`));
