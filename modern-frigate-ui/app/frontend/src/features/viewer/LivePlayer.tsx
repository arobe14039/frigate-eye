import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import { usePageVisible } from "../../hooks/useAppState";
import { apiUrl, cameraPreviewUrl, socketUrl } from "../../services/api";
import { demoImageFor } from "../../services/demoData";
import type { StreamOption, StreamQuality } from "../../types";

/** Append the requested quality tier; the backend maps it onto a go2rtc src. */
const withQuality = (path: string, quality: StreamQuality) =>
  !path || quality === "high" ? path : `${path}${path.includes("?") ? "&" : "?"}q=${quality}`;

export type LiveStatus = {
  kind: StreamOption["kind"];
  phase: "connecting" | "playing" | "failed";
  message?: string;
  width?: number;
  height?: number;
};

const log = (...args: unknown[]) => console.info("[live]", ...args);

/** Codecs advertised to go2rtc — only what this browser can actually decode. */
function supportedMseCodecs(): string {
  const candidates: Array<[string, string]> = [
    ["avc1.640029", 'video/mp4; codecs="avc1.640029"'],
    ["hvc1.1.6.L153.B0", 'video/mp4; codecs="hvc1.1.6.L153.B0"'],
    ["mp4a.40.2", 'audio/mp4; codecs="mp4a.40.2"'],
    ["opus", 'audio/mp4; codecs="opus"'],
  ];
  const MS: any =
    (window as any).ManagedMediaSource ?? (window as any).MediaSource ?? null;
  if (!MS?.isTypeSupported) return "avc1.640029,mp4a.40.2";
  return candidates
    .filter(([, mime]) => MS.isTypeSupported(mime))
    .map(([codec]) => codec)
    .join(",");
}

/**
 * Streaming adapter with progressive fallback:
 *   WebRTC (go2rtc) → MSE → HLS (hls.js) → MJPEG → refreshing preview frames.
 * Every URL is derived from the current app location, so it works unchanged
 * behind Home Assistant Ingress over both HTTP and HTTPS.
 */
