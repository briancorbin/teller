import { useCallback, useEffect, useState } from 'react';
import type {
  Campaign,
  Character,
  CharacterData,
  PackRecord,
  SystemTemplate,
} from '../../worker/types';
import { api } from '../lib/api';
import { useRuleLookup } from '../lib/rules';
import { useSession } from '../lib/use-session';
import { useWakeLock } from '../lib/use-wake-lock';
import {
  layoutOf,
  ownsFields,
  SEAT_LAYOUTS,
  type SeatLayout,
} from '../lib/seat-layouts';
import { ConnectionHint } from '../components/ConnectionHint';
import { COUNTER_VIEWS } from '../components/counters';
import { FitBox } from '../components/FitBox';
import { SEAT_SIZES, SizeFrame, type SeatSize } from '../components/SizeFrame';
import { TagSection } from '../components/TagSection';

// The player's card.
//
// Two rules govern everything here.
//
// **It never scrolls.** Not down, not sideways. A seat is a fixed piece
// of glass — a phone in a hand, a 1920×515 panel screwed to the table
// rail — and scrolling means the number you need is somewhere else at
// the moment you need it. So the card fits the screen: fluid grids
// first, and `FitBox` scaling as the backstop when a character has more
// counters than the glass has room for.
//
// **The arrangement is a question, not an answer.** Nobody knows what a
// seat should look like yet, so there are five and the player picks. See
// `src/lib/seat-layouts.ts`. The choice is stored on the DISPLAY, which
// means it survives a reload and — the actual point — the DM can see
// what each player chose.

