# Operator guide

1. Open the conference timer URL and select Create a timer. Bookmark the private controller link. Anyone with that link can control the session; share only the display link/QR with presenters.
2. Choose preset minutes or enter 1�180 whole minutes. Set a presentation title if useful. Start begins the countdown; Pause freezes it; Resume continues it. �1 minute adjusts current time without changing reset duration. Reset returns to the selected duration. Replacing a running timer, including overtime, requires confirmation.
3. Open the display link on the presenter device or scan its QR. Check the connected-display count. On a different controller browser, use Generate new display link if the old link is unavailable. This invalidates old display links; connected presenters must reopen the new one.
4. On each presenter device, tap Activate display. Read the wake-prevention and full-screen results separately. If wake prevention is unavailable/released, disable automatic screen lock in device settings or tap Activate again. App switching/manual locking can release wake prevention. Test the actual devices for 60 minutes before the event.
5. Green means more than five minutes; yellow means five minutes or less; red means one minute or less. TIME UP and +time show overtime. The running/paused status remains visible. There is no sound or flashing.
6. Wait for Saved before assuming a command succeeded. During connection loss, controls disable and the display continues from its last known deadline. After reconnecting, review the authoritative timer. An unknown command outcome is not automatically retried. If a link is invalid/expired/replaced, obtain a current link or create a new session.
7. Sessions expire seven days after the last successful controller change; the controller shows expiry. Display viewing does not extend it. Never clear or publish controller URLs during the event. Keep an operator device powered and test network coverage in the room.

## Presentation playlists

In the controller's **Playlist** section, select **Add presentation** for each speaker. Enter a title (1-120 characters), talk minutes (1-180) and Q&A minutes (0-180). Use 0 to skip Q&A. Arrow buttons reorder the list; the remove button deletes an entry. Lists can contain up to 100 presentations.

Select **Save playlist** to persist your edits and share them with other controllers. **Discard edits** restores the saved list. Saving does not interrupt the current countdown, but clears the playlist selection; load a presentation again to resume playlist navigation. Saved lists and the active phase survive reloads, reconnects and server restarts, subject to the session's normal expiry. Unsaved drafts are local to the current page and are lost on reload.

Select **Load first presentation**, or **Load talk** / **Load Q&A** beside any entry, to prepare that countdown. **Next: Q&A** prepares the current speaker's questions; **Next presentation** prepares the following talk. A zero-minute Q&A is skipped, and the final entry shows **Playlist complete**. Transitions do not start the timer automatically: select **Start** when ready. Replacing a running countdown requires confirmation. Presenter displays show the presentation title, position and talk/Q&A phase. Editing the standalone timer title or setting a standalone duration clears the playlist selection; pause, adjustments and reset keep it.

**Download** exports the current valid list, including unsaved edits, as `stage-time-playlist.json`. No session links or credentials are included. **Upload** validates a JSON file and replaces the local draft after confirmation; select **Save playlist** to apply it. Uploading does not change the countdown. Invalid files leave the list untouched. Files must be at most 128 KiB and use this versioned format (durations are seconds in whole-minute increments):

```json
{
	"version": 1,
	"presentations": [
		{"title": "Opening keynote", "duration_seconds": 1200, "qa_duration_seconds": 300},
		{"title": "Closing remarks", "duration_seconds": 600, "qa_duration_seconds": 0}
	]
}
```

Playlist navigation is disabled while edits are unsaved. If another controller changes the saved list while you are editing, your draft is preserved and saving is blocked. Download your edits before discarding them to load the latest saved list. Draft editing and downloading remain available during a connection loss, but saving and timer transitions require a synchronized connection.
