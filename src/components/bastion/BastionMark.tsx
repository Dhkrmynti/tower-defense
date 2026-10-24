/** The fortress mark: a crenellated keep with a brass gun on top, flat cut. */
export function BastionMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="56" height="56" rx="10" fill="#1b2a24" />
      <path d="M14 48V26h6v-6h6v6h12v-6h6v6h6v22H14Z" fill="#b8b0a2" />
      <path d="M14 48V26h6v-6h6v6h12v-6h6v6h6v22" stroke="#070b08" strokeWidth="2.4" strokeLinejoin="round" />
      <rect x="28" y="36" width="8" height="12" fill="#070b08" />
      <circle cx="32" cy="22" r="6" fill="#f2b31f" stroke="#070b08" strokeWidth="2.4" />
      <rect x="31" y="8" width="2.8" height="10" fill="#f2b31f" stroke="#070b08" strokeWidth="1.6" />
      <path d="M8 56h48" stroke="#ff3b3b" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
