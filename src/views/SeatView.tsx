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
import { card, input, sectionLabel } from '../lib/ui';
import { ConnectionHint } from '../components/ConnectionHint';
import { CounterSection } from '../components/CounterSection';
import { FieldSection } from '../components/FieldSection';
import { TagSection } from '../components/TagSection';

// The player's card. Two layouts from one component:
//  - portrait card (phones) — default flex-col
//  - instrument strip (the future 1920×515 rail panels) — a max-height
//    media query flips the root row-wise. Keep every control reachable
//    in both.

export function SeatView({ characterId }: { characterId: string }) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [packs, setPacks] = useState<PackRecord[]>([]);
  const [error, setError] = useState('');
  const lookup = useRuleLookup(packs);
  /** This system's dice — the faces are what the tally offers. */
  const [template, setTemplate] = useState<SystemTemplate | null>(null);
  /** Faces tapped so far this roll, e.g. { hit: 2, ace: 1 }. */
  const [tally, setTally] = useState<Record<string, number>>({});

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
      .then((all) => setTemplate(all.find((t) => t.system === campaign.system) ?? null))
      .catch(() => setTemplate(null));
  }, [campaign?.system]); // eslint-disable-line react-hooks/exhaustive-deps

  useWakeLock();
  const { session, connected } = useSession(character?.campaignId ?? null, (id) => {
    if (id === characterId || id === 'campaign') refetch();
  });

  const patch = (data: Partial<CharacterData>) => {
    if (!character) return;
    setCharacter({ ...character, data: { ...character.data, ...data } });
    api.patchCharacter(characterId, { data }).catch(() => refetch());
  };

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8">
        <h1 className="font-serif text-3xl">teller</h1>
        <p className="text-red-400">{error}</p>
        <p className="text-sm text-stone-500">
          ask your {campaign?.data.vocabulary.gm ?? 'DM'} for a fresh seat link
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
   *
   * A seat may report its OWN roll and nothing else; the server checks
   * that the entry belongs to this character (rule 7).
   */
  const mine = initiative.find((e) => e.characterId === character.id);
  const takingRolls = Boolean(session?.rolling && mine);
  const submitRoll = (score: number) => {
    if (!mine) return;
    api
      .sessionOp(character.campaignId, { op: 'score', entryId: mine.id, score })
      .catch(() => {});
  };

  // The distinct faces this system's dice can show, and what each is
  // worth. Tapping faces beats typing a total: the arithmetic ("an Ace
  // is two") is the bit that gets miscounted at the table, and it means
  // teller never has to know about your bonuses — you already applied
  // them by picking up more dice.
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
  /** What their sheet says, as a reminder — never as the truth. */
  const basePool = template?.initiative
    ? (character.data.fields.find((f) => f.key === template.initiative!.field)?.value ??
      '')
    : '';

  return (
    <main
      className={`mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4 ${
        youreUp ? 'ring-4 ring-inset ring-amber-600' : ''
      } [@media(max-height:560px)]:max-w-none [@media(max-height:560px)]:flex-row [@media(max-height:560px)]:items-stretch [@media(max-height:560px)]:gap-6 [@media(max-height:560px)]:overflow-hidden`}
    >
      <ConnectionHint connected={connected} />
      <header className="shrink-0 [@media(max-height:560px)]:flex [@media(max-height:560px)]:w-56 [@media(max-height:560px)]:flex-col [@media(max-height:560px)]:justify-center">
        <h1 className="font-serif text-3xl text-stone-100">{character.name}</h1>
        {campaign && (
          <p className="text-sm text-stone-500">{campaign.name}</p>
        )}
        {youreUp && (
          <p className="mt-1 inline-block animate-pulse rounded bg-amber-700 px-2 py-0.5 text-sm font-semibold text-stone-950">
            YOU'RE UP
          </p>
        )}
        {onDeck && (
          <p className="mt-1 inline-block rounded bg-stone-800 px-2 py-0.5 text-sm text-amber-300">
            on deck
          </p>
        )}
      </header>

      {takingRolls && (
        <section className="shrink-0 rounded-lg bg-amber-950/40 p-3 ring-1 ring-amber-800">
          <div className="flex items-baseline gap-2">
            <p className="text-sm text-amber-200">
              Roll for turn order — tap each die you rolled.
            </p>
            {basePool && (
              <span className="font-mono text-[11px] text-stone-500">
                sheet says {basePool} · roll any bonus dice too
              </span>
            )}
          </div>

          {/* Big targets: this gets tapped with a fingertip, on a rail
              panel, mid-conversation. */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {faceList.map((face) => (
              <button
                key={face}
                className="min-w-20 rounded-md bg-stone-800 px-3 py-2 text-left active:bg-stone-700"
                // The count and the face read as separate scraps of text
                // otherwise, so the button has no name at all in the
                // accessibility tree — spotted by reading the tree rather
                // than the screenshot.
                aria-label={`add a ${face} — you have ${tally[face] ?? 0}`}
                onClick={() => setTally((t) => ({ ...t, [face]: (t[face] ?? 0) + 1 }))}
              >
                <span className="font-mono text-lg text-stone-100">
                  {tally[face] ?? 0}
                </span>
                <span className="ml-1.5 text-xs text-stone-400">{face}</span>
                <span className="ml-1 text-[10px] text-stone-600">
                  {(dice?.values[face] ?? 0) === 0 ? '·0' : `·${dice?.values[face]}`}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-2 flex items-center gap-3">
            <span className="font-mono text-2xl text-amber-300">
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
            {tapped > 0 && (
              <button
                className="text-xs text-stone-500 underline-offset-2 hover:underline"
                onClick={() => setTally({})}
              >
                clear
              </button>
            )}
            {/* A blank roll is a real outcome, and tapping four Blanks to
                say so would be silly. */}
            {!tapped && (
              <button
                className="text-xs text-stone-500 underline-offset-2 hover:underline"
                onClick={() => submitRoll(0)}
              >
                I rolled nothing
              </button>
            )}
          </div>

          {typeof mine?.score === 'number' && (
            <p className="mt-2 text-xs text-stone-400">
              Reported <span className="text-amber-300">{mine.score}</span> — tap a
              new roll to correct it.
            </p>
          )}
        </section>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-4 [@media(max-height:560px)]:flex-row [@media(max-height:560px)]:items-center [@media(max-height:560px)]:overflow-x-auto">
        <FieldSection fields={character.data.fields} onChange={(fields) => patch({ fields })} />

        <div className="[@media(max-height:560px)]:min-w-72 [@media(max-height:560px)]:flex-1">
          <CounterSection
            big
            counters={character.data.counters}
            onChange={(counters) => patch({ counters })}
          />
        </div>

        <TagSection
          tags={character.data.tags}
          label={campaign?.data.vocabulary.conditions ?? 'Conditions'}
          lookup={lookup}
          onChange={(tags) => patch({ tags })}
        />

        <section className="space-y-2 [@media(max-height:560px)]:hidden">
          <span className={sectionLabel}>Notes</span>
          <textarea
            className={`${input} min-h-16 w-full resize-y`}
            defaultValue={character.data.notes}
            onBlur={(e) =>
              e.target.value !== character.data.notes && patch({ notes: e.target.value })
            }
            aria-label="notes"
          />
        </section>
      </div>

      {initiative.length > 0 && (
        <footer
          className={`${card} shrink-0 [@media(max-height:560px)]:flex [@media(max-height:560px)]:w-48 [@media(max-height:560px)]:flex-col [@media(max-height:560px)]:justify-center`}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className={sectionLabel}>Initiative</span>
            {turn !== null && (
              <span className="font-mono text-xs text-stone-500">
                rd {session?.round}
              </span>
            )}
          </div>
          <ol className="flex flex-wrap gap-1.5 [@media(max-height:560px)]:flex-col [@media(max-height:560px)]:gap-1 [@media(max-height:560px)]:overflow-y-auto">
            {initiative.map((entry, index) => (
              <li
                key={entry.id}
                className={`rounded px-2 py-0.5 text-sm ${
                  index === turn
                    ? 'bg-amber-700 font-medium text-stone-950'
                    : entry.characterId === character.id
                      ? 'bg-stone-800 text-amber-200'
                      : 'bg-stone-900 text-stone-400'
                }`}
              >
                {entry.label}
              </li>
            ))}
          </ol>
        </footer>
      )}
    </main>
  );
}
