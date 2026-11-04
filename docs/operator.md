# Operator guide

1. Open the timer URL and select **Create a timer**. The controller has **Run**, **Playlist** and **Connect** tabs. The countdown and live controls remain available above every tab. Tabs support Left/Right arrows and Home/End. Bookmark the private controller link; share only the display link with presenters.
2. In **Run**, expand **Edit timer** to set a title and preset/custom duration (1-180 whole minutes), or load a saved playlist entry. The main button changes between **Start**, **Pause** and **Resume**. Minus/plus adjust one minute without changing reset duration. The reset icon returns to the selected duration. Replacing a running countdown requires confirmation. Mobile live controls stay at the top while scrolling.
3. In **Connect**, open or copy the display link, or scan the QR on the presenter device. Check the connected-display count. The private controller link is collapsed by default. **Advanced** contains session expiry and **Replace display link**, which invalidates previous display links and disconnects existing displays after confirmation.
4. On the presenter device, select **Enter full screen** to request full screen and wake prevention. The display has no app header or controller controls. Setup controls hide after four seconds only when full screen and wake prevention are active; pointer movement, tapping or keyboard focus reveals them. Permission failures and released wake locks keep the controls visible. If wake prevention fails, disable automatic screen lock in device settings. Test actual devices for 60 minutes before the event.
5. Green means more than five minutes; yellow means five minutes or less; red means one minute or less. **Time up** and +time show overtime; **Paused** appears when paused. Normal running status is omitted. Healthy connection information is hidden on displays, but disconnection/synchronization warnings remain visible. There is no sound or flashing.
6. Wait for Saved before assuming a command succeeded. During connection loss, controls disable and the display continues from its last known deadline. After reconnecting, review the authoritative timer. An unknown command outcome is not automatically retried. If a link is invalid/expired/replaced, obtain a current link or create a new session.
7. Sessions expire seven days after the last successful controller change; the controller shows expiry. Display viewing does not extend it. Never clear or publish controller URLs during the event. Keep an operator device powered and test network coverage in the room.

## Installable display app

Open `/display/` on the deployed HTTPS website. On iPhone/iPad, use Safari's **Share > Add to Home Screen**, keep **Open as Web App** enabled if offered, then tap **Add**. Launch **Stage time Display** using its Home Screen icon. Other supported browsers offer an install action in the browser menu or through **Install display app**. Installation is optional; existing display links still work in a browser.

Inside the installed app, select **Scan QR**, grant camera permission, and scan the controller's presenter-display QR. Or paste the complete display link, including the `#` fragment, and select **Join display**. Only display links for the same website are accepted; controller links and external websites are rejected. Camera frames remain on the device. Cancel scanning, switch away, or join a timer to stop camera capture. If camera access is blocked or unavailable, paste the link instead. Installation and scanning need HTTPS (localhost is permitted for development, but a phone accessing a computer's plain-HTTP LAN address is not).

The app remembers its last display link only after successful authentication and resumes it on launch. **Change session** opens the join screen without deleting the saved session; **Resume last display** returns to it. **Forget session** removes the saved link and returns to joining. Expired or replaced links are forgotten automatically and show a request for a current link. Saved links are read-only credentials: anyone using that device can reopen the display, so forget the session on shared devices. Safari and Home Screen apps may have separate storage; join from inside the installed app after installation.

Apple's Camera QR scanner may open links in Safari/default browser rather than an installed web app. A website cannot reliably force those links into its Home Screen app. Open the installed app and scan there for a dependable installed-app workflow; automatic external link handling would require a separately distributed native iOS app with Universal Links.

In standalone mode the browser chrome is already absent, so the activation button becomes **Keep screen awake**, not a full-screen request. Wake permissions, device settings, app switching and system restrictions still apply. The service worker does not keep a WebSocket or timer running while iOS suspends the app. Returning to the foreground re-synchronizes with the server.

