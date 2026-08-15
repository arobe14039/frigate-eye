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

export interface FrigateStatus {
  connected: boolean;
  version?: string;
  cameraCount?: number;
  detectorFps?: number;
  error?: string;
  discoveredVia?: "configured" | "auto" | null;
}
