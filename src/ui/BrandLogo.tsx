/** Logo Kasir Konter: ponsel dengan tanda centang di kotak biru tua. */
export function BrandLogo({ size = 48 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Kasir Konter">
      <rect width="64" height="64" rx="16" fill="#1f3a5f" />
      <rect x="20" y="10" width="24" height="44" rx="5" fill="#f4f7fb" />
      <rect x="23.5" y="15" width="17" height="30" rx="2" fill="#1f3a5f" />
      <circle cx="32" cy="49.5" r="2" fill="#1f3a5f" />
      <path
        d="M26.5 30.5l4 4 7.5-8"
        fill="none"
        stroke="#f2b544"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
