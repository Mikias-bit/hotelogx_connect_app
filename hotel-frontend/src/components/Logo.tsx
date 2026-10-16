export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#235748" />
      <path d="M10 8.5v15M22 8.5v15" stroke="#b8d0c6" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M10 16h12" stroke="#faf8f5" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="16" cy="16" r="3.1" fill="#235748" stroke="#faf8f5" strokeWidth="1.8" />
    </svg>
  );
}