After the first successful online load, the display's public app shell is cached for offline launch. No timer snapshots, API responses, controller pages or session credentials are put in that cache. An already-loaded countdown can continue from its last known deadline with a warning while disconnected. A cold offline launch has no timer snapshot and waits for the server; it does not invent a current countdown. Saved display credentials remain separately in local device storage until forgotten or invalidated. Browser storage eviction may require an online launch and rejoining.

Updates wait until all display app windows/tabs using the previous version close; they do not force a reload during a talk. If the join screen reports an update, close all display windows and reopen after the presentation. Keep the display app open and awake during use. Real iPhone/iPad installation, camera access, safe-area layout and wake behavior must be checked on the actual devices before an event.

## Browser notifications

On the private controller page, open the settings icon in the header, select **Browser notifications** and allow notifications when prompted. This enables browser notifications for five minutes left, one minute left, and time up, including the presentation title and Q&A phase when applicable. Presenter/display pages never request notification permission or send notifications. This setting applies to the current controller tab and must be enabled again after reload.

Notifications require HTTPS (or localhost), a supporting browser and permission in browser site settings. If permission is blocked, change it in the browser settings. Some mobile browsers do not support desktop-style notifications; unavailable notifications do not affect the timer.

Alerts occur only while the countdown is running and the controller is connected and synchronized. Each milestone fires at most once until a reset or new countdown is prepared; pause/resume and time adjustments do not repeat alerts already sent. Enabling notifications or reconnecting after a milestone does not replay missed alerts. If a delayed browser tick crosses several milestones, only the most recent milestone is notified. Keep the controller tab open: background throttling, device sleep, browser restrictions and operating-system notification settings can delay or suppress notifications. These are supplementary cues, not guaranteed alarms.

## Presentation playlists

In the controller's **Playlist** tab, select **Add presentation** for each speaker. Select an existing row to expand its editor. Enter a title (1-120 characters), talk minutes (1-180) and Q&A minutes (0-180). Use 0 to skip Q&A. Arrow buttons reorder entries; the trash icon removes an entry. Desktop users can also drag a row to reorder it. Lists can contain up to 100 presentations.

**Save changes** and **Discard** appear only when there are unsaved edits. Saving persists the list and shares it with other controllers. Discard restores the saved list. Saving does not interrupt the current countdown, but clears the playlist selection; load a presentation again to resume navigation. The Playlist tab marks unsaved edits, and the browser warns before leaving with a dirty draft. Saved lists and the active phase survive reloads, reconnects and server restarts, subject to normal expiry. Unsaved drafts remain local to the current page.

In **Run**, select **Load first presentation**, or **Load talk** / **Load Q&A** beside a saved entry. The active row is highlighted; **Up next** names the next phase and its duration. **Load Q&A** prepares the current speaker's questions; **Load next talk** prepares the following talk. Zero-minute Q&A is skipped, and the final phase shows **Playlist complete**. Loading does not start the timer: select **Start** when ready. Presenter displays show the title, position and talk/Q&A phase. Editing the standalone title or setting a standalone duration clears playlist selection; pause, adjustments and reset keep it.

The **Download playlist** icon exports the current valid list, including unsaved edits, as `stage-time-playlist.json`. No credentials are included. The **Upload playlist** icon validates a JSON file and replaces the local draft after confirmation; select **Save changes** to apply it. Uploading does not change the countdown. Invalid files leave the list untouched. Each entry can include an optional `speaker` string (up to 120 characters, empty allowed). Speaker names are editable in Playlist, shown in playlist and Run summaries, and preserved on save and download. Existing files without `speaker` remain valid. Files must be at most 128 KiB and use this versioned format (durations are seconds in whole-minute increments):

```json
{
	"version": 1,
	"presentations": [
		{"title": "Opening keynote", "speaker": "Ada Lovelace", "duration_seconds": 1200, "qa_duration_seconds": 300},
		{"title": "Closing remarks", "duration_seconds": 600, "qa_duration_seconds": 0}
	]
}
```

Playlist navigation is disabled while edits are unsaved. If another controller changes the saved list while you are editing, your draft is preserved and saving is blocked. Download your edits before discarding them to load the latest saved list. Draft editing and downloading remain available during a connection loss, but saving and timer transitions require a synchronized connection.
