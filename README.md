# Stage time

Conference countdown with private controller links and read-only presenter displays. This completes the prototype's server/client workflow; see docs/acceptance.md for verified results and outstanding release acceptance.

Build a presentation playlist in the controller: add titles, talk durations and Q&A durations, reorder or remove entries, then select **Save playlist**. Load a talk directly or use **Next** to move through each talk and its Q&A. Each transition prepares the countdown; select **Start** when the speaker is ready. Download/upload playlists as reusable JSON files. Saved lists persist with the session. See the [operator guide](docs/operator.md#presentation-playlists) for details.

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

Dependencies are constrained in requirements.lock; container runtime dependencies are selected by requirements.txt. Locally bundled QR Code Generator 1.4.4 and NoSleep.js 0.12.0 retain notices in static/vendor. No remote scripts or pairing services are used. The base container image is pinned by digest.
