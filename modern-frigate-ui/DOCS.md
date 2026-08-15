# Modern Frigate UI — Documentation

## How it works

The add-on serves a React app and a small Fastify API on internal port `8099`.
Home Assistant Ingress puts the app behind its own authentication, so the add-on
never asks for a login and stores no credentials.

The backend is the only component that talks to Frigate (`:5000`) and to Home
Assistant (`http://supervisor/core/api` using the runtime `SUPERVISOR_TOKEN`).
Neither address nor token is ever sent to the browser.

## Configuration

| Option                    | Default | Description                                                                                          |
| ------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `frigate_url`             | empty   | Optional override, e.g. `http://ccab4aaf-frigate:5000`. Leave empty to auto-discover on the network. |
| `log_level`               | `info`  | Add-on log verbosity.                                                                                |
| `preview_refresh_seconds` | `6`     | Default refresh interval for lightweight camera previews.                                            |

### Frigate discovery

On start (and whenever you press **Test connection** in Settings) the backend
probes `GET /api/version` on the configured URL first, then on common internal
Frigate add-on hostnames. The first host that answers is used. Nothing is assumed
without a successful probe, and the resolved hostname stays server-side.

If discovery fails, set `frigate_url` explicitly to the Frigate add-on hostname
shown in the Frigate add-on log or in its Docker container name.

## Live video

The viewer tries, in order:

1. **WebRTC** through go2rtc (lowest latency), relayed by the backend websocket.
2. **MSE** (fragmented MP4 over the same relay).
3. **HLS** where the platform plays it natively (iOS/Safari).
4. **Preview frames** — a refreshing downscaled JPEG.

If nothing plays, the viewer stays usable and shows
"Live stream unavailable — showing latest preview". No video is transcoded by
this add-on.

## Data storage

Per-user preferences are stored in `/data/preferences.json`, which Home Assistant
preserves across add-on updates. Identity comes only from Ingress-supplied
Supervisor headers; browser-provided identity headers are ignored, and without
Supervisor a single shared local profile is used.

Frigate's own configuration is never modified.

## Endpoints (this add-on's API)

```
GET  /health
GET  /api/status              POST /api/status/test
GET  /api/session             PUT  /api/preferences
GET  /api/cameras             GET  /api/cameras/:camera
GET  /api/cameras/:camera/preview
GET  /api/labels
GET  /api/events              GET  /api/events/:id
GET  /api/events/:id/thumbnail
GET  /api/events/:id/snapshot
GET  /api/timeline/:camera    GET  /api/recordings/:camera
GET  /api/recordings/:camera/frame/:ts
POST /api/exports
GET  /api/stream/events       (SSE)
WS   /api/live/:stream/webrtc, /api/live/:stream/mse
GET  /api/live/:stream/hls/*
```

## Troubleshooting

**"Frigate is temporarily unavailable"** — the backend cannot reach Frigate. Check
that the Frigate add-on is running and set `frigate_url` if the hostname differs.

**Blank panel** — reload the panel; if it persists, check the add-on log. The
frontend is built with a relative base, so it works under any Ingress path.

**Previews not refreshing** — previews pause when the tab is hidden or the card is
off-screen. Change the refresh behaviour in Settings → Interface.
