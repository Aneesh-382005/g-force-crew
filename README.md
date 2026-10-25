# G-Force Crew

A co-op plane game for a room full of phones. A laptop on the big screen shows the sky; players scan a QR code and fly with their phones. Players are paired into **crews of two**: the **pilot** tilts their phone to steer, the **gunner** holds a button to fire. The whole room shares one score and one hull bar.

Works on iPhone (Safari), Android (Chrome), and any laptop browser. No app, no accounts, no hardware.

```
phone (pilot)  --tilt, 30/s-->  server (Node, ws)  --snapshots, 30/s-->  big screen (Three.js)
phone (gunner) --fire on/off->  runs the game at 30 Hz
```

The server owns the game (`shared/sim.js`, no DOM), so every screen sees the same world, and enemy waves come from a seeded RNG.

## Run it

Phones need **HTTPS** to read their motion sensors, so the game has to be reachable at an `https://` address. Open that address on the big screen too: the QR code is built from whatever address the big screen was opened on.

**With Docker only** (Windows, macOS, Linux; nothing else to install):

```bash
docker compose --profile tunnel up -d --build
docker compose logs tunnel | grep trycloudflare     # the https link; open it on the big screen
```

**With Node** (`npm install`, then):

```bash
npm start                                            # http://localhost:8000
cloudflared tunnel --url http://localhost:8000       # prints https://<random>.trycloudflare.com
```

**On a server** (HTTPS on port 443 with a real certificate; needs a domain pointing at the machine):

```bash
DOMAIN=play.example.com docker compose --profile https up -d --build
```

## Run it from a published image (no source needed)

CI builds an amd64 + arm64 image on every push to `main`: `ghcr.io/<owner>/<repo>` (set the package to public once in GitHub). Then on any laptop with Docker:

```bash
docker run -d -p 8000:8000 ghcr.io/<owner>/<repo>
```

Offline (no internet at the venue): copy `dist/g-force-crew-amd64.tar.gz` on a USB stick, then `docker load -i g-force-crew-amd64.tar.gz` and `docker run -d -p 8000:8000 g-force-crew`. The offline file is amd64 only; Apple Silicon Macs run it through emulation, or pull the published image beforehand.

Only one machine needs to host. Everyone else just opens the link.

## Controls

| | |
|---|---|
| Pilot | tilt the phone like a tray: lean right = right, pull the top toward you = climb. **Recenter** sets "level" |
| Gunner | hold FIRE |
| No motion sensor | the pilot drags inside the box instead |
| Big screen | `Enter` start · `M` sound · `N` skip time of day |

If a direction feels backwards, the pilot has **Flip left/right** and **Flip up/down** buttons.
A crew with no gunner auto-fires slowly. Put your own audio at `public/music.mp3` and the big screen loops it (not included).

## Tests

```bash
npm test      # sim rules + a real server with fake phones
```

## Known limits

- Anyone who knows the room URL can open a screen or join; there is no auth. Fine for a meetup, not for the open internet.
- Phones must stay portrait while flying. Rotation is detected and a reminder is shown.
- Sensor behaviour differs between phone models; test on one iPhone and one Android before the event.
