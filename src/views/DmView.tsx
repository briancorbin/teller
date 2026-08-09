import { useCallback, useEffect, useRef, useState } from 'react';
import type { Campaign, Character, CharacterData, PackRecord } from '../../worker/types';
import { api, getDmKey, setDmKey } from '../lib/api';
import { useRuleLookup } from '../lib/rules';
import { useSession } from '../lib/use-session';
import { useWakeLock } from '../lib/use-wake-lock';
import { btn, btnPrimary, card, input, sectionLabel } from '../lib/ui';
import { CharacterCard } from '../components/CharacterCard';
import { ConnectionHint } from '../components/ConnectionHint';
import { CounterSection } from '../components/CounterSection';
import { InitiativePanel } from '../components/InitiativePanel';
import { RulesPanel } from '../components/RulesPanel';

// ?pane= renders a focused slice of the console — one slice per future
// DM-screen panel, useful today across iPad + phone:
//   session    → initiative · notices · map · handouts
//   characters → the character grid
//   library    → rules · reference · party resources
export function DmView({ campaignId }: { campaignId: string }) {
  const pane = new URLSearchParams(window.location.search).get('pane');
  const showSession = pane === null || pane === 'session';
  const showCharacters = pane === null || pane === 'characters';
  const showLibrary = pane === null || pane === 'library';
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<'pc' | 'npc'>('pc');
  const [notice, setNotice] = useState('');
  const [packs, setPacks] = useState<PackRecord[]>([]);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(() => {
    api
      .getCampaign(campaignId)
      .then(({ campaign, characters }) => {
        setCampaign(campaign);
        setCharacters(characters);
        setError('');
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, [campaignId]);

  useEffect(refetch, [refetch]);

  const loadPacks = useCallback(() => {
    if (!campaign) return;
    api.packs(campaign.system).then(setPacks).catch(() => setPacks([]));
  }, [campaign?.system]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(loadPacks, [loadPacks]);
  const lookup = useRuleLookup(packs);

  // SSE poke → debounced refetch (a burst of taps = one fetch).
  useWakeLock();
  const { session, connected } = useSession(campaignId, () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(refetch, 300);
  });

  const patchCharacter = (
    id: string,
    patch: { name?: string; data?: Partial<CharacterData> },
  ) => {
    // Optimistic; SSE echo reconciles.
    setCharacters((cs) =>
      cs.map((c) =>
        c.id === id
          ? { ...c, name: patch.name ?? c.name, data: { ...c.data, ...patch.data } }
          : c,
      ),
    );
    api.patchCharacter(id, patch).catch(() => refetch());
  };

  // Functional update so rapid taps never compute from a stale base;
  // the PATCH sends absolute values, so replays are harmless.
  const patchGrid = (
    update: (prev: NonNullable<Campaign['data']['grid']>) => NonNullable<Campaign['data']['grid']>,
  ) => {
    setCampaign((prev) => {
      if (!prev) return prev;
      const grid = update(prev.data.grid ?? { on: false, ppi: 40 });
      api.patchCampaign(prev.id, { data: { grid } }).catch(() => refetch());
      return { ...prev, data: { ...prev.data, grid } };
    });
  };

  const nudgeGrid = (delta: number) =>
    patchGrid((g) => ({ ...g, on: true, ppi: Math.max(10, g.ppi + delta) }));

  const panGrid = (dx: number, dy: number) =>
    patchGrid((g) => ({ ...g, ox: (g.ox ?? 0) + dx, oy: (g.oy ?? 0) + dy }));

  const addCharacter = async () => {
    if (!newName.trim()) return;
    await api.createCharacter(campaignId, newName.trim(), newKind).catch((e) =>
      setError(String(e instanceof Error ? e.message : e)),
    );
    setNewName('');
  };

  if (error && !campaign) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
        <h1 className="font-serif text-3xl">teller</h1>
        <p className="text-red-400">{error}</p>
        <input
          className={input}
          type="password"
          placeholder="DM key"
          defaultValue={getDmKey()}
          onBlur={(e) => setDmKey(e.target.value)}
        />
        <button className={btnPrimary} onClick={refetch}>
          retry
        </button>
      </main>
    );
  }

  if (!campaign) {
    return <main className="p-8 text-stone-500">opening the books…</main>;
  }

  const gm = campaign.data.vocabulary.gm ?? 'DM';

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <ConnectionHint connected={connected} />
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <input
          className="min-w-0 bg-transparent font-serif text-3xl text-stone-100 focus:outline-none"
          defaultValue={campaign.name}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== campaign.name) {
              setCampaign({ ...campaign, name });
              api.patchCampaign(campaign.id, { name }).catch(() => refetch());
            }
          }}
          aria-label="campaign name"
        />
        <span className="font-mono text-xs text-stone-500">
          {campaign.system} · {gm}'s console
        </span>
        <span className="ml-auto flex items-baseline gap-4">
          <button
            className="font-mono text-xs text-stone-500 underline-offset-2 hover:text-amber-300 hover:underline"
            onClick={() =>
              api
                .undo(campaignId)
                .then(() => refetch())
                .catch((e) => setError(String(e instanceof Error ? e.message : e)))
            }
            title="revert the last change (character/campaign edits)"
          >
            ↺ undo
          </button>
          <a
            className="font-mono text-xs text-stone-500 underline-offset-2 hover:text-amber-300 hover:underline"
            href={`/table/${campaign.id}`}
            target="_blank"
            rel="noreferrer"
          >
            table ↗
          </a>
          <a
            className="font-mono text-xs text-stone-500 underline-offset-2 hover:text-amber-300 hover:underline"
            href={`/board/${campaign.id}`}
            target="_blank"
            rel="noreferrer"
            title="player-facing vertical companion display — no secrets"
          >
            board ↗
          </a>
          <a
            className="font-mono text-xs text-stone-500 underline-offset-2 hover:text-amber-300 hover:underline"
            href={`/art/${campaign.id}`}
            target="_blank"
            rel="noreferrer"
            title="fullscreen frame for the active handout — point any spare screen at it"
          >
            art ↗
          </a>
        </span>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div
        className={
          pane === null
            ? 'grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]'
            : pane === 'characters'
              ? 'space-y-6'
              : 'mx-auto max-w-2xl space-y-6'
        }
      >
        {(showSession || showLibrary) && (
        <div className="space-y-6">
          {showSession && (
          <InitiativePanel
            session={session}
            characters={characters}
            onOp={(op) => api.sessionOp(campaignId, op).catch(() => refetch())}
          />
          )}

          {showSession && (
          <>
          <div className={`${card} space-y-2`}>
            <span className={sectionLabel}>Table notice</span>
            <div className="flex flex-wrap gap-1.5">
              {['SHORT REST', 'LONG REST', 'ROLL INITIATIVE', 'BREAK'].map((preset) => (
                <button
                  key={preset}
                  className="rounded-full bg-stone-800 px-2.5 py-1 text-xs text-stone-300 transition-colors hover:bg-amber-800 hover:text-stone-50"
                  onClick={() => {
                    setNotice(preset);
                    api.sessionOp(campaignId, { op: 'notice', text: preset });
                  }}
                >
                  {preset}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                className={`${input} min-w-0 flex-1`}
                placeholder="SHORT REST · roll perception…"
                value={notice}
                onChange={(e) => setNotice(e.target.value)}
                onKeyDown={(e) =>
                  e.key === 'Enter' &&
                  api.sessionOp(campaignId, { op: 'notice', text: notice })
                }
              />
              <button
                className={btn}
                onClick={() => api.sessionOp(campaignId, { op: 'notice', text: notice })}
              >
                show
              </button>
              <button
                className={btn}
                disabled={!session?.notice}
                onClick={() => {
                  setNotice('');
                  api.sessionOp(campaignId, { op: 'notice', text: null });
                }}
              >
                clear
              </button>
            </div>
          </div>

          <div className={`${card} space-y-2`}>
            <div className="flex items-center justify-between">
              <span className={sectionLabel}>Scenes</span>
              <div className="flex gap-1">
                {(campaign.data.activeMapId || campaign.data.map) && (
                  <button
                    className="rounded-md px-2 py-1 text-sm text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200"
                    onClick={() => {
                      const clears: Promise<unknown>[] = [
                        api.patchCampaign(campaign.id, { data: { activeMapId: null } }),
                      ];
                      if (campaign.data.map) clears.push(api.removeMap(campaignId));
                      Promise.all(clears).then(() => refetch());
                    }}
                    title="table goes dark (idle mark)"
                  >
                    clear
                  </button>
                )}
                <label className="cursor-pointer rounded-md px-2 py-1 text-sm text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200">
                  + upload
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      api
                        .uploadScene(campaignId, file)
                        .then(() => refetch())
                        .catch((err2) =>
                          setError(String(err2 instanceof Error ? err2.message : err2)),
                        );
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
            {(campaign.data.maps ?? []).length === 0 ? (
              <p className="text-sm text-stone-600">
                no scenes yet — upload battle maps & splash art; tap one to put
                it on the table TV
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {(campaign.data.maps ?? []).map((scene) => {
                  const active = campaign.data.activeMapId === scene.id;
                  return (
                    <div key={scene.id} className="relative">
                      <button
                        className={`w-full rounded-lg text-left ${
                          active ? 'ring-2 ring-amber-500' : 'hover:opacity-80'
                        }`}
                        onClick={() =>
                          api
                            .patchCampaign(campaign.id, {
                              data: { activeMapId: active ? null : scene.id },
                            })
                            .then(() => refetch())
                        }
                        title={active ? 'on the table — tap to clear' : 'put on the table TV'}
                      >
                        <img
                          src={`/api/maps/${scene.key}`}
                          alt={scene.name}
                          className="h-24 w-full rounded-lg object-cover"
                        />
                        <span className="block truncate px-0.5 text-xs text-stone-400">
                          {scene.name}
                        </span>
                      </button>
                      <button
                        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-stone-950/80 text-xs text-stone-400 hover:text-red-300"
                        onClick={() =>
                          api.deleteScene(campaignId, scene.id).then(() => refetch())
                        }
                        aria-label={`delete ${scene.name}`}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={`${card} space-y-2`}>
            <div className="flex items-center justify-between">
              <span className={sectionLabel}>Table grid</span>
              <button
                className={`rounded-md px-2 py-1 text-sm transition-colors ${
                  campaign.data.grid?.on
                    ? 'bg-amber-700 text-stone-950'
                    : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
                }`}
                onClick={() => patchGrid((g) => ({ ...g, on: !g.on }))}
              >
                {campaign.data.grid?.on ? 'on' : 'off'}
              </button>
            </div>
            {campaign.data.grid?.on && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <button
                    className="h-8 w-8 rounded-lg bg-stone-800 text-lg text-stone-200 hover:bg-stone-700"
                    aria-label="smaller squares"
                    onClick={() => nudgeGrid(-0.5)}
                  >
                    −
                  </button>
                  <span className="font-mono text-sm text-stone-400">
                    {(campaign.data.grid?.ppi ?? 40).toFixed(1)} px/in
                  </span>
                  <button
                    className="h-8 w-8 rounded-lg bg-stone-800 text-lg text-stone-200 hover:bg-stone-700"
                    aria-label="larger squares"
                    onClick={() => nudgeGrid(0.5)}
                  >
                    +
                  </button>
                </div>
                <div className="flex items-center justify-center gap-2">
                  {(
                    [
                      ['←', -2, 0],
                      ['↑', 0, -2],
                      ['↓', 0, 2],
                      ['→', 2, 0],
                    ] as const
                  ).map(([label, dx, dy]) => (
                    <button
                      key={label}
                      className="h-8 w-8 rounded-lg bg-stone-800 text-sm text-stone-200 hover:bg-stone-700"
                      aria-label={`pan grid ${label}`}
                      onClick={() => panGrid(dx, dy)}
                    >
                      {label}
                    </button>
                  ))}
                  <span className="ml-1 text-xs text-stone-600">pan</span>
                </div>
                <p className="text-xs leading-snug text-stone-600">
                  ± until a mini base fits a square exactly; arrows slide the
                  lines onto the map's walls &amp; streets
                </p>
              </>
            )}
          </div>

          <div className={`${card} space-y-2`}>
            <div className="flex items-center justify-between">
              <span className={sectionLabel}>Handouts</span>
              <div className="flex gap-1">
                {campaign.data.activeHandoutId && (
                  <button
                    className="rounded-md px-2 py-1 text-sm text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200"
                    onClick={() =>
                      api
                        .patchCampaign(campaign.id, { data: { activeHandoutId: null } })
                        .then(() => refetch())
                    }
                  >
                    hide
                  </button>
                )}
                <label className="cursor-pointer rounded-md px-2 py-1 text-sm text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200">
                  + upload
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      api
                        .uploadHandout(campaignId, file)
                        .then(() => refetch())
                        .catch((err2) =>
                          setError(String(err2 instanceof Error ? err2.message : err2)),
                        );
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
            {(campaign.data.handouts ?? []).length === 0 ? (
              <p className="text-sm text-stone-600">
                none yet — push art, letters, WANTED posters to the board & art panels
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {(campaign.data.handouts ?? []).map((handout) => {
                  const active = campaign.data.activeHandoutId === handout.id;
                  return (
                    <div key={handout.id} className="relative">
                      <button
                        className={`w-full rounded-lg text-left ${
                          active ? 'ring-2 ring-amber-500' : 'hover:opacity-80'
                        }`}
                        onClick={() =>
                          api
                            .patchCampaign(campaign.id, {
                              data: { activeHandoutId: active ? null : handout.id },
                            })
                            .then(() => refetch())
                        }
                        title={active ? 'showing — tap to hide' : 'show on board & art panels'}
                      >
                        <img
                          src={`/api/maps/${handout.key}`}
                          alt={handout.name}
                          className="h-20 w-full rounded-lg object-cover"
                        />
                        <span className="block truncate px-0.5 text-xs text-stone-400">
                          {handout.name}
                        </span>
                      </button>
                      <button
                        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-stone-950/80 text-xs text-stone-400 hover:text-red-300"
                        onClick={() =>
                          api.deleteHandout(campaignId, handout.id).then(() => refetch())
                        }
                        aria-label={`delete ${handout.name}`}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </>
          )}

          {showLibrary && (
          <>
          <RulesPanel packs={packs} onUploaded={loadPacks} />

          <div className={`${card} space-y-2`}>
            <span className={sectionLabel}>Reference</span>
            <textarea
              className={`${input} min-h-24 w-full resize-y font-mono text-xs leading-relaxed`}
              placeholder="house rules, statuses, ranges — the Warden's screen text (private to this campaign)"
              defaultValue={campaign.data.reference ?? ''}
              onBlur={(e) =>
                e.target.value !== (campaign.data.reference ?? '') &&
                api
                  .patchCampaign(campaign.id, { data: { reference: e.target.value } })
                  .catch(() => refetch())
              }
              aria-label="campaign reference"
            />
          </div>

          <div className={card}>
            <CounterSection
              label="Party resources"
              counters={campaign.data.counters}
              editable
              onChange={(counters) => {
                setCampaign({ ...campaign, data: { ...campaign.data, counters } });
                api
                  .patchCampaign(campaign.id, { data: { counters } })
                  .catch(() => refetch());
              }}
            />
          </div>
          </>
          )}
        </div>
        )}

        {showCharacters && (
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            {characters.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                vocabulary={campaign.data.vocabulary}
                lookup={lookup}
                onPatch={(patch) => patchCharacter(character.id, patch)}
                onDelete={() =>
                  api.deleteCharacter(character.id).catch(() => refetch())
                }
                onDuplicate={() =>
                  api
                    .duplicateCharacter(character.id)
                    .then(() => refetch())
                    .catch((e) => setError(String(e instanceof Error ? e.message : e)))
                }
              />
            ))}
          </div>

          <div className={`${card} space-y-2`}>
            <span className={sectionLabel}>New character</span>
            <div className="flex gap-2">
              <input
                className={`${input} min-w-0 flex-1`}
                placeholder="name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCharacter()}
              />
              <select
                className={input}
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as 'pc' | 'npc')}
              >
                <option value="pc">PC</option>
                <option value="npc">NPC</option>
              </select>
              <button className={btn} onClick={addCharacter}>
                add
              </button>
            </div>
          </div>
        </div>
        )}
      </div>
    </main>
  );
}
