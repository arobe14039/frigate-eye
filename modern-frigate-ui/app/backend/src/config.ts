/**
 * Runtime configuration. Every value comes from the environment the add-on
 * entrypoint exports, so nothing has to be duplicated in source.
 */
const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const bool = (value: string | undefined, fallback: boolean) =>
  value === undefined || value === "" ? fallback : !/^(0|false|no|off)$/i.test(value);

/** Present only when the Supervisor started us, i.e. we run as an add-on. */
const supervised = Boolean(process.env["SUPERVISOR_TOKEN"]);

export const config = {
  port: num(process.env["PORT"], 8099),
  host: "0.0.0.0",
  logLevel: (process.env["LOG_LEVEL"] ?? "info").replace("warning", "warn"),
  staticDir: process.env["STATIC_DIR"] ?? "../frontend/dist",
  dataDir: process.env["DATA_DIR"] ?? "/data",
  previewRefreshSeconds: num(process.env["PREVIEW_REFRESH_SECONDS"], 6),
  /** Optional user override from the add-on options. */
  configuredFrigateUrl: (process.env["FRIGATE_URL"] ?? "").trim() || null,
  /**
   * Single source of truth for the version: injected at build/run time from the
   * add-on manifest. `0.0.0-dev` only ever appears in a local dev shell.
   */
  version: (process.env["BUILD_VERSION"] ?? "").trim() || "0.0.0-dev",
  /**
   * Ingress trust boundary. Enforced whenever the Supervisor is present; a
   * developer running `npm run dev` on a laptop is not behind Ingress.
   */
  enforceIngress: bool(process.env["ENFORCE_INGRESS"], supervised),
  supervised,
  /** Realtime detection polling interval for the fallback provider. */
  eventPollMs: num(process.env["EVENT_POLL_MS"], 5_000),
  /** Guard rail so a client cannot ask the NVR for a multi-day export. */
  maxExportSeconds: num(process.env["MAX_EXPORT_SECONDS"], 30 * 60),
  /** Longest timeline/recording range a client may request. */
  maxRangeSeconds: num(process.env["MAX_RANGE_SECONDS"], 24 * 60 * 60),
};

/**
 * Candidate internal hostnames for the Frigate add-on. Every candidate is
 * probed against `/api/version` before use — nothing is assumed.
 * These names are never returned to the browser.
 */
export const FRIGATE_CANDIDATES = [
  "http://ccab4aaf-frigate:5000",
  "http://ccab4aaf-frigate-fa:5000",
  "http://ccab4aaf-frigate-beta:5000",
  "http://a0d7b954-frigate:5000",
  "http://frigate:5000",
  "http://localhost:5000",
];
