import { VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useInView, usePageVisible } from "../hooks/useAppState";
import { cameraPreviewUrl } from "../services/api";
import { demoImageFor } from "../services/demoData";
import type { Camera } from "../types";
import { relativeTime } from "../utils/format";
import { StatusDot } from "./primitives";

const REFRESH_MS = { off: 0, slow: 20_000, normal: 8_000, fast: 3_000 };

/**
 * Lightweight camera preview card. Instead of opening a live stream per camera,
 * it refreshes a single downscaled JPEG frame — and only while the card is on
 * screen and the app is in the foreground.
 */
export function CameraCard({
  camera,
  detecting,
  compact,
  refresh = "normal",
  onOpen,
  onLongPress,
}: {
  camera: Camera;
  detecting?: boolean;
  compact?: boolean;
  refresh?: keyof typeof REFRESH_MS;
  onOpen: () => void;
  onLongPress?: () => void;
}) {
  const { ref, inView } = useInView<HTMLButtonElement>();
  const visible = usePageVisible();
  const [bust, setBust] = useState(() => Date.now());
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const pressTimer = useRef<number | null>(null);

  const interval = REFRESH_MS[refresh];
  useEffect(() => {
    if (!inView || !visible || !interval || !camera.online) return;
    const timer = setInterval(() => setBust(Date.now()), interval);
    return () => clearInterval(timer);
  }, [inView, visible, interval, camera.online]);

  const src = failed ? demoImageFor(camera.id) : cameraPreviewUrl(camera.id, compact ? 240 : 360, bust);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      onContextMenu={(event) => {
        if (!onLongPress) return;
        event.preventDefault();
        onLongPress();
      }}
      onPointerDown={() => {
        if (!onLongPress) return;
        pressTimer.current = window.setTimeout(onLongPress, 480);
      }}
      onPointerUp={() => pressTimer.current && clearTimeout(pressTimer.current)}
      onPointerLeave={() => pressTimer.current && clearTimeout(pressTimer.current)}
      className="group relative block w-full overflow-hidden rounded-card bg-surface text-left shadow-lift transition-transform duration-200 ease-smooth active:scale-[0.98]"
    >
      <div className={`relative w-full overflow-hidden ${compact ? "aspect-16/10" : "aspect-4/3"}`}>
        {!loaded && <div className="skeleton absolute inset-0" />}
        {inView ? (
          <img
            src={src}
            alt={`${camera.displayName} preview`}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => {
              setFailed(true);
              setLoaded(true);
            }}
            className={`size-full object-cover transition-opacity duration-500 ${
              loaded ? "opacity-100" : "opacity-0"
            } ${camera.online ? "" : "opacity-40 grayscale"}`}
          />
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background/95 via-background/35 to-transparent" />

        {!camera.online && (
          <div className="absolute inset-0 grid place-items-center">
            <span className="flex items-center gap-2 rounded-pill bg-background/70 px-3 py-1.5 text-[12px] text-muted backdrop-blur">
              <VideoOff className="size-3.5" /> Offline
            </span>
          </div>
        )}

        {detecting && camera.online && (
          <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-pill bg-background/65 px-2.5 py-1 text-[11px] font-medium text-detect backdrop-blur">
            <StatusDot state="detecting" /> Motion
          </span>
        )}

        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-3.5 pb-3">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold tracking-tight">
              {camera.displayName}
            </p>
            {!compact && (
              <p className="mt-0.5 text-[11px] text-subtle">
                {camera.online ? `Updated ${relativeTime(bust)}` : "No signal"}
              </p>
            )}
          </div>
          <StatusDot state={camera.online ? "online" : "offline"} />
        </div>
      </div>
    </button>
  );
}
