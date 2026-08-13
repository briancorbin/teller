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
  spreadTotal,
  withoutInstanced,
} from '../lib/creation';
import { SheetPanel } from './sheet/SheetPanel';

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

const stepBtn =
  'rounded-lg border p-3 text-left transition-colors active:bg-amber-950/60';
const off = 'border-stone-700 bg-stone-900';
const on = 'border-amber-500 bg-amber-950/40';

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
  const [tally, setTally] = useState<Record<string, number>>({});
  const [keeps, setKeeps] = useState<string[]>([]);
  const [nameDraft, setNameDraft] = useState('');

  const gmWord = vocabulary?.gm ?? 'Warden';
  const budget = creation.skills;
  const skills = spread ?? trade?.skills ?? {};
  const spent = budget ? spreadTotal(skills, budget.die) : 0;

  // The wallet roll: only a fresh Tenderfoot rolls; the faces are the
  // system's dice, the prices are the pack's.
  const rollsWallet = Boolean(creation.wallet) && (tier?.prestige ?? 0) === 0;
  const faces = Object.keys(template?.dice?.values ?? {});
  const walletTotal = Object.entries(tally).reduce(
    (sum, [face, n]) => sum + n * (creation.wallet?.values[face] ?? 0),
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
  const accent = trade ? template?.accents?.[trade.name] : undefined;

  // Walking back is free: every step's commit REPLACES what it wrote
  // (abilities swap with the trade, bundles swap on re-pack, the
  // keepsakes line rewrites), so second thoughts never double up.
  const heading = (sub?: string) => (
    <div className="flex shrink-0 items-baseline gap-3">
      {step > 0 && (
        <button
          className="rounded-md px-2 py-1 text-sm text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-200"
          aria-label="back a step"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          ← back
        </button>
      )}
      {sub && <p className="text-xs text-stone-500">{sub}</p>}
    </div>
  );

  // One layout family: heading up top, the question's options in a row
  // that PANS on the strip (the shelf gesture) and wraps on a phone.
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
  const tile = (extra = '') =>
    `${strip ? 'w-[19rem] shrink-0 snap-start self-stretch' : 'w-full'} ${extra}`;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-2 p-1">
      {/* The screen's question, worn the way the finished sheet wears
          its header: the same bordered bar, the same ruled hairlines,
          the plate treatment — but the QUESTION is the plate, centered
          and large, for the whole flow. The bar tints to the trade's
          colour the moment one is chosen. */}
      <div
        className="flex shrink-0 items-center gap-2.5 rounded-md border px-3 py-1.5"
        style={{ borderColor: `${accent ?? '#f59e0b'}66` }}
      >
        <span
          className="h-px flex-1"
          style={{ background: `${accent ?? '#f59e0b'}55` }}
        />
        <span
          className="whitespace-nowrap font-serif text-[1.25rem] font-bold uppercase leading-tight tracking-[0.12em]"
          style={{ color: accent ?? '#f59e0b' }}
        >
          {QUESTIONS[here]}
        </span>
        <span
          className="h-px flex-1"
          style={{ background: `${accent ?? '#f59e0b'}55` }}
        />
      </div>
      {here === 'trade' && (
        <>
          {heading('tap one to read it — this is who you are at the table')}
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
                            src={`/api/maps/${t.art}`}
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
        <>
          {heading(
            budget
              ? `${budget.total} ${budget.die} dice total, ${budget.min}–${budget.max} each — the ${trade.name}'s usual spread is dealt already`
              : 'the trade set these — adjust if your table allows',
          )}
          {shelf(
            Object.entries(skills).map(([label, pool]) => (
              <div
                key={label}
                className={`${off} ${tile('flex flex-col items-center justify-center gap-2 rounded-lg border p-3')}`}
              >
                <span className="text-xs uppercase tracking-widest text-stone-400">
                  {label}
                </span>
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
                  <span className="font-mono text-2xl text-stone-100">{pool}</span>
                  <button
                    className="h-12 min-w-12 rounded-lg bg-stone-800 text-2xl active:bg-amber-700"
                    aria-label={`more ${label} dice`}
                    onClick={() => {
                      if (!budget) return;
                      setSpread((prev) => {
                        const cur = prev ?? trade?.skills ?? {};
                        const n = parseInt(cur[label] ?? '0', 10) || 0;
                        const v = Math.min(budget.max, n + 1);
                        return { ...cur, [label]: `${v}${budget.die}` };
                      });
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            )),
          )}
          <div className="flex shrink-0 items-center gap-3">
            {budget && (
              <span
                className={`font-mono text-sm ${
                  spent === budget.total ? 'text-stone-500' : 'text-amber-400'
                }`}
              >
                {spent}/{budget.total} dice used
              </span>
            )}
            <button
              className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-stone-950"
              onClick={() => {
                onPatch(applySkills(data, skills));
                next();
              }}
            >
              that's my spread
            </button>
          </div>
        </>
      )}

      {here === 'gear' && (
        <>
          {heading(
            `pick ${tier?.packs ?? 1} equipment pack${(tier?.packs ?? 1) > 1 ? 's' : ''} — your starting arms are already in your inventory`,
          )}
          {shelf(
            (creation.equipmentPacks ?? []).map((id) => {
              const p = catalog.get(id);
              if (!p) return null;
              const picked = eqPicks.includes(id);
              return (
                <button
                  key={id}
                  className={`${stepBtn} ${picked ? on : off} ${tile('flex flex-col gap-1')}`}
                  onClick={() =>
                    setEqPicks(
                      picked
                        ? eqPicks.filter((x) => x !== id)
                        : [...eqPicks, id].slice(-(tier?.packs ?? 1)),
                    )
                  }
                >
                  <span className="font-serif text-base text-stone-100">{p.name}</span>
                  <span className="text-xs text-stone-400">
                    {p.fields?.find((f) => f.key === 'effect')?.value ?? ''}
                  </span>
                </button>
              );
            }),
          )}
          <button
            className="shrink-0 self-start rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-stone-950 disabled:opacity-40"
            disabled={eqPicks.length === 0}
            onClick={() => {
              // Swap, don't stack: drop anything a previous pass's
              // bundles unpacked before granting this pass's picks.
              onPatch(
                applyGear(
                  withoutInstanced(data, {
                    from: bundleGrantIds(packs, creation.equipmentPacks ?? []),
                  }),
                  packs,
                  eqPicks,
                ),
              );
              next();
            }}
          >
            packed
          </button>
        </>
      )}

      {here === 'wallet' && (
        <>
          {heading(
            `roll ${creation.wallet!.roll} — real dice, on the table — then tap what you rolled`,
          )}
          <div className="flex min-h-0 flex-1 flex-wrap content-center items-center gap-2">
            {faces.map((face) => (
              <button
                key={face}
                className="min-w-24 rounded-md bg-stone-800 px-4 py-3 text-left active:bg-stone-700"
                aria-label={`add a ${face}`}
                onClick={() =>
                  setTally((t) => ({ ...t, [face]: (t[face] ?? 0) + 1 }))
                }
              >
                <span className="font-mono text-xl text-stone-100">
                  {tally[face] ?? 0}
                </span>
                <span className="ml-2 text-sm text-stone-400">{face}</span>
                <span className="ml-1 text-[10px] text-stone-600">
                  ${creation.wallet!.values[face] ?? 0}
                </span>
              </button>
            ))}
            <span className="font-mono text-3xl text-amber-300">${walletTotal}</span>
            <button
              className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-stone-950"
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
                setTally({});
                next();
              }}
            >
              that's my roll
            </button>
            <button
              className="text-xs text-stone-500 underline-offset-2 hover:underline"
              onClick={() => setTally({})}
            >
              clear
            </button>
          </div>
        </>
      )}

      {here === 'keepsake' && (
        <>
          {heading('what rides in your pocket from the life before — pick up to two, or none')}
          <div className="flex min-h-0 flex-1 flex-wrap content-start gap-1.5 overflow-y-auto">
            {creation.keepsakes!.map((k) => {
              const picked = keeps.includes(k);
              return (
                <button
                  key={k}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    picked
                      ? 'border-amber-500 bg-amber-950/40 text-stone-100'
                      : 'border-stone-700 bg-stone-900 text-stone-400'
                  }`}
                  onClick={() =>
                    setKeeps(
                      picked
                        ? keeps.filter((x) => x !== k)
                        : [...keeps, k].slice(-2),
                    )
                  }
                >
                  {k}
                </button>
              );
            })}
          </div>
          <button
            className="shrink-0 self-start rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-stone-950"
            onClick={() => {
              if (keeps.length) onPatch(applyKeepsakes(data, keeps));
              next();
            }}
          >
            {keeps.length ? 'tucked away' : 'travelin’ light'}
          </button>
        </>
      )}

      {here === 'name' && (
        <>
          {heading()}
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
          <button
            className="rounded-md px-2 py-1 text-sm text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-200"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            ← back
          </button>
          {/* The welcome is in the header bar now; this is the handshake. */}
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
