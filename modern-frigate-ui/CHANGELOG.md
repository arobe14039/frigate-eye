# Changelog

## 0.1.8

- Fixed dropped WebRTC/MSE negotiation messages by buffering browser messages until the upstream go2rtc socket is open.
- Reworked HLS/MJPEG proxy streaming around an explicitly hijacked response and abortable pipeline, eliminating duplicate Fastify replies and cleaning up immediately when a viewer disconnects.
- Added bounded upstream-header timeouts and idempotent WebSocket shutdown to prevent hanging requests and duplicate close handling.
- Hardened player recovery so each failed attempt can trigger only one retry/fallback transition, cleanup events cannot restart dead transports, and HLS retries are bounded.
- Low/Medium quality now use configured sub-streams when available and safely fall back to the native stream instead of requesting unsupported synthesized ffmpeg streams.

## 0.1.7

- Added a Low / Medium / High stream quality selector to the live viewer (remembered per device), so 4K cameras no longer have to be decoded in full on a phone.
- Low (~360p) and Medium (~720p) prefer a camera's existing go2rtc sub-stream (`<camera>_sub`, `_low`, `_mid`, …) and otherwise ask go2rtc to downscale on the fly; High keeps the native stream.
- The quality tier is applied to every transport (WebRTC, MSE, HLS, MJPEG) and switching it reconnects instantly.



## 0.1.6

- Live view now shows a loading state while a stream connects, instead of a blank/broken video area.
- Streams that die mid-playback are retried on the same transport twice (with the reason shown) before stepping down the fallback ladder, so brief glitches no longer drop you to preview frames.
- Once playing, the viewer badges the active stream type (WebRTC/HLS/MSE/MJPEG) and its quality (e.g. 1080p).
- Stopped the stream proxy from occasionally attempting a second reply after a segment had already started streaming, which logged 500s during normal HLS playback.

## 0.1.5

- Fixed HLS/MJPEG live playback: the proxy sent the upstream body in a format Fastify could not stream, so every playlist and segment request failed with a 500 ("Reply was already sent"). Upstream bodies are now converted to Node streams and never double-sent.
- Live fallback order is now WebRTC → HLS → MSE → MJPEG → preview frames, so remote/Ingress viewers reach a working stream faster.

## 0.1.4

- Settings now generates a paste-ready `go2rtc:` block for every camera missing a live stream, built from your own Frigate camera URLs, with a copy button.

## 0.1.3

- Fixed live video: go2rtc stream names are now resolved from go2rtc's own stream list instead of assumed from the camera name (the cause of the 404s on every WebRTC/MSE/HLS request).
- Added a reliable MJPEG fallback that uses Frigate's built-in camera feed when go2rtc has no stream configured, so live view works out of the box.
- Settings now shows a "Ports & live streaming" panel with required ports (5000, 1984), their live status, the active live path, and which cameras have a go2rtc stream.
- Fixed the Frigate version (served as plain text, not JSON) and detection fps readouts in Settings.

## 0.1.2

- Rebuilt live playback: go2rtc is now discovered explicitly (direct port 1984,
  falling back to Frigate's `/live/*` proxy) and every relay logs its upstream
  URL, open/close codes and errors.
- WebRTC now trickles ICE candidates and reports connection state, which fixes
  streams that silently never started.
- MSE waits for `sourceopen`, negotiates only codecs this browser can decode,
  and trims its buffer to stay light on mobile.
- HLS plays in every browser through hls.js in low-latency mode; go2rtc segment
  requests are proxied correctly instead of returning 503.
- Added an MJPEG fallback between HLS and static preview frames.

## 0.1.1


- Fixed "Test connection" returning *unsupported media type* by accepting POSTs
  without a parseable content-type.
- Camera previews, event thumbnails and timeline frames now fall back to bundled
  demo frames whenever Frigate is unreachable, instead of showing broken images.

## 0.1.0

- First release: mobile-first Frigate frontend served through Home Assistant Ingress.
- Live previews, camera viewer with go2rtc/WebRTC/MSE/HLS fallback, NVR timeline,
  activity feed with filters, per-user preferences stored in `/data`.
