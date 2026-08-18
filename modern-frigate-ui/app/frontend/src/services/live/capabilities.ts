import Hls from "hls.js";

/**
 * Browser capability probe.
 *
 * Detection is done once per page session and cached: opening the same camera
 * repeatedly must not re-run codec checks, and a camera should never be probed
 * with a transport this browser cannot decode at all.
 */
export interface BrowserCapabilities {
  webSocket: boolean;
  mediaSource: boolean;
  /** Codec list advertised to go2rtc for MSE — only what this browser decodes. */
  mseCodecs: string;
  webrtc: boolean;
  hlsJs: boolean;
  nativeHls: boolean;
}

const CODEC_CANDIDATES: Array<[string, string]> = [
  ["avc1.640029", 'video/mp4; codecs="avc1.640029"'],
  ["hvc1.1.6.L153.B0", 'video/mp4; codecs="hvc1.1.6.L153.B0"'],
  ["mp4a.40.2", 'audio/mp4; codecs="mp4a.40.2"'],
  ["opus", 'audio/mp4; codecs="opus"'],
];

/** iOS Safari only exposes ManagedMediaSource; both are acceptable for MSE. */
export const mediaSourceCtor = (): any =>
  (globalThis as any).ManagedMediaSource ?? (globalThis as any).MediaSource ?? null;

let cached: BrowserCapabilities | null = null;

export function browserCapabilities(): BrowserCapabilities {
  if (cached) return cached;
  const MS = mediaSourceCtor();
  const codecs = MS?.isTypeSupported
    ? CODEC_CANDIDATES.filter(([, mime]) => MS.isTypeSupported(mime)).map(([codec]) => codec)
    : [];
  let nativeHls = false;
  try {
    nativeHls = Boolean(
      document.createElement("video").canPlayType("application/vnd.apple.mpegurl"),
    );
  } catch {
    nativeHls = false;
  }
  cached = {
    webSocket: typeof WebSocket !== "undefined",
    mediaSource: Boolean(MS),
    mseCodecs: (codecs.length ? codecs : ["avc1.640029", "mp4a.40.2"]).join(","),
    webrtc: typeof RTCPeerConnection !== "undefined",
    hlsJs: (() => {
      try {
        return Hls.isSupported();
      } catch {
        return false;
      }
    })(),
    nativeHls,
  };
  return cached;
}

/** Test seam / used after a meaningful configuration change. */
export const resetCapabilities = () => {
  cached = null;
};
