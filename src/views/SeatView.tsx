import { useCallback, useEffect, useState } from 'react';
import type {
  Calibration,
  Campaign,
  Character,
  CharacterData,
  PackRecord,
  SystemTemplate,
} from '../../worker/types';
import { api } from '../lib/api';
import { usePanelNote, useRuleLookup, useRuleSection } from '../lib/rules';
import { useSession } from '../lib/use-session';
import { useWakeLock } from '../lib/use-wake-lock';
import {
  layoutOf,
  ownsFields,
  ownsTags,
  type SeatLayout,
} from '../lib/seat-layouts';
import { CalibrationOverlay } from '../components/CalibrationOverlay';
import { ConnectionHint } from '../components/ConnectionHint';
import { CreationBuilder } from '../components/CreationBuilder';
import { COUNTER_VIEWS } from '../components/counters';
import { bumped } from '../components/counters/shared';
import { SEAT_SIZES, SizeFrame, type SeatSize } from '../components/SizeFrame';
import { TagSection } from '../components/TagSection';

// The player's card.
//
// Two rules govern everything here.
//
// **It never scrolls on glass nobody will touch.** Sideways, never, on
// anything. Downwards depends on which KIND of screen it is, and that
// turned out to be the only device question worth asking — see `wide`
// below.
//
// The rule used to read "it never scrolls, full stop", which was learned
// honestly on the rail panel and then over-applied to phones. A panel
// screwed to the table genuinely can't scroll; a phone in a hand
// obviously can, and refusing to let it meant squeezing the card to
// 0.64 to avoid a gesture every human already knows. That cost
// legibility AND the width the panels were asking for, to protect a
// property nobody wanted on that device.
//
// Mounted glass doesn't SCALE to fit either (Brian, 2026-08-13 —
// `FitBox` removed). Text renders at exactly one size: the one it was
// designed at. A layout that overflows mounted glass gets clipped, and
// the clipping is the bug report — fix the layout for that glass, don't
// let a transform quietly shrink the type until nobody can read it.
//
// So: fluid grids that honestly fit on mounted glass, and on held
// glass just let it be as tall as it is.
//
// **The arrangement is a question, not an answer.** Nobody knows what a
// seat should look like yet, so there are five and the player picks. See
// `src/lib/seat-layouts.ts`. The choice is stored on the DISPLAY, which
// means it survives a reload and — the actual point — the DM can see
// what each player chose.

