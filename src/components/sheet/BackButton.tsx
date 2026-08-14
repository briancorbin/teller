// The way back, drawn once.
//
// The character builder had a proper one — a round accent-bordered
// chevron you can hit with a thumb — and the store's detail view had a
// muted line of text saying "◂ the shelf". Same job, two looks, and the
// text one didn't read as a control at all on a screen it had just
// taken over (Brian, 2026-08-14).
//
// It takes an `accent` because the builder is themed per trade from a
// prop, while the sheet themes itself from `--sheet-accent` on its
// root. Omitting it falls back to the variable, so a caller inside the
// card gets the card's colour without passing anything.

export function BackButton({
  label,
  accent,
  className = '',
  onClick,
}: {
  /** What you're going back TO — the accessible name, and the text beside it. */
  label: string;
  /** Overrides the sheet's own accent, for surfaces themed by prop. */
  accent?: string;
  /** Positioning only; the button's own look is not the caller's business. */
  className?: string;
  onClick: () => void;
}) {
  const colour = accent ?? 'var(--sheet-accent, #f59e0b)';
  return (
    <button
      type="button"
      className={`group flex shrink-0 items-center gap-2 ${className}`}
      aria-label={label}
      onClick={onClick}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors"
        style={{
          borderColor: accent ? `${accent}66` : 'var(--sheet-accent, #f59e0b)',
          color: colour,
          // A tint rather than a fill: it has to read as a control
          // without competing with the thing it's a way back from.
          background: accent ? `${accent}14` : 'transparent',
        }}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M14.5 5.5 8 12l6.5 6.5" />
        </svg>
      </span>
      {/* The word rides along where there's room for it. `aria-label`
          already carries the name, so this is `aria-hidden` — otherwise
          a screen reader hears the destination twice. */}
      <span
        aria-hidden
        className="text-[0.7rem] uppercase tracking-widest text-stone-400 transition-colors group-hover:text-stone-100"
      >
        {label}
      </span>
    </button>
  );
}
