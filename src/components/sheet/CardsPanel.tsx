import type { Counter } from '../../../worker/types';
import { isGauge } from '../counters/shared';
import { SheetPanel } from './SheetPanel';

// A counter drawn as a hand of playing cards — WiW's Ace-in-the-Hole
// tally: collect an ace per Ace rolled, and the sixth wins you the
// ability that shares the name.
//
// Generic on purpose (rule 2): this knows "a counter with a smallish
// max, drawn as cards", not the word "Ace" — the system asks for the
// face with `dials: { <counter>: 'cards' }`, exactly the way the
// revolver cylinder is asked for.
//
// The whole hand is dealt face-down up front — alternating blue and
// red backs (Brian, 2026-08-12) — and each point flips one card over.
// "Ace in the hole" is a stud-poker term (the hole card is the one
// dealt face down), so the last flip is the reveal: the spade turns,
// lifts above its neighbours, and the hand glows ready. Count at a
// glance stays honest: face-up cards are the count.
//
// Tapping the nth card proposes n, tapping the last face-up card takes
// it back — the ring's gesture, the tally's arithmetic: event-logged,
// undoable, and the console can type over it (rule 1).

/** Past this many cards a hand stops being a hand and becomes a deck. */
const CARDS_LIMIT = 8;

/** Whether this counter's shape suits a hand of cards. */
export function cardable(counter: Counter): boolean {
  return isGauge(counter) && counter.max! <= CARDS_LIMIT;
}

// Cycled for flavour; the hole card is always the spade, because if a
// hand of six aces is already impossible, it may as well end on the
// iconic one.
const SUITS = ['♥', '♣', '♦', '♠'] as const;
const RED = new Set(['♥', '♦']);
const HOLE_SUIT = '♠';

/** One face of a card, face-up: index in the corners, pip in the middle. */
function Face({ suit }: { suit: string }) {
  const ink = RED.has(suit) ? '#b91c1c' : '#1c1917';
  return (
    <span
      className="absolute inset-0 flex items-center justify-center rounded-md border border-stone-400 bg-[#f4efe4] [backface-visibility:hidden]"
      style={{ color: ink }}
    >
      <span className="absolute left-1 top-0.5 flex flex-col items-center text-[0.55rem] font-bold leading-tight">
        A<span className="text-[0.5rem] leading-none">{suit}</span>
      </span>
      <span className="text-xl leading-none">{suit}</span>
      <span className="absolute bottom-0.5 right-1 flex rotate-180 flex-col items-center text-[0.55rem] font-bold leading-tight">
        A<span className="text-[0.5rem] leading-none">{suit}</span>
      </span>
    </span>
  );
}

/**
 * A card back — the classic lattice, in a deck colour. Every undealt
 * card wears one (a hand is DEALT face down, not missing), alternating
 * blue and red down the row the way a drawer of decks does.
 */
const BACKS = ['#3b82f6', '#dc2626'];
function Back({ tint }: { tint: string }) {
  return (
    <span
      className="absolute inset-0 rounded-md border-2 [backface-visibility:hidden]"
      style={{
        borderColor: `color-mix(in srgb, ${tint} 60%, transparent)`,
        background: `repeating-linear-gradient(45deg, color-mix(in srgb, ${tint} 32%, transparent) 0 2px, transparent 2px 7px), repeating-linear-gradient(-45deg, color-mix(in srgb, ${tint} 32%, transparent) 0 2px, transparent 2px 7px)`,
        backgroundColor: '#1c1917',
      }}
    />
  );
}

export function CardsPanel({
  counter,
  note,
  onChange,
  fill = false,
}: {
  counter: Counter;
  note?: string;
  onChange: (next: Counter) => void;
  fill?: boolean;
}) {
  const max = counter.max!;
  const full = counter.current >= max;

  return (
    <SheetPanel title={counter.name} note={note} fill={fill}>
      <div className="flex min-h-0 flex-1 items-center justify-center py-1">
        <div className="flex items-end">
          {Array.from({ length: max }, (_, i) => {
            const hole = i === max - 1;
            const dealt = i < counter.current;
            // The fan: each card tilts a little further from the middle
            // and drops a little at the edges, the way a held hand
            // arcs. Derived from position, so four cards fan as well as
            // eight.
            const mid = (max - 1) / 2;
            const tilt = (i - mid) * 5;
            const drop = Math.abs(i - mid) * 4;
            const next = dealt && i === counter.current - 1 ? i : i + 1;
            return (
              <button
                key={i}
                type="button"
                aria-label={`set ${counter.name} to ${next}`}
                aria-pressed={dealt}
                onClick={() => onChange({ ...counter, current: next })}
                className={`relative h-[5.5rem] w-16 shrink-0 transition-transform duration-500 [transform-style:preserve-3d] ${
                  i > 0 ? '-ml-3' : ''
                }`}
                style={{
                  transform: `rotate(${tilt}deg) translateY(${drop}px) rotateY(${
                    dealt ? 0 : 180
                  }deg)`,
                  transformOrigin: 'bottom center',
                  // The reveal outranks the deal: a completed hand lifts
                  // its hole card above its neighbours' edges.
                  zIndex: hole && full ? max + 1 : i,
                  filter: full
                    ? 'drop-shadow(0 0 6px color-mix(in srgb, var(--sheet-accent, #f59e0b) 65%, transparent))'
                    : undefined,
                }}
              >
                <Face suit={hole ? HOLE_SUIT : SUITS[i % SUITS.length]} />
                {/* The face the flip shows while undealt — a back, so
                    the whole hand reads as dealt-and-waiting.
                    `backface-visibility` must sit on THIS wrapper —
                    it's the element in the button's 3D context, and
                    without `preserve-3d` of its own it flattens its
                    child, whose backface rule then protects nothing:
                    the back painted over the face at rotateY(0) and
                    every card looked forever undealt. */}
                <span
                  className="absolute inset-0 [backface-visibility:hidden]"
                  style={{ transform: 'rotateY(180deg)' }}
                >
                  <Back tint={BACKS[i % BACKS.length]} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </SheetPanel>
  );
}
