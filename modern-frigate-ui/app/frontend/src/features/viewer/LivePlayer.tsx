import { useEffect, useRef, useState } from "react";
import { usePageVisible } from "../../hooks/useAppState";
import { apiUrl, cameraPreviewUrl, socketUrl } from "../../services/api";
import { demoImageFor } from "../../services/demoData";
import type { StreamOption } from "../../types";

type Status = { kind: StreamOption["kind"]; message?: string };

/**
 * Streaming adapter with progressive fallback:
 *   WebRTC (go2rtc)  →  MSE  →  HLS  →  refreshing preview frames.
 * Every URL is derived from the current app location, so it works unchanged
 * behind Home Assistant Ingress over both HTTP and HTTPS.
 */
export function LivePlayer({
  cameraId,
  streams,
  muted,
  onStatus,
}: {
  cameraId: string;
  streams: StreamOption[];
  muted: boolean;
  onStatus?: (status: Status) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: "preview" });
  const visible = usePageVisible();
  const [bust, setBust] = useState(() => Date.now());
  const [previewFailed, setPreviewFailed] = useState(false);

  const candidates = streams.length
    ? streams
    : ([{ kind: "preview", path: "", label: "Preview frames" }] as StreamOption[]);
  const current = candidates[Math.min(attempt, candidates.length - 1)];

  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  const fallback = (message: string) =>
    setAttempt((previous) => {
      const next = Math.min(previous + 1, candidates.length - 1);
      setStatus({ kind: candidates[next]!.kind, message });
      return next;
    });

  // WebRTC / MSE via the backend websocket relay.
  useEffect(() => {
    if (!current || current.kind === "preview" || current.kind === "hls") return;
    const video = videoRef.current;
    if (!video) return;

    let socket: WebSocket | null = null;
    let peer: RTCPeerConnection | null = null;
    const timeout = window.setTimeout(() => fallback("Stream did not start"), 7_000);

    const cleanup = () => {
      clearTimeout(timeout);
      socket?.close();
      peer?.close();
    };

    try {
      socket = new WebSocket(socketUrl(current.path));
    } catch {
      fallback("Stream unavailable");
      return cleanup;
    }

    socket.onerror = () => fallback("Stream connection failed");
    socket.onclose = () => clearTimeout(timeout);

    if (current.kind === "webrtc") {
      peer = new RTCPeerConnection({ iceServers: [] });
      peer.addTransceiver("video", { direction: "recvonly" });
      peer.addTransceiver("audio", { direction: "recvonly" });
      peer.ontrack = (event) => {
        video.srcObject = event.streams[0] ?? null;
        void video.play().catch(() => undefined);
        clearTimeout(timeout);
        setStatus({ kind: "webrtc" });
      };
      socket.onopen = async () => {
        const offer = await peer!.createOffer();
        await peer!.setLocalDescription(offer);
        socket!.send(JSON.stringify({ type: "webrtc/offer", value: offer.sdp }));
      };
      socket.onmessage = async (message) => {
        try {
          const payload = JSON.parse(message.data);
          if (payload.type === "webrtc/answer") {
            await peer!.setRemoteDescription({ type: "answer", sdp: payload.value });
          }
        } catch {
          /* ignore */
        }
      };
    } else {
      // MSE: go2rtc streams fragmented MP4 over the same relay.
      const mediaSource = new MediaSource();
      video.src = URL.createObjectURL(mediaSource);
      socket.binaryType = "arraybuffer";
      let sourceBuffer: SourceBuffer | null = null;
      const queue: ArrayBuffer[] = [];
      const flush = () => {
        if (!sourceBuffer || sourceBuffer.updating || !queue.length) return;
        sourceBuffer.appendBuffer(queue.shift()!);
      };
      socket.onopen = () =>
        socket!.send(
          JSON.stringify({ type: "mse", value: 'avc1.640029,mp4a.40.2,opus' }),
        );
      socket.onmessage = (message) => {
        if (typeof message.data === "string") {
          try {
            const payload = JSON.parse(message.data);
            if (payload.type === "mse" && mediaSource.readyState === "open") {
              sourceBuffer = mediaSource.addSourceBuffer(`video/mp4; codecs="${payload.value}"`);
              sourceBuffer.mode = "segments";
              sourceBuffer.onupdateend = flush;
              clearTimeout(timeout);
              setStatus({ kind: "mse" });
              void video.play().catch(() => undefined);
            }
          } catch {
            /* ignore */
          }
          return;
        }
        queue.push(message.data as ArrayBuffer);
        flush();
      };
    }

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.kind, current?.path]);

  // HLS via native playback (Safari/iOS) — otherwise skip to preview frames.
  useEffect(() => {
    if (current?.kind !== "hls") return;
    const video = videoRef.current;
    if (!video) return;
    if (!video.canPlayType("application/vnd.apple.mpegurl")) {
      fallback("Live stream unavailable");
      return;
    }
    video.src = apiUrl(current.path);
    const timeout = window.setTimeout(() => fallback("Live stream unavailable"), 8_000);
    const onPlaying = () => {
      clearTimeout(timeout);
      setStatus({ kind: "hls" });
    };
    video.addEventListener("playing", onPlaying);
    void video.play().catch(() => undefined);
    return () => {
      clearTimeout(timeout);
      video.removeEventListener("playing", onPlaying);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.kind, current?.path]);

  // Preview-frame fallback keeps the viewer usable when nothing streams.
  useEffect(() => {
    if (current?.kind !== "preview" || !visible) return;
    const timer = setInterval(() => setBust(Date.now()), 2_000);
    return () => clearInterval(timer);
  }, [current?.kind, visible]);

  if (current?.kind === "preview") {
    return (
      <img
        src={previewFailed ? demoImageFor(cameraId) : cameraPreviewUrl(cameraId, 720, bust)}
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
      className="size-full bg-background object-contain"
    />
  );
}
