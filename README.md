# Stage time
Python conference countdown with separate controller and read-only display links.

## Deploy
Point DNS for timer.txoko.se at your server. Adjust ALLOWED_ORIGINS in compose.yaml if using another hostname. Run `docker compose up -d --build`. Add this to your host Caddyfile, validate it, and reload Caddy:

    timer.txoko.se {
        reverse_proxy 127.0.0.1:8010
    }

Open https://timer.txoko.se and create a timer. Copy the display link to the presenter device. Keep the controller URL private and bookmark it. Tap Activate display on the tablet. Native wake lock needs HTTPS and browser support.

## Local development
Use Python 3.12 and a virtual environment. Install requirements.txt and run `uvicorn app:app --reload`. Open http://localhost:8000. Data defaults to data/timers.db. Run only one worker.

## Prototype limitations
This is a runnable first implementation, not full acceptance of the specification. QR codes, NoSleep.js fallback, session expiry, creation rate limits, command receipt history, and database migrations are not implemented. Display links are saved in the creating browser's local storage; copy the link before changing browsers. Physical device wake behaviour and cross-device latency need manual testing. Restrict access at the reverse proxy before exposing public session creation. Commands use revision checks, preventing a repeated stale command from applying twice; disconnected commands are not queued.

SQLite stores timers and hashed access secrets. A restart retains deadlines. Stop the container before copying the complete data volume, or use SQLite's online backup API. Back up before upgrading. Rebuild with `docker compose up -d --build`; retain the prior image for rollback and do not delete the volume.

## Tests
Install requirements-dev.txt, then run `python -m unittest discover -s tests -v`. Tests cover transitions, overtime and validation. Browser rendering and wake lock have not been automated.
