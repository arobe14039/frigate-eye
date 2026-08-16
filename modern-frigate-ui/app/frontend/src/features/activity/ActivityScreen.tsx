import { useQuery } from "@tanstack/react-query";
import { Inbox, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { EventCard } from "../../components/EventCard";
import { BottomSheet, Chip, EmptyState, Skeleton } from "../../components/primitives";
import { api } from "../../services/api";
import type { DetectionEvent, Preferences } from "../../types";
import { clockTime, dayGroupLabel, durationLabel, titleCase } from "../../utils/format";

const ANIMALS = ["dog", "cat", "bird", "horse", "bear"];

export function ActivityScreen({
  preferences,
  onOpenCamera,
}: {
  preferences: Preferences;
  onOpenCamera: (cameraId: string) => void;
}) {
  const [quickFilter, setQuickFilter] = useState<string>(preferences.defaultFilter);
  const [cameraFilter, setCameraFilter] = useState<string[]>([]);
  const [zoneFilter, setZoneFilter] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pages, setPages] = useState(1);
  const [selected, setSelected] = useState<DetectionEvent | null>(null);

  const cameras = useQuery({ queryKey: ["cameras"], queryFn: api.cameras });
  const labels = useQuery({ queryKey: ["labels"], queryFn: api.labels });

  const labelFilter = useMemo(() => {
    if (quickFilter === "all") return undefined;
    if (quickFilter === "animal") {
      return (labels.data ?? ANIMALS).filter((label) => ANIMALS.includes(label));
    }
    return [quickFilter];
  }, [quickFilter, labels.data]);

  const events = useQuery({
    queryKey: ["events", { quickFilter, cameraFilter, zoneFilter, pages }],
    queryFn: () =>
      api.events({
        ...(labelFilter ? { labels: labelFilter } : {}),
        cameras: cameraFilter,
        zones: zoneFilter,
        limit: pages * 20,
      }),
  });

  const cameraName = (id: string) =>
    cameras.data?.find((camera) => camera.id === id)?.displayName ?? titleCase(id);

  const groups = useMemo(() => {
    const map = new Map<string, DetectionEvent[]>();
    for (const event of events.data ?? []) {
      const key = dayGroupLabel(event.startTime);
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return [...map.entries()];
  }, [events.data]);

  const quickChips = ["all", "person", "car", "animal"].filter(
    (chip) =>
      chip === "all" ||
      chip === "animal" ||
      (labels.data ?? ["person", "car"]).includes(chip),
  );

  const allZones = [...new Set((cameras.data ?? []).flatMap((camera) => camera.zones ?? []))];

  return (
    <div className="pb-24">
      <header className="flex items-center justify-between px-4 pt-4 pb-3 safe-top">
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight">Activity</h1>
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          aria-label="Filters"
          className="grid size-10 place-items-center rounded-full bg-surface text-muted active:bg-surface-2"
        >
          <SlidersHorizontal className="size-[18px]" />
        </button>
      </header>

      <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto px-4">
        {quickChips.map((chip) => (
          <Chip key={chip} active={quickFilter === chip} onClick={() => setQuickFilter(chip)}>
            {chip === "all" ? "All" : titleCase(chip)}
          </Chip>
        ))}
        {cameraFilter.length || zoneFilter.length ? (
          <Chip
            active
            onClick={() => {
              setCameraFilter([]);
              setZoneFilter([]);
            }}
          >
            Clear filters
          </Chip>
        ) : null}
      </div>

      {events.isLoading ? (
        <div className="space-y-2 px-3">
          {[0, 1, 2, 3, 4].map((key) => (
            <Skeleton key={key} className="h-[92px]" />
          ))}
        </div>
      ) : groups.length ? (
        <div className="space-y-6">
          {groups.map(([day, dayEvents]) => (
            <section key={day}>
              <h2 className="mb-2 px-4 text-[13px] font-semibold tracking-wide text-subtle uppercase">
                {day}
              </h2>
              <div className="space-y-2 px-3">
                {dayEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    large
                    cameraName={cameraName(event.camera)}
                    onOpen={() => setSelected(event)}
                  />
                ))}
              </div>
            </section>
          ))}
          <div className="px-4">
            <button
              type="button"
              onClick={() => setPages((value) => value + 1)}
              className="h-11 w-full rounded-pill bg-surface text-[14px] font-medium text-muted active:bg-surface-2"
            >
              Load more
            </button>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<Inbox className="size-5" />}
          title="Nothing detected yet"
          detail="Detections from Frigate appear here as they happen."
        />
      )}

      <BottomSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        <p className="pt-1 pb-2 text-[13px] font-medium text-subtle">Cameras</p>
        <div className="flex flex-wrap gap-2">
          {(cameras.data ?? []).map((camera) => (
            <Chip
              key={camera.id}
              active={cameraFilter.includes(camera.id)}
              onClick={() =>
                setCameraFilter((previous) =>
                  previous.includes(camera.id)
                    ? previous.filter((id) => id !== camera.id)
                    : [...previous, camera.id],
                )
              }
            >
              {camera.displayName}
            </Chip>
          ))}
        </div>

        {allZones.length ? (
          <>
            <p className="pt-5 pb-2 text-[13px] font-medium text-subtle">Zones</p>
            <div className="flex flex-wrap gap-2">
              {allZones.map((zone) => (
                <Chip
                  key={zone}
                  active={zoneFilter.includes(zone)}
                  onClick={() =>
                    setZoneFilter((previous) =>
                      previous.includes(zone)
                        ? previous.filter((value) => value !== zone)
                        : [...previous, zone],
                    )
                  }
                >
                  {titleCase(zone)}
                </Chip>
              ))}
            </div>
          </>
        ) : null}

        <p className="pt-5 pb-2 text-[13px] font-medium text-subtle">Objects</p>
        <div className="flex flex-wrap gap-2">
          {["all", ...(labels.data ?? [])].map((label) => (
            <Chip key={label} active={quickFilter === label} onClick={() => setQuickFilter(label)}>
              {label === "all" ? "All" : titleCase(label)}
            </Chip>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setFiltersOpen(false)}
          className="mt-6 h-12 w-full rounded-2xl bg-accent text-[15px] font-semibold text-background"
        >
          Show results
        </button>
      </BottomSheet>

      <BottomSheet
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? titleCase(selected.label) : ""}
      >
        {selected ? (
          <div className="pt-1">
            <img
              src={selected.snapshotUrl ?? selected.thumbnailUrl}
              alt={`${selected.label} snapshot`}
              className="mb-4 aspect-video w-full rounded-2xl object-cover"
            />
            <Row label="Camera" value={cameraName(selected.camera)} />
            <Row label="Time" value={clockTime(selected.startTime, preferences.clock, true)} />
            <Row label="Duration" value={durationLabel(selected.startTime, selected.endTime)} />
            {selected.zones?.length ? (
              <Row label="Zones" value={selected.zones.map(titleCase).join(", ")} />
            ) : null}
            {selected.subLabel ? <Row label="Recognised" value={titleCase(selected.subLabel)} /> : null}
            {typeof selected.score === "number" ? (
              <Row label="Confidence" value={`${Math.round(selected.score * 100)}%`} />
            ) : null}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  const { camera, id } = selected;
                  setSelected(null);
                  onOpenCamera(camera, id);
                }}
                className="h-12 rounded-2xl bg-accent text-[14px] font-semibold text-background"
              >
                Play clip
              </button>
              <button
                type="button"
                onClick={() =>
                  void api.exportClip(
                    selected.camera,
                    selected.startTime - 5_000,
                    (selected.endTime ?? selected.startTime) + 5_000,
                  )
                }
                className="h-12 rounded-2xl bg-surface-2 text-[14px] font-medium"
              >
                Export clip
              </button>
            </div>
          </div>
        ) : null}
      </BottomSheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-hairline/40 py-2.5 text-[14px] last:border-0">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
