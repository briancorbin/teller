import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Campaign,
  Character,
  CharacterData,
  Display,
  PackRecord,
  Scene,
} from '../../worker/types';
import { api, getDmKey, newLocalId, setDmKey } from '../lib/api';
import { useRuleLookup } from '../lib/rules';
import { useSession } from '../lib/use-session';
import { useWakeLock } from '../lib/use-wake-lock';
import { btn, btnPrimary, card, input, sectionLabel } from '../lib/ui';
import { CharacterCard } from '../components/CharacterCard';
import { ConnectionHint } from '../components/ConnectionHint';
import { SceneEditor } from '../components/SceneEditor';
import { CounterSection } from '../components/CounterSection';
import { DisplaysPanel } from '../components/DisplaysPanel';
import { EncounterPanel } from '../components/EncounterPanel';
import { RulesPanel } from '../components/RulesPanel';

// A pane is a focused slice of the console — one slice per DM-screen
// panel. A screen assigned the 'console' role renders exactly one:
//   session    → the encounter · notices · handouts
//   encounter  → turn order, stats and states, on its own
//   map        → scenes · table grid (everything the table TV shows)
//   characters → the character grid
//   library    → rules · reference · party resources
//   displays   → the screens in the room, and what each one is
const PANES = ['session', 'encounter', 'map', 'characters', 'library', 'displays'] as const;

