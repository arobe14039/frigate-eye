import { getFrigateConfig } from "./cameras.js";

export type StreamKind = "webrtc" | "mse" | "hls" | "preview";

export interface StreamOption {
  kind: StreamKind;
  /** Path relative to the app root — safe under Ingress, never a Frigate URL. */
  path: string;
  label: string;
}

/**
 * Ordered candidate list for live playback. The frontend walks the list and
 * falls back to the lightweight preview when nothing plays.
 * go2rtc endpoints are proxied by this backend so port 5000/1984 stay internal.
 */
export async function streamOptions(camera: string): Promise<StreamOption[]> {
  let streamName = camera;
  try {
    const cfg = await getFrigateConfig();
    const restream = cfg?.cameras?.[camera]?.live?.stream_name;
    if (typeof restream === "string" && restream) streamName = restream;
  } catch {
    /* fall back to the camera name */
  }

  const q = encodeURIComponent(streamName);
  return [
    { kind: "webrtc", path: `api/live/${q}/webrtc`, label: "WebRTC (lowest latency)" },
    { kind: "mse", path: `api/live/${q}/mse`, label: "MSE" },
    { kind: "hls", path: `api/live/${q}/hls/index.m3u8`, label: "HLS" },
    { kind: "preview", path: `api/cameras/${encodeURIComponent(camera)}/preview`, label: "Preview frames" },
  ];
}
