# Stage time

Conference countdown with private controller links and read-only presenter displays. This completes the prototype's server/client workflow; see docs/acceptance.md for verified results and outstanding release acceptance.

The controller separates **Run**, **Playlist** and **Connect** into tabs, with live countdown controls always available. Build and reorder presentations in **Playlist**, select **Save changes**, then load talks and Q&A from **Run**. Each transition prepares the countdown; select **Start** when ready. Download/upload lists as reusable JSON files. Presenter displays have no app header or controller controls, with full-screen/wake controls that hide when idle. See the [operator guide](docs/operator.md) for details.

Enable **Browser notifications** in the controller's settings menu for five-minute, one-minute and time-up alerts. Presenter displays never send notifications. Browser permission and HTTPS (or localhost) are required; see [notification support and limitations](docs/operator.md#browser-notifications). Run frontend interaction and notification regression tests with `node --test tests/*.cjs`.

Install **Stage time Display** from `/display/` for a reusable Home Screen app. On iOS, use Safari's **Share > Add to Home Screen**, then open the installed app and scan the controller's QR or paste its display link. The app remembers the last successfully joined session. Apple Camera links may still open in the browser; scan inside the installed app to stay in it. See [display app installation](docs/operator.md#installable-display-app).

Run Python 3.12+ in a virtual environment, then:

```sh
pip install -r requirements-dev.txt
uvicorn app:app --host 127.0.0.1 --port 8000 --workers 1 --no-proxy-headers --no-access-log
```

Open http://localhost:8000 (the default allowed origin). If opening 127.0.0.1 instead, set BASE_URL and ALLOWED_ORIGINS accordingly. Exactly one application worker is required. SQLite WAL, per-session mutation locks and independent bounded socket queues coordinate the timers. Run tests with `python -m unittest discover -s tests -v`, JavaScript validation with `node --check static/app.js`, and local capacity verification with `python scripts/capacity.py`.

- [Deployment, backup, restore and rollback](docs/deployment.md)
- [One-page operator guide](docs/operator.md)
- [WebSocket protocol and refinements](docs/protocol.md)
- [Acceptance evidence and device checklist](docs/acceptance.md)

Dependencies are constrained in requirements.lock; container runtime dependencies are selected by requirements.txt. Locally bundled QR Code Generator 1.4.4, NoSleep.js 0.12.0, Lucide 0.468.0 and jsQR 1.4.0 retain notices in static/vendor. No remote scripts, fonts or pairing services are used. QR camera frames are decoded on-device, never uploaded. The base container image is pinned by digest.
