export type StreamKind = "webrtc" | "mse" | "hls" | "mjpeg" | "preview";

export interface StreamOption {
  kind: StreamKind;
  /** Path relative to the app root — safe under Ingress, never a Frigate URL. */
  path: string;
  label: string;
}

/**
 * Ordered candidate list for live playback. The frontend walks the list and
 * falls back to the lightweight preview when nothing plays.
 *
 * Paths carry the Frigate camera name; the backend maps it onto the matching
 * go2rtc stream at request time so playback keeps working when the two names
 * differ (or when go2rtc has no stream for the camera at all).
 */
export async function streamOptions(camera: string): Promise<StreamOption[]> {
  const q = encodeURIComponent(camera);
  return [
    { kind: "webrtc", path: `api/live/${q}/webrtc`, label: "WebRTC (lowest latency)" },
    { kind: "hls", path: `api/live/${q}/hls/index.m3u8`, label: "HLS" },
    { kind: "mse", path: `api/live/${q}/mse`, label: "MSE" },
    { kind: "mjpeg", path: `api/live/${q}/mjpeg`, label: "MJPEG" },
    { kind: "preview", path: `api/cameras/${q}/preview`, label: "Preview frames" },
  ];

}
