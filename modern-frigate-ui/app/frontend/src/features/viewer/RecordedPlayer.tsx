import Hls from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  eventClipUrl,
  eventVodUrl,
  recordingFrameUrl,
  vodPlaylistUrl,
} from "../../services/api";
import type { DetectionEvent, PlaybackWindow } from "../../types";
import type { LiveStatus } from "./LivePlayer";

const log = (...args: unknown[]) => console.info("[recorded]", ...args);

/** How much of a window must remain ahead before a new one is requested. */
const EDGE_MS = 8_000;
const WINDOW_MS = 300_000;
/** Seeks smaller than this are ignored — the element is already close enough. */
const SEEK_EPSILON = 0.6;

type Source =
  { kind: "hls"; src: string; baseTime: number } | { kind: "mp4"; src: string; baseTime: number };

/**
 * Historical playback.
 *
 * Frigate's native VOD endpoints (`/vod/...`, proxied by our backend) serve
 * recordings as HLS in the stored codec — no transcoding, no export wait. A
 * window of recording is loaded once and scrubbing inside it is a plain
 * `currentTime` seek, so dragging the timeline costs no extra requests.
 *
 * Ladder: VOD HLS → event `clip.mp4` → still recording frame.
 */
export function RecordedPlayer({
  cameraId,
  event,
  target,
  playing,
  speed,
  muted,
  clock,
  onStatus,
  onTime,
}: {
  cameraId: string;
  event: DetectionEvent | null;
  target: number;
  playing: boolean;
  speed: number;
  muted: boolean;
  clock?: string;
  onStatus?: (status: LiveStatus) => void;
  onTime?: (time: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [window_, setWindow] = useState<PlaybackWindow | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [status, setStatus] = useState<LiveStatus>({ kind: "hls", phase: "connecting" });
  const [stillOnly, setStillOnly] = useState(false);
  const [clipFallback, setClipFallback] = useState(false);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  // Event playback takes the dedicated event route: for a short detection a
  // single progressive mp4 starts faster than a playlist.
  useEffect(() => {
    if (!event) return;
    setStillOnly(false);
    setStatus({ kind: "hls", phase: "connecting" });
    setWindow(null);
    const useClip = Boolean(event.hasClip) && !clipFallback;
    setSource({
      kind: useClip ? "mp4" : "hls",
      src: useClip ? eventClipUrl(event.id) : eventVodUrl(event.id),
      baseTime: event.startTime,
    });
  }, [event, clipFallback]);

  const loadWindow = useCallback(
    async (at: number) => {
      setStatus((previous) => ({ ...previous, kind: "hls", phase: "connecting" }));
      const next = await api.playbackWindow(cameraId, at, WINDOW_MS);
      if (!next.playlist) {
        setStillOnly(true);
        setStatus({ kind: "preview", phase: "failed", message: "No recording at this moment" });
        return;
      }
      log("window", new Date(next.start).toISOString(), "→", new Date(next.end).toISOString());
      setStillOnly(false);
      setWindow(next);
      setSource({ kind: "hls", src: vodPlaylistUrl(next.playlist), baseTime: next.start });
    },
    [cameraId],
  );

  // Load (or reload) the surrounding window when the playhead leaves it.
  useEffect(() => {
    if (event) return;
    if (!window_ || target < window_.start + 500 || target > window_.end - EDGE_MS) {
      void loadWindow(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, cameraId, Math.floor(target / 1_000), window_?.start, window_?.end]);

  // Attach the media source.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source || stillOnly) return;
    let hls: Hls | null = null;
    let failed = false;
    const fail = (message: string) => {
      if (failed) return;
      failed = true;
      if (source.kind === "mp4") {
        // Progressive clip unavailable → try the event playlist instead.
        setClipFallback(true);
        return;
      }
      setStatus({ kind: "preview", phase: "failed", message });
      setStillOnly(true);
    };

    const seekToTarget = () => {
      const offset = (targetRef.current - source.baseTime) / 1000;
      if (
        Number.isFinite(offset) &&
        offset > 0 &&
        Math.abs(video.currentTime - offset) > SEEK_EPSILON
      ) {
        try {
          video.currentTime = offset;
        } catch {
          /* not seekable yet */
        }
      }
    };
    const onLoaded = () => {
      seekToTarget();
      video.playbackRate = speed;
      if (playing) void video.play().catch(() => undefined);
    };
    const onPlaying = () =>
      setStatus({
        kind: "hls",
        phase: "playing",
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
      });
    const onError = () => fail("Recording playback error");
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onError);

    if (source.kind === "mp4") {
      video.src = source.src;
    } else if (Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: false,
        // Recorded playback benefits from a deeper buffer than live does.
        maxBufferLength: 30,
        backBufferLength: 30,
        manifestLoadingMaxRetry: 2,
        fragLoadingMaxRetry: 3,
      } as any);
      hls.on(Hls.Events.ERROR, (_event: unknown, data: any) => {
        if (data.fatal) fail(`Recording error (${data.details})`);
      });
      hls.loadSource(source.src);
      hls.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = source.src;
    } else {
      fail("HLS unsupported");
    }

    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.src, source?.kind, stillOnly]);

  // In-window scrubbing: seek the loaded media element, never reload.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source || stillOnly) return;
    const offset = (target - source.baseTime) / 1000;
    if (offset < 0) return;
    if (Math.abs(video.currentTime - offset) > SEEK_EPSILON) {
      try {
        video.currentTime = offset;
      } catch {
        /* not seekable yet */
      }
    }
  }, [target, source, stillOnly]);

  // Transport controls.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [playing, speed, source, stillOnly]);

  // Report progress back so the timeline playhead follows the video.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source || !onTime || stillOnly) return;
    const onTimeUpdate = () => {
      if (video.seeking || video.paused) return;
      onTime(source.baseTime + video.currentTime * 1000);
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, [source, onTime, stillOnly]);

  if (stillOnly) {
    return (
      <img
        src={recordingFrameUrl(cameraId, target)}
        alt={`${cameraId} recorded frame`}
        className="size-full object-contain"
      />
    );
  }

  return (
    <video
      ref={videoRef}
      playsInline
      muted={muted}
      preload="metadata"
      poster={recordingFrameUrl(cameraId, source?.baseTime ?? target)}
      data-clock={clock}
      className="size-full bg-background object-contain"
    />
  );
}
