import { useMemo, useState } from 'react';
import type {
  Character,
  RulesPack,
  SystemTemplate,
} from '../../worker/types';
import {
  applyGear,
  applyKeepsakes,
  applySkills,
  applyTrade,
  bundleGrantIds,
  creationOf,
  gimmeName,
  keepsakeOf,
  packArtUrl,
  skillLore,
  spreadTotal,
  withoutInstanced,
} from '../lib/creation';
import { SheetPanel } from './sheet/SheetPanel';
import { Glyph } from './sheet/glyphs';

// "What's yer trade?" — the rail builder (TEL-75).
//
// A seat pointed at a draft character renders THIS instead of the
// sheet: the book's saddle-up steps, one question per screen, sized
// for the strip and fine on a phone. Every tap writes ordinary
// fields/counters/items through the seat's own edit rights (rule 7 —
// the seat legitimately owns what it's building), and the last step
// clears the draft flag; after that this is a normal character and
// nothing remembers it was born guided (rule 1).
//
// The tier was the Warden's call at stamp time (a posse decision, not
// a player one) — it's derived here from the Prestige counter the
// stamp wrote, never asked again.

// Every step that offers a CHOICE now wears the sheet's own panel, so
// the plain bordered button these described survives only where a step
// still lists loose chips (keepsakes, the wallet's faces).
const off = 'border-stone-700 bg-stone-900';

/** Ids in first-seen order, each with how many times it appears. */
function counted(ids: string[]): { id: string; n: number }[] {
  const out: { id: string; n: number }[] = [];
  for (const id of ids) {
    const seen = out.find((x) => x.id === id);
    if (seen) seen.n += 1;
    else out.push({ id, n: 1 });
  }
  return out;
}

