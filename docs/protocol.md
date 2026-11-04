# Protocol v1

This document records refinements to the supplied completion plan. The original DOCX/ZIP were not present in the repository; this protocol supersedes prototype field/action names.

POST /api/sessions returns relative `controller` and `display` links, with secrets in fragments. GET /healthz is liveness; /readyz queries SQLite. GET /control/{id} and /display/{id} serve the client. Session credentials are stored as SHA-256 hashes. Session snapshots never contain credentials.

Connect /ws/{id} with an exact allowed Origin. Missing Origin is rejected, including for nonbrowser clients. First message within five seconds:

```json
{"type":"auth","role":"control","token":"secret-from-fragment"}
```

Role must match the credential. Display credentials cannot control. An invalid, expired or rotated credential closes with 1008; clients must stop retrying. Active sessions receive full `state` messages. State fields: mode (prepared/running/paused), selected_duration_seconds, deadline_utc_ms (nullable), paused_remaining_ms (nullable), title, revision, server_now_ms, connected_display_count, expires_at_ms. Time units are milliseconds since Unix epoch except durations in seconds.

```json
{"type":"command","request_id":"unique-id","expected_revision":0,"action":"start","payload":{}}
```

Actions: start, pause, reset, set_duration ({seconds:60..10800, whole minutes}), adjust_time ({seconds:-60 or 60}), set_title ({text:up to 120 characters}), rotate_display ({}). Extra fields and invalid payloads are rejected. Adjustments preserve reset duration, allow negative time down to -24 hours and positive time up to 3 hours. Reset/prepared time is the selected duration.

Playlist snapshot fields are `playlist` (an ordered array, default `[]` for existing sessions), `playlist_index` (nullable zero-based active index) and `playlist_phase` (`talk`, `qa`, or null). Each entry has exactly `title` (nonblank, up to 120 characters), `duration_seconds` (60..10800, whole minutes), and `qa_duration_seconds` (0..10800, whole minutes; 0 skips Q&A). At most 100 entries are accepted. Additional commands:

- `set_playlist`, payload `{"entries":[...]}`: atomically replace the list and clear the active index/phase without changing the countdown. An empty list clears the playlist.
- `load_presentation`, payload `{"index":0,"phase":"talk"}`: load the indexed talk or nonzero `qa` phase, update title/reset duration, and prepare its countdown.
- `next_presentation`, payload `{}`: load the first talk if no entry is selected; otherwise load that talk's Q&A when present, then the next talk. Advancing past the final phase is rejected.

Loading/advancing never starts the countdown. Clients confirm before replacing a running countdown. `set_title` and `set_duration` clear the active playlist selection; reset, pause, start and adjustments retain it. Playlist mutations use the same revision checks, durable receipts, authorization and atomic persistence as other commands. No SQL schema migration is required: old JSON states receive empty playlist defaults when read. Download/upload is client-side versioned JSON (`{"version":1,"presentations":[...]}`), excludes credentials, and requires a subsequent `set_playlist` command to save imported data.

Success is `ack` with request_id and committed revision. Errors include stable code and message, with request_id when a valid command was decoded. Codes: invalid_message, read_only, request_id_reused, revision_conflict (includes current authorised state), invalid_transition, database_unavailable. A failed database transaction returns no success; its outcome may be unknown and clients must retrieve state before deciding whether to retry.

Command receipts persist for 24 hours, including conflicts/transition failures. Identical decoded commands (including expected_revision) replay the original outcome before revision checks. Reusing the ID with different contents fails. A rejected command must use a new ID after correction. State, receipt, expiry and credential rotation commit atomically. Receipts survive process restart.

Rotation refinement: the new display_url appears only on the first acknowledgement. It is deliberately excluded from the persistent receipt to preserve hash-only storage. Replaying rotation returns its committed revision without recovering the secret; generate a new link if the response was lost. Old displays are disconnected and old links are invalid. No controller token is embedded in QR codes.

Clients send `{type:"ping",sent:<monotonic timestamp>}` every five seconds; pong echoes sent and includes server_now_ms. No incoming traffic for 15 seconds disconnects the socket. Client response silence for 15 seconds disables controls and reconnects. Clock estimation uses round-trip midpoint, the lowest-latency sample in the last 15 seconds and a monotonic clock between samples; reconnect/visibility return discard old samples. No operator command is automatically replayed.

Queue overflow or a send exceeding two seconds disconnects a slow peer (1013); full snapshots on reconnect recover state. Mutations enqueue ordered replies/broadcasts without awaiting network I/O. A disconnect can leave a committed command unacknowledged. Display countdown continues from its last known deadline with an offline warning.

Sessions expire seven days after creation or last successful new controller mutation. Heartbeats, state reads and receipt replays do not extend expiry. Authentication and all messages enforce expiry; periodic cleanup removes expired rows/receipts and closes sockets within ten seconds. Each heartbeat also checks expiry. Legacy schema 0 migrates to user_version 1 with an online backup, preserving timer fields, revisions and hashes; legacy rows receive an initial seven-day lifetime.
