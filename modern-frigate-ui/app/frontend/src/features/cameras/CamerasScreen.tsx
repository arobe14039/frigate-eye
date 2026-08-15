import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Star } from "lucide-react";
import { CameraCard } from "../../components/CameraCard";
import { SectionTitle, Skeleton } from "../../components/primitives";
import { api } from "../../services/api";
import type { Preferences } from "../../types";
import { orderCameras } from "../home/HomeScreen";

export function CamerasScreen({
  preferences,
  activeCameras,
  onOpenCamera,
  onToggleFavorite,
  onReorder,
}: {
  preferences: Preferences;
  activeCameras: Record<string, number>;
  onOpenCamera: (cameraId: string) => void;
  onToggleFavorite: (cameraId: string) => void;
  onReorder: (order: string[]) => void;
}) {
  const cameras = useQuery({ queryKey: ["cameras"], queryFn: api.cameras });
  const ordered = orderCameras(cameras.data ?? [], preferences);
  const favorites = ordered.filter((camera) => preferences.favorites.includes(camera.id));
  const others = ordered.filter((camera) => !preferences.favorites.includes(camera.id));

  const move = (cameraId: string, direction: -1 | 1) => {
    const current = ordered.map((camera) => camera.id);
    const index = current.indexOf(cameraId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return;
    const moved = current[index]!;
    current[index] = current[target]!;
    current[target] = moved;
    onReorder(current);
  };

  return (
    <div className="pb-24">
      <header className="px-4 pt-4 pb-5 safe-top">
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight">Cameras</h1>
      </header>

      {cameras.isLoading ? (
        <div className="grid grid-cols-2 gap-2.5 px-3">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="aspect-4/3" />
          ))}
        </div>
      ) : (
        <>
          {favorites.length ? (
            <section className="mb-7">
              <SectionTitle>Favorites</SectionTitle>
              <div className="grid grid-cols-2 gap-2.5 px-3">
                {favorites.map((camera) => (
                  <CameraCard
                    key={camera.id}
                    camera={camera}
                    refresh={preferences.previewRefresh}
                    detecting={Boolean(activeCameras[camera.id])}
                    onOpen={() => onOpenCamera(camera.id)}
                    onLongPress={() => onToggleFavorite(camera.id)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <SectionTitle>All Cameras</SectionTitle>
            <ul className="space-y-1.5 px-3">
              {others.map((camera) => (
                <li
                  key={camera.id}
                  className="flex items-center gap-2 rounded-2xl bg-surface px-3 py-2.5"
                >
                  <button
                    type="button"
                    onClick={() => onOpenCamera(camera.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[15px] font-medium">{camera.displayName}</p>
                    <p className="text-[12px] text-subtle">
                      {camera.online ? "Online" : "Offline"}
                      {camera.zones?.length ? ` · ${camera.zones.length} zones` : ""}
                    </p>
                  </button>
                  <button
                    type="button"
                    aria-label="Move up"
                    onClick={() => move(camera.id, -1)}
                    className="grid size-10 place-items-center rounded-full text-subtle active:bg-surface-2"
                  >
                    <ArrowUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    onClick={() => move(camera.id, 1)}
                    className="grid size-10 place-items-center rounded-full text-subtle active:bg-surface-2"
                  >
                    <ArrowDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Favorite"
                    onClick={() => onToggleFavorite(camera.id)}
                    className="grid size-10 place-items-center rounded-full text-subtle active:bg-surface-2"
                  >
                    <Star className="size-[18px]" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
