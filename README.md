# G-Force Crew

A party game for a room of phones. A laptop shows the sky on a projector; everyone scans a QR code and flies their own plane by **tilting their phone**. The whole room shares one score and one hull bar.

## Run it

1. **Install [Docker](https://docs.docker.com/get-docker/) first** (Windows, macOS or Linux). Only the host needs it; players just use their phones.
2. Start the game and get an https link (phones need https to read their tilt sensor):
   ```bash
   docker compose --profile tunnel up -d --build
   docker compose logs tunnel | grep -o 'https://[a-z0-9-]*.trycloudflare.com'
   ```
3. Open that link on the projector and press **Enter** to start. Everyone else scans the QR code.

Stop with `docker compose --profile tunnel down`.
No Docker? Run `npm install && npm start`, then `cloudflared tunnel --url http://localhost:8000`.

## Playing

- **Tilt** to steer, **hold FIRE** to shoot. Your phone is tinted in your plane's colour.
- **Recenter** if it drifts. **Mode** switches portrait / landscape (hold sideways like a steering wheel).
- Controls backwards? Tap **Flip left/right** or **Flip up/down**.
- You get a **wingmate**: fly close together to link up (gold beam) for faster fire and double points.
- The end screen ranks everyone by kills.
- Projector keys: `Enter` start · `M` sound · `N` skip time of day · `C` calm mode (no shaking).

## Setups

- **One projector, everyone plays:** run the host on the projector laptop (lowest latency).
- **A screen per pair:** each laptop opens the same link and gets its own room code (up to 8).
- **Extra screen:** open `/?watch=CODE` to mirror a running game.
- **Own server:** `DOMAIN=play.example.com docker compose --profile https up -d --build` (https on port 443).

## Developers

`npm test` runs the tests. Feel is tuned by `DELAY` in `public/screen.html` and the easing rate (`20`) in `shared/sim.js`. For music, put a `music.mp3` in `public/`.
