export const config = {
  port: Number(process.env["PORT"] ?? 8099),
  host: "0.0.0.0",
  logLevel: (process.env["LOG_LEVEL"] ?? "info").replace("warning", "warn"),
  staticDir: process.env["STATIC_DIR"] ?? "../frontend/dist",
  dataDir: process.env["DATA_DIR"] ?? "/data",
  previewRefreshSeconds: Number(process.env["PREVIEW_REFRESH_SECONDS"] ?? 6),
  /** Optional user override from the add-on options. */
  configuredFrigateUrl: (process.env["FRIGATE_URL"] ?? "").trim() || null,
  version: "0.1.0",
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
