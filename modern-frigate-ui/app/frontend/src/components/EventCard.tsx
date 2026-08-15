import { useState } from "react";
import { eventThumbnailUrl } from "../services/api";
import { demoImageFor } from "../services/demoData";
import type { DetectionEvent } from "../types";
import { relativeTime, titleCase } from "../utils/format";

export function EventCard({
  event,
  cameraName,
  onOpen,
  large,
}: {
  event: DetectionEvent;
  cameraName: string;
  onOpen: () => void;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const src = failed ? demoImageFor(event.camera) : eventThumbnailUrl(event.id, event.camera);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3.5 rounded-card bg-surface p-2.5 text-left transition-transform duration-200 ease-smooth active:scale-[0.985]"
    >
      <div
        className={`relative shrink-0 overflow-hidden rounded-[14px] bg-surface-2 ${
          large ? "h-[76px] w-[112px]" : "h-16 w-24"
        }`}
      >
        {!loaded && <div className="skeleton absolute inset-0" />}
        <img
          src={src}
          alt={`${event.label} on ${cameraName}`}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setFailed(true);
            setLoaded(true);
          }}
          className={`size-full object-cover transition-opacity duration-400 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold tracking-tight">
          {titleCase(event.label)}
          {event.subLabel ? <span className="text-muted"> · {titleCase(event.subLabel)}</span> : null}
        </p>
        <p className="mt-0.5 truncate text-[13px] text-muted">
          {cameraName}
          {event.zones?.length ? ` · ${titleCase(event.zones[0]!)}` : ""}
        </p>
        <p className="mt-1 text-[12px] text-subtle">{relativeTime(event.startTime)}</p>
      </div>
    </button>
  );
}
