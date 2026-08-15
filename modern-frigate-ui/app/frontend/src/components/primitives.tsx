import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-2xl ${className}`} />;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between px-4">
      <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{children}</h2>
      {action}
    </div>
  );
}

export function StatusDot({ state }: { state: "online" | "offline" | "detecting" }) {
  const color =
    state === "detecting"
      ? "bg-detect animate-pulse-dot"
      : state === "online"
        ? "bg-online"
        : "bg-subtle";
  return <span className={`inline-block size-2 rounded-full ${color}`} />;
}

export function Chip({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 shrink-0 rounded-pill px-4 text-[13px] font-medium transition-colors duration-200 ${
        active
          ? "bg-accent text-background"
          : "bg-surface text-muted active:bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}

export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
      />
      <div className="animate-sheet relative max-h-[82vh] w-full overflow-y-auto rounded-t-[28px] bg-surface pb-8 safe-bottom">
        <div className="sticky top-0 flex items-center justify-between bg-surface/95 px-5 pt-4 pb-3 backdrop-blur">
          <h3 className="text-base font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-full bg-surface-2 text-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-4 flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-10 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-surface-2 text-muted">
        {icon}
      </div>
      <p className="text-[15px] font-medium">{title}</p>
      {detail ? <p className="max-w-xs text-[13px] leading-relaxed text-subtle">{detail}</p> : null}
      {action}
    </div>
  );
}
