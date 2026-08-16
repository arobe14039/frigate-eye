import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  Download,
  Loader2,
  Maximize2,
  MoreVertical,
  Pause,
  Play,
  Star,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BottomSheet, Skeleton, StatusDot } from "../../components/primitives";
import { api, recordingFrameUrl } from "../../services/api";
import type { DetectionEvent, Preferences, StreamQuality } from "../../types";
import { clockTime, durationLabel, titleCase } from "../../utils/format";
import { Timeline, ZOOM_WINDOWS } from "../timeline/Timeline";
import { LivePlayer, type LiveStatus } from "./LivePlayer";
import { RecordedPlayer } from "./RecordedPlayer";

const SPEEDS = [0.5, 1, 2, 4];

const QUALITIES: Array<{ value: StreamQuality; label: string; hint: string }> = [
  { value: "low", label: "Low", hint: "≈360p — smoothest on mobile data" },
  { value: "medium", label: "Medium", hint: "≈720p — balanced" },
  { value: "high", label: "High", hint: "Native camera stream (up to 4K)" },
];

const QUALITY_KEY = "frigate-ui:stream-quality";

const storedQuality = (): StreamQuality => {
  try {
    const value = localStorage.getItem(QUALITY_KEY);
    if (value === "low" || value === "medium" || value === "high") return value;
  } catch {
    /* storage unavailable */
  }
  return "medium";
};

const STREAM_LABELS: Record<LiveStatus["kind"], string> = {
  webrtc: "WebRTC",
  mse: "MSE",
  hls: "HLS",
  mjpeg: "MJPEG",
  preview: "Preview",
};

/** Map the decoded height onto the nearest familiar quality tier. */
function qualityLabel(height: number) {
  if (height >= 2000) return "4K";
  if (height >= 1300) return "1440p";
  if (height >= 1000) return "1080p";
  if (height >= 680) return "720p";
  if (height >= 460) return "480p";
  return `${height}p`;
}

