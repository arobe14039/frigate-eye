import { useQuery } from "@tanstack/react-query";
import { CameraOff, ChevronRight } from "lucide-react";
import { CameraCard } from "../../components/CameraCard";
import { EventCard } from "../../components/EventCard";
import { EmptyState, SectionTitle, Skeleton } from "../../components/primitives";
import { api } from "../../services/api";
import type { Camera, Preferences, TabKey } from "../../types";
import { greeting } from "../../utils/format";

export function HomeScreen({
  preferences,
  activeCameras,
  onOpenCamera,
  onNavigate,
}: {
  preferences: Preferences;
  activeCameras: Record<string, number>;
  onOpenCamera: (cameraId: string) => void;
  onNavigate: (tab: TabKey) => void;
}) {
  const status = useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: 30_000 });
  const cameras = useQuery({ queryKey: ["cameras"], queryFn: api.cameras });
  const events = useQuery({
    queryKey: ["events", { scope: "home" }],
    queryFn: () => api.events({ limit: 6 }),
  });

  const ordered = orderCameras(cameras.data ?? [], preferences);
  const offline = ordered.filter((camera) => !camera.online).length;
  const compact = preferences.gridDensity === "compact";

  return (
    <div className="pb-24">
      <header className="flex items-baseline justify-between px-4 pt-4 pb-5 safe-top">
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{greeting()}</h1>
        <span className="text-[12px] text-subtle">
          {cameras.isLoading
            ? "Loading"
            : offline
              ? `${offline} offline`
              : `${ordered.length} cameras live`}
        </span>
      </header>

      {status.data && !status.data.frigate.connected ? (
        <div className="mx-4 mb-5 rounded-card bg-surface px-4 py-3.5">
          <p className="text-[14px] font-medium">Frigate is temporarily unavailable</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-subtle">
            {status.data.frigate.error ?? "Retrying automatically in the background."}
          </p>
          <button
            type="button"
            onClick={() => void api.testConnection().then(() => status.refetch())}
            className="mt-3 h-9 rounded-pill bg-surface-2 px-4 text-[13px] font-medium"
          >
            Retry now
          </button>
        </div>
      ) : null}

      <section className="mb-7">
        <SectionTitle>Live Cameras</SectionTitle>
        <div className={`grid gap-2.5 px-3 ${compact ? "grid-cols-3" : "grid-cols-2"}`}>
          {cameras.isLoading
            ? [0, 1, 2, 3].map((key) => <Skeleton key={key} className="aspect-4/3" />)
            : ordered.map((camera) => (
                <CameraCard
                  key={camera.id}
                  camera={camera}
                  compact={compact}
                  refresh={preferences.previewRefresh}
                  detecting={Boolean(activeCameras[camera.id])}
                  onOpen={() => onOpenCamera(camera.id)}
                />
              ))}
        </div>
        {!cameras.isLoading && !ordered.length ? (
          <EmptyState
            icon={<CameraOff className="size-5" />}
            title="No cameras found"
            detail="Once Frigate reports cameras they appear here automatically."
          />
        ) : null}
      </section>

      <section>
        <SectionTitle
          action={
            <button
              type="button"
              onClick={() => onNavigate("activity")}
              className="flex items-center gap-0.5 text-[13px] font-medium text-accent"
            >
              All activity <ChevronRight className="size-4" />
            </button>
          }
        >
          Recent Activity
        </SectionTitle>
        <div className="space-y-2 px-3">
          {events.isLoading
            ? [0, 1, 2].map((key) => <Skeleton key={key} className="h-[92px]" />)
            : (events.data ?? []).map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  large
                  cameraName={
                    ordered.find((camera) => camera.id === event.camera)?.displayName ?? event.camera
                  }
                  onOpen={() => onOpenCamera(event.camera)}
                />
              ))}
        </div>
      </section>
    </div>
  );
}

export function orderCameras(cameras: Camera[], preferences: Preferences) {
  const order = preferences.cameraOrder;
  const favorites = new Set(preferences.favorites);
  return [...cameras].sort((a, b) => {
    const favoriteDelta = Number(favorites.has(b.id)) - Number(favorites.has(a.id));
    if (favoriteDelta) return favoriteDelta;
    const indexA = order.indexOf(a.id);
    const indexB = order.indexOf(b.id);
    if (indexA !== -1 || indexB !== -1) {
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    }
    return a.displayName.localeCompare(b.displayName);
  });
}
