# Settings: auto-generated go2rtc setup snippet

Right now Settings only tells you that no go2rtc stream matches your cameras. It should hand you the exact YAML to paste into Frigate, built from your real camera stream URLs, so live WebRTC/MSE playback can be enabled in one copy-paste.

## What you'll see

In **Settings → Ports & live streaming**, when one or more cameras have no matching go2rtc stream, a new section appears:

- Heading: "Enable live video in Frigate"
- Short explanation: Frigate only exposes go2rtc streams you declare; these camera URLs come from your own Frigate config.
- A read-only code block with a complete `go2rtc:` block listing every camera that is missing a stream, using each camera's record/main RTSP URL (falling back to its detect/sub URL).
- A **Copy YAML** button, plus a note to paste it as a top-level section in Frigate's config and restart Frigate, then hit **Re-check**.
- Passwords are shown as they exist in your Frigate config so the snippet is paste-ready; a caution line notes the block contains camera credentials.

Cameras that already have a matching stream are excluded. If Frigate exposes no usable input URLs, the section shows a placeholder template with `USER:PASSWORD@CAMERA_IP` instead.

## Technical details

Backend (`modern-frigate-ui/app/backend`):
- `services/frigate/go2rtc.ts`: add `buildGo2rtcSuggestion()` that reads Frigate's `/api/config`, walks `cameras[].ffmpeg.inputs`, picks the input whose `roles` include `record` (else `detect`, else first), and returns `{ camera, url }[]` for cameras whose `resolveStreamName()` reports `matched: false`.
- `routes/api.ts` (`GET /api/diagnostics`): extend the response with `go2rtcSuggestion: { cameras: {camera,url}[]; yaml: string; complete: boolean }`, where `yaml` is the rendered `go2rtc:\n  streams:\n    <Camera>:\n      - <url>` block and `complete` is false when any URL had to be templated.

Frontend (`modern-frigate-ui/app/frontend`):
- `features/settings/SettingsScreen.tsx`: render the new panel from `diagnostics.go2rtcSuggestion` (only when `cameras.length > 0`), with a `navigator.clipboard.writeText` copy button and a toast confirmation.
- `services/api.ts` / types: add the `go2rtcSuggestion` shape to the diagnostics type and to demo-mode data so the preview environment renders a representative snippet.

Release:
- Bump add-on version to **0.1.4** in `modern-frigate-ui/config.yaml` and add a `CHANGELOG.md` entry.