export function CreationBuilder({
  character,
  packs,
  template,
  vocabulary,
  onPatch,
  onName,
  strip = false,
}: {
  character: Character;
  packs: RulesPack[];
  template: SystemTemplate | null;
  /** The campaign's words — "Warden" beats "DM" on every prompt. */
  vocabulary?: { gm?: string };
  onPatch: (data: Partial<Character['data']>) => void;
  onName: (name: string) => void;
  strip?: boolean;
}) {
  const found = useMemo(() => creationOf(packs), [packs]);
  const trades = found?.trades ?? [];
  const creation = found?.creation ?? {};
  const data = character.data;

  const catalog = useMemo(
    () =>
      new Map(
        packs.flatMap((p) =>
          (p.catalog?.items ?? []).map((e) => [e.id, e] as const),
        ),
      ),
    [packs],
  );

  // What the stamp already decided: the tier, from the Prestige the
  // stamp wrote (each tier's prestige is unique in the table).
  const prestigeName = Array.isArray(creation.map?.prestige)
    ? creation.map!.prestige[0]
    : creation.map?.prestige;
  const prestige =
    data.counters.find((c) => c.name === prestigeName)?.current ?? 0;
  const tier =
    (creation.tiers ?? []).find((t) => t.prestige === prestige) ??
    (creation.tiers ?? [])[0];

  // Where the flow stands, derived from the data itself so a reload
  // resumes rather than restarts. Local index only moves forward from
  // there.
  const tradeLabel = creation.map?.trade;
  const tradeName = data.fields.find((f) => f.label === tradeLabel)?.value ?? '';
  const trade = trades.find((t) => t.name === tradeName);
  const derived = !trade ? 0 : 1;
  const [step, setStep] = useState(derived);
  const [confirming, setConfirming] = useState('');
  const [spread, setSpread] = useState<Record<string, string> | null>(null);
  const [eqPicks, setEqPicks] = useState<string[]>([]);
  // What the dice on the table came up, IN TAP ORDER — a list rather
  // than a per-face tally, so a slot knows which die it is and can
  // hand that one back.
  const [rolled, setRolled] = useState<string[]>([]);
  const [keeps, setKeeps] = useState<string[]>([]);
  // Null while picking from the drawer; a string once you've opened
  // the "of your own creation" the book allows.
  const [ownKeepsake, setOwnKeepsake] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');

  const gmWord = vocabulary?.gm ?? 'Warden';
  const budget = creation.skills;
  const skills = spread ?? trade?.skills ?? {};
  const spent = budget ? spreadTotal(skills, budget.die) : 0;
  /** Dice still in hand. The pool is the constraint the screen shows. */
  const left = budget ? budget.total - spent : 0;
  /** How many equipment packs this tier gets to choose. */
  const picks = tier?.packs ?? 1;
  /** Already sitting on the printed numbers — nothing for reset to do. */
  const atTradeSpread = Object.entries(trade?.skills ?? {}).every(
    ([label, pool]) => skills[label] === pool,
  );
  /** The keepsakes the pack prints — anything else you wrote yourself. */
  const offered = useMemo(
    () =>
      new Set((creation.keepsakes ?? []).map((k) => keepsakeOf(k).text)),
    [creation],
  );
  // What the book says each skill is FOR. Keyed off the trade's own
  // spread, so the labels asked about are the ones this sheet has.
  const skillText = useMemo(
    () => skillLore(packs, Object.keys(trade?.skills ?? skills)),
    [packs, trade, skills],
  );

  // The wallet roll: only a fresh Tenderfoot rolls; the faces are the
  // system's dice, the prices are the pack's.
  const rollsWallet = Boolean(creation.wallet) && (tier?.prestige ?? 0) === 0;
  const faces = Object.keys(template?.dice?.values ?? {});
  /** How many dice the roll calls for — "6B" is six of them. */
  const dice = parseInt(creation.wallet?.roll ?? '', 10) || 0;
  const walletTotal = rolled.reduce(
    (sum, face) => sum + (creation.wallet?.values[face] ?? 0),
    0,
  );

  // No ability-pick step, deliberately: the printed sheet presets the
  // trade's FIRST ability (only slot with no Prestige tag) and AitH 1.
  // Choosing abilities is what SPENDING Prestige is for (4 apiece, the
  // menu already prices it) — a higher-tier posse shops after creation.
  const steps = [
    'trade',
    'skills',
    'gear',
    ...(rollsWallet ? ['wallet'] : []),
    ...(creation.keepsakes?.length ? ['keepsake'] : []),
    'name',
    'done',
  ];
  const here = steps[Math.min(step, steps.length - 1)];
  const next = () => setStep((s) => Math.min(s + 1, steps.length - 1));

  // The question lives in the SAME header bar the finished sheet wears
  // (Brian, 2026-08-13) — and the bar fills in as the character does:
  // once a trade is chosen its plate and colour appear beside the next
  // question, so creation visibly becomes the sheet it's building.
  const QUESTIONS: Record<string, string> = {
    trade: "What's yer trade?",
    skills: 'Spread yer skills',
    gear: 'Grab yer gear',
    wallet: 'Roll yer wallet',
    keepsake: 'A keepsake or two',
    name: 'What do they call ya?',
    done: 'Welcome to the posse',
  };
  // The caption under the question — the same italic instruction line
  // every sheet panel prints beneath its heading.
  const CAPTIONS: Record<string, string | undefined> = {
    trade: 'tap one to read it — this is who you are at the table',
    skills: budget
      ? `${budget.total} ${budget.die} dice total, ${budget.min}–${budget.max} each — the ${trade?.name ?? 'trade'}'s usual spread is dealt already`
      : 'the trade set these — adjust if your table allows',
    gear: `pick ${tier?.packs ?? 1} equipment pack${(tier?.packs ?? 1) > 1 ? 's' : ''} — your starting arms are already in your inventory`,
    wallet: creation.wallet
      ? `roll ${creation.wallet.roll} — real dice, on the table — then tap what you rolled`
      : undefined,
    keepsake: 'what rides in your pocket from the life before — pick up to two, or none',
    name: undefined,
    done: undefined,
  };
  const accent = trade ? template?.accents?.[trade.name] : undefined;

  // The trades still PAN — there are seven of them, one expands to
  // twice its width, and reading them one at a time is the point. The
  // steps that offer a handful of alternatives divide the glass
  // instead; each says so where it lays itself out.
  const shelf = (children: React.ReactNode) => (
    <div
      className={`flex min-h-0 flex-1 gap-2 ${
        strip
          ? 'snap-x snap-mandatory flex-nowrap items-stretch overflow-x-auto overflow-y-hidden'
          : 'flex-wrap content-start overflow-y-auto'
      }`}
    >
      {children}
    </div>
  );

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-2 p-1">
      {/* The screen's question, worn the way the finished sheet wears
          its header: the same bordered bar, the same ruled hairlines,
          the plate treatment — but the QUESTION is the plate, centered
          and large, for the whole flow. The bar tints to the trade's
          colour the moment one is chosen. */}
      <div
        className="relative flex shrink-0 items-center gap-2.5 rounded-md border py-1.5 pl-14 pr-14"
        style={{ borderColor: `${accent ?? '#f59e0b'}66` }}
      >
        {/* Walking back is free: every step's commit REPLACES what it
            wrote (abilities swap with the trade, bundles swap on
            re-pack, the keepsakes line rewrites), so second thoughts
            never double up. The bar reserves its gutter whether or not
            the button is there, so the rules never run under it. */}
        {step > 0 && (
          <button
            className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border transition-colors"
            style={{
              borderColor: `${accent ?? '#f59e0b'}66`,
              color: accent ?? '#f59e0b',
              background: `${accent ?? '#f59e0b'}14`,
            }}
            aria-label="back a step"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.5 5.5 8 12l6.5 6.5" />
            </svg>
          </button>
        )}
        <span
          className="h-px flex-1"
          style={{ background: `${accent ?? '#f59e0b'}55` }}
        />
        {/* The rules flank the whole block — question AND caption — so
            the bar reads as one centered plate rather than a ruled
            title with a line of small print hung underneath. */}
        <div className="flex flex-col items-center">
          <span
            className="whitespace-nowrap font-serif text-[1.25rem] font-bold uppercase leading-tight tracking-[0.12em]"
            style={{ color: accent ?? '#f59e0b' }}
          >
            {QUESTIONS[here]}
          </span>
          {CAPTIONS[here] && (
            <p className="font-serif text-[0.7rem] italic leading-tight text-stone-500">
              {CAPTIONS[here]}
            </p>
          )}
        </div>
        <span
          className="h-px flex-1"
          style={{ background: `${accent ?? '#f59e0b'}55` }}
        />
      </div>
      {here === 'trade' && (
        <>
          {shelf(
            trades.map((t) => {
              const open = confirming === t.id;
              // Each card wears its own trade's accent — the same
              // colour the finished sheet will be tinted with, pulled
              // from the template's declared accents (the card IS a
              // preview of the sheet you're choosing).
              const accent = template?.accents?.[t.name];
              return (
                <button
                  key={t.id}
                  // Tapped, the card GROWS — width, not a modal — and
                  // shoulders the other trades aside to make room for
                  // the book's fuller portrait of the life.
                  className={`flex flex-col text-left ${
                    strip
                      ? `${open ? 'w-[38rem]' : 'w-[19rem]'} shrink-0 snap-start self-stretch transition-[width] duration-300`
                      : 'w-full'
                  }`}
                  style={
                    accent
                      ? ({ '--sheet-accent': accent } as React.CSSProperties)
                      : undefined
                  }
                  onClick={() => setConfirming(open ? '' : t.id)}
                >
                  <SheetPanel
                    title={t.name}
                    note={t.tagline}
                    fill
                    className={
                      open ? 'border-[color:var(--sheet-accent)]' : ''
                    }
                  >
                    <span
                      className={`flex min-h-0 flex-1 gap-3 pt-1 ${
                        open && strip ? 'flex-row' : 'flex-col'
                      }`}
                    >
                      {/* The trade's portrait. Collapsed: a head-and-
                          shoulders crop filling the card's middle.
                          Expanded on the strip: the whole figure docks
                          left at full height and the words flow beside
                          it. A soft accent glow sits behind either way
                          — it flatters the cutouts and swallows any
                          keying residue. */}
                      {t.art && (
                        <span
                          className={`relative block shrink-0 overflow-hidden ${
                            open && strip
                              ? 'h-full w-[13rem] self-stretch'
                              : 'min-h-0 w-full flex-1'
                          }`}
                          style={{
                            background: accent
                              ? `radial-gradient(ellipse 60% 50% at 50% 45%, ${accent}1f, transparent 75%)`
                              : undefined,
                          }}
                        >
                          <img
                            src={packArtUrl(t.art, found?.version ?? 0)}
                            alt=""
                            draggable={false}
                            className={`h-full w-full ${
                              open && strip
                                ? 'object-contain object-bottom'
                                : 'object-cover object-top'
                            }`}
                          />
                        </span>
                      )}
                      <span className="flex min-h-0 flex-1 flex-col gap-1.5">
                  {/* The top of the card is reserved space: the trade's
                      portrait lands here when the art pipeline exists
                      (TEL-83). Until then, the book's introduction
                      carries the card — no stat spread; the numbers
                      have their own screen next, and a card sells a
                      LIFE, not a statline. */}
                  {t.text && (
                    <span className="font-serif text-sm italic leading-snug text-stone-300">
                      {t.text}
                    </span>
                  )}
                  {open && (
                    <>
                      {/* The fuller portrait of the life, from the pack. */}
                      {t.overview && (
                        <span className="mt-1 border-t border-stone-800 pt-2 text-xs leading-relaxed text-stone-400">
                          {t.overview}
                        </span>
                      )}
                      {/* What you START with — the sheet's preset: the
                          first ability and AitH 1. The rest are named
                          so the choice of trade is informed, and they
                          unlock with Prestige (4 apiece, per the book's
                          own cost table). */}
                      <span className="mt-1 text-xs text-stone-300">
                        starts with{' '}
                        {[t.abilities?.[0], t.aceInTheHole?.[0]]
                          .map((id) => (id ? catalog.get(id)?.name : null))
                          .filter(Boolean)
                          .join(' + ')}
                      </span>
                      <span className="text-[10px] text-stone-500">
                        later, with Prestige:{' '}
                        {(t.abilities ?? [])
                          .slice(1)
                          .map((id) => catalog.get(id)?.name)
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <span
                        className="mt-1 rounded-md px-3 py-2 text-center text-sm font-semibold text-stone-950"
                        style={{ background: 'var(--sheet-accent, #f59e0b)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          // Trade + its preset abilities in one write —
                          // dropping any OTHER trade's abilities first,
                          // so backing up and switching trades swaps
                          // cleanly instead of accumulating.
                          onPatch(
                            applyGear(
                              applyTrade(
                                withoutInstanced(data, { kinds: ['ability'] }),
                                t,
                                creation,
                              ),
                              packs,
                              [t.abilities?.[0], t.aceInTheHole?.[0]].filter(
                                (x): x is string => Boolean(x),
                              ),
                            ),
                          );
                          setSpread(null);
                          setConfirming('');
                          setStep(1);
                        }}
                      >
                        this is me
                      </span>
                    </>
                  )}
                      </span>
                    </span>
                  </SheetPanel>
                </button>
              );
            }),
          )}
        </>
      )}

      {here === 'skills' && trade && (
        <div
          className="flex min-h-0 flex-1 flex-col gap-2"
          style={
            (accent ? { '--sheet-accent': accent } : {}) as React.CSSProperties
          }
        >
          {/* Not the shelf. There are exactly as many skills as the
              sheet has, they all matter equally, and nothing here is
              worth panning past — so they divide the glass evenly
              instead of queueing at 19rem apiece and leaving a third
              of the bar empty. Columns come from the COUNT, so a
              system with three skills or five still fills its width. */}
          <div
            className={
              strip
                ? 'grid min-h-0 flex-1 gap-2'
                : 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto'
            }
            style={
              strip
                ? {
                    gridTemplateColumns: `repeat(${
                      Object.keys(skills).length || 1
                    }, minmax(0, 1fr))`,
                  }
                : undefined
            }
          >
            {Object.entries(skills).map(([label, pool]) => {
              const lore = skillText.get(label.toLowerCase());
              const glyph = template?.icons?.[label];
              return (
                <SheetPanel
                  key={label}
                  title={label}
                  // The sheet's instruction line, and the pack fills
                  // it — this is the book talking about the skill, so
                  // it lives in the pack and never in here (rule 4).
                  note={lore?.text}
                  fill
                  className={off}
                >
                  <div className="flex min-h-0 flex-1 flex-col items-center gap-2">
                    {/* The mark takes the whole gap between the book's
                        words and the dice, and centres in it — so it
                        reads as the panel's face rather than a bullet
                        point that wandered into the middle. */}
                    {glyph && (
                      <span className="flex min-h-0 flex-1 items-center justify-center py-1">
                        <Glyph
                          name={glyph}
                          className="h-24 w-24 text-[color:var(--sheet-accent,#f59e0b)]"
                        />
                      </span>
                    )}
                    {/* What the book says you DO with it — four verbs,
                        set like the sheet's own small print. */}
                    {lore?.meta && (
                      <span className="text-center text-[0.65rem] uppercase tracking-[0.18em] text-stone-500">
                        {lore.meta}
                      </span>
                    )}
                    <div className="flex items-center gap-3">
                      {/* Functional updates, both: two taps inside one
                          frame must BOTH count — a drummed finger on the
                          bar would otherwise lose a die. */}
                      <button
                        className="h-12 min-w-12 rounded-lg bg-stone-800 text-2xl active:bg-amber-700"
                        aria-label={`fewer ${label} dice`}
                        onClick={() => {
                          if (!budget) return;
                          setSpread((prev) => {
                            const cur = prev ?? trade?.skills ?? {};
                            const n = parseInt(cur[label] ?? '0', 10) || 0;
                            const v = Math.max(budget.min, n - 1);
                            return { ...cur, [label]: `${v}${budget.die}` };
                          });
                        }}
                      >
                        −
                      </button>
                      <span className="font-mono text-2xl text-stone-100">
                        {pool}
                      </span>
                      <button
                        className="h-12 min-w-12 rounded-lg bg-stone-800 text-2xl active:bg-amber-700 disabled:bg-stone-900 disabled:text-stone-700"
                        aria-label={`more ${label} dice`}
                        // Nothing to deal means nothing to add, and the
                        // button that would break the pool isn't live.
                        disabled={left === 0}
                        onClick={() => {
                          if (!budget) return;
                          setSpread((prev) => {
                            const cur = prev ?? trade?.skills ?? {};
                            // The pool check reads CUR, not the `left`
                            // this handler closed over. A drummed
                            // finger fires several taps inside one
                            // frame, and every one of them sees the
                            // same stale `left` — which is how twelve
                            // rapid taps spent thirteen dice and left
                            // the footer reading "-1 to place".
                            const used = spreadTotal(cur, budget.die);
                            const n = parseInt(cur[label] ?? '0', 10) || 0;
                            if (used >= budget.total || n >= budget.max) {
                              return cur;
                            }
                            return { ...cur, [label]: `${n + 1}${budget.die}` };
                          });
                        }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </SheetPanel>
              );
            })}
          </div>
          {/* The pool as a bar that FILLS. "12/12 dice used" asks you
              to do the arithmetic; twelve dice lighting up as they land
              on skills IS the arithmetic, and the row is only full when
              the spread is legal — which is the same moment the button
              unlocks, so there's one thing to look at, not two. */}
          <div className="flex shrink-0 items-center justify-center gap-4">
            {/* Back to what the trade deals. `spread` is an OVERRIDE
                over `trade.skills`, so clearing it is the whole reset
                — there's no second copy of the printed numbers to
                drift from the one the trade already carries. Dead
                while it IS the printed spread, so it never looks like
                a button that does nothing. */}
            <button
              className="rounded-md border px-3 py-2 text-xs uppercase tracking-widest transition-colors disabled:opacity-30"
              style={{
                borderColor: `${accent ?? '#f59e0b'}66`,
                color: accent ?? '#f59e0b',
              }}
              disabled={!spread || atTradeSpread}
              onClick={() => setSpread(null)}
            >
              the {trade.name}'s spread
            </button>
            {budget && (
              <div
                className="flex items-center gap-1.5"
                title={`${left} to place`}
              >
                {Array.from({ length: budget.total }, (_, i) => (
                  <Glyph
                    key={i}
                    // WHICH mark the pool wears is the system's call,
                    // keyed by the die's own name — WiW spends bullets,
                    // and a system that spends dice says so instead of
                    // inheriting a cowboy's ammunition (rule 2).
                    name={template?.icons?.[budget.die] ?? 'die'}
                    className={`h-9 w-9 transition-colors ${
                      i < spent
                        ? 'text-[color:var(--sheet-accent,#f59e0b)]'
                        : 'text-stone-800'
                    }`}
                  />
                ))}
              </div>
            )}
            {/* Dealt out exactly, or you don't leave. The spread is a
                fixed budget, not a suggestion — and the trade deals a
                legal one, so this only ever locks mid-rearrange. */}
            <button
              className="rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:bg-stone-800 disabled:text-stone-600"
              style={
                left === 0
                  ? { background: accent ?? '#f59e0b', color: '#1c1917' }
                  : undefined
              }
              disabled={left !== 0}
              onClick={() => {
                onPatch(applySkills(data, skills));
                next();
              }}
            >
              {left === 0 ? "that's my spread" : `${left} to place`}
            </button>
          </div>
        </div>
      )}

      {here === 'gear' && (
        <div
          className="flex min-h-0 flex-1 flex-col gap-2"
          style={
            (accent ? { '--sheet-accent': accent } : {}) as React.CSSProperties
          }
        >
          {/* Same shape as the skills: the choices divide the glass
              evenly, because they're alternatives to weigh side by
              side rather than a list to pan through. */}
          <div
            className={
              strip
                ? 'grid min-h-0 flex-1 gap-2'
                : 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto'
            }
            style={
              strip
                ? {
                    gridTemplateColumns: `repeat(${
                      (creation.equipmentPacks ?? []).length || 1
                    }, minmax(0, 1fr))`,
                  }
                : undefined
            }
          >
            {(creation.equipmentPacks ?? []).map((id) => {
              const p = catalog.get(id);
              if (!p) return null;
              const picked = eqPicks.includes(id);
              return (
                <button
                  key={id}
                  className="flex text-left"
                  onClick={() =>
                    setEqPicks(
                      picked
                        ? eqPicks.filter((x) => x !== id)
                        : [...eqPicks, id].slice(-(tier?.packs ?? 1)),
                    )
                  }
                >
                  <SheetPanel
                    title={p.name}
                    fill
                    className={`w-full transition-colors ${
                      picked
                        ? 'border-[color:var(--sheet-accent)]'
                        : `${off} opacity-60`
                    }`}
                    style={
                      picked
                        ? { background: `${accent ?? '#f59e0b'}14` }
                        : undefined
                    }
                  >
                    <div className="flex min-h-0 flex-1 flex-col items-center">
                      {/* Mark up top with the list right under it —
                          NOT the skills' even-spacing treatment. There
                          the mark is the panel's face with one line
                          beneath; here the list is the content, and
                          spreading a nine-item list to the far edge
                          reads as two unrelated blocks. */}
                      {p.icon && (
                        <span className="mb-2 flex shrink-0 items-center justify-center">
                          <Glyph
                            name={p.icon}
                            className={`h-24 w-24 transition-colors ${
                              picked
                                ? 'text-[color:var(--sheet-accent,#f59e0b)]'
                                : 'text-stone-500'
                            }`}
                          />
                        </span>
                      )}
                      {/* What's actually IN it, itemised. A bundle
                          unpacks into the inventory (rule 4a), so the
                          card that offers it should show the same
                          list the sheet will end up carrying — not
                          one word you have to take on trust. */}
                      <ul className="flex min-h-0 w-full flex-col items-center gap-px overflow-hidden font-serif text-[0.72rem] leading-tight text-stone-400">
                        {/* Repeats COUNT rather than repeat. A bundle
                            lists an id twice to grant two, and two
                            Pain Pills is what lands — but printing the
                            line twice reads as a mistake, and the book
                            writes "2x Pain Pills" for the same reason.
                            The list is what you're getting; the
                            inventory still carries them separately,
                            because you spend one at a time. */}
                        {counted(p.contents ?? []).map(({ id: cid, n }) => (
                          <li key={cid}>
                            {catalog.get(cid)?.name ?? cid}
                            {n > 1 && (
                              <span className="text-stone-500"> ×{n}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {/* The commit lives in the card you chose, the
                          way the trade's does — you point at a thing
                          and then agree to it, instead of pointing at
                          a thing and reaching somewhere else. It waits
                          for the LAST pick, so a tier with two slots
                          still gets one button and not two.
                          ALWAYS rendered, merely hidden: appearing
                          from nothing would shove the mark and the
                          list up the card at the exact moment you're
                          reading them to decide. It holds its own
                          space so choosing changes only colour. */}
                      <span
                        aria-hidden={!(picked && eqPicks.length === picks)}
                        className={`mt-auto w-full rounded-md px-3 py-2 text-center text-sm font-semibold text-stone-950 ${
                          picked && eqPicks.length === picks
                            ? ''
                            : 'invisible pointer-events-none'
                        }`}
                        style={{ background: 'var(--sheet-accent, #f59e0b)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!(picked && eqPicks.length === picks)) return;
                          // Swap, don't stack: drop anything a
                          // previous pass's bundles unpacked before
                          // granting this pass's picks.
                          onPatch(
                            applyGear(
                              withoutInstanced(data, {
                                from: bundleGrantIds(
                                  packs,
                                  creation.equipmentPacks ?? [],
                                ),
                              }),
                              packs,
                              eqPicks,
                            ),
                          );
                          next();
                        }}
                      >
                        grab yer pack
                      </span>
                    </div>
                  </SheetPanel>
                </button>
              );
            })}
          </div>
          {/* Only when there's more than one slot to fill. With the
              usual single pick the card carries the whole decision,
              and a bar counting to one is furniture. */}
          {picks > 1 && (
            <div className="flex shrink-0 items-center justify-center gap-1.5">
              {Array.from({ length: picks }, (_, i) => (
                <Glyph
                  key={i}
                  name="satchel"
                  className={`h-8 w-8 transition-colors ${
                    i < eqPicks.length
                      ? 'text-[color:var(--sheet-accent,#f59e0b)]'
                      : 'text-stone-800'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {here === 'wallet' && (
        <div
          className="flex min-h-0 flex-1 flex-col gap-2"
          style={
            (accent ? { '--sheet-accent': accent } : {}) as React.CSSProperties
          }
        >
          {/* The dice are on the TABLE — this screen only asks what
              they came up. One panel per face, tapped once per die,
              with what that face is worth printed where the skills put
              their verbs. */}
          <div
            className={
              strip
                ? 'grid min-h-0 flex-1 gap-2'
                : 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto'
            }
            style={
              strip
                ? {
                    gridTemplateColumns: `repeat(${faces.length || 1}, minmax(0, 1fr))`,
                  }
                : undefined
            }
          >
            {faces.map((face) => {
              const worth = creation.wallet!.values[face] ?? 0;
              const mine = rolled.filter((f) => f === face).length;
              return (
                <button
                  key={face}
                  className="flex text-left disabled:opacity-40"
                  aria-label={`add a ${face}`}
                  disabled={rolled.length >= dice}
                  onClick={() => setRolled((r) => [...r, face].slice(0, dice))}
                >
                  <SheetPanel title={face} fill className={`w-full ${off}`}>
                    <div className="flex min-h-0 flex-1 flex-col items-center">
                      <span className="mb-2 flex shrink-0 items-center justify-center">
                        <Glyph
                          name={template?.icons?.[face] ?? face}
                          className={`h-24 w-24 ${
                            worth
                              ? 'text-[color:var(--sheet-accent,#f59e0b)]'
                              : 'text-stone-600'
                          }`}
                        />
                      </span>
                      <span className="font-serif text-[0.8rem] italic text-stone-400">
                        {worth ? `worth $${worth}` : 'worth nothing'}
                      </span>
                      <span className="mt-auto font-mono text-2xl text-stone-100">
                        {mine}
                      </span>
                    </div>
                  </SheetPanel>
                </button>
              );
            })}
          </div>
          {/* What you've told it so far, die by die, in the order you
              tapped — and every one of them takes it back, because a
              mis-tap on six dice used to mean starting the roll over. */}
          <div className="flex shrink-0 items-center justify-center gap-4">
            <div className="flex items-center gap-1.5">
              {Array.from({ length: dice }, (_, i) => {
                const face = rolled[i];
                return (
                  <button
                    key={i}
                    aria-label={face ? `take back the ${face}` : 'empty die'}
                    disabled={!face}
                    onClick={() =>
                      setRolled((r) => r.filter((_, at) => at !== i))
                    }
                  >
                    <Glyph
                      name={face ? (template?.icons?.[face] ?? face) : 'die'}
                      className={`h-9 w-9 transition-colors ${
                        face
                          ? 'text-[color:var(--sheet-accent,#f59e0b)]'
                          : 'text-stone-800'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
            <span
              className="font-serif text-3xl font-bold tabular-nums"
              style={{ color: accent ?? '#f59e0b' }}
            >
              ${walletTotal}
            </span>
            <button
              className="rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:bg-stone-800 disabled:text-stone-600"
              style={
                rolled.length === dice
                  ? { background: accent ?? '#f59e0b', color: '#1c1917' }
                  : undefined
              }
              disabled={rolled.length !== dice}
              onClick={() => {
                const walletName = Array.isArray(creation.map?.wallet)
                  ? creation.map!.wallet[0]
                  : creation.map?.wallet;
                if (walletName) {
                  onPatch({
                    counters: data.counters.map((c) =>
                      c.name === walletName ? { ...c, current: walletTotal } : c,
                    ),
                  });
                }
                setRolled([]);
                next();
              }}
            >
              {rolled.length === dice
                ? "that's my roll"
                : `${dice - rolled.length} more`}
            </button>
          </div>
        </div>
      )}

      {here === 'keepsake' && (
        <div
          className="flex min-h-0 flex-1 flex-col gap-2"
          style={
            (accent ? { '--sheet-accent': accent } : {}) as React.CSSProperties
          }
        >
          {ownKeepsake === null ? (
            <>
              {/* Twelve small objects laid out like objects, not like a
                  dropdown — each with its own mark, so the row reads as
                  a drawer you're picking something out of. */}
              <div
                className={`grid min-h-0 flex-1 gap-1.5 ${
                  strip ? 'grid-cols-7 grid-rows-2' : 'grid-cols-2 overflow-y-auto'
                }`}
              >
                {creation.keepsakes!.map((entry) => {
                  const k = keepsakeOf(entry);
                  const picked = keeps.includes(k.text);
                  return (
                    <button
                      key={k.text}
                      className={`flex flex-col items-center justify-start gap-1 rounded-md border p-2 text-center transition-colors ${
                        picked ? '' : `${off} opacity-60`
                      }`}
                      style={
                        picked
                          ? {
                              borderColor: accent ?? '#f59e0b',
                              background: `${accent ?? '#f59e0b'}14`,
                            }
                          : undefined
                      }
                      onClick={() =>
                        setKeeps(
                          picked
                            ? keeps.filter((x) => x !== k.text)
                            : [...keeps, k.text].slice(-2),
                        )
                      }
                    >
                      {k.icon && (
                        <Glyph
                          name={k.icon}
                          className={`h-10 w-10 shrink-0 transition-colors ${
                            picked
                              ? 'text-[color:var(--sheet-accent,#f59e0b)]'
                              : 'text-stone-500'
                          }`}
                        />
                      )}
                      <span className="font-serif text-[0.7rem] leading-tight text-stone-300">
                        {k.text}
                      </span>
                    </button>
                  );
                })}
                {/* Anything you wrote yourself, sitting in the drawer
                    beside the printed ones — otherwise your own
                    keepsake vanishes the moment you confirm it, with
                    no way to read it back or change your mind. */}
                {keeps
                  .filter((k) => !offered.has(k))
                  .map((k) => (
                    <button
                      key={k}
                      className="flex flex-col items-center justify-start gap-1 rounded-md border p-2 text-center"
                      style={{
                        borderColor: accent ?? '#f59e0b',
                        background: `${accent ?? '#f59e0b'}14`,
                      }}
                      onClick={() => setKeeps(keeps.filter((x) => x !== k))}
                    >
                      <Glyph
                        name="quill"
                        className="h-10 w-10 shrink-0 text-[color:var(--sheet-accent,#f59e0b)]"
                      />
                      <span className="font-serif text-[0.7rem] leading-tight text-stone-300">
                        {k}
                      </span>
                    </button>
                  ))}
                {/* "…or of your own creation", which the book offers and
                    this screen used not to. It's the thirteenth object
                    in the drawer rather than a link under it. */}
                <button
                  className={`flex flex-col items-center justify-start gap-1 rounded-md border border-dashed p-2 text-center ${off} opacity-60`}
                  onClick={() => setOwnKeepsake('')}
                >
                  <Glyph name="quill" className="h-10 w-10 shrink-0 text-stone-500" />
                  <span className="font-serif text-[0.7rem] leading-tight text-stone-300">
                    Something of your own
                  </span>
                </button>
              </div>
              <div className="flex shrink-0 items-center justify-center gap-4">
                <div className="flex items-center gap-1.5">
                  {[0, 1].map((i) => (
                    <Glyph
                      key={i}
                      name="satchel"
                      className={`h-8 w-8 transition-colors ${
                        i < keeps.length
                          ? 'text-[color:var(--sheet-accent,#f59e0b)]'
                          : 'text-stone-800'
                      }`}
                    />
                  ))}
                </div>
                {/* The book says one or two — but it's flavour, and a
                    player who wants none owns that call (rule 1), so
                    the button changes its words instead of locking. */}
                <button
                  className="rounded-md px-4 py-2 text-sm font-semibold transition-colors"
                  style={
                    keeps.length
                      ? { background: accent ?? '#f59e0b', color: '#1c1917' }
                      : { background: '#292524', color: '#a8a29e' }
                  }
                  onClick={() => {
                    onPatch(applyKeepsakes(data, keeps));
                    next();
                  }}
                >
                  {keeps.length ? 'tucked away' : 'travelin’ light'}
                </button>
              </div>
            </>
          ) : (
            /* Writing your own. Same keyboard the name step uses — the
               rail has no other one, and a keepsake is a sentence. */
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
              <div className="w-full max-w-[46rem] rounded-md border border-stone-600 bg-stone-950 px-3 py-2 text-center font-serif text-xl text-stone-100">
                {ownKeepsake || (
                  <span className="text-stone-600">what do you carry?</span>
                )}
              </div>
              <Keyboard
                onKey={(key) =>
                  setOwnKeepsake((v) => {
                    if (key === '⌫') return (v ?? '').slice(0, -1);
                    if (key === 'space') return `${v ?? ''} `;
                    return `${v ?? ''}${key}`;
                  })
                }
              />
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md border border-stone-700 px-3 py-2 text-xs uppercase tracking-widest text-stone-400"
                  onClick={() => setOwnKeepsake(null)}
                >
                  never mind
                </button>
                <button
                  className="rounded-md px-4 py-2 text-sm font-semibold text-stone-950 disabled:bg-stone-800 disabled:text-stone-600"
                  style={
                    ownKeepsake.trim()
                      ? { background: accent ?? '#f59e0b' }
                      : undefined
                  }
                  disabled={!ownKeepsake.trim()}
                  onClick={() => {
                    setKeeps((k) => [...k, ownKeepsake.trim()].slice(-2));
                    setOwnKeepsake(null);
                  }}
                >
                  that's mine
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {here === 'name' && (
        <>
          <div className="flex min-h-0 flex-1 flex-col justify-center gap-2">
            <div className="flex items-center gap-2">
              <input
                className="min-w-0 flex-1 rounded-md border border-stone-600 bg-stone-950 px-3 py-2 font-serif text-xl text-stone-100 outline-none focus:border-amber-500"
                placeholder={trade ? `New ${trade.name}` : 'a name'}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
              />
              {creation.names && (
                <button
                  className="rounded-md bg-stone-800 px-3 py-2 text-sm text-stone-200 active:bg-amber-700"
                  onClick={() => setNameDraft(gimmeName(creation))}
                >
                  gimme a name
                </button>
              )}
            </div>
            {/* The bar has no OS keyboard — teller brings its own. */}
            <Keyboard onKey={(k) =>
              setNameDraft((n) =>
                k === '⌫' ? n.slice(0, -1) : k === 'space' ? n + ' ' : n + k,
              )
            } />
            <div className="flex items-center gap-3">
              <button
                className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-stone-950"
                onClick={() => {
                  if (nameDraft.trim()) onName(nameDraft.trim());
                  next();
                }}
              >
                that's me
              </button>
              <button
                className="text-xs text-stone-500 underline-offset-2 hover:underline"
                onClick={next}
              >
                later — the {gmWord} can write it in
              </button>
            </div>
          </div>
        </>
      )}

      {here === 'done' && (
        <div className="flex min-h-0 flex-1 flex-col items-start justify-center gap-3">
          {/* The welcome is in the header bar now (which also carries
              the back button); this is the handshake. */}
          <h2 className="font-serif text-2xl text-stone-100">
            {nameDraft.trim()
              ? `Pleasure to meet ya, ${nameDraft.trim()}.`
              : 'Pleasure to meet ya.'}
          </h2>
          {(creation.questions?.length ?? 0) > 0 && (
            <p className="max-w-xl text-sm text-stone-400">
              Your sheet is ready. When you have a quiet minute, the back side
              wants your story — who you were, what you're after, what you'd
              never do.
            </p>
          )}
          <button
            className="rounded-md bg-amber-600 px-5 py-2.5 font-semibold text-stone-950"
            onClick={() => onPatch({ draft: false })}
          >
            saddle up
          </button>
        </div>
      )}
    </div>
  );
}

/** A plain QWERTY for glass with no OS keyboard — the kiosk bar. */
function Keyboard({ onKey }: { onKey: (k: string) => void }) {
  const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  return (
    <div className="flex select-none flex-col items-center gap-1">
      {rows.map((row, i) => (
        <div key={row} className="flex gap-1">
          {[...row].map((k) => (
            <button
              key={k}
              className="h-10 w-9 rounded-md bg-stone-800 font-mono text-sm text-stone-200 active:bg-amber-700"
              onClick={() => onKey(k)}
            >
              {k}
            </button>
          ))}
          {i === 2 && (
            <button
              className="h-10 w-16 rounded-md bg-stone-800 font-mono text-sm text-stone-200 active:bg-amber-700"
              onClick={() => onKey('⌫')}
            >
              ⌫
            </button>
          )}
        </div>
      ))}
      <button
        className="h-9 w-64 rounded-md bg-stone-800 text-xs text-stone-400 active:bg-amber-700"
        onClick={() => onKey('space')}
      >
        space
      </button>
    </div>
  );
}
