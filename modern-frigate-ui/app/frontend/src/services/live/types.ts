import type { StreamKind, StreamQuality } from "../../types";

/**
 * Explicit lifecycle of the live view. The UI renders these states directly and
 * never surfaces raw browser/video errors.
 */
export type StreamState =
  | "idle"
  | "connecting"
  | "live"
  | "fallback"
  | "reconnecting"
  | "offline";

export interface LiveSnapshot {
  state: StreamState;
  /** Transport currently attached (null while idle). */
  kind: StreamKind | null;
  /** Safe, human-readable detail — never a URL or a credential. */
  detail?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  fallbackCount: number;
  reconnectCount: number;
}

/** Channel a provider uses to drive an <img>-based transport (MJPEG/preview). */
export interface ImageChannel {
  /** Point the rendered <img> at a path (already ingress-resolved by caller). */
  set(src: string | null): void;
  /** Resolves on the next successful load, rejects on the next error. */
  next(timeoutMs: number): Promise<void>;
}

export interface ProviderContext {
  cameraId: string;
  quality: StreamQuality;
  /** Ingress-relative backend path for this transport, quality applied. */
  path: string;
  /** Present for video transports; null when the viewer has no <video> yet. */
  video: HTMLVideoElement | null;
  image: ImageChannel;
  /** Aborted when the session is torn down (camera switch, close, unmount). */
  signal: AbortSignal;
  /** Called when the transport reports usable dimensions. */
  onDimensions(width: number, height: number): void;
  /** Called when a *running* stream dies, so the controller can recover. */
  onDrop(reason: string): void;
  log(message: string, extra?: Record<string, unknown>): void;
}

export interface LiveStreamSession {
  kind: StreamKind;
  stop(): void;
}

export interface LiveStreamProvider {
  readonly name: string;
  readonly kind: StreamKind;
  /** Connection budget — deliberately short so a dead transport never blocks the ladder. */
  readonly timeoutMs: number;
  /** Cheap, cached capability check. No network work. */
  supported(): boolean;
  /** Resolves once media is actually playing; rejects with a safe reason. */
  connect(context: ProviderContext): Promise<LiveStreamSession>;
}

export class ProviderError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ProviderError";
  }
}
