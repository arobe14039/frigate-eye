import { Activity, Home, Settings, Video } from "lucide-react";
import type { TabKey } from "../types";

const TABS: Array<{ key: TabKey; label: string; Icon: typeof Home }> = [
  { key: "home", label: "Home", Icon: Home },
  { key: "activity", label: "Activity", Icon: Activity },
  { key: "cameras", label: "Cameras", Icon: Video },
  { key: "settings", label: "Settings", Icon: Settings },
];

export function BottomNav({
  active,
  onSelect,
}: {
  active: TabKey;
  onSelect: (tab: TabKey) => void;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline/60 bg-background/85 backdrop-blur-xl safe-bottom">
      <ul className="mx-auto flex max-w-2xl items-stretch">
        {TABS.map(({ key, label, Icon }) => {
          const selected = active === key;
          return (
            <li key={key} className="flex-1">
              <button
                type="button"
                onClick={() => onSelect(key)}
                aria-current={selected ? "page" : undefined}
                className={`flex h-[58px] w-full flex-col items-center justify-center gap-1 transition-colors duration-200 ${
                  selected ? "text-accent" : "text-subtle"
                }`}
              >
                <Icon className="size-[22px]" strokeWidth={selected ? 2.4 : 1.9} />
                <span className="text-[11px] font-medium tracking-tight">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
