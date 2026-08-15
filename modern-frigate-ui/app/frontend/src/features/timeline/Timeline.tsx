import { Minus, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DetectionEvent, Preferences, RecordingSegment } from "../../types";
import { clockTime, titleCase } from "../../utils/format";

export const ZOOM_WINDOWS: Record<Preferences["timelineZoom"], number> = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

const ZOOM_ORDER: Preferences["timelineZoom"][] = ["15m", "1h", "6h", "24h"];

const tickStep = (windowMs: number) => {
  if (windowMs <= ZOOM_WINDOWS["15m"]) return 5 * 60_000;
  if (windowMs <= ZOOM_WINDOWS["1h"]) return 15 * 60_000;
  if (windowMs <= ZOOM_WINDOWS["6h"]) return 60 * 60_000;
  return 3 * 60 * 60_000;
};

/**
 * NVR-quality scrub timeline.
 * The playhead stays pinned at the centre; dragging moves time under it.
 * Timestamps update instantly on every pointer move, while the expensive
 * "load this moment" callback is only fired once the gesture settles.
 */
export function Timeline({
  playhead,
  live,
  zoom,
  segments,
  events,
  clock,
  onScrub,
  onSettle,
  onZoomChange,
  onSelectEvent,
}: {
  playhead: number;
  live: boolean;
  zoom: Preferences["timelineZoom"];
  segments: RecordingSegment[];
  events: DetectionEvent[];
  clock: Preferences["clock"];
  onScrub: (time: number) => void;
  onSettle: (time: number) => void;
  onZoomChange: (zoom: Preferences["timelineZoom"]) => void;
  onSelectEvent: (event: DetectionEvent) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(360);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; startTime: number } | null>(null);
  const settleTimer = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = trackRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth || 360));
    observer.observe(element);
    setWidth(element.clientWidth || 360);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  const windowMs = ZOOM_WINDOWS[zoom];
  const pxPerMs = width / windowMs;
  const viewStart = playhead - windowMs / 2;
  const toX = (time: number) => (time - viewStart) * pxPerMs;

  const settle = (time: number) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => onSettle(time), 260);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    drag.current = { x: event.clientX, startTime: playhead };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag.current) return;
    const deltaMs = (drag.current.x - event.clientX) / pxPerMs;
    const next = Math.min(Date.now(), drag.current.startTime + deltaMs);
    onScrub(next);
  };

  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    settle(playhead);
  };

  const step = tickStep(windowMs);
  const firstTick = Math.ceil(viewStart / step) * step;
  const ticks: number[] = [];
  for (let time = firstTick; time < viewStart + windowMs; time += step) ticks.push(time);

  const zoomIndex = ZOOM_ORDER.indexOf(zoom);

  return (
    <div className="select-none">
      <div className="mb-2 flex items-center justify-between px-4">
        <span
          className={`font-mono text-[13px] tabular-nums ${dragging ? "text-accent" : "text-muted"}`}
        >
          {live && !dragging ? "Live edge" : clockTime(playhead, clock, true)}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => onZoomChange(ZOOM_ORDER[Math.max(0, zoomIndex - 1)]!)}
            className="grid size-8 place-items-center rounded-full bg-surface text-muted active:bg-surface-2"
          >
            <Plus className="size-4" />
          </button>
          <span className="w-9 text-center text-[12px] font-medium text-subtle">{zoom}</span>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => onZoomChange(ZOOM_ORDER[Math.min(ZOOM_ORDER.length - 1, zoomIndex + 1)]!)}
            className="grid size-8 place-items-center rounded-full bg-surface text-muted active:bg-surface-2"
          >
            <Minus className="size-4" />
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative h-[92px] touch-none overflow-hidden bg-surface/60"
        style={{ cursor: dragging ? "grabbing" : "grab" }}
      >
        {/* time ruler */}
        <div className="absolute inset-x-0 top-0 h-6">
          {ticks.map((tick) => (
            <div
              key={tick}
              className="absolute top-0 flex h-6 flex-col items-center"
              style={{ transform: `translateX(${toX(tick)}px)` }}
            >
              <span className="-translate-x-1/2 font-mono text-[10px] text-subtle">
                {clockTime(tick, clock)}
              </span>
            </div>
          ))}
        </div>

        {/* recording availability */}
        <div className="absolute inset-x-0 top-8 h-4">
          <div className="absolute inset-x-0 h-full bg-surface-2/60" />
          {segments.map((segment) => (
            <div
              key={`${segment.startTime}-${segment.endTime}`}
              className="absolute h-full bg-accent-soft"
              style={{
                transform: `translateX(${toX(segment.startTime)}px)`,
                width: Math.max(1, (segment.endTime - segment.startTime) * pxPerMs),
              }}
            />
          ))}
        </div>

        {/* detection markers */}
        <div className="absolute inset-x-0 top-14 h-8">
          {events.map((event) => {
            const left = toX(event.startTime);
            if (left < -60 || left > width + 60) return null;
            const durationPx = Math.max(
              3,
              ((event.endTime ?? event.startTime + 8000) - event.startTime) * pxPerMs,
            );
            return (
              <button
                key={event.id}
                type="button"
                onPointerDown={(pointer) => pointer.stopPropagation()}
                onClick={() => onSelectEvent(event)}
                className="absolute top-0 flex flex-col items-start"
                style={{ transform: `translateX(${left}px)` }}
              >
                <span
                  className="block h-1.5 rounded-pill bg-detect"
                  style={{ width: durationPx }}
                />
                <span className="mt-1 max-w-[92px] truncate rounded-pill bg-surface-2/90 px-1.5 py-0.5 text-[10px] font-medium text-detect">
                  {titleCase(event.label)}
                </span>
              </button>
            );
          })}
        </div>

        {/* playhead */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-foreground/85">
          <span className="absolute -top-0.5 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-foreground" />
        </div>
      </div>
    </div>
  );
}
