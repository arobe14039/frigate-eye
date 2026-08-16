import { BottomNav } from "../components/BottomNav";
import { useDetectionStream } from "../hooks/useDetectionStream";
import { useRoute } from "../hooks/useAppState";
import { usePreferences } from "../hooks/usePreferences";
import { ActivityScreen } from "../features/activity/ActivityScreen";
import { CamerasScreen } from "../features/cameras/CamerasScreen";
import { HomeScreen } from "../features/home/HomeScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { CameraViewer } from "../features/viewer/CameraViewer";
import type { Preferences } from "../types";

const FALLBACK_PREFERENCES: Preferences = {
  favorites: [],
  cameraOrder: [],
  gridDensity: "comfortable",
  previewRefresh: "normal",
  clock: "12h",
  defaultFilter: "all",
  timelineZoom: "1h",
};

export function AppRoot() {
  const { route, navigate, back } = useRoute();
  const { preferences, userName, update, toggleFavorite } = usePreferences();
  const { activeCameras } = useDetectionStream();
  const prefs = preferences ?? FALLBACK_PREFERENCES;

  const openCamera = (cameraId: string, eventId?: string) =>
    navigate(
      eventId
        ? `camera/${encodeURIComponent(cameraId)}/event/${encodeURIComponent(eventId)}`
        : `camera/${encodeURIComponent(cameraId)}`,
    );

  return (
    <div className="mx-auto min-h-dvh max-w-2xl">
      {route.tab === "home" && (
        <HomeScreen
          preferences={prefs}
          activeCameras={activeCameras}
          onOpenCamera={openCamera}
          onNavigate={(tab) => navigate(tab)}
        />
      )}
      {route.tab === "activity" && (
        <ActivityScreen preferences={prefs} onOpenCamera={openCamera} />
      )}
      {route.tab === "cameras" && (
        <CamerasScreen
          preferences={prefs}
          activeCameras={activeCameras}
          onOpenCamera={openCamera}
          onToggleFavorite={toggleFavorite}
          onReorder={(cameraOrder) => update({ cameraOrder })}
        />
      )}
      {route.tab === "settings" && (
        <SettingsScreen preferences={prefs} userName={userName} onUpdate={update} />
      )}

      {route.camera ? (
        <CameraViewer
          cameraId={route.camera}
          initialEventId={route.event}
          preferences={prefs}
          isFavorite={prefs.favorites.includes(route.camera)}
          onToggleFavorite={() => toggleFavorite(route.camera!)}
          onZoomChange={(timelineZoom) => update({ timelineZoom })}
          onClose={back}
        />
      ) : null}

      <BottomNav active={route.tab} onSelect={(tab) => navigate(tab)} />
    </div>
  );
}
