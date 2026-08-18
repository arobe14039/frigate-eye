import type { StreamKind } from "../../types";

/**
 * Which transport actually worked for a camera *during this page session*.
 *
 * Deliberately in-memory only: a Frigate/go2rtc configuration change must not
 * be shadowed by a stale protocol preference persisted on the device. A reload
 * re-evaluates from scratch.
 */
interface Entry {
  worked?: StreamKind;
  failed: Set<StreamKind>;
  at: number;
}

const memory = new Map<string, Entry>();
const key = (cameraId: string, quality: string) => `${cameraId}::${quality}`;

const entry = (cameraId: string, quality: string): Entry => {
  const existing = memory.get(key(cameraId, quality));
  if (existing) return existing;
  const created: Entry = { failed: new Set(), at: Date.now() };
  memory.set(key(cameraId, quality), created);
  return created;
};

export const rememberWorking = (cameraId: string, quality: string, kind: StreamKind) => {
  const record = entry(cameraId, quality);
  record.worked = kind;
  record.failed.delete(kind);
  record.at = Date.now();
};

export const rememberFailure = (cameraId: string, quality: string, kind: StreamKind) => {
  const record = entry(cameraId, quality);
  record.failed.add(kind);
  if (record.worked === kind) delete record.worked;
  record.at = Date.now();
};

export const knownWorking = (cameraId: string, quality: string): StreamKind | undefined =>
  memory.get(key(cameraId, quality))?.worked;

export const knownFailures = (cameraId: string, quality: string): StreamKind[] => [
  ...(memory.get(key(cameraId, quality))?.failed ?? []),
];

/** Called on app restart-like events (config change, manual retry). */
export const forgetStreamMemory = () => memory.clear();
