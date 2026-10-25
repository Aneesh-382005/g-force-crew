import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createGame, startGame, syncShip, setInput, setFiring, step, snapshot } from "./shared/sim.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 8000;
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const MAX_ROOMS = 8, MAX_PLAYERS = 80, PHONE_GRACE = 20_000, SCREEN_GRACE = 120_000;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mp3": "audio/mpeg" };
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";                   // no I or O
const COLORS = [0xff6b6b, 0x4dd0e1, 0xffd93d, 0xb388ff, 0x69f0ae, 0xff9ff3, 0xffa94d, 0x74c0fc];   // one per crew, shared by the screen and the phones
const roomMsg = (r) => ({ t: "room", code: r.code, url: PUBLIC_URL || null, colors: COLORS });
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

// room: { code, screen (the host), viewers (extra screens, watch only), game, players: Map(token -> { token, id, ws, name, crew, drop }), crews: Map(id -> { id, members: [token] }), ... }
const rooms = new Map();

const toScreens = (room, msg) => [room.screen, ...room.viewers].forEach((w) => send(w, msg));

const syncRoom = (room) => {
  const ids = new Set();
  for (const p of room.players.values()) { ids.add(p.id); syncShip(room.game, p.id, p.crew, alive(p)); }
  for (const id of [...room.game.ships.keys()]) if (!ids.has(id)) syncShip(room.game, id, null);
  toScreens(room, {
    t: "roster",
    players: [...room.players.values()].map((p) => ({ id: p.id, crew: p.crew, name: p.name, on: alive(p) })),
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
        const r = room = { code, screen: ws, game: createGame(randSeed()), players: new Map(), crews: new Map(), viewers: new Set(), nextCrew: 1, nextId: 1, n: 0, grace: null };
        rooms.set(code, r);
        r.loop = setInterval(() => {
          step(r.game);
          const snap = snapshot(r.game);
          toScreens(r, { t: "snap", ...snap });
          for (const ev of snap.ev) if (ev[0] === "h") send([...r.players.values()].find((q) => q.id === ev[1])?.ws, { t: "hit" });
          if (++r.n % 8 === 0) for (const p of r.players.values()) {
            const ship = r.game.ships.get(p.id), mate = r.crews.get(p.crew).members.map((t) => r.players.get(t)).find((q) => q !== p);
            send(p.ws, { t: "hud", s: snap.s, sc: snap.sc, h: snap.h, k: ship?.kills ?? 0, l: ship?.linked ? 1 : 0, w: mate?.name ?? null });
          }
        }, 1000 / 30);
      }
      send(ws, roomMsg(room));
      syncRoom(room);

    } else if (m.t === "watch" && !room) {
      const r = rooms.get(String(m.room || "").toUpperCase());
      if (!r) return send(ws, { t: "error", msg: "no such room" });
      room = r; r.viewers.add(ws);
      send(ws, roomMsg(r));
      syncRoom(r);

    } else if (m.t === "join" && !room) {
      const r = rooms.get(String(m.room || "").toUpperCase());
      const token = String(m.token || "").slice(0, 40);
      if (!r || !token) return send(ws, { t: "error", msg: "no such room" });
      let p = r.players.get(token);
      if (!p) {
        if (r.players.size >= MAX_PLAYERS) return send(ws, { t: "error", msg: "room is full" });
        p = { token, id: r.nextId++, drop: null };
        r.players.set(token, p);
        // wingmates: join a crew that has one member, otherwise start a new crew
        const half = [...r.crews.values()].find((c) => c.members.length === 1);
        if (half) { half.members.push(token); p.crew = half.id; }
        else { r.crews.set(r.nextCrew, { id: r.nextCrew, members: [token] }); p.crew = r.nextCrew++; }
      }
      clearTimeout(p.drop);
      p.ws = ws; p.name = String(m.name || "pilot").replace(/[<>&"'`]/g, "").slice(0, 12);
      room = r; me = p;
      send(ws, { t: "joined", crew: p.crew, color: COLORS[(p.crew - 1) % COLORS.length] });
      syncRoom(room);

    } else if (room && ws === room.screen) {
      if (m.t === "start" && room.game.ships.size) startGame(room.game, randSeed());

    } else if (me) {
      if (m.t === "in") setInput(room.game, me.id, axis(m.r), axis(m.p));
      else if (m.t === "fire") setFiring(room.game, me.id, m.on);
    }
  });

  ws.on("close", () => {
    if (!room) return;
    if (room.viewers.delete(ws)) return;
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
        c.members = c.members.filter((t) => t !== me.token);
        if (!c.members.length) room.crews.delete(c.id);
        syncRoom(room);
      }, PHONE_GRACE);
      syncRoom(room);
    }
  });
});

http.listen(PORT, () => console.log(`G-Force Crew on http://localhost:${PORT}${PUBLIC_URL ? ` (public ${PUBLIC_URL})` : ""}`));
