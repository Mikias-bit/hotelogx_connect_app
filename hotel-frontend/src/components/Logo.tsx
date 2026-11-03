/** Hotelogx One symbol. `onDark` adds a faint inner edge so the tile stays visible on dark green surfaces. */
export function Logo({ size = 32, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#235748" />
      {onDark && <rect x=".5" y=".5" width="31" height="31" rx="8.5" stroke="#ffffff" strokeOpacity=".18" />}
      <path d="M10 8.5v15M22 8.5v15" stroke="#b8d0c6" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M10 16h12" stroke="#faf8f5" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="16" cy="16" r="3.1" fill="#235748" stroke="#faf8f5" strokeWidth="1.8" />
    </svg>
  );
}

/** "Hotelogx One" wordmark: serif name with "One" in italic pine. */
export function Wordmark({ className = "text-[16px]", onDark = false }: { className?: string; onDark?: boolean }) {
  return (
    <span className={`font-display leading-none font-semibold tracking-[-0.01em] whitespace-nowrap ${onDark ? "text-white" : "text-ink"} ${className}`}>
      Hotelogx
      <span className={`ml-[0.18em] font-normal italic ${onDark ? "text-pine-200" : "text-pine-500"}`}>One</span>
    </span>
  );
}
