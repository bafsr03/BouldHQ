import { ReactNode, useState } from 'react';
import { Icon } from '@/components/Common/Iconify/icons';
import type { GrowthTask } from '@shared/lib/growthBlueprints';

// Shared chrome for the Growth Engine board (/growth).
//
// The visual language is deliberately not the standard HeroUI card stack: mono
// uppercase phase tags, a spectral progress fill, and blocks that read as a
// build checklist rather than a dashboard. Colours come from theme tokens so it
// holds up in light mode; the gradient and the "done" green are the two fixed
// brand accents that stay constant across themes.

const SPECTRAL = 'linear-gradient(90deg,#4C7DFF 0%,#8A5CFF 45%,#E0529B 100%)';

export const MONO = 'font-mono text-[10px] uppercase tracking-[0.12em]';

/** Percentage helper that renders 0 rather than NaN for an empty list. */
export function pct(done: number, total: number): number {
  return total ? Math.round((done / total) * 100) : 0;
}

/**
 * The spectral progress bar. `size="lg"` is the page header; `size="sm"` is the
 * hairline under a block summary.
 */
export function RenderBar({ done, total, size = 'sm' }: { done: number; total: number; size?: 'sm' | 'lg' }) {
  const width = `${pct(done, total)}%`;
  if (size === 'lg') {
    return (
      <div className="h-2 rounded-full bg-default-200 overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width, backgroundImage: SPECTRAL }}
        />
      </div>
    );
  }
  return (
    <div className="h-[3px] bg-default-200">
      <div className="h-full transition-[width] duration-500 ease-out" style={{ width, backgroundImage: SPECTRAL }} />
    </div>
  );
}

/** "12 / 30" in the same mono as the phase tags. */
export function Count({ done, total, showPct = false }: { done: number; total: number; showPct?: boolean }) {
  return (
    <span className="font-mono text-[11px] text-default-500 whitespace-nowrap">
      {showPct && `${pct(done, total)}% · `}
      {done} / {total}
    </span>
  );
}

/**
 * One checkbox row. `busy` keeps the box interactive but visually pending while
 * the mutation is in flight — the parent already applied the change optimistically.
 */
export function TaskRow({
  task,
  checked,
  disabled = false,
  onToggle,
}: {
  task: GrowthTask;
  checked: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <label
      className={`flex gap-3 items-start px-3 py-2.5 rounded-lg transition-colors ${
        disabled ? 'opacity-60' : 'hover:bg-default-100 cursor-pointer'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-0.5 shrink-0 size-[18px] rounded-[5px] appearance-none border-[1.5px] border-default-400
                   grid place-content-center cursor-pointer transition-colors
                   checked:bg-[#5CD69A] checked:border-[#5CD69A]
                   after:content-[''] after:w-[9px] after:h-[5px] after:border-l-2 after:border-b-2
                   after:border-black/80 after:rotate-[-45deg] after:translate-x-px after:-translate-y-px
                   after:opacity-0 checked:after:opacity-100
                   focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2
                   disabled:cursor-not-allowed"
      />
      <span className="flex-1 min-w-0">
        <span className={`block text-sm font-medium ${checked ? 'line-through text-default-400' : ''}`}>
          {task.title}
        </span>
        {task.why && (
          <span className={`block text-[12.5px] mt-0.5 ${checked ? 'text-default-400' : 'text-default-500'}`}>
            {task.why}
          </span>
        )}
      </span>
    </label>
  );
}

/**
 * A collapsible section. Uncontrolled by design — open/closed state is local UI
 * chrome, not something worth persisting or round-tripping to the server.
 */
export function Collapsible({
  tag,
  title,
  meta,
  progress,
  defaultOpen = true,
  nested = false,
  children,
}: {
  tag?: string;
  title: ReactNode;
  meta?: ReactNode;
  progress?: { done: number; total: number };
  defaultOpen?: boolean;
  nested?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={`rounded-xl border border-divider overflow-hidden ${nested ? 'bg-default-50' : 'bg-content1'}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 text-left px-4 py-3.5 hover:bg-default-100 transition-colors"
      >
        {tag && <span className={`${MONO} text-default-500 whitespace-nowrap`}>{tag}</span>}
        <span className={`flex-1 min-w-0 font-semibold tracking-tight ${nested ? 'text-sm' : 'text-base'}`}>
          {title}
        </span>
        {meta}
        {progress && <Count done={progress.done} total={progress.total} />}
        <Icon
          icon="tabler:chevron-right"
          width={14}
          height={14}
          className={`text-default-400 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {progress && <RenderBar done={progress.done} total={progress.total} />}
      {open && <div className="pb-2 pt-1 px-1">{children}</div>}
    </div>
  );
}

/** The "you don't move past this until…" callout under a phase. */
export function StageGate({ label = 'Stage gate', children }: { label?: string; children: ReactNode }) {
  return (
    <div className="mx-3 mb-3 mt-1 px-3.5 py-2.5 rounded-r-lg border-l-2 border-primary bg-default-100">
      <span className={`${MONO} block text-foreground font-semibold mb-0.5`}>{label}</span>
      <span className="text-[12.5px] text-default-600">{children}</span>
    </div>
  );
}

/** A neutral explainer panel (budget floors, archetype modifiers). */
export function Note({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-divider px-4 py-3 text-[12.5px] text-default-600">
      <span className="font-semibold text-foreground">{heading}</span>{' '}
      {children}
    </div>
  );
}
