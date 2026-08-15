import { getFrigateConfig } from "./cameras.js";

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
 * go2rtc endpoints are proxied by this backend so port 5000/1984 stay internal.
 */
export async function streamOptions(camera: string): Promise<StreamOption[]> {
  let streamName = camera;
  try {
    const cfg = await getFrigateConfig();
    const live = cfg?.cameras?.[camera]?.live as { stream_name?: string; streams?: Record<string, string> } | undefined;
    if (typeof live?.stream_name === "string" && live.stream_name) {
      streamName = live.stream_name;
    } else if (live?.streams && typeof live.streams === "object") {
      // Frigate 0.16 replaced `stream_name` with a label → go2rtc name map.
      const first = Object.values(live.streams)[0];
      if (typeof first === "string" && first) streamName = first;
    }
  } catch {
    /* fall back to the camera name */
  }

  const q = encodeURIComponent(streamName);
  return [
    { kind: "webrtc", path: `api/live/${q}/webrtc`, label: "WebRTC (lowest latency)" },
    { kind: "mse", path: `api/live/${q}/mse`, label: "MSE" },
    { kind: "hls", path: `api/live/${q}/hls/index.m3u8`, label: "HLS" },
    { kind: "mjpeg", path: `api/live/${q}/mjpeg`, label: "MJPEG" },
    { kind: "preview", path: `api/cameras/${encodeURIComponent(camera)}/preview`, label: "Preview frames" },
  ];
}