export function SeatView({
  characterId,
  layout: assigned,
  frame: framed = null,
  glass = null,
  ppi = null,
  displayId,
  seatName,
}: {
  characterId: string;
  layout?: string | null;
  /**
   * What the DM called this screen. A seat is assigned to a PERSON
   * (rule 6), so its name is very often the player's — which makes it
   * the right default for the sheet's player box when a character is
   * built here, and a proposal like any other (rule 1).
   */
  seatName?: string;
  /**
   * This screen's own id, so it can recognise calibration mail
   * addressed to it. Absent in the console's preview, which is not a
   * screen and receives no mail.
   */
  displayId?: string;
  /**
   * The glass this card should pretend to be on — set by the console's
   * preview, which wraps this in a `SizeFrame` of the same dimensions.
   */
  frame?: SeatSize;
  /**
   * The ASSIGNED pretend-glass (`params.glass`) — the console telling a
   * real screen to render as other hardware (an iPad auditioning as the
   * rail bar). A `SEAT_SIZES` preset id; unknown or unset renders the
   * actual window. Unlike `frame`, the seat wraps ITSELF here.
   */
  glass?: string | null;
  /**
   * This screen's calibrated CSS px/inch, when it has one — with it, an
   * assigned glass renders at true physical size on this very screen.
   */
  ppi?: number | null;
}) {
  // Assignment-driven glass, resolved from the client's own vocabulary.
  // The preview's `frame` wins — it already has a SizeFrame outside.
  const forced = framed
    ? null
    : (SEAT_SIZES.find((s) => s.id === glass) ?? null);
  const frame = framed ?? forced;
  const [character, setCharacter] = useState<Character | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [packs, setPacks] = useState<PackRecord[]>([]);
  const [error, setError] = useState('');
  const lookup = useRuleLookup(packs);
  // What this table calls its conditions is the campaign's word, and it
  // doubles as the name of the pack section that describes them — so a
  // system saying "Statuses" gets the pack's "Statuses" section without
  // anything here knowing either word.
  const conditionsLabel = campaign?.data.vocabulary.conditions ?? 'Conditions';
  const conditions = useRuleSection(packs, conditionsLabel);
  // The sheet's own captions under each heading. Publisher prose, so
  // the pack is the only place they can come from (rule 4).
  const note = usePanelNote(packs);
  const [template, setTemplate] = useState<SystemTemplate | null>(null);
  const [tally, setTally] = useState<Record<string, number>>({});
  /**
   * The arrangement, from the ASSIGNMENT. The picker used to live on
   * the card itself; it's the console's now (Displays panel) — a seat
   * renders what it was told to render, and the change arrives over
   * SSE like any other assignment edit.
   */
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
  /**
   * A calibration pattern addressed to THIS screen — the console
   * measuring this glass so an assigned pretend-glass can render at
   * true physical size. Targeted mail only; the table's own
   * calibration rides the same broadcast unaddressed.
   */
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const { session, connected } = useSession(
    character?.campaignId ?? null,
    (id) => {
      if (id === characterId || id === 'campaign') refetch();
    },
    {
      onCalibration: (c) =>
        setCalibration(
          c && displayId && c.displayId === displayId ? c : null,
        ),
    },
  );

  const patch = (data: Partial<CharacterData>) => {
    if (!character) return;
    setCharacter({ ...character, data: { ...character.data, ...data } });
    api.patchCharacter(characterId, { data }).catch(() => refetch());
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
  /**
   * Is this glass MOUNTED, or is it held?
   *
   * The one question that decides the whole shape of the card, and the
   * reason there is no per-device tuning here. It isn't really about
   * aspect ratio — it's about which dimension is scarce and whether
   * anybody will touch the screen:
   *
   *   * **Mounted** — the rail panel bolted to the table, a propped
   *     tablet, the table TV. Width is plentiful and height is FIXED,
   *     because nobody flicks a screwed-down panel and a screen the
   *     whole table reads has to show everything at once. So: columns,
   *     no scrolling — and no scaling either (Brian, 2026-08-13): the
   *     layout is designed to fit this glass, and content that
   *     overflows is clipped. Clipping is the diagnostic now — it means
   *     the layout is wrong for that glass, and the fix is design,
   *     never a transform shrinking the type.
   *   * **Held** — a phone or tablet in someone's hand. Width is the
   *     scarce thing and height is ELASTIC, because scrolling is free
   *     and universally understood. So: one column, full width, natural
   *     size, and it may scroll down.
   *
   * Neither family may EVER scroll sideways by accident — the page
   * never pans. A deliberate SHELF may (the item rows on the strip):
   * same gesture family as swiping between screens.
   *
   * Read from the forced frame when there is one, or the preview would
   * keep answering for the real window and a simulated rail would
   * render as a phone.
   */
  const wide = frame
    ? frame.w / frame.h >= 1.3
    : typeof window !== 'undefined' &&
      window.innerWidth / window.innerHeight >= 1.3;

  /**
   * Mounted glass, but a STRIP — no room to stack, and width to burn.
   *
   * Measured against the width it could otherwise use, not in absolute
   * pixels. That distinction cost a round trip: keyed on "under 700px
   * tall" this fired on a landscape iPad, because a tablet's VISIBLE
   * height is its logical height minus the browser's chrome — an iPad
   * mini lands near 664 — and 700 was a line drawn for a 515px rail with
   * no margin under it.
   *
   * The ratio has margin to spare. The rail bar is 3.7:1; every tablet
   * and laptop in landscape sits between 1.3 and 1.8, and 16:9 is 1.78.
   * Nothing lives between 1.8 and 3.7, so a threshold in that gap can't
   * be nudged across by a browser toolbar.
   *
   * It is still the same statement about the content: at 3.7:1 there is
   * no height to put one panel above another and plenty of width to put
   * them side by side. A tall narrow screen is not a strip, and neither
   * is a tablet that merely lost 80px to Safari.
   */
  const ratio = frame
    ? frame.w / frame.h
    : typeof window !== 'undefined'
      ? window.innerWidth / window.innerHeight
      : 0;
  const strip = ratio >= 2.5;
  const fields = character.data.fields.filter((f) => f.key !== 'description');

  // The seat renders ONLY what the glass is for: the card, the turn
  // signals aimed at this player, and the connection state. Identity,
  // the layout choice and the device preview are the CONSOLE's
  // business now (Displays panel) — a screen shows its assignment, it
  // doesn't negotiate it, and nothing here spends the panel's pixels
  // on controls nobody uses mid-game.
  const card = (
    <main
      // Held glass may scroll DOWN; mounted glass may not. Nothing may
      // ever scroll sideways — see the note on `wide` above. Height is
      // the window's — or the preview frame's, which sizes its child.
      className={`flex w-full flex-col gap-2 overflow-x-hidden p-3 ${
        frame ? 'h-full' : 'h-[100dvh]'
      } ${wide ? 'overflow-y-hidden' : 'overflow-y-auto'} ${
        youreUp ? 'ring-4 ring-inset ring-amber-600' : ''
      }`}
    >
      <ConnectionHint connected={connected} />

      {/* Turn signals: gameplay, not chrome — they appear only
          mid-fight and are addressed to this player. The amber ring
          already shouts; these give it words, and cover on-deck. */}
      {(youreUp || onDeck) && (
        <div className="flex shrink-0 items-baseline gap-2">
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
                // Faces the system banks (`dice.banks` — WiW's Aces
                // marking the Ace-in-the-Hole meter) tick their counter
                // as a side effect of the report: the only rolls teller
                // ever hears about are reported ones, so this is where
                // "roll an Ace, mark an Ace" can be automatic. An
                // ordinary counter write — clamped by the counter's own
                // max, event-logged, and a tap on the tally reverses a
                // miscount (rule 1).
                const banked = (dice?.banks ?? []).flatMap((b) => {
                  const n = tally[b.face] ?? 0;
                  return n > 0 ? [{ counter: b.counter, n }] : [];
                });
                if (banked.length && character) {
                  patch({
                    counters: character.data.counters.map((c) => {
                      const b = banked.find((x) => x.counter === c.name);
                      return b ? bumped(c, b.n) : c;
                    }),
                  });
                }
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
        className={`flex min-h-0 gap-2 ${wide ? 'flex-1 flex-row' : 'flex-col'}`}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          {/* No fit wrapper — the card renders at designed size on
              every glass. Mounted glass clips what overflows (the
              `main` above hides overflow when `wide`); the clip is a
              layout bug to fix by design, not by scaling.

              Flex column ONLY when mounted: it stretches the card into
              the fixed height. On held glass it must be a plain box —
              flex would let the card's min-h-0 chain squeeze the item
              rows to the viewport and stack them over each other; held
              glass grows naturally and scrolls instead. */}
          <div
            className={
              wide ? 'flex min-h-0 flex-1 flex-col' : 'min-h-0 flex-1'
            }
          >
            {character.data.draft ? (
              // Mid-creation: the seat asks its questions instead of
              // showing a sheet that doesn't exist yet (TEL-75). Same
              // edit rights as the sheet — the seat owns this one
              // character, draft or done.
              <CreationBuilder
                character={character}
                packs={packs.map((p) => p.pack)}
                template={template}
                vocabulary={campaign?.data.vocabulary}
                onPatch={patch}
                onName={(name) => {
                  setCharacter({ ...character, name });
                  api.patchCharacter(characterId, { name }).catch(() => refetch());
                }}
                strip={strip}
                seatName={seatName}
              />
            ) : (
            <Counters
              big
              name={character.name}
              counters={character.data.counters}
              fields={fields}
              dice={template?.dice}
              groups={template?.groups}
              accents={template?.accents}
              pins={template?.pins}
              dials={template?.dials}
              icons={template?.icons}
              strip={strip}
              mounted={wide}
              tags={character.data.tags}
              onTags={ownsTags(layout) ? (tags) => patch({ tags }) : undefined}
              items={character.data.items ?? []}
              onItems={ownsTags(layout) ? (items) => patch({ items }) : undefined}
              use={template?.use}
              screens={template?.screens}
              marks={template?.marks}
              spends={template?.spends}
              ladders={template?.ladders}
              onFields={
                ownsTags(layout)
                  ? (next) =>
                      // The card was given fields minus the
                      // description; it must ride back on every write
                      // or the first standing tap deletes it (the
                      // StatusPanel lesson, same shape).
                      patch({
                        fields: [
                          ...next,
                          ...character.data.fields.filter(
                            (f) => f.key === 'description',
                          ),
                        ],
                      })
                  : undefined
              }
              onSpend={ownsTags(layout) ? (next) => patch(next) : undefined}
              itemsLabel={campaign?.data.vocabulary.items ?? 'Items'}
              packs={packs.map((p) => p.pack)}
              ownCatalog={campaign?.data.catalog}
              conditions={conditions}
              conditionsLabel={conditionsLabel}
              lookup={lookup}
              note={note}
              onChange={(counters) => patch({ counters })}
            />
            )}
          </div>

          {/* Stats are reference, not controls — one dense strip.
              Skipped when the layout places them itself, or the same
              stats would appear twice on the card. */}
          {fields.length > 0 && !ownsFields(layout) && !character.data.draft && (
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

        {/* The sidebar exists only to hold the conditions strip, so a
            layout that draws its own doesn't get the COLUMN either.
            Rendering an empty `w-56` left 14rem of nothing down the
            side of the card and everything else squeezed to fit beside
            it — the emptiest possible use of the scarcest thing here.

            This is why the guard moved out to wrap the div rather than
            staying on the child: a container sized in advance keeps its
            width whether or not anything ends up inside it. */}
        {!ownsTags(layout) && !character.data.draft && (
          <div className={`flex shrink-0 flex-col gap-2 ${wide ? 'w-56' : ''}`}>
            <TagSection
              tags={character.data.tags}
              label={conditionsLabel}
              lookup={lookup}
              onChange={(tags) => patch({ tags })}
            />

            {/* The turn-order list used to sit here, and it's gone for
                now. A seat is one player's own card, and the roster of
                everyone else in the fight is the room's information,
                not theirs — it's on the table screen and the console,
                where everybody can already see it.

                What stays is everything aimed at THIS player: the ring
                around the card when it's their turn, and the roll
                prompt when the Warden asks for one. Those are
                addressed to them; a list of names is a thing to read. */}
          </div>
        )}
      </div>
    </main>
  );

  // The console measuring THIS glass: the pattern takes the whole
  // screen, exactly as it does on the table, and leaves when the
  // wizard closes.
  if (calibration) return <CalibrationOverlay calibration={calibration} />;

  // An assigned glass letterboxes the card on the seat's own screen —
  // an iPad auditioning as the rail bar renders the bar's exact frame,
  // at true physical size when this screen's ppi is known, scaled to
  // fit when it isn't.
  if (!forced) return card;
  return (
    <div className="flex h-[100dvh] w-full flex-col bg-stone-950">
      <SizeFrame size={forced} ppi={ppi}>
        {card}
      </SizeFrame>
    </div>
  );
}