export function DmView({
  campaignId,
  pane,
  onPane,
  onLock,
}: {
  campaignId: string;
  pane: string | null;
  onPane: (pane: string | null) => void;
  /** Absent on a screen the DM promoted — it has no key to give up. */
  onLock?: () => void;
}) {
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
  /** The screen on table duty — it owns the calibration, not the campaign. */
  const [tableScreen, setTableScreen] = useState<Display | null>(null);
  // Which scene the map pane is shaping — independent of what's live.
  const [editSceneId, setEditSceneId] = useState<string | null>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const loadTableScreen = useCallback(() => {
    api
      .displays(campaignId)
      .then((ds) => {
        // More than one screen can be on table duty. The preview can
        // only describe one, so prefer a screen that has actually
        // reported itself, then the most recently seen of those.
        const tables = ds.filter((d) => d.role === 'table');
        const live = tables.filter((d) => d.viewport);
        const pick = (live.length ? live : tables).sort((a, b) =>
          b.lastSeenAt.localeCompare(a.lastSeenAt),
        )[0];
        setTableScreen(pick ?? null);
      })
      .catch(() => setTableScreen(null));
  }, [campaignId]);
  useEffect(loadTableScreen, [loadTableScreen]);

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

  /** Calibration is written to the SCREEN it describes, not the campaign. */
  const calibrate = (ppi: number, ppiY: number) => {
    if (!tableScreen) return;
    setTableScreen({ ...tableScreen, ppi, ppiY });
    api
      .patchDisplay(tableScreen.id, { ppi, ppiY })
      .then(loadTableScreen)
      .catch(loadTableScreen);
  };

  const activateScene = (id: string | null) => {
    setCampaign((prev) =>
      prev ? { ...prev, data: { ...prev.data, activeMapId: id } } : prev,
    );
    api.patchCampaign(campaignId, { data: { activeMapId: id } }).catch(() => refetch());
  };

  // Live scene edits: optimistic locally, debounced to the wire so a
  // paint drag or a framing drag is one write.
  const onSceneChange = (next: Scene) => {
    setCampaign((prev) => {
      if (!prev) return prev;
      const maps = (prev.data.maps ?? []).map((s) => (s.id === next.id ? next : s));
      if (sceneSaveTimer.current) clearTimeout(sceneSaveTimer.current);
      sceneSaveTimer.current = setTimeout(() => {
        api.patchCampaign(campaignId, { data: { maps } }).catch(() => refetch());
      }, 400);
      return { ...prev, data: { ...prev.data, maps } };
    });
  };

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

  const paneChip = (label: string, value: string | null) => (
    <button
      key={label}
      className={`rounded-full px-2.5 py-0.5 font-mono text-xs transition-colors ${
        pane === value
          ? 'bg-amber-700 text-stone-950'
          : 'bg-stone-900 text-stone-400 hover:text-stone-200'
      }`}
      onClick={() => onPane(value)}
    >
      {label}
    </button>
  );

  const paneNav = (
    <nav className="flex flex-wrap gap-1.5" aria-label="console panes">
      {paneChip('full', null)}
      {PANES.map((p) => paneChip(p, p))}
      {onLock && (
        <button
          className="rounded-full px-2.5 py-0.5 font-mono text-xs text-stone-600 transition-colors hover:text-stone-300"
          onClick={onLock}
        >
          lock
        </button>
      )}
    </nav>
  );

  // One encounter component: the session pane and the encounter pane
  // show the same thing, the latter on its own for a DM-screen panel.
  const liveScene = (campaign.data.maps ?? []).find(
    (sc) => sc.id === campaign.data.activeMapId,
  );
  const tokenLinks = new Set(
    (liveScene?.tokens ?? [])
      .map((t) => t.characterId)
      .filter((id): id is string => Boolean(id)),
  );
  const dropToken = (characterId: string, label: string) => {
    if (!liveScene) return;
    const character = characters.find((c) => c.id === characterId);
    onSceneChange({
      ...liveScene,
      tokens: [
        ...(liveScene.tokens ?? []),
        {
          id: newLocalId('tok'),
          label,
          u: 0.5,
          v: 0.5,
          sizeInches: 1,
          color: character?.kind === 'npc' ? '#f87171' : '#38bdf8',
          characterId,
        },
      ],
    });
  };
  const encounterPanel = (
    <EncounterPanel
      session={session}
      characters={characters}
      states={campaign.data.states ?? []}
      tokenLinks={tokenLinks}
      onOp={(op) => api.sessionOp(campaignId, op).catch(() => refetch())}
      onPatchCharacter={patchCharacter}
      onDropToken={dropToken}
    />
  );

  // Turn order and everything you reach for mid-fight.
  if (pane === 'encounter') {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-3 p-3">
        <ConnectionHint connected={connected} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-serif text-xl text-stone-300">{campaign.name}</h1>
          {paneNav}
        </div>
        {encounterPanel}
      </main>
    );
  }

  // The patch bay: every screen in the room and what each one is.
  if (pane === 'displays') {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-3 p-3">
        <ConnectionHint connected={connected} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-serif text-xl text-stone-300">{campaign.name}</h1>
          {paneNav}
        </div>
        <DisplaysPanel campaignId={campaignId} characters={characters} />
      </main>
    );
  }

  // The map pane is the workshop. What you SHAPE and what the players
  // SEE are separate on purpose: prep a scene off the table, then put
  // it up when the moment comes. A station can sit on this URL all
  // session; ?scene=<id> makes a particular workbench linkable.
  if (pane === 'map') {
    const scenes = campaign.data.maps ?? [];
    const editing =
      scenes.find((s) => s.id === editSceneId) ??
      scenes.find((s) => s.id === campaign.data.activeMapId) ??
      scenes[0];
    const isLive = !!editing && editing.id === campaign.data.activeMapId;

    const pickScene = (id: string) => setEditSceneId(id);

    return (
      <main className="flex h-screen flex-col gap-3 p-3">
        <ConnectionHint connected={connected} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-serif text-xl text-stone-300">{campaign.name}</h1>
          {paneNav}

          {scenes.length > 0 && (
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <select
                className={`${input} max-w-52`}
                value={editing?.id ?? ''}
                onChange={(e) => pickScene(e.target.value)}
                aria-label="scene to work on"
              >
                {scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.id === campaign.data.activeMapId ? ' — on the table' : ''}
                  </option>
                ))}
              </select>

              {editing &&
                (isLive ? (
                  <button
                    className="rounded-lg bg-stone-800 px-3 py-1.5 font-mono text-xs text-stone-300 hover:bg-stone-700"
                    onClick={() => activateScene(null)}
                    title="clear the table (goes to the idle mark)"
                  >
                    take off table
                  </button>
                ) : (
                  <button
                    className="rounded-lg bg-amber-700 px-3 py-1.5 font-mono text-xs text-stone-950 hover:bg-amber-600"
                    onClick={() => activateScene(editing.id)}
                    title="show this scene to the table"
                  >
                    put on table ↗
                  </button>
                ))}
            </span>
          )}
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-stone-800">
          {editing ? (
            <SceneEditor
              campaignId={campaignId}
              key={editing.id}
              scene={editing}
              live={isLive}
              combatRunning={(session?.turn ?? null) !== null}
              table={tableScreen}
              onCalibrate={calibrate}
              characters={characters.map((c) => ({
                id: c.id,
                name: c.name,
                kind: c.kind,
              }))}
              onChange={onSceneChange}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
              <p className="text-stone-500">no scenes yet</p>
              <p className="text-sm text-stone-600">
                upload battle maps from the console's Scenes card
              </p>
            </div>
          )}
        </div>
      </main>
    );
  }

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

      {paneNav}

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
          {showSession && encounterPanel}

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
          </>
          )}

          {showSession && (
          <>
          <div className={`${card} space-y-2`}>
            <div className="flex items-center justify-between">
              <span className={sectionLabel}>Scenes</span>
              <div className="flex gap-1">
                {campaign.data.activeMapId && (
                  <a
                    className="rounded-md px-2 py-1 text-sm text-amber-300/80 transition-colors hover:bg-stone-800 hover:text-amber-300"
                    href={`/dm/${campaignId}?pane=map`}
                    title="shape the live scene — framing, tokens, ground effects"
                  >
                    edit ↗
                  </a>
                )}
                {(campaign.data.activeMapId || campaign.data.map) && (
                  <button
                    className="rounded-md px-2 py-1 text-sm text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200"
                    onClick={() => {
                      activateScene(null);
                      if (campaign.data.map) api.removeMap(campaignId).then(refetch);
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
                        onClick={() => activateScene(active ? null : scene.id)}
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
                      <a
                        className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-stone-950/80 text-xs text-stone-400 hover:text-amber-300"
                        href={`/dm/${campaignId}?pane=map`}
                        onClick={() => activateScene(scene.id)}
                        aria-label={`edit ${scene.name} in the map workshop`}
                        title="put it up and shape it in the map workshop"
                      >
                        ✎
                      </a>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </>
          )}

          {showSession && (
          <>
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