export function SeatView({
  characterId,
  displayId,
  layout: assigned,
}: {
  characterId: string;
  /** This screen, so it can remember how it likes to look. */
  displayId?: string;
  layout?: string | null;
}) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [packs, setPacks] = useState<PackRecord[]>([]);
  const [error, setError] = useState('');
  const lookup = useRuleLookup(packs);
  const [template, setTemplate] = useState<SystemTemplate | null>(null);
  const [tally, setTally] = useState<Record<string, number>>({});
  const [picking, setPicking] = useState(false);
  /**
   * Render as some other device, to see how a layout lands on glass you
   * don't have in your hand. A viewing aid, so it's component state and
   * gone on reload — a player who wandered in and left it on "Rail"
   * shouldn't be stuck with a letterboxed card forever.
   */
  const [size, setSize] = useState<SeatSize>(null);
  const [sizing, setSizing] = useState(false);
  /** Optimistic, so tapping a layout is instant on a slow LAN. */
  const [layout, setLayout] = useState<SeatLayout>(layoutOf(assigned));

  useEffect(() => setLayout(layoutOf(assigned)), [assigned]);

  const refetch = useCallback(() => {
    api
      .seat(characterId)
      .then(({ character, campaign, packs }) => {
        setCharacter(character);
        setCampaign(campaign);
        setPacks(packs ?? []);
        setError('');
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, [characterId]);

  useEffect(refetch, [refetch]);

  // The dice belong to the system, and `/api/templates` is open — a seat
  // needs no key to learn what a die in this game looks like.
  useEffect(() => {
    if (!campaign) return;
    api
      .templates()
      .then((all) =>
        setTemplate(all.find((t) => t.system === campaign.system) ?? null),
      )
      .catch(() => setTemplate(null));
  }, [campaign?.system]); // eslint-disable-line react-hooks/exhaustive-deps

  useWakeLock();
  const { session, connected } = useSession(
    character?.campaignId ?? null,
    (id) => {
      if (id === characterId || id === 'campaign') refetch();
    },
  );

  const patch = (data: Partial<CharacterData>) => {
    if (!character) return;
    setCharacter({ ...character, data: { ...character.data, ...data } });
    api.patchCharacter(characterId, { data }).catch(() => refetch());
  };

  const chooseLayout = (next: SeatLayout) => {
    setLayout(next);
    setPicking(false);
    if (displayId) api.setLayout(displayId, next).catch(() => {});
  };

  if (error) {
    return (
      <main className="flex h-[100dvh] flex-col items-center justify-center gap-2 overflow-hidden p-8">
        <h1 className="font-serif text-3xl">teller</h1>
        <p className="text-red-400">{error}</p>
        <p className="text-sm text-stone-500">
          ask your {campaign?.data.vocabulary.gm ?? 'DM'} to point this screen
          at a character
        </p>
      </main>
    );
  }

  if (!character) {
    return <main className="p-8 text-stone-500">taking your seat…</main>;
  }

  const initiative = session?.initiative ?? [];
  const turn = session?.turn ?? null;
  const current = turn !== null ? initiative[turn] : null;
  const next =
    turn !== null && initiative.length > 0
      ? initiative[(turn + 1) % initiative.length]
      : null;
  const youreUp = current?.characterId === character.id;
  const onDeck = !youreUp && next?.characterId === character.id;

  /**
   * Rolling for turn order. The dice are real and in the player's hand —
   * this only takes the number off them, which is the part that
   * otherwise gets shouted across a table and written down twice.
   */
  const mine = initiative.find((e) => e.characterId === character.id);
  const takingRolls = Boolean(session?.rolling && mine);
  const submitRoll = (score: number) => {
    if (!mine) return;
    api
      .sessionOp(character.campaignId, { op: 'score', entryId: mine.id, score })
      .catch(() => {});
  };

  // Tapping faces beats typing a total: the arithmetic ("an Ace is two")
  // is the bit that gets miscounted, and it means teller never has to
  // know about bonuses — you applied them by picking up more dice.
  const dice = template?.dice;
  const faceList = dice
    ? [...new Set(Object.values(dice.faces).flat())].sort(
        (a, b) => (dice.values[b] ?? 0) - (dice.values[a] ?? 0),
      )
    : [];
  const tallyTotal = Object.entries(tally).reduce(
    (n, [face, count]) => n + (dice?.values[face] ?? 0) * count,
    0,
  );
  const tapped = Object.values(tally).reduce((n, c) => n + c, 0);
  const basePool = template?.initiative
    ? (character.data.fields.find((f) => f.key === template.initiative!.field)
        ?.value ?? '')
    : '';

  const Counters = COUNTER_VIEWS[layout];
  // Wide-and-short glass lays out in a row. Read from the frame when one
  // is forced, or the preview would keep answering for the real window
  // and a simulated rail would render as a phone.
  const wide = size
    ? size.w / size.h >= 1.3
    : typeof window !== 'undefined' &&
      window.innerWidth / window.innerHeight >= 1.3;
  const fields = character.data.fields.filter((f) => f.key !== 'description');

  return (
    <SizeFrame size={size}>
      <main
        className={`flex h-full w-full flex-col gap-2 overflow-hidden p-3 ${
          youreUp ? 'ring-4 ring-inset ring-amber-600' : ''
        }`}
      >
        <ConnectionHint connected={connected} />

        {/* Identity. Wraps rather than squeezes: in a nowrap row the title
            takes the width it wants and the neighbours get the remainder,
            which on a phone was about one character — so the campaign
            name rendered vertically, a letter per line. Nothing here may
            clip, so anything that doesn't fit moves to the next line. */}
        <header className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="min-w-0 break-words font-serif text-[clamp(1.25rem,4cqh,2rem)] leading-tight text-stone-100">
            {character.name}
          </h1>
          {youreUp && (
            <span className="shrink-0 animate-pulse rounded bg-amber-700 px-2 py-0.5 text-xs font-semibold text-stone-950">
              YOU'RE UP
            </span>
          )}
          {onDeck && (
            <span className="shrink-0 rounded bg-stone-800 px-2 py-0.5 text-xs text-amber-300">
              on deck
            </span>
          )}
          {/* Whole name or next line, never letter-by-letter. */}
          <span className="whitespace-nowrap text-xs text-stone-600">
            {campaign?.name}
          </span>
          {/* Kept together and pushed right, so the name wraps as a unit
              instead of colliding with them. */}
          <div className="ml-auto flex shrink-0 items-baseline gap-1">
            <button
              type="button"
              onClick={() => {
                setSizing(!sizing);
                setPicking(false);
              }}
              aria-expanded={sizing}
              className={`shrink-0 rounded-md px-2 py-1 text-xs transition-colors hover:bg-stone-800 hover:text-stone-300 ${
                size ? 'text-amber-400' : 'text-stone-600'
              }`}
              title="render as another device, to see how this lands"
            >
              ▭ {size ? size.name : 'Actual'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPicking(!picking);
                setSizing(false);
              }}
              aria-expanded={picking}
              className="shrink-0 rounded-md px-2 py-1 text-xs text-stone-600 transition-colors hover:bg-stone-800 hover:text-stone-300"
              title="how this card is arranged"
            >
              ▦ {SEAT_LAYOUTS.find((l) => l.id === layout)?.name}
            </button>
          </div>
        </header>

        {/* The picker is deliberately in the player's reach, not buried in
          the console: the whole point is that they try all five and tell
          you which one they liked. */}
        {picking && (
          <div className="flex shrink-0 flex-wrap gap-1.5 rounded-lg bg-stone-900 p-2">
            {SEAT_LAYOUTS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => chooseLayout(option.id)}
                aria-pressed={option.id === layout}
                className={`rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                  option.id === layout
                    ? 'bg-amber-700 text-stone-950'
                    : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                }`}
              >
                <span className="font-medium">{option.name}</span>
                <span
                  className={`ml-1.5 ${
                    option.id === layout ? 'text-stone-800' : 'text-stone-500'
                  }`}
                >
                  {option.blurb}
                </span>
              </button>
            ))}
          </div>
        )}

        {sizing && (
          <div className="flex shrink-0 flex-wrap gap-1.5 rounded-lg bg-stone-900 p-2">
            <button
              type="button"
              onClick={() => setSize(null)}
              aria-pressed={!size}
              className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                !size
                  ? 'bg-amber-700 text-stone-950'
                  : 'bg-stone-800 text-stone-300'
              }`}
            >
              Actual
            </button>
            {SEAT_SIZES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSize(option)}
                aria-pressed={size?.id === option.id}
                className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                  size?.id === option.id
                    ? 'bg-amber-700 text-stone-950'
                    : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                }`}
              >
                {option.name}
                <span
                  className={`ml-1.5 font-mono ${
                    size?.id === option.id ? 'text-stone-800' : 'text-stone-500'
                  }`}
                >
                  {option.w}×{option.h}
                </span>
              </button>
            ))}
          </div>
        )}

        {takingRolls && (
          <section className="shrink-0 rounded-lg bg-amber-950/40 p-2 ring-1 ring-amber-800">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-sm text-amber-200">
                Roll for turn order — tap each die you rolled.
              </p>
              {basePool && (
                <span className="font-mono text-[11px] text-stone-500">
                  sheet says {basePool} · roll any bonus dice too
                </span>
              )}
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {faceList.map((face) => (
                <button
                  key={face}
                  className="min-w-20 rounded-md bg-stone-800 px-3 py-2 text-left active:bg-stone-700"
                  aria-label={`add a ${face} — you have ${tally[face] ?? 0}`}
                  onClick={() =>
                    setTally((t) => ({ ...t, [face]: (t[face] ?? 0) + 1 }))
                  }
                >
                  <span className="font-mono text-lg text-stone-100">
                    {tally[face] ?? 0}
                  </span>
                  <span className="ml-1.5 text-xs text-stone-400">{face}</span>
                  <span className="ml-1 text-[10px] text-stone-600">
                    {(dice?.values[face] ?? 0) === 0
                      ? '·0'
                      : `·${dice?.values[face]}`}
                  </span>
                </button>
              ))}
              <span className="ml-1 font-mono text-2xl text-amber-300">
                {tallyTotal}
                <span className="ml-1 text-xs text-stone-500">
                  {dice?.unit ?? 'total'}
                </span>
              </span>
              <button
                className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-stone-950 disabled:opacity-40"
                disabled={!tapped}
                onClick={() => {
                  submitRoll(tallyTotal);
                  setTally({});
                }}
              >
                that's my roll
              </button>
              {tapped > 0 ? (
                <button
                  className="text-xs text-stone-500 underline-offset-2 hover:underline"
                  onClick={() => setTally({})}
                >
                  clear
                </button>
              ) : (
                // A blank roll is a real outcome, and tapping four Blanks to
                // say so would be silly.
                <button
                  className="text-xs text-stone-500 underline-offset-2 hover:underline"
                  onClick={() => submitRoll(0)}
                >
                  I rolled nothing
                </button>
              )}
              {typeof mine?.score === 'number' && (
                <span className="text-xs text-stone-400">
                  reported <span className="text-amber-300">{mine.score}</span>
                </span>
              )}
            </div>
          </section>
        )}

        {/* The body. A row when the glass is wider than it is tall — a rail
          panel or a desktop — and a column on a phone. Driven by aspect
          rather than a pixel breakpoint, because 1920×515 and 1024×600
          want the same treatment for the same reason. */}
        <div
          className={`flex min-h-0 flex-1 gap-2 ${wide ? 'flex-row' : 'flex-col'}`}
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            <FitBox className="min-h-0 flex-1">
              <Counters
                big
                counters={character.data.counters}
                fields={fields}
                dice={template?.dice}
                groups={template?.groups}
                accents={template?.accents}
                onChange={(counters) => patch({ counters })}
              />
            </FitBox>

            {/* Stats are reference, not controls — one dense strip.
                Skipped when the layout places them itself, or the same
                stats would appear twice on the card. */}
            {fields.length > 0 && !ownsFields(layout) && (
              <div className="flex shrink-0 flex-wrap gap-1">
                {fields.map((field) => (
                  <span
                    key={field.key}
                    className="rounded-md bg-stone-900 px-2 py-1 text-xs"
                  >
                    <span className="font-mono text-stone-100">
                      {field.value || '—'}
                    </span>
                    <span className="ml-1 uppercase tracking-wider text-stone-500">
                      {field.label}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className={`flex shrink-0 flex-col gap-2 ${wide ? 'w-56' : ''}`}>
            <TagSection
              tags={character.data.tags}
              label={campaign?.data.vocabulary.conditions ?? 'Conditions'}
              lookup={lookup}
              onChange={(tags) => patch({ tags })}
            />

            {initiative.length > 0 && (
              <div className="min-h-0">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-widest text-stone-500">
                    Turn order
                  </span>
                  {turn !== null && (
                    <span className="font-mono text-xs text-stone-600">
                      rd {session?.round}
                    </span>
                  )}
                </div>
                {/* Wraps rather than scrolls; FitBox catches a very long
                  fight. Yours is highlighted so you can find it without
                  reading every name. */}
                <ol className="flex flex-wrap gap-1">
                  {initiative.map((entry, index) => (
                    <li
                      key={entry.id}
                      className={`break-words rounded px-1.5 py-0.5 text-xs ${
                        index === turn
                          ? 'bg-amber-700 font-medium text-stone-950'
                          : entry.characterId === character.id
                            ? 'bg-stone-800 text-amber-200'
                            : 'bg-stone-900 text-stone-500'
                      }`}
                    >
                      {entry.label}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      </main>
    </SizeFrame>
  );
}
