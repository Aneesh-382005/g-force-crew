# G-Force Crew

A co-op plane game for a room full of phones. A laptop on the big screen shows the sky; players scan a QR code and each get their own plane: **tilt the phone to steer, hold FIRE to shoot**. Everyone shares one score and one hull bar, and each player is paired with a **wingmate**. Fly close to your wingmate to **link up**: a gold beam appears, you fire faster, and your kills are worth double. The end screen ranks everyone by kills.

Works on iPhone (Safari), Android (Chrome), and any laptop browser. No app, no accounts, no hardware.

```
phone --tilt 30/s, fire on/off-->  server (Node, ws)  --snapshots 30/s-->  big screen (Three.js)
phone <-- kills, link, hull 4/s --  runs the game at 30 Hz
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

## Ways to run an event

All three work with the same build:

- **One projector, everyone plays.** Run the server on the laptop that drives the projector and open the page full-screen on it. Everyone scans the QR code and flies in the same world. Only the phone-to-laptop leg crosses a network; the screen is on the same machine as the server, so nothing has to travel back.
- **A screen per pair.** Each extra laptop opens the same server URL and gets its **own room and code** (up to 8 rooms), so two players fly at each screen.
- **A second screen for the same game.** Open `/?watch=CODE` on another laptop or projector to mirror a running game. Only the host screen can start it.

## Controls

| | |
|---|---|
| Steer | tilt the phone. **Portrait tray**: lean right = right, top toward you = climb. **Landscape wheel**: hold it sideways and twist like a steering wheel, top toward you = climb |
| Fire | hold the big FIRE button |
| Recenter | sets "level" to how you are holding the phone now |
| Mode | the **Mode** button switches portrait tray / landscape wheel. The page asks you to rotate the phone if it disagrees with the mode |
| No motion sensor | drag inside the box instead |
| Big screen | `Enter` start / play again, `M` sound, `N` skip time of day, `C` calm mode (no screen shake or flashes; on by default if the system asks for reduced motion) |

If a direction feels backwards, use **Flip left/right** or **Flip up/down**. Put your own audio at `public/music.mp3` and the big screen loops it (not included).

## Tests

```bash
npm test      # sim rules + a real server with fake phones
```

## Known limits

- Anyone who knows the room URL can open a screen or join; there is no auth. Fine for a meetup, not for the open internet.
- The tilt maths is checked against Chromium's emulated sensors (portrait, and landscape rotated 90 degrees). Real phones, iOS, and the other landscape side (270) are only covered by unit tests so far.
- Sensor behaviour differs between phone models; test on one iPhone and one Android before the event.
