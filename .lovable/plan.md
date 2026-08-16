# Historical playback: real recorded video on the scrub timeline

## What's broken today

Confirmed in the code:

- `CameraViewer.tsx` renders a single still image (`recordingFrameUrl(...)`) whenever `live` is false. There is no video element for the past, so scrubbing and tapping an event can only ever show one JPEG frame.
- The play/pause and 0.5x–4x speed buttons are local state only — nothing is wired to a media element.
- The backend has no recorded-video route at all: `routes/live.ts` only proxies go2rtc live (WebRTC/MSE/HLS/MJPEG); `recordings.ts` returns segment metadata for drawing the timeline bar; `exports.ts` triggers a slow full export.

So "historical video" simply doesn't exist yet — it must be added, using Frigate's native recording endpoints rather than go2rtc.

## Approach: use Frigate's native VOD (HLS) endpoints

Frigate already muxes recordings into HLS on demand. These are the right primitives and are far cheaper than exports or transcoding:

```text
/vod/<camera>/start/<unix>/end/<unix>/index.m3u8   time-range playback (scrub)
/vod/<camera>/start/<unix>/master.m3u8             open-ended from a moment
/vod/event/<event_id>/index.m3u8                   exact event clip
/api/events/<id>/clip.mp4                          single-file event clip (fast path)
/api/preview/<camera>/start/<s>/end/<e>/frames     low-res preview frames for scrub
```

Playback stays proxied through our backend so the browser never contacts Frigate directly and everything keeps working behind Ingress.

## Backend work

New `src/routes/playback.ts` (registered next to `registerLive`):

- `GET /api/playback/:camera/vod/*` — proxy Frigate VOD playlists and `.ts`/`.m4s` segments, reusing the existing hardened `pipe()` helper (hijack + `pipeline`, abort on client disconnect, no double replies). Playlists get `no-store`; segments get a long `immutable` cache so seeking backwards is instant.
- `GET /api/playback/:camera/window?start=&end=` — returns the VOD playlist URL plus the clamped range, snapped to the recording segments we already fetch, so we never ask Frigate for a gap.
- `GET /api/playback/event/:id/vod/*` and `GET /api/playback/event/:id/clip.mp4` — event playback; the mp4 path is used when `has_clip` is true because a single progressive file starts fastest for short clips.
- Range-request passthrough (`range` header + 206) for the mp4 path so seeking within a clip doesn't refetch.

`recordings.ts` gains a small helper that reports, for a requested instant, the nearest available recorded moment — used to snap the playhead instead of loading a dead range.

## Frontend work

New `src/features/viewer/RecordedPlayer.tsx` — a sibling to `LivePlayer` with the same status contract (`connecting | playing | failed`) so the existing overlay, badge, and retry UI are reused:

- Loads the VOD playlist with `hls.js` (native HLS on iOS Safari), `lowLatencyMode: false`, and a modest `maxBufferLength` tuned for mobile.
- Real `currentTime`-based seeking: while the playhead stays inside the loaded VOD window, scrubbing seeks the existing media element (no reload). Only crossing the window boundary loads a new playlist.
- `playbackRate` wired to the existing 0.5x/2x/4x buttons; play/pause drives the element.
- Fallback ladder for the past: VOD HLS → event `clip.mp4` (when an event is selected) → `recordingFrame` still image (today's behaviour), so it degrades instead of breaking.

`CameraViewer.tsx`:

- Render `RecordedPlayer` instead of the still image when `live` is false; keep the still as the poster while the playlist loads so scrubbing still feels instant.
- Timeline `onSettle` becomes a seek instead of an image swap; the frame still updates immediately during the drag (cheap `recordingFrame` scrub preview), and the video takes over once the gesture settles.
- Event taps (timeline markers and the "Recent detections" list) open playback at `event.startTime - 4s`, preferring the event VOD/clip route.
- Playhead advances from the video's `currentTime` while playing recorded video, instead of the wall-clock interval.
- Show quality selector for live only (unchanged) and a speed selector for recorded only (unchanged), but disable speeds the transport can't honour.

`ActivityScreen.tsx`: the event detail sheet gets a "Play clip" action that opens the viewer in recorded mode on that event, instead of only showing a snapshot.

## Performance notes

- Segment caching plus in-window seeking means a scrub inside the loaded range costs zero network requests.
- Preview-frame scrub during the drag keeps the UI responsive on 4K cameras; the VOD load is deferred to the settle callback that already exists.
- No ffmpeg transcoding for history — Frigate serves recordings in their stored codec, so the add-on stays light.

## Version

Bump the add-on to **0.2.0** and add a CHANGELOG entry so it can be updated from Home Assistant.
