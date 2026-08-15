export interface Camera {
  id: string;
  name: string;
  displayName: string;
  online: boolean;
  detect?: { width: number; height: number; fps: number };
  audioEnabled?: boolean;
  recordEnabled?: boolean;
  zones?: string[];
  lastUpdated?: number;
}

export type StreamKind = "webrtc" | "mse" | "hls" | "mjpeg" | "preview";

export interface StreamOption {
  kind: StreamKind;
  path: string;
  label: string;
}

export interface CameraDetail extends Camera {
  streams: StreamOption[];
}

export interface DetectionEvent {
  id: string;
  camera: string;
  label: string;
  subLabel?: string;
  startTime: number;
  endTime?: number;
  score?: number;
  zones?: string[];
  hasSnapshot?: boolean;
  hasClip?: boolean;
  thumbnailUrl?: string;
  snapshotUrl?: string;
}

export interface RecordingSegment {
  camera: string;
  startTime: number;
  endTime: number;
  available: boolean;
  motion?: number;
  objects?: number;
}

export interface TimelineData {
  camera: string;
  after: number;
  before: number;
  segments: RecordingSegment[];
  events: DetectionEvent[];
}

export interface AppStatus {
  app: { version: string; previewRefreshSeconds: number };
  frigate: {
    connected: boolean;
    version?: string;
    cameraCount?: number;
    detectorFps?: number;
    discoveredVia?: "configured" | "auto" | null;
    error?: string;
  };
  homeAssistant: {
    available: boolean;
    connected: boolean;
    version?: string;
    locationName?: string;
  };
}

export interface Preferences {
  favorites: string[];
  cameraOrder: string[];
  gridDensity: "compact" | "comfortable";
  previewRefresh: "off" | "slow" | "normal" | "fast";
  clock: "12h" | "24h";
  defaultFilter: string;
  timelineZoom: "15m" | "1h" | "6h" | "24h";
}

export type TabKey = "home" | "activity" | "cameras" | "settings";

export interface PortCheck {
  label: string;
  port: number;
  required: boolean;
  ok: boolean;
  detail: string;
}

export interface Diagnostics {
  ports: PortCheck[];
  liveVia: "go2rtc-direct" | "frigate-proxy" | null;
  streamCount: number;
  go2rtcStreams: string[];
  cameraStreams: Array<{ camera: string; streamName: string; matched: boolean }>;
}
