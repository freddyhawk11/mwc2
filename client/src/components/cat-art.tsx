// Decorative, background-only cat illustrations (aria-hidden, no pointer events).

export function SittingCat({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 200 250" className={className} style={style} aria-hidden fill="currentColor">
      {/* tail */}
      <path d="M138 236 C188 232 196 182 168 160" fill="none" stroke="currentColor" strokeWidth="15" strokeLinecap="round" />
      {/* body */}
      <path d="M58 240 C34 186 48 124 100 114 C152 124 166 186 142 240 Z" />
      {/* head */}
      <circle cx="100" cy="86" r="42" />
      {/* ears */}
      <path d="M62 66 L66 18 L96 46 Z" />
      <path d="M138 66 L134 18 L104 46 Z" />
    </svg>
  );
}

export function PeekingCat({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 120 60" className={className} style={style} aria-hidden>
      <g fill="currentColor">
        <path d="M22 38 L27 3 L50 24 Z" />
        <path d="M98 38 L93 3 L70 24 Z" />
        <path d="M12 60 C12 32 30 18 60 18 C90 18 108 32 108 60 Z" />
      </g>
      {/* eyes */}
      <g fill="hsl(var(--primary))" fillOpacity="0.55">
        <ellipse cx="44" cy="42" rx="4.2" ry="5.2" />
        <ellipse cx="76" cy="42" rx="4.2" ry="5.2" />
      </g>
      <path d="M57 50 L60 53 L63 50" fill="none" stroke="hsl(var(--primary))" strokeOpacity="0.4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Fixed page background: faint paw pattern + a sitting cat silhouette in the corner. */
export function CatBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 cat-bg-paws" />
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(120% 70% at 50% 0%, hsl(218 60% 16% / 0.9), transparent 70%)" }}
      />
      <SittingCat
        className="absolute -right-6 bottom-16 w-48 text-[hsl(216_45%_22%)] opacity-60"
      />
    </div>
  );
}
