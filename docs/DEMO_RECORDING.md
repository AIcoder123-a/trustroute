# Recording the demo

A checklist that produces a file you can upload without editing it in a hurry. The script itself is in
`DEMO_SCRIPT.md`; this is the production procedure around it.

---

## 1. Prepare the machine

| Step | Why |
| --- | --- |
| `npm run build && npm start` | production build: no dev overlay, no "compiling" toast, realistic timing |
| Open `http://localhost:3100` in a fresh browser window | a clean profile has no extensions covering the page, no autofill dropdowns |
| Set the window to 1440×900, zoom 100%, hide the bookmarks bar | matches the screenshots and the layout the UI was tuned for |
| Close every other tab; quit chat and mail apps | a notification banner in frame is a reshoot |
| Turn off the OS "do not disturb" | same reason |
| Check `CLOCKED_MODE` and record it | a take must not switch between live and simulated halfway |
| Never open `.env.local`, a terminal with the key, or DevTools | the video is public; a key in a frame is a leak, not a mistake to note later |

If the deployed URL is used instead of localhost, do the same checks there — plus one screen that proves
the URL in the address bar is the deployed one.

## 2. Choose the mode

```bash
npm run accept:live        # server-side: status, shape, verdict, source
```

- **All three answered** → record in live mode. Say "live" once, in scene 1.
- **Refused (`403 cf-mitigated: challenge`)** → record in mock mode, keep the banner visible, and optionally
  add the alternate scene from `DEMO_SCRIPT.md`. Do not claim the detections are live, and do not present
  the browser harness as evidence that the demo is live.

## 3. Record

Observing the rules of thumb matters more than the tool:

- **1920×1080, 30 fps, H.264**, or 1440×900 scaled to 1080p. Text must stay readable at 720p playback.
- Record the **whole** take, including the two-second pauses after each click; cut in the edit, not by
  racing the mouse.
- Mouse movements: one straight move to the target, then stop. No circling, no highlighting with the
  cursor.
- Do not scroll fast enough that a judge cannot read the decision panel.

OBS Studio (free, all platforms): *Display Capture* → 1920×1080 canvas, 30 fps, CQP 20, MKV then remux to
MP4. macOS QuickTime and Windows Game Bar both work if OBS is unavailable.

## 4. Voice-over

- Record narration separately and lay it over the capture. Reading while clicking produces dead air and
  "um".
- ~150 words per minute. The script's narration is ~260 words, so a 100-second take has room for pauses.
- Normalise to about −16 LUFS; keep the music out. A quiet room recording beats a music bed.

## 5. Edit checklist

- [ ] Length between 90 and 120 seconds
- [ ] The mode banner is visible in every frame where a number appears
- [ ] No key, token, terminal history, email address or real personal data in any frame
- [ ] Every spoken claim is on screen at the moment it is spoken
- [ ] No frame shows a simulated number described as a Clocked result
- [ ] The failure state (if shown) is held long enough to read
- [ ] End card names the project and the three endpoints

## 6. Export and check

```bash
# remux and compress a first pass
ffmpeg -i take.mkv -c:v libx264 -crf 21 -preset slow -pix_fmt yuv420p -c:a aac -b:a 128k trustroute-demo.mp4

# confirm the duration before uploading
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 trustroute-demo.mp4
```

Watch the exported file once, end to end, at 720p — that is how a judge will first see it. If a number is
unreadable at that size, re-record that scene rather than zooming in post.

## 7. Publish

- Upload to YouTube (unlisted is acceptable; public is better for a judge who wants captions), Vimeo, or
  the challenge's own upload field if it has one.
- Title: `TrustRoute — AI Agent Security Gateway (Clocked Build Challenge 2026)`.
- Description: one paragraph, the demo URL, the repository URL, and which endpoints are used.
- Turn on captions or attach an `.srt`; a judge may watch muted.
- Put the link in the entry form **and** in `README.md`, and check it in a private window: a link that only
  works for the owner is a missing demo.

## 8. Keep the evidence

Store the take, the final MP4, the `.srt`, and the exact build that was recorded (commit id) together in a
folder outside the repository. If a judge asks how a scene was produced, the answer should be a commit id
and a timestamp, not a memory.
