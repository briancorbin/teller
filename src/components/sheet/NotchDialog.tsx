import { useEffect, useRef, useState } from 'react';
import type { Deed } from '../../../worker/types';

// Cutting a notch.
//
// The player etches it, by hand, on purpose — nothing here fires on its
// own. teller never sees a shot: the dice are real and in someone's
// hand, there is no roll in the software to hang a tally on, and a
// weapon's kills therefore cannot be derived from combat. They can only
// be claimed. Which turns out to be the better mechanic anyway, because
// claiming one out loud is the part that makes Bill argue.
//
// What teller DOES know, it fills in: who is in the fight, where the
// fight is, and which round it is. So the common case is two taps —
// the thing you killed, then Cut — and every one of those prefills is a
// proposal a person types over (rule 1).
//
// **It overlays and never reflows**, the same bargain `InfoPopover`
// makes and for the same reason: a seat on mounted glass may not scroll,
// so a disclosure that grows the card pushes something off the bottom.

/** One thing that could take the notch — an entry in the turn order. */
export type Candidate = {
  /** The turn-order entry's own id. Ephemeral — for React keys only. */
  id: string;
  label: string;
  /**
   * The BLUEPRINT behind it, when the caller knows one, so a later
   * screen could count kinds ("nine coyotes"). Deliberately not the
   * turn-order entry's id and not the deployed character's: both are
   * cleared when the table is, and a deed that points at either would
   * be a reference to something that no longer exists — which is the
   * whole reason a deed is a snapshot (see `Deed`).
   */
  from?: string;
  /**
   * At zero on its first max-bearing counter. A HINT for ordering, never
   * a verdict: at Brian's table zero kills by default, but an important
   * NPC may be bleeding out instead, and either way it's the table's
   * ruling and not teller's. All this does is put the likely answer
   * nearest your thumb.
   */
  down?: boolean;
};

