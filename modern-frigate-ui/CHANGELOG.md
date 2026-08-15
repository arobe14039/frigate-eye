# Changelog

## 0.1.1

- Fixed "Test connection" returning *unsupported media type* by accepting POSTs
  without a parseable content-type.
- Camera previews, event thumbnails and timeline frames now fall back to bundled
  demo frames whenever Frigate is unreachable, instead of showing broken images.

## 0.1.0

- First release: mobile-first Frigate frontend served through Home Assistant Ingress.
- Live previews, camera viewer with go2rtc/WebRTC/MSE/HLS fallback, NVR timeline,
  activity feed with filters, per-user preferences stored in `/data`.