export function CameraViewer({
  cameraId,
  initialEventId,
  preferences,
  isFavorite,
  onToggleFavorite,
  onZoomChange,
  onClose,
}: {
  cameraId: string;
  initialEventId?: string | undefined;
  preferences: Preferences;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onZoomChange: (zoom: Preferences["timelineZoom"]) => void;
  onClose: () => void;
}) {
  const [live, setLive] = useState(!initialEventId);
  // The event currently being played back (null = plain timeline playback).
  const [playbackEvent, setPlaybackEvent] = useState<DetectionEvent | null>(null);
  const [playhead, setPlayhead] = useState(() => Date.now());
  const [settled, setSettled] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [quality, setQuality] = useState<StreamQuality>(storedQuality);
  const [speed, setSpeed] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<DetectionEvent | null>(null);
  const [streamStatus, setStreamStatus] = useState<LiveStatus>({
    kind: "preview",
    phase: "connecting",
  });
  const [dragging, setDragging] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const camera = useQuery({
    queryKey: ["camera", cameraId],
    queryFn: () => api.camera(cameraId),
  });

  const windowMs = ZOOM_WINDOWS[preferences.timelineZoom];
  const timeline = useQuery({
    queryKey: ["timeline", cameraId, preferences.timelineZoom, Math.floor(playhead / 300_000)],
    queryFn: () => api.timeline(cameraId, playhead - windowMs, playhead + windowMs / 2),
    staleTime: 30_000,
  });

  const events = useQuery({
    queryKey: ["events", { camera: cameraId }],
    queryFn: () => api.events({ cameras: [cameraId], limit: 12 }),
  });

  // Keep the live edge moving while nothing is being scrubbed.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setPlayhead(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [live]);

  const changeQuality = (value: StreamQuality) => {
    setQuality(value);
    try {
      localStorage.setItem(QUALITY_KEY, value);
    } catch {
      /* storage unavailable */
    }
  };

  const scrub = (time: number) => {
    setLive(false);
    setDragging(true);
    setPlaybackEvent(null);
    setPlayhead(time);
  };

  const jumpToLive = () => {
    setLive(true);
    setPlaybackEvent(null);
    setSettled(null);
    setPlayhead(Date.now());
  };

  const displayName = camera.data?.displayName ?? titleCase(cameraId);
  const streams = useMemo(() => camera.data?.streams ?? [], [camera.data]);

  return (
    <div ref={shellRef} className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center justify-between px-2 py-2 safe-top">
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 items-center gap-1 rounded-pill px-2 text-[15px] font-medium active:bg-surface"
        >
          <ChevronLeft className="size-6" />
          <span className="max-w-[52vw] truncate">{displayName}</span>
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleFavorite}
            aria-label="Favorite"
            className="grid size-11 place-items-center rounded-full active:bg-surface"
          >
            <Star
              className={`size-5 ${isFavorite ? "fill-detect text-detect" : "text-muted"}`}
            />
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="More"
            className="grid size-11 place-items-center rounded-full text-muted active:bg-surface"
          >
            <MoreVertical className="size-5" />
          </button>
        </div>
      </header>

      <div className="relative aspect-video w-full bg-black">
        {live ? (
          <LivePlayer
            cameraId={cameraId}
            streams={streams}
            quality={quality}
            muted={muted}
            onStatus={setStreamStatus}
          />
        ) : dragging ? (
          // Cheap still frame while the gesture is in flight — the video only
          // loads once the scrub settles.
          <img
            src={recordingFrameUrl(cameraId, playhead)}
            alt={`${displayName} at ${clockTime(playhead, preferences.clock, true)}`}
            className="size-full object-contain"
          />
        ) : (
          <RecordedPlayer
            cameraId={cameraId}
            event={playbackEvent}
            target={settled ?? playhead}
            playing={playing}
            speed={speed}
            muted={muted}
            onStatus={setStreamStatus}
            onTime={(time) => {
              setPlayhead(time);
              setSettled(time);
            }}
          />
        )}

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
          {live ? (
            <span className="flex items-center gap-1.5 rounded-pill bg-background/60 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-live backdrop-blur">
              LIVE <StatusDot state="detecting" />
            </span>
          ) : (
            <span className="rounded-pill bg-background/60 px-2.5 py-1 font-mono text-[11px] text-foreground backdrop-blur">
              {clockTime(playhead, preferences.clock, true)}
            </span>
          )}
          {!live && (
            <button
              type="button"
              onClick={jumpToLive}
              className="pointer-events-auto rounded-pill bg-live/90 px-3 py-1 text-[11px] font-semibold tracking-wide"
            >
              JUMP TO LIVE →
            </button>
          )}
        </div>

        {streamStatus.phase === "playing" ? (
          <span className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-pill bg-background/65 px-2.5 py-1 text-[11px] font-medium text-foreground backdrop-blur">
            <span className="font-semibold tracking-wide uppercase">
              {STREAM_LABELS[streamStatus.kind]}
            </span>
            {streamStatus.height ? (
              <span className="text-muted">{qualityLabel(streamStatus.height)}</span>
            ) : null}
          </span>
        ) : null}

        {streamStatus.phase !== "playing" && !dragging ? (
          <div className="absolute inset-0 grid place-items-center bg-background/45 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-2.5">
              <Loader2 className="size-7 animate-spin text-accent" />
              <p className="text-[12px] text-muted">
                {streamStatus.phase === "failed"
                  ? live
                    ? "Live stream unavailable — showing latest preview"
                    : "No recorded video at this moment — showing the nearest frame"
                  : live
                    ? `Connecting ${STREAM_LABELS[streamStatus.kind]} stream…`
                    : "Loading recording…"}
              </p>
              {streamStatus.message && streamStatus.phase !== "failed" ? (
                <p className="max-w-[70%] text-center text-[11px] text-subtle">
                  {streamStatus.message} — retrying
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPlaying((value) => !value)}
            aria-label={playing ? "Pause" : "Play"}
            className="grid size-11 place-items-center rounded-full bg-surface active:bg-surface-2"
          >
            {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
          </button>
          <button
            type="button"
            onClick={() => setMuted((value) => !value)}
            aria-label={muted ? "Unmute" : "Mute"}
            className="grid size-11 place-items-center rounded-full bg-surface text-muted active:bg-surface-2"
          >
            {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>
          <button
            type="button"
            onClick={() => void shellRef.current?.requestFullscreen?.().catch(() => undefined)}
            aria-label="Fullscreen"
            className="grid size-11 place-items-center rounded-full bg-surface text-muted active:bg-surface-2"
          >
            <Maximize2 className="size-5" />
          </button>
        </div>
        <div className="flex items-center gap-1 rounded-pill bg-surface p-1">
          {live
            ? QUALITIES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => changeQuality(option.value)}
                  aria-pressed={quality === option.value}
                  title={option.hint}
                  className={`h-8 rounded-pill px-2.5 text-[12px] font-medium transition-colors ${
                    quality === option.value ? "bg-accent text-background" : "text-muted"
                  }`}
                >
                  {option.label}
                </button>
              ))
            : SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSpeed(option)}
              className={`h-8 rounded-pill px-2.5 text-[12px] font-medium transition-colors ${
                speed === option ? "bg-accent text-background" : "text-muted"
              }`}
                >
                  {option}x
                </button>
              ))}
        </div>
      </div>

      <Timeline
        playhead={playhead}
        live={live}
        zoom={preferences.timelineZoom}
        clock={preferences.clock}
        segments={timeline.data?.segments ?? []}
        events={timeline.data?.events ?? []}
        onScrub={scrub}
        onSettle={(time) => {
          setDragging(false);
          setSettled(time);
        }}
        onZoomChange={onZoomChange}
        onSelectEvent={(event) => {
          // Start a moment before the detection, then load that recording.
          const start = event.startTime - 4_000;
          setLive(false);
          setDragging(false);
          setPlayhead(start);
          setSettled(start);
          setPlaybackEvent(event);
          setPlaying(true);
          setSelected(event);
        }}
      />

      <div className="flex-1 overflow-y-auto pt-4 pb-6">
        <h2 className="mb-2 px-4 text-[13px] font-semibold tracking-wide text-subtle uppercase">
          Recent detections
        </h2>
        <div className="space-y-1.5 px-3">
          {events.isLoading
            ? [0, 1, 2].map((key) => <Skeleton key={key} className="h-14" />)
            : (events.data ?? []).map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => {
                    setLive(false);
                    setDragging(false);
                    setPlayhead(event.startTime - 4_000);
                    setSettled(event.startTime - 4_000);
                    setPlaybackEvent(event);
                    setPlaying(true);
                    setSelected(event);
                  }}
                  className="flex w-full items-center justify-between rounded-2xl bg-surface px-4 py-3 text-left active:bg-surface-2"
                >
                  <span className="text-[14px] font-medium">
                    {titleCase(event.label)}
                    {event.zones?.length ? (
                      <span className="text-subtle"> · {titleCase(event.zones[0]!)}</span>
                    ) : null}
                  </span>
                  <span className="font-mono text-[12px] text-subtle">
                    {clockTime(event.startTime, preferences.clock)}
                  </span>
                </button>
              ))}
        </div>
      </div>

      <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)} title={displayName}>
        <div className="space-y-2 pt-1 text-[14px]">
          <Row label="Status" value={camera.data?.online ? "Online" : "Offline"} />
          {camera.data?.detect ? (
            <Row
              label="Detect stream"
              value={`${camera.data.detect.width}×${camera.data.detect.height} @ ${camera.data.detect.fps} fps`}
            />
          ) : null}
          {camera.data?.zones?.length ? (
            <Row label="Zones" value={camera.data.zones.map(titleCase).join(", ")} />
          ) : null}
          <button
            type="button"
            onClick={async () => {
              await api.exportClip(cameraId, playhead - 60_000, playhead);
              setMenuOpen(false);
            }}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-surface-2 font-medium"
          >
            <Download className="size-4" /> Export last minute
          </button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `${titleCase(selected.label)} detected` : ""}
      >
        {selected ? (
          <div className="space-y-2 pt-1 text-[14px]">
            <Row label="Camera" value={displayName} />
            <Row label="Time" value={clockTime(selected.startTime, preferences.clock, true)} />
            <Row label="Duration" value={durationLabel(selected.startTime, selected.endTime)} />
            {selected.zones?.length ? (
              <Row label="Zones" value={selected.zones.map(titleCase).join(", ")} />
            ) : null}
            {selected.subLabel ? <Row label="Recognised" value={titleCase(selected.subLabel)} /> : null}
            {typeof selected.score === "number" ? (
              <Row label="Confidence" value={`${Math.round(selected.score * 100)}%`} />
            ) : null}
          </div>
        ) : null}
      </BottomSheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-hairline/40 py-2.5 last:border-0">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
