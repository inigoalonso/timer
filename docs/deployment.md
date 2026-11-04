# Deployment and recovery

Set BASE_URL to the externally accessible HTTP(S) origin and ALLOWED_ORIGINS to a comma-separated list of exact complete origins (no paths/trailing slash). The default is http://localhost:8000. Origin-less sockets are rejected. Invalid URL/limit configuration fails startup. LOG_LEVEL defaults INFO. DATABASE_PATH defaults data/timers.db. SESSION_TTL_DAYS defaults 7. Positive integer limits: MAX_MESSAGE_BYTES=131072 (128 KiB, accommodates playlists of up to 100 presentations), MAX_CONNECTIONS=500 (includes authenticating sockets), CREATE_PER_MINUTE=10, AUTH_PER_MINUTE=30 (all auth attempts), MESSAGES_PER_MINUTE=120 per socket. The production Uvicorn frame limit is also 131072; change both if needed. Remove or raise any previous 4096-byte deployment override when enabling playlists.

Client IP means the direct peer only. Forwarded headers are not trusted; production disables Uvicorn proxy headers. Behind Caddy, creation/auth limits therefore aggregate at the proxy IP; size them for conference arrivals (e.g. AUTH_PER_MINUTE=300), and add edge per-client limits if required. Never enable forwarded headers from arbitrary peers. Exactly one worker is mandatory. WAL and busy_timeout=5000 are configured. Filesystem/database failures are visible in logs/readiness and never acknowledged as successful commands.

Edit compose.yaml origins, then run `docker compose up -d --build`. The image runs as user app and the named volume initializes /data writable by that user. For bind mounts, set ownership to the image's app UID before startup. The host port binds only loopback. Verify `docker compose ps`, `docker compose logs countdown`, `/healthz` and `/readyz`. Do not log request bodies, authentication messages or full private URLs. Application access logging is disabled in the image.

Example host Caddyfile:

```caddyfile
 timer.txoko.se {
     reverse_proxy 127.0.0.1:8010
 }
```

Validate with `caddy validate --config /etc/caddy/Caddyfile`, then `caddy reload --config /etc/caddy/Caddyfile`. Caddy handles HTTPS/WebSocket upgrades. Verify from the public origin: create session, join a display, start/pause, disconnect network for 30 seconds, reconnect. Test certificate validity and ensure other Origins cannot connect.

Before upgrade, retain the running image ID/tag and take an online SQLite backup (choose a new filename):

```sh
docker compose exec countdown python scripts/backup.py /data/timers.db /data/pre-upgrade.db
docker compose cp countdown:/data/pre-upgrade.db ./pre-upgrade.db
```

The helper uses SQLite backup and integrity_check, including committed WAL content. Copy the backup off the host; protect it as credential-hash/state data. Do not copy only a live main database file. Migration additionally creates timers.db.pre-v1.bak before schema changes. Build and upgrade with `docker compose up -d --build`; inspect readiness and verify existing running, paused and overdue sessions.

Restore: stop the application, preserve the old volume, create a fresh volume, copy the chosen consistent backup as /data/timers.db with app ownership, and start one application instance pointing at it. Do not mix old -wal/-shm sidecars with the restored database. Validate integrity/readiness, reconnect saved controller/display links and verify revision, title, deadline and paused/overtime state. A past deadline correctly restores as overtime; restoration does not reset elapsed wall time. Test this in a separate deployment before switching traffic.

Rollback: use the retained image with its compatible backup. Prototype schema 0 cannot be assumed compatible with schema 1 renamed JSON fields; restore the pre-v1 backup for prototype rollback. Newer schema versions are rejected at startup. Do not delete the original volume until restore acceptance passes. Automated tests cover a consistent backup reopened in a fresh process; the full fresh-container restoration exercise remains an operator acceptance task.

The dependency constraint file fixes Python package versions. Rebuild/review updates deliberately; base image digest is pinned. CI runs unit/integration/persistence tests, JavaScript syntax, capacity and an image build. Physical wake locks and real reverse-proxy operation still require deployment-specific validation.
