import backyard from "../assets/demo/backyard.jpg";
import driveway from "../assets/demo/driveway.jpg";
import frontDoor from "../assets/demo/front-door.jpg";
import garage from "../assets/demo/garage.jpg";
import type {
  AppStatus,
  Camera,
  CameraDetail,
  DetectionEvent,
  Preferences,
  TimelineData,
} from "../types";

/**
 * Demo dataset used only when the backend is unreachable (design preview or
 * while the add-on is still starting). Nothing here is used in production;
 * real cameras, labels and zones always come from the running Frigate config.
 */
const DEMO_CAMERAS: Array<{ id: string; displayName: string; image: string; zones: string[] }> = [
  { id: "driveway", displayName: "Driveway", image: driveway, zones: ["drive", "street"] },
  { id: "front_door", displayName: "Front Door", image: frontDoor, zones: ["porch"] },
  { id: "backyard", displayName: "Backyard", image: backyard, zones: ["lawn", "patio"] },
  { id: "garage", displayName: "Garage", image: garage, zones: ["bay"] },
  { id: "side_yard", displayName: "Side Yard", image: backyard, zones: ["gate"] },
  { id: "porch", displayName: "Porch", image: frontDoor, zones: ["steps"] },
  { id: "street", displayName: "Street", image: driveway, zones: ["curb"] },
  { id: "workshop", displayName: "Workshop", image: garage, zones: [] },
];

export const demoImageFor = (cameraId: string) =>
  DEMO_CAMERAS.find((camera) => camera.id === cameraId)?.image ?? driveway;

const LABELS = ["person", "car", "dog", "cat", "package", "bicycle"];

const makeEvents = (count: number, cameras?: string[], labels?: string[]): DetectionEvent[] => {
  const pool = DEMO_CAMERAS.filter((camera) => !cameras?.length || cameras.includes(camera.id));
  const labelPool = labels?.length ? labels : LABELS;
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => {
    const camera = pool[index % Math.max(pool.length, 1)] ?? DEMO_CAMERAS[0]!;
    const label = labelPool[index % labelPool.length]!;
    const start = now - index * 11 * 60 * 1000 - (index % 5) * 90_000;
    return {
      id: `demo-${index}-${camera.id}`,
      camera: camera.id,
      label,
      ...(label === "person" && index % 4 === 0 ? { subLabel: "Alex" } : {}),
      startTime: start,
      endTime: start + 12_000 + (index % 6) * 4_000,
      score: 0.68 + ((index * 7) % 30) / 100,
      zones: camera.zones.slice(0, 1),
      hasSnapshot: true,
      hasClip: true,
      thumbnailUrl: camera.image,
      snapshotUrl: camera.image,
    } satisfies DetectionEvent;
  });
};

export const demo = {
  status: (): AppStatus => ({
    app: { version: "0.1.0", previewRefreshSeconds: 6 },
    frigate: {
      connected: false,
      version: "0.14.1",
      cameraCount: DEMO_CAMERAS.length,
      detectorFps: 12.4,
      discoveredVia: null,
      error: "Showing demo data — no Frigate instance reachable from this preview.",
    },
    homeAssistant: { available: false, connected: false },
  }),
  diagnostics: (): Diagnostics => ({
    ports: [
      { label: "Frigate API", port: 5000, required: true, ok: false, detail: "Demo mode" },
      { label: "go2rtc (live video)", port: 1984, required: false, ok: false, detail: "Demo mode" },
    ],
    liveVia: null,
    streamCount: 0,
    go2rtcStreams: [],
    cameraStreams: DEMO_CAMERAS.map((camera) => ({
      camera: camera.id,
      streamName: camera.id,
      matched: false,
    })),
  }),
  cameras: (): Camera[] =>

    DEMO_CAMERAS.map((camera, index) => ({
      id: camera.id,
      name: camera.id,
      displayName: camera.displayName,
      online: index !== 6,
      zones: camera.zones,
      recordEnabled: true,
      detect: { width: 1920, height: 1080, fps: 5 },
      lastUpdated: Date.now(),
    })),
  camera: (id: string): CameraDetail => {
    const base =
      demo.cameras().find((camera) => camera.id === id) ??
      ({ id, name: id, displayName: id, online: true } as Camera);
    return { ...base, streams: [{ kind: "preview", path: "", label: "Preview frames" }] };
  },
  labels: () => LABELS,
  events: (params: { cameras?: string[]; labels?: string[]; limit?: number }) =>
    makeEvents(params.limit ?? 25, params.cameras, params.labels),
  timeline: (camera: string, after: number, before: number): TimelineData => {
    const segments = [];
    const step = 10 * 60 * 1000;
    for (let time = Math.floor(after / step) * step; time < before; time += step) {
      // Leave a couple of gaps so unavailable recording ranges are visible.
      const available = Math.floor(time / step) % 11 !== 4;
      if (available) {
        segments.push({ camera, startTime: time, endTime: time + step, available: true });
      }
    }
    return {
      camera,
      after,
      before,
      segments,
      events: makeEvents(14, [camera]).filter(
        (event) => event.startTime > after && event.startTime < before,
      ),
    };
  },
  session: (): { userName: string | null; preferences: Preferences } => ({
    userName: null,
    preferences: {
      favorites: ["driveway", "front_door"],
      cameraOrder: [],
      gridDensity: "comfortable",
      previewRefresh: "normal",
      clock: "12h",
      defaultFilter: "all",
      timelineZoom: "1h",
    },
  }),
};