export function LivePlayer({
  cameraId,
  streams,
  quality,
  muted,
  onStatus,
}: {
  cameraId: string;
  streams: StreamOption[];
  quality: StreamQuality;
  muted: boolean;
  onStatus?: (status: LiveStatus) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<LiveStatus>({ kind: "preview", phase: "connecting" });
  const [retry, setRetry] = useState(0);
  const visible = usePageVisible();
  const [bust, setBust] = useState(() => Date.now());
  const [previewFailed, setPreviewFailed] = useState(false);

  const candidates = streams.length
    ? streams
    : ([{ kind: "preview", path: "", label: "Preview frames" }] as StreamOption[]);
  const current = candidates[Math.min(attempt, candidates.length - 1)];
  const currentPath = withQuality(current?.path ?? "", quality);

  // Restart the ladder when the camera changes.
  useEffect(() => {
    setAttempt(0);
    setRetry(0);
    setPreviewFailed(false);
  }, [cameraId, quality]);

  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  const fallback = (message: string) =>
    setAttempt((previous) => {
      const next = Math.min(previous + 1, candidates.length - 1);
      if (next !== previous) log(`${candidates[previous]?.kind} failed: ${message} → ${candidates[next]?.kind}`);
      setRetry(0);
      const nextCandidate = candidates[next];
      setStatus({
        kind: nextCandidate?.kind ?? "preview",
        phase: next === previous && next === candidates.length - 1 ? "failed" : "connecting",
        message,
      });
      return next;
    });

  /**
   * A live stream that dies mid-playback usually recovers on a clean reconnect,
   * so retry the same transport twice before stepping down the ladder.
   */
  const recover = (message: string) => {
    if (retry >= 1) {
      fallback(message);
      return;
    }
    log(`${current?.kind} failed: ${message} → retry ${retry + 1}`);
    setStatus((previous) => ({ ...previous, phase: "connecting", message }));
    setRetry((value) => value + 1);
  };

  const markPlaying = (kind: StreamOption["kind"]) => {
    const video = videoRef.current;
    setRetry(0);
    setStatus({
      kind,
      phase: "playing",
      width: video?.videoWidth || undefined,
      height: video?.videoHeight || undefined,
    });
  };

  // ---- WebRTC (go2rtc signalling over our websocket relay) ----
  useEffect(() => {
    if (current?.kind !== "webrtc" || !visible) return;
    const video = videoRef.current;
    if (!video || typeof RTCPeerConnection === "undefined") {
      fallback("WebRTC unsupported");
      return;
    }

    let closed = false;
    let failed = false;
    const fail = (message: string) => {
      if (closed || failed) return;
      failed = true;
      recover(message);
    };
    const peer = new RTCPeerConnection({
      iceServers: [],
      // Host candidates only: go2rtc lives on the same LAN as Home Assistant.
      bundlePolicy: "max-bundle",
    });
    const socket = new WebSocket(socketUrl(currentPath));
    const timeout = window.setTimeout(() => fail("WebRTC timed out"), 6_000);

    const cleanup = () => {
      closed = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {}
      try {
        peer.close();
      } catch {}
    };

    peer.addTransceiver("video", { direction: "recvonly" });
    peer.addTransceiver("audio", { direction: "recvonly" });
    peer.ontrack = (event) => {
      if (closed) return;
      video.srcObject = event.streams[0] ?? null;
      void video.play().catch(() => undefined);
    };
    peer.oniceconnectionstatechange = () => {
      if (peer.iceConnectionState === "connected" || peer.iceConnectionState === "completed") {
        clearTimeout(timeout);
        log("webrtc connected");
        markPlaying("webrtc");
      }
      if (peer.iceConnectionState === "failed") fail("WebRTC ICE failed");
      if (peer.iceConnectionState === "disconnected" && status.phase === "playing") {
        fail("WebRTC connection dropped");
      }
    };
    // Trickle ICE — go2rtc accepts candidates as they are discovered.
    peer.onicecandidate = (event) => {
      if (socket.readyState === 1) {
        socket.send(
          JSON.stringify({ type: "webrtc/candidate", value: event.candidate?.candidate ?? "" }),
        );
      }
    };

    socket.onopen = async () => {
      try {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        socket.send(JSON.stringify({ type: "webrtc/offer", value: peer.localDescription?.sdp }));
      } catch (error) {
        console.warn("[live] webrtc offer failed", error);
        fail("WebRTC negotiation failed");
      }
    };
    socket.onerror = () => fail("WebRTC relay unreachable");
    socket.onclose = (event) => {
      if (!closed && peer.iceConnectionState !== "connected") {
        fail(`WebRTC relay closed (${event.code})`);
      }
    };
    socket.onmessage = async (message) => {
      try {
        const payload = JSON.parse(message.data);
        if (payload.type === "webrtc/answer") {
          await peer.setRemoteDescription({ type: "answer", sdp: payload.value });
        } else if (payload.type === "webrtc/candidate" && payload.value) {
          await peer.addIceCandidate({ candidate: payload.value, sdpMid: "0" }).catch(() => undefined);
        } else if (payload.type === "error") {
          console.warn("[live] go2rtc error", payload.value);
          fail(String(payload.value ?? "go2rtc error"));
        }
      } catch {
        /* non-JSON frames are ignored during signalling */
      }
    };

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.kind, currentPath, visible, retry]);

  // ---- MSE (fragmented MP4 over the relay) ----
  useEffect(() => {
    if (current?.kind !== "mse" || !visible) return;
    const video = videoRef.current;
    const MS: any = (window as any).ManagedMediaSource ?? (window as any).MediaSource;
    if (!video || !MS) {
      fallback("MSE unsupported");
      return;
    }

    const socket = new WebSocket(socketUrl(currentPath));
    socket.binaryType = "arraybuffer";
    const mediaSource = new MS();
    let sourceBuffer: any = null;
    const queue: ArrayBuffer[] = [];
    let closed = false;
    let failed = false;
    const fail = (message: string) => {
      if (closed || failed) return;
      failed = true;
      recover(message);
    };
    const timeout = window.setTimeout(() => fail("MSE timed out"), 6_000);
    video.disableRemotePlayback = true;
    video.src = URL.createObjectURL(mediaSource);

    const flush = () => {
      if (!sourceBuffer || sourceBuffer.updating || !queue.length) return;
      try {
        const next = queue.shift();
        if (next) sourceBuffer.appendBuffer(next);
      } catch (error) {
        console.warn("[live] mse append failed", error);
      }
    };
    // Trim the buffer so a long-running live view never grows unbounded.
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

    const requestStream = () => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ type: "mse", value: supportedMseCodecs() }));
      }
    };
    mediaSource.addEventListener("sourceopen", requestStream, { once: true });
    socket.onopen = () => {
      if (mediaSource.readyState === "open") requestStream();
    };
    socket.onerror = () => fail("MSE relay unreachable");
    socket.onclose = (event) => {
      fail(`MSE relay closed (${event.code})`);
    };
    socket.onmessage = (message) => {
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
            clearTimeout(timeout);
            log("mse playing", payload.value);
            markPlaying("mse");
            void video.play().catch(() => undefined);
          } else if (payload.type === "error") {
            fail(String(payload.value ?? "go2rtc error"));
          }
        } catch {
          /* ignore */
        }
        return;
      }
      queue.push(message.data as ArrayBuffer);
      flush();
    };

    return () => {
      closed = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {}
      try {
        if (mediaSource.readyState === "open") mediaSource.endOfStream();
      } catch {}
      video.removeAttribute("src");
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.kind, currentPath, visible, retry]);

  // ---- HLS via hls.js (all browsers) or native playback (Safari/iOS) ----
  useEffect(() => {
    if (current?.kind !== "hls" || !visible) return;
    const video = videoRef.current;
    if (!video) return;
    const src = apiUrl(currentPath);
    let closed = false;
    let failed = false;
    const fail = (message: string) => {
      if (closed || failed) return;
      failed = true;
      recover(message);
    };
    const timeout = window.setTimeout(() => fail("HLS timed out"), 8_000);
    const onPlaying = () => {
      clearTimeout(timeout);
      log("hls playing");
      markPlaying("hls");
    };
    video.addEventListener("playing", onPlaying);

    let hls: Hls | null = null;
    if (Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 10,
        maxBufferLength: 6,
        liveSyncDurationCount: 2,
        manifestLoadingMaxRetry: 1,
        levelLoadingMaxRetry: 1,
        fragLoadingMaxRetry: 2,
        manifestLoadingRetryDelay: 500,
        levelLoadingRetryDelay: 500,
        fragLoadingRetryDelay: 500,
      } as any);
      hls.on(Hls.Events.ERROR, (_event: unknown, data: any) => {
        console.warn("[live] hls error", data.type, data.details);
        if (data.fatal) fail(`HLS error (${data.details})`);
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      void video.play().catch(() => undefined);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      void video.play().catch(() => undefined);
    } else {
      fail("HLS unsupported");
    }

    return () => {
      closed = true;
      clearTimeout(timeout);
      video.removeEventListener("playing", onPlaying);
      hls?.destroy();
      video.removeAttribute("src");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.kind, currentPath, visible, retry]);

  // Preview-frame fallback keeps the viewer usable when nothing streams.
  useEffect(() => {
    if (current?.kind !== "preview" || !visible) return;
    const timer = setInterval(() => setBust(Date.now()), 2_000);
    return () => clearInterval(timer);
  }, [current?.kind, visible]);

  if (current?.kind === "mjpeg") {
    return (
      <img
        src={apiUrl(currentPath)}
        onLoad={(event) =>
          setStatus({
            kind: "mjpeg",
            phase: "playing",
            width: event.currentTarget.naturalWidth || undefined,
            height: event.currentTarget.naturalHeight || undefined,
          })
        }
        onError={() => recover("MJPEG unavailable")}
        alt={`${cameraId} live`}
        className="size-full object-contain"
      />
    );
  }

  if (current?.kind === "preview") {
    return (
      <img
        src={previewFailed ? demoImageFor(cameraId) : cameraPreviewUrl(cameraId, 720, bust)}
        onLoad={() => setStatus({ kind: "preview", phase: "playing", message: status.message })}
        onError={() => setPreviewFailed(true)}
        alt={`${cameraId} preview`}
        className="size-full object-contain"
      />
    );
  }

  return (
    <video
      ref={videoRef}
      playsInline
      autoPlay
      muted={muted}
      preload="none"
      onLoadedMetadata={(event) =>
        setStatus((previous) => ({
          ...previous,
          width: event.currentTarget.videoWidth || undefined,
          height: event.currentTarget.videoHeight || undefined,
        }))
      }
      onError={() => recover("Playback error")}
      className="size-full bg-background object-contain"
    />
  );
}
