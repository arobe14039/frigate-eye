# Changelog

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
