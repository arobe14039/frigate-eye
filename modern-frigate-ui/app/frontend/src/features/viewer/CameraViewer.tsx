import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  Download,
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
import type { DetectionEvent, Preferences } from "../../types";
import { clockTime, durationLabel, titleCase } from "../../utils/format";
import { Timeline, ZOOM_WINDOWS } from "../timeline/Timeline";
import { LivePlayer } from "./LivePlayer";

const SPEEDS = [0.5, 1, 2, 4];

export function CameraViewer({
  cameraId,
  preferences,
  isFavorite,
  onToggleFavorite,
  onZoomChange,
  onClose,
}: {
  cameraId: string;
  preferences: Preferences;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onZoomChange: (zoom: Preferences["timelineZoom"]) => void;
  onClose: () => void;
}) {
  const [live, setLive] = useState(true);
  const [playhead, setPlayhead] = useState(() => Date.now());
  const [settled, setSettled] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<DetectionEvent | null>(null);
  const [streamMessage, setStreamMessage] = useState<string | undefined>();
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

  const scrub = (time: number) => {
    setLive(false);
    setPlayhead(time);
  };

  const jumpToLive = () => {
    setLive(true);
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
            muted={muted}
            onStatus={(status) => setStreamMessage(status.message)}
          />
        ) : (
          <img
            src={recordingFrameUrl(cameraId, settled ?? playhead)}
            alt={`${displayName} at ${clockTime(playhead, preferences.clock, true)}`}
            className="size-full object-contain"
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

        {streamMessage && live ? (
          <p className="absolute inset-x-0 bottom-0 bg-background/70 px-3 py-2 text-center text-[12px] text-muted backdrop-blur">
            Live stream unavailable — showing latest preview
          </p>
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
          {SPEEDS.map((option) => (
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
        onSettle={(time) => setSettled(time)}
        onZoomChange={onZoomChange}
        onSelectEvent={(event) => {
          // Start a moment before the detection, then load that recording.
          const start = event.startTime - 4_000;
          setLive(false);
          setPlayhead(start);
          setSettled(start);
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
                    setPlayhead(event.startTime - 4_000);
                    setSettled(event.startTime - 4_000);
                    setSelected(event);
                  }}
                  className="flex w-full items-center justify-between rounded-2xl bg-surface px-4 py-3 text-left active:bg-surface-2"
                >
                  <span className="text-[14px] font-medium">
                    {titleCase(event.label)}
                    {event.zones?.length ? (
                      <span className="text-subtle"> · {titleCase(event.zones[0])}</span>
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
