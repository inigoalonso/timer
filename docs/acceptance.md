# Acceptance record — 3 November 2026

Status: implementation delivered for validation; full production acceptance remains open. The original DOCX specification and ZIP were not supplied in this checkout. No physical-device/browser results are inferred from server tests.

Recorded automated checks on Windows, Python 3.14, Node 25.9:

- Deterministic timer tests cover start/pause/resume/reset, prepared/paused/running ±60 seconds, overtime, exact 5-minute/1-minute/zero/subsecond transitions, duration validation and title data preservation.
- HTTP/WebSocket tests cover malformed/nonobject JSON, read-only permissions, Origin/role mismatch rejection, duplicate receipts, request-ID reuse, revision conflict snapshots, display rotation/hash-only storage, expiry and database write failure without a success response.
- Separate-process checks migrate a legacy database, preserve deadline/revision/hashes, restart, back up and reopen the backup. A command replay after an actual process restart preserves revision and applies an adjustment only once.
- Slow-socket tests exercise bounded queue overflow and the two-second send timeout.
- All 14 automated tests pass; `node --check static/app.js` and Python compilation pass.
- Local capacity script opens 20 sessions with 2 controllers and 5 displays each (140 simultaneous sockets), applies 400 mutations over 20 rounds and checks identical committed deadlines across each group. Recorded delivery median 9.03 ms, maximum 15.17 ms, zero failures. This is a short loopback protocol run, not a sustained WAN/browser or physical-display synchronisation test. Resource usage and real network RTT have not yet been certified.

Browser automation could not initialise: the installed browser tool returned a sandbox metadata error (`missing field sandboxPolicy`) before browser connection. No screenshot/layout, screen-reader, real-browser countdown, QR scan, device clock, sleep or clipboard denial result is claimed. CI configuration includes an image build. Local Docker builds fetched the pinned base image but stalled at dependency installation (including a host-network retry with bounded pip timeouts); they were stopped. Image build/run, non-root persistent-volume operation and fresh-container restore are unverified.

| ID | Evidence now | Release acceptance still required |
|---|---|---|
| A01 | Server creation, role/token checks, rotation | Real phone QR scan and browser pairing |
| A02 | Deterministic transition tests | Browser controls |
| A03 | Server exact-boundary preservation | Browser rounding/threshold screenshots |
| A04 | All-state adjustment tests | Display state after adjustment |
| A05 | Backend validation, client confirmation implemented | Confirm/cancel in browser, overtime replacement |
| A06 | Legacy deadline restart, receipt restart, backup restore | Running/paused/overtime page refresh and fresh container restore |
| A07 | Connection recovery logic implemented | 30-second network loss, no command replay, authoritative recovery |
| A08 | Conflict, duplicate/restart receipt tests | Two actual controller browsers and dropped acknowledgement |
| A09 | Monotonic midpoint clock implementation | Wrong wall clock and device sleep recovery within 1 second |
| A10 | Native/fallback wake controls implemented | Actual conference devices, 60-minute run, lock/app switch/full-screen rejection |
| A11 | Responsive sizing/focus/live region implemented | 320 px, tablet orientations, desktop, 100+ minutes, long titles, keyboard/screen reader |
| A12 | Limits/expiry/origin/slow-socket/restore tests and 140-socket run | Sustained deployment capacity, resources, public HTTPS proxy/reconnect, auth timeout |

Manual test worksheet: for every browser/device record date, device, OS version, browser version, orientation, native Wake Lock availability, fallback result, full-screen result, 60-minute duration, screen-lock/app-switch recovery, maximum observed timer difference, failures and tester. Cover desktop Chrome/Edge/Firefox/Safari as applicable, Android Chrome, iPhone Safari and iPad Safari. Unsupported features must display actionable guidance. Run the documented restore into a fresh deployment and retain results before declaring the release complete.
