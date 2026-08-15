import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { useState } from "react";
import { Chip } from "../../components/primitives";
import { api, isDemoMode } from "../../services/api";
import type { Preferences } from "../../types";

const GITHUB_URL = "https://github.com/REPLACE_ME/modern-frigate-ui";

export function SettingsScreen({
  preferences,
  userName,
  onUpdate,
}: {
  preferences: Preferences;
  userName: string | null;
  onUpdate: (patch: Partial<Preferences>) => void;
}) {
  const status = useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: 60_000 });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const frigate = status.data?.frigate;
  const ha = status.data?.homeAssistant;

  return (
    <div className="pb-24">
      <header className="px-4 pt-4 pb-5 safe-top">
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight">Settings</h1>
        {userName ? <p className="mt-1 text-[13px] text-subtle">Signed in as {userName}</p> : null}
      </header>

      <Group title="Frigate">
        <Row
          label="Connection"
          value={
            <span className="flex items-center gap-1.5">
              {frigate?.connected ? (
                <CheckCircle2 className="size-4 text-online" />
              ) : (
                <XCircle className="size-4 text-live" />
              )}
              {frigate?.connected
                ? frigate.discoveredVia === "configured"
                  ? "Connected (configured URL)"
                  : "Connected (auto-discovered)"
                : "Not connected"}
            </span>
          }
        />
        <Row label="Version" value={frigate?.version ?? "—"} />
        <Row label="Cameras" value={String(frigate?.cameraCount ?? 0)} />
        <Row
          label="Detection"
          value={frigate?.detectorFps ? `${frigate.detectorFps.toFixed(1)} fps` : "—"}
        />
        <button
          type="button"
          disabled={testing}
          onClick={async () => {
            setTesting(true);
            const result = await api.testConnection();
            setTestResult(
              result.connected ? "Connection successful" : (result.error ?? "Could not reach Frigate"),
            );
            setTesting(false);
            void status.refetch();
          }}
          className="mt-3 h-11 w-full rounded-2xl bg-surface-2 text-[14px] font-medium"
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
        {testResult ? <p className="mt-2 text-[12.5px] text-subtle">{testResult}</p> : null}
        {isDemoMode() ? (
          <p className="mt-2 text-[12.5px] text-detect">
            Demo data is being shown because this backend is not reachable.
          </p>
        ) : null}
      </Group>

      <Group title="Interface">
        <Setting label="Camera grid">
          {(["comfortable", "compact"] as const).map((value) => (
            <Chip
              key={value}
              active={preferences.gridDensity === value}
              onClick={() => onUpdate({ gridDensity: value })}
            >
              {value === "comfortable" ? "Comfortable" : "Compact"}
            </Chip>
          ))}
        </Setting>
        <Setting label="Preview refresh">
          {(["off", "slow", "normal", "fast"] as const).map((value) => (
            <Chip
              key={value}
              active={preferences.previewRefresh === value}
              onClick={() => onUpdate({ previewRefresh: value })}
            >
              {value === "off" ? "Off" : value[0].toUpperCase() + value.slice(1)}
            </Chip>
          ))}
        </Setting>
        <Setting label="Clock">
          {(["12h", "24h"] as const).map((value) => (
            <Chip
              key={value}
              active={preferences.clock === value}
              onClick={() => onUpdate({ clock: value })}
            >
              {value}
            </Chip>
          ))}
        </Setting>
        <Setting label="Default timeline zoom">
          {(["15m", "1h", "6h", "24h"] as const).map((value) => (
            <Chip
              key={value}
              active={preferences.timelineZoom === value}
              onClick={() => onUpdate({ timelineZoom: value })}
            >
              {value}
            </Chip>
          ))}
        </Setting>
      </Group>

      <Group title="Diagnostics">
        <Row label="App version" value={status.data?.app.version ?? "—"} />
        <Row label="Backend" value={status.data ? "Running" : "Unreachable"} />
        <Row
          label="Home Assistant"
          value={
            ha?.connected ? `Connected${ha.version ? ` · ${ha.version}` : ""}` : "Not available"
          }
        />
        <Row label="Frigate" value={frigate?.connected ? "Connected" : "Disconnected"} />
      </Group>

      <Group title="About">
        <Row label="Modern Frigate UI" value={status.data?.app.version ?? "0.1.0"} />
        <Row label="License" value="MIT" />
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-surface-2 text-[14px] font-medium"
        >
          View on GitHub <ExternalLink className="size-4" />
        </a>
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 px-3">
      <h2 className="mb-2 px-1 text-[13px] font-semibold tracking-wide text-subtle uppercase">
        {title}
      </h2>
      <div className="rounded-card bg-surface px-4 py-2">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline/40 py-3 text-[14px] last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-hairline/40 py-3.5 last:border-0">
      <p className="mb-2.5 text-[14px] text-muted">{label}</p>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">{children}</div>
    </div>
  );
}
