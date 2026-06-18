// Shared login chrome used by both the staff /signin page and the brand-owner
// /owner/login page so the whole app shares one look:
//   • near-black background with a soft radial glow up top
//   • centered white "bould" wordmark + tagline
//   • a white card that sits as a bottom-sheet on mobile and floats centered
//     on desktop, with a small drag-handle cue
//
// Page-specific form fields are passed in as `children`. Use the exported
// `LoginField` / `LoginButton` primitives inside so the inputs/buttons match
// the mockup (warm cream inputs, black pill button).

import type { ReactNode } from 'react';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';

export function LoginShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative flex flex-col items-center bg-[#0a0a0a] overflow-hidden"
      style={{ minHeight: '100dvh' }}
    >
      {/* soft radial glow at the top, matching the mockup */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[55%]"
        style={{
          background:
            'radial-gradient(120% 80% at 50% -10%, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 35%, transparent 70%)',
        }}
      />

      {/* Wordmark + tagline */}
      <div className="relative flex-1 flex flex-col items-center justify-center gap-4 px-6 py-10 w-full">
        <img
          src={getBlinkoEndpoint('/bouldhq-logo.png')}
          alt="bould"
          className="h-12 sm:h-14 w-auto select-none"
          draggable={false}
        />
        <p className="text-zinc-400 text-sm text-center leading-snug max-w-[220px]">
          Pioneering the future of online shopping
        </p>
      </div>

      {/* Card: bottom-sheet on mobile, floating centered card on desktop */}
      <div className="relative w-full max-w-md">
        <div className="bg-white rounded-t-[28px] md:rounded-[28px] md:mb-10 md:mx-4 px-6 pt-5 pb-10 shadow-[0_-8px_40px_rgba(0,0,0,0.35)] md:shadow-2xl">
          <div className="mx-auto mb-6 h-1 w-10 rounded-full bg-zinc-200" />
          {children}
        </div>
      </div>
    </div>
  );
}

// Warm cream input with an uppercase tracked label, matching the mockup.
export function LoginField({
  label, type = 'text', value, onChange, autoComplete, placeholder, endContent, onEnter, name,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
  endContent?: ReactNode;
  onEnter?: () => void;
  name?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-semibold tracking-[0.12em] text-zinc-400 uppercase">
        {label}
      </label>
      <div className="relative">
        <input
          name={name}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter(); }}
          autoComplete={autoComplete}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={placeholder}
          className="w-full rounded-xl bg-[#f1efe9] px-4 py-3.5 text-zinc-900 placeholder:text-zinc-400 border border-transparent focus:outline-none focus:border-zinc-300 focus:bg-[#eceae3] transition-colors pr-11"
          style={{ fontSize: '16px' }}
        />
        {endContent && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">{endContent}</div>
        )}
      </div>
    </div>
  );
}

// Black pill "Sign In →" button.
export function LoginButton({
  children, onClick, type = 'button', loading, disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full rounded-xl bg-[#161616] text-white font-semibold py-4 text-[15px] transition-opacity hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
    >
      {loading ? (
        <span className="inline-block size-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
      ) : children}
    </button>
  );
}
