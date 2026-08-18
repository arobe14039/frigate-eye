import Hls from "hls.js";
import { apiUrl } from "../../api";
import { browserCapabilities } from "../capabilities";
import { ProviderError, type LiveStreamProvider, type ProviderContext } from "../types";

/**
 * HLS compatibility fallback (Frigate/go2rtc `stream.m3u8`, proxied by us).
 *
 * Playlist and segment URLs are always resolved against the app base, so every
 * request stays on our own `api/live/...` routes and no internal Frigate or
 * go2rtc address ever reaches the browser. Buffers are deliberately tiny: this
 * is live video on a phone, not a download.
 */
export const HLSStreamProvider: LiveStreamProvider = {
  name: "HLSStreamProvider",
  kind: "hls",
  timeoutMs: 9_000,
  supported: () => {
    const caps = browserCapabilities();
    return caps.hlsJs || caps.nativeHls;
  },
  connect: (context: ProviderContext) =>
    new Promise((resolve, reject) => {
      const video = context.video;
      if (!video) return reject(new ProviderError("HLS unsupported"));
      const caps = browserCapabilities();
      let hls: Hls | null = null;
      let stopped = false;
      let live = false;

      const stop = () => {
        if (stopped) return;
        stopped = true;
        window.clearTimeout(timer);
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("error", onError);
        context.signal.removeEventListener("abort", stop);
        try {
          hls?.destroy();
        } catch {}
        hls = null;
        video.removeAttribute("src");
        video.srcObject = null;
        try {
          video.load();
        } catch {}
      };

      const fail = (reason: string) => {
        if (stopped) return;
        if (live) {
          context.onDrop(reason);
          return;
        }
        stop();
        reject(new ProviderError(reason));
      };

      const timer = window.setTimeout(() => fail("HLS did not start"), HLSStreamProvider.timeoutMs);
      const onPlaying = () => {
        if (live || stopped) return;
        live = true;
        window.clearTimeout(timer);
        context.onDimensions(video.videoWidth, video.videoHeight);
        context.log("hls playing");
        resolve({ kind: "hls", stop });
      };
      const onError = () => fail("Playback error");
      video.addEventListener("playing", onPlaying);
      video.addEventListener("error", onError);

      const src = apiUrl(context.path);
      if (caps.hlsJs) {
        hls = new Hls({
          lowLatencyMode: true,
          backBufferLength: 10,
          maxBufferLength: 6,
          maxMaxBufferLength: 12,
          liveSyncDurationCount: 2,
          manifestLoadingMaxRetry: 1,
          levelLoadingMaxRetry: 1,
          fragLoadingMaxRetry: 2,
          manifestLoadingRetryDelay: 500,
          levelLoadingRetryDelay: 500,
          fragLoadingRetryDelay: 500,
        } as any);
        hls.on(Hls.Events.ERROR, (_event: unknown, data: any) => {
          if (data?.fatal) fail("HLS stream error");
        });
        hls.loadSource(src);
        hls.attachMedia(video);
        void video.play().catch(() => undefined);
      } else if (caps.nativeHls) {
        video.srcObject = null;
        video.src = src;
        void video.play().catch(() => undefined);
      } else {
        fail("HLS unsupported");
        return;
      }

      context.signal.addEventListener("abort", stop, { once: true });
    }),
};
