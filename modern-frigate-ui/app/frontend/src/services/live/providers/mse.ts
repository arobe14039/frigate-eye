import { socketUrl } from "../../api";
import { browserCapabilities, mediaSourceCtor } from "../capabilities";
import { ProviderError, type LiveStreamProvider, type ProviderContext } from "../types";

/**
 * MSE (fragmented MP4 over a WebSocket relay) — the preferred transport.
 *
 * It rides a single WebSocket, which is exactly what Home Assistant Ingress
 * proxies reliably, and it needs no ICE negotiation, so it also works for
 * remote access (Nabu Casa / reverse proxy) where WebRTC often cannot connect.
 * The socket URL is derived from the document base, so it is ingress-relative
 * and automatically `wss://` when Home Assistant is served over HTTPS.
 */
export const MSEStreamProvider: LiveStreamProvider = {
  name: "MSEStreamProvider",
  kind: "mse",
  timeoutMs: 5_000,
  supported: () => {
    const caps = browserCapabilities();
    return caps.webSocket && caps.mediaSource;
  },
  connect: (context: ProviderContext) =>
    new Promise((resolve, reject) => {
      const video = context.video;
      const MS = mediaSourceCtor();
      if (!video || !MS) return reject(new ProviderError("MSE unsupported"));

      const socket = new WebSocket(socketUrl(context.path));
      socket.binaryType = "arraybuffer";
      const mediaSource = new MS();
      const queue: ArrayBuffer[] = [];
      let sourceBuffer: any = null;
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
          socket.close();
        } catch {}
        try {
          if (mediaSource.readyState === "open") mediaSource.endOfStream();
        } catch {}
        queue.length = 0;
        video.removeAttribute("src");
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

      const timer = window.setTimeout(() => fail("Live stream did not start"), context.timeoutMsOverride ?? MSEStreamProvider.timeoutMs);

      const onPlaying = () => {
        if (live || stopped) return;
        live = true;
        window.clearTimeout(timer);
        context.onDimensions(video.videoWidth, video.videoHeight);
        context.log("mse playing");
        resolve({ kind: "mse", stop });
      };
      const onError = () => fail("Playback error");

      const flush = () => {
        if (!sourceBuffer || sourceBuffer.updating || !queue.length) return;
        try {
          const next = queue.shift();
          if (next) sourceBuffer.appendBuffer(next);
        } catch {
          /* a transient append failure recovers on the next segment */
        }
      };
      // Keep the buffer short: a long live view must not grow without bound on a phone.
      const trim = () => {
        if (!sourceBuffer || sourceBuffer.updating) return;
        const buffered = sourceBuffer.buffered;
        if (!buffered.length) return;
        const end = buffered.end(buffered.length - 1);
        if (end - buffered.start(0) > 30) {
          try {
            sourceBuffer.remove(buffered.start(0), end - 15);
          } catch {}
        }
      };

      const request = () => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: "mse", value: browserCapabilities().mseCodecs }));
        }
      };

      video.addEventListener("playing", onPlaying);
      video.addEventListener("error", onError);
      video.disableRemotePlayback = true;
      video.srcObject = null;
      video.src = URL.createObjectURL(mediaSource);
      mediaSource.addEventListener("sourceopen", request, { once: true });

      socket.onopen = () => {
        if (mediaSource.readyState === "open") request();
      };
      socket.onerror = () => fail("Live relay unreachable");
      socket.onclose = () => fail("Live relay closed");
      socket.onmessage = (message) => {
        if (stopped) return;
        if (typeof message.data === "string") {
          try {
            const payload = JSON.parse(message.data);
            if (payload.type === "mse" && mediaSource.readyState === "open") {
              sourceBuffer = mediaSource.addSourceBuffer(`video/mp4; codecs="${payload.value}"`);
              sourceBuffer.mode = "segments";
              sourceBuffer.addEventListener("updateend", () => {
                flush();
                trim();
              });
              void video.play().catch(() => undefined);
            } else if (payload.type === "error") {
              fail("Stream not available");
            }
          } catch {
            /* ignore non-JSON control frames */
          }
          return;
        }
        queue.push(message.data as ArrayBuffer);
        flush();
      };

      context.signal.addEventListener("abort", stop, { once: true });
    }),
};