export function NotchDialog({
  noun = 'notch',
  candidates,
  where,
  round,
  mounted = false,
  onCut,
  onClose,
}: {
  /** The system's word for one of these (`growth.noun`), never teller's. */
  noun?: string;
  /**
   * Mounted glass, which decides what this is anchored TO — the one
   * question that decides everything else about glass (rule 6).
   *
   * Mounted never scrolls, so the screen it sits in is the size of the
   * glass and pinning to the screen's bottom pins it to something you
   * can see. HELD glass scrolls the whole card, so that same screen is
   * 1268px tall behind an 844px window and the same pin puts the
   * dialog 400px below the fold. There it's fixed to the window and
   * centred — which also means it never has to know the height of the
   * segmented bar it covers, the mistake that would otherwise creep
   * back in as a hardcoded offset.
   */
  mounted?: boolean;
  /** Who's in the fight. Empty is fine — you type the name yourself. */
  candidates: Candidate[];
  /** The active scene, when there is one. */
  where?: string;
  /** The round, when combat is running. */
  round?: number;
  onCut: (deed: Deed) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [what, setWhat] = useState('');
  const [note, setNote] = useState('');
  /** The blueprint behind a tapped candidate, carried onto the deed. */
  const [from, setFrom] = useState<string | undefined>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // `pointerdown`, not `click` — the button that opened this is still
    // under the finger, and a click listener catches its own opening.
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  // Likely answers first. Anything at zero floats up, and within each
  // group the turn order is left alone — it's the order on every other
  // screen in the room, and re-sorting it here would cost more than it
  // saves.
  const sorted = [...candidates].sort(
    (a, b) => Number(Boolean(b.down)) - Number(Boolean(a.down)),
  );

  const cut = () => {
    const trimmed = what.trim();
    if (!trimmed) return;
    onCut({
      // Not `crypto.randomUUID` — a LAN host is served over plain HTTP
      // and that is not a secure context, so it isn't there (rule 6).
      id: `ded_${Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')}`,
      what: trimmed,
      from,
      where,
      round,
      when: new Date().toISOString(),
      note: note.trim() || undefined,
    });
    onClose();
  };

  const field =
    'w-full shrink-0 rounded-md border border-stone-700 bg-stone-900/80 px-2 py-1.5 text-sm text-stone-100 placeholder:text-stone-600';

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`cut a ${noun}`}
      // No viewport cap on the held branch, deliberately. `max-h-[85dvh]`
      // was the obvious reach and it's the wrong tool twice: `dvh`
      // resolves against the real window, which under pretend-glass is
      // not the glass (and reads 0×0 in a hidden pane, collapsing this
      // to 26px) — so it would be a rule I could neither see nor test.
      // The dialog is already bounded by its own parts instead: a
      // header, a shelf that caps itself at 7.5rem, two inputs and a
      // button, which cannot exceed ~300px however long the fight is.
      // Bounded by construction beats bounded by measurement.
      className={`z-30 flex min-h-0 flex-col gap-2 rounded-md border bg-stone-950/97 p-3 shadow-xl backdrop-blur-sm ${
        mounted
          ? 'absolute inset-x-2 bottom-2 max-h-[92%]'
          : 'fixed inset-x-3 top-1/2 -translate-y-1/2'
      }`}
      style={{ borderColor: 'var(--sheet-accent, #f59e0b)' }}
    >
      <div className="flex shrink-0 items-baseline gap-2">
        <span
          className="font-serif text-sm font-bold uppercase tracking-wide"
          style={{ color: 'var(--sheet-accent, #f59e0b)' }}
        >
          cut a {noun}
        </span>
        {/* Where and when, stated rather than asked. Two more inputs
            would not fit a rail bar, and these are the two answers
            nobody has ever had to think about. */}
        {(where || round != null) && (
          <span className="min-w-0 break-words text-[0.65rem] uppercase tracking-widest text-stone-500">
            {[where, round != null ? `round ${round}` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="close"
          className="-my-1 ml-auto shrink-0 px-1.5 py-1 text-stone-500 transition-colors hover:text-stone-200"
        >
          ✕
        </button>
      </div>

      {/* Who's in the fight. A bounded shelf that may scroll DOWN — the
          allowance mounted touch glass got when the store's shelf
          proved genuinely unbounded (rule 6). The PAGE still doesn't
          move; this region does, inside its own edges. */}
      {/* The one part that GIVES when the dialog is capped. Everything
          else is `shrink-0`, so a fight big enough to overflow a rail
          panel costs foe list and never the Cut button — the control
          you came for does not move because the room got tight. */}
      {sorted.length > 0 && (
        <div className="flex min-h-0 max-h-[7.5rem] flex-wrap gap-1 overflow-y-auto">
          {sorted.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setWhat(c.label);
                setFrom(c.from);
              }}
              aria-pressed={what === c.label}
              className={`rounded-full border px-2 py-1 text-[0.7rem] transition-colors ${
                what === c.label
                  ? 'border-transparent text-stone-950'
                  : c.down
                    ? 'border-red-900 text-stone-200'
                    : 'border-stone-700 text-stone-400 hover:text-stone-100'
              }`}
              style={
                what === c.label
                  ? { background: 'var(--sheet-accent, #f59e0b)' }
                  : undefined
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <input
        className={field}
        value={what}
        onChange={(e) => {
          setWhat(e.target.value);
          // Typed over a tapped name: it isn't that blueprint any more,
          // and a stale pointer is worse than none.
          setFrom(undefined);
        }}
        placeholder={sorted.length ? 'or type it' : 'what'}
        aria-label="what"
      />
      <input
        className={field}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="how it went (optional)"
        aria-label="note"
      />

      <button
        type="button"
        onClick={cut}
        disabled={!what.trim()}
        className="h-9 shrink-0 rounded-md border-2 font-mono text-sm font-bold uppercase tracking-wider transition-colors active:bg-stone-800 disabled:opacity-35"
        style={{
          borderColor: 'var(--sheet-accent, #f59e0b)',
          color: 'var(--sheet-accent, #f59e0b)',
        }}
      >
        cut it
      </button>
    </div>
  );
}
