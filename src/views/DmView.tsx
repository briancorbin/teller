import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Campaign,
  Character,
  CharacterData,
  Display,
  Encounter,
  PackRecord,
  RulesPack,
  Scene,
  SystemTemplate,
} from '../../worker/types';
import { api, ApiError, getDmKey, newLocalId, setDmKey } from '../lib/api';
import type { SourcedNpc } from '../../worker/bestiary';
import { tierHolders } from '../../worker/items';
import { PANES } from '../lib/panes';
import { useRuleLookup } from '../lib/rules';
import { useSession } from '../lib/use-session';
import { useWakeLock } from '../lib/use-wake-lock';
import { btn, btnPrimary, card, input, sectionLabel } from '../lib/ui';
import { CharacterCard } from '../components/CharacterCard';
import { ConnectionHint } from '../components/ConnectionHint';
import { SceneEditor } from '../components/SceneEditor';
import { CounterSection } from '../components/CounterSection';
import { BestiaryPanel } from '../components/BestiaryPanel';
import { BooksPanel } from '../components/BooksPanel';
import { BundleImport } from '../components/BundleImport';
import { CreationDialog } from '../components/CreationDialog';
import { DisplaysPanel } from '../components/DisplaysPanel';
import { EncounterPanel } from '../components/EncounterPanel';
import { EncountersPanel } from '../components/EncountersPanel';
import { RulesPanel } from '../components/RulesPanel';
import { StorePanel } from '../components/StorePanel';

/**
 * Who's in the characters pane.
 *
 * `kind` is the whole distinction now. A deployed monster used to carry
 * the fight it came from, so "on the table" was a third category; deploy
 * stopped leaving that behind — a stamped creature is just a creature —
 * and the pane is simpler for it.
 */
const CAST_FILTERS: {
  key: string;
  label: string;
  match: (c: Character) => boolean;
}[] = [
  { key: 'all', label: 'everyone', match: () => true },
  { key: 'party', label: 'party', match: (c) => c.kind === 'pc' },
  { key: 'foes', label: 'foes', match: (c) => c.kind === 'npc' },
];

export function DmView({
  campaignId,
  pane,
  onPane,
  onLock,
  onLeave,
  onMissing,
}: {
  campaignId: string;
  pane: string | null;
  onPane: (pane: string | null) => void;
  /** Absent on a screen the DM promoted — it has no key to give up. */
  onLock?: () => void;
  /**
   * Back to the campaign list, keeping the key. Absent for the same
   * reason `onLock` is: a screen the DM assigned to a campaign is what
   * they said it is, and must not wander to a different one (rule 7).
   */
  onLeave?: () => void;
  /** The campaign is gone; forget it and show the list again. */
  onMissing?: () => void;
}) {
  const showSession = pane === null || pane === 'session';

  /**
   * Whether this host has an assistant wired up (TEL-85). Checked once;
   * an unconfigured host renders no trace of the feature — the button
   * only exists where an answer can (rule 7: allowed, never required).
   */
  const [assistantOn, setAssistantOn] = useState(false);
  useEffect(() => {
    api
      .assistant()
      .then((a) => setAssistantOn(a.configured))
      .catch(() => setAssistantOn(false));
  }, []);
  const showCharacters = pane === null || pane === 'characters';
  const showLibrary = pane === null || pane === 'library';
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [error, setError] = useState('');
  // Pack foes plus this campaign's own, already merged by the server.
  const [bestiary, setBestiary] = useState<SourcedNpc[]>([]);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<'pc' | 'npc'>('pc');
  const [creating, setCreating] = useState(false);
  const [castFilter, setCastFilter] = useState('all');
  const [castQuery, setCastQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [packs, setPacks] = useState<PackRecord[]>([]);
  /** The system this campaign runs — its dice, mostly. */
  const [template, setTemplate] = useState<SystemTemplate | null>(null);
  /** Packs this campaign claims that the host doesn't hold. */
  const [missingPacks, setMissingPacks] = useState<string[]>([]);
  /** The screen on table duty — it owns the calibration, not the campaign. */
  const [tableScreen, setTableScreen] = useState<Display | null>(null);
  // Which scene the map pane is shaping — independent of what's live.
  const [editSceneId, setEditSceneId] = useState<string | null>(null);
  /** The prepared fight being arranged on the map pane, if any. */
  const [arrangingId, setArrangingId] = useState<string | null>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(() => {
    api
      .getCampaign(campaignId)
      .then(({ campaign, characters, bestiary, missingPacks }) => {
        setCampaign(campaign);
        setCharacters(characters);
        setBestiary(bestiary ?? []);
        setMissingPacks(missingPacks ?? []);
        setError('');
      })
      .catch((e) => {
        // A campaign that isn't there is not an error to stare at — it's
        // a stale pointer, and the only useful thing to do is go back to
        // the list. This happens for real: the id is remembered per
        // origin, so pointing a browser at a different host (or a fresh
        // one) leaves it holding an id that host has never heard of.
        //
        // A 404 means gone; anything else means the host is unreachable
        // or unhappy, and dropping the Warden out of their campaign
        // mid-session over a blip would be much worse than a message.
        if (e instanceof ApiError && e.status === 404) {
          onMissing?.();
          return;
        }
        setError(String(e instanceof Error ? e.message : e));
      });
  }, [campaignId, onMissing]);

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

  /**
   * The book's die-face art, from whichever pack carries creation
   * marks — the same images the character creator renders, so the
   * encounter's dice and the builder's dice are one vocabulary.
   */
  /**
   * Every pack item by id, so a carried weapon can be read for the
   * dice it rolls. A character's item is a reference (`from`); the
   * numbers live in the catalogue it came from.
   */
  const catalogById = useMemo(() => {
    const map = new Map<string, { name: string; kind?: string; fields?: { key: string; value: string }[] }>();
    for (const p of packs) {
      for (const item of p.pack.catalog?.items ?? []) map.set(item.id, item);
    }
    return map;
  }, [packs]);

  const dieArt = useMemo(() => {
    for (const p of packs) {
      const marks = p.pack.creation?.marks;
      if (marks) return { marks, version: p.pack.version ?? 0 };
    }
    return null;
  }, [packs]);

  // The system's dice, so the picker can tell a die pool from a price.
  // `/api/templates` is open and the console already holds the key —
  // this is the same fetch the seat makes, for the same reason.
  useEffect(() => {
    if (!campaign) return;
    api
      .templates()
      .then((all) => setTemplate(all.find((t) => t.system === campaign.system) ?? null))
      .catch(() => setTemplate(null));
  }, [campaign?.system]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * The packs this table actually runs on, in precedence order.
   *
   * `packsFor` on the server, in the client's own terms — the console
   * must show a Warden the same catalogue their players' seats do, and
   * `packs` here is every pack for the system rather than this
   * campaign's claim. Same fallback, deliberately: no claim means all of
   * them, because a host with one pack should never make anyone tick a
   * box.
   */
  const activePacks = useMemo(() => {
    const claim = campaign?.data.packs;
    if (!claim?.length) return packs.map((p) => p.pack);
    const byId = new Map(packs.map((p) => [p.id, p.pack]));
    return claim.map((id) => byId.get(id)).filter((p): p is RulesPack => Boolean(p));
  }, [packs, campaign?.data.packs]);

  /**
   * Who already holds something at each tier, for the rise proposal's
   * one-of notice.
   *
   * Off `characters` and never `shownCast`: the question is "does this
   * posse already have a Legendary", and it does whether or not the
   * name filter happens to be showing that person right now.
   *
   * Up HERE, above the loading and error returns, because that's where
   * hooks have to live — placing it beside the cast it's about read
   * better and cost a blank console, since a render that takes an early
   * return would have run one hook fewer (React #310).
   */
  const tiersHeld = useMemo(
    () =>
      template?.growth
        ? tierHolders(
            characters,
            activePacks,
            campaign?.data.catalog,
            template.growth,
            template.dice,
          )
        : undefined,
    [characters, activePacks, campaign?.data.catalog, template],
  );

  // SSE poke → debounced refetch (a burst of taps = one fetch).
  useWakeLock();
  const { session, connected } = useSession(
    campaignId,
    () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(refetch, 300);
    },
    {
      // A display changed (a rename, or the camera's inch card writing
      // calibration) — refresh what the workshop knows about the table
      // so the frame preview and the px/in readout track it live.
      onDisplay: () => loadTableScreen(),
    },
  );

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

  /**
   * Keep an NPC sheet in the bestiary. A blueprint is a starting kit,
   * not a live link — editing the copy later never touches the original.
   *
   * Identity is the id, never the name. Keying on name meant renaming a
   * foe left the old blueprint behind, and two different creatures that
   * happened to share a name silently ate each other. So: a character
   * that came from one of YOUR blueprints updates it in place; anything
   * else becomes a new one. Pack blueprints are the publisher's and are
   * never written back to — tuning one of those for a single fight
   * belongs in that encounter, not in the bestiary.
   */
  const saveBlueprint = (character: Character) => {
    const own = campaign?.data.npcs ?? [];
    const from = character.data.blueprintId;
    const mine = from ? own.find((n) => n.id === from) : undefined;
    const blueprint = {
      id: mine?.id ?? newLocalId('npc'),
      name: character.name,
      fields: structuredClone(character.data.fields),
      counters: structuredClone(character.data.counters),
      tags: [...character.data.tags],
    };
    const npcs = mine
      ? own.map((n) => (n.id === mine.id ? blueprint : n))
      : [...own, blueprint];
    setCampaign((prev) => (prev ? { ...prev, data: { ...prev.data, npcs } } : prev));
    api.patchCampaign(campaignId, { data: { npcs } }).catch(() => refetch());
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
  /**
   * A deployed fight walks onto the table AND into the turn order,
   * carrying what teller rolled for it. Spawning from the bestiary has
   * always done this; deploy not doing it was an inconsistency, and it
   * left every foe stranded in the "not in the order yet" list.
   *
   * The order is still yours: these land as a proposal you can drag.
   */
  const seatDeployed = (
    deployed?: {
      characters: Character[];
      rolls: Record<string, { total: number; faces: string[] }>;
    },
  ) => {
    refetch();
    if (!deployed?.characters.length) return;
    const entries = deployed.characters.map((c) => ({
      id: newLocalId('ini'),
      characterId: c.id,
      label: c.name,
      score: deployed.rolls[c.id]?.total ?? null,
    }));
    api
      .sessionOp(campaignId, {
        op: 'set',
        initiative: [...(session?.initiative ?? []), ...entries],
      })
      .catch(() => refetch());
  };

  // Party first, then the recurring cast, then whatever's on the table —
  // so position in the list means something even before you read a name.
  const shownCast = characters
    .filter((c) => CAST_FILTERS.find((f) => f.key === castFilter)?.match(c) ?? true)
    .filter((c) => c.name.toLowerCase().includes(castQuery.trim().toLowerCase()))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'pc' ? -1 : 1));

  /** Say which printing of a foe this table uses (rule 1 over pack order). */
  const pickFoeSource = (npcId: string, packId: string) => {
    const foePicks = { ...(campaign?.data.foePicks ?? {}), [npcId]: packId };
    setCampaign((prev) => (prev ? { ...prev, data: { ...prev.data, foePicks } } : prev));
    api.patchCampaign(campaignId, { data: { foePicks } }).catch(() => refetch());
  };

  // Stamp out a group, put it in the order, and get it onto the map —
  // one tap, because that's the moment a fight starts.
  const spawnGroup = async (npcId: string, count: number) => {
    try {
      const { characters: made } = await api.spawn(campaignId, npcId, count);
      await api.sessionOp(campaignId, {
        op: 'set',
        initiative: [
          ...(session?.initiative ?? []),
          ...made.map((c) => ({
            id: newLocalId('ini'),
            characterId: c.id,
            label: c.name,
          })),
        ],
      });
      if (liveScene) {
        // Fanned out rather than stacked, so they can be dragged apart.
        onSceneChange({
          ...liveScene,
          tokens: [
            ...(liveScene.tokens ?? []),
            ...made.map((c, i) => ({
              id: newLocalId('tok'),
              label: c.name,
              u: 0.5 + ((i % 5) - 2) * 0.04,
              v: 0.5 + Math.floor(i / 5) * 0.06,
              sizeInches: 1,
              color: '#f87171',
              characterId: c.id,
            })),
          ],
        });
      }
      refetch();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  /**
   * Prepared fights live next to the running one, because they're the
   * same noun at two moments: you prep an encounter, then one runs.
   */
  const saveEncounters = (encounters: Encounter[]) => {
    setCampaign((prev) =>
      prev ? { ...prev, data: { ...prev.data, encounters } } : prev,
    );
    api.patchCampaign(campaignId, { data: { encounters } }).catch(() => refetch());
  };

  const encountersPanel = (
    <EncountersPanel
      campaign={campaign}
      bestiary={bestiary}
      onChange={saveEncounters}
      onTable={characters.filter((c) => c.kind === 'npc').length}
      onDeployed={seatDeployed}
    />
  );

  const encounterPanel = (
    <EncounterPanel
      session={session}
      characters={characters}
      states={campaign.data.states ?? []}
      npcs={bestiary}
      onSpawn={spawnGroup}
      tokenLinks={tokenLinks}
      onOp={(op) => api.sessionOp(campaignId, op).catch(() => refetch())}
      onRollNpcs={() =>
        // Open the phase — which clears every score — and immediately
        // roll back in the ones nobody wants to roll by hand. One tap:
        // the monsters are done, the seats are asked.
        api
          .sessionOp(campaignId, { op: 'rolling', on: true })
          .then(() => api.rollNpcInitiative(campaignId))
          .catch(() => refetch())
      }
      onPatchCharacter={patchCharacter}
      onResolve={(body) =>
        api
          .resolveTurn(campaignId, body)
          .then(() => refetch())
          .catch(() => refetch())
      }
      onDropToken={dropToken}
      onSuggest={
        assistantOn ? (characterId) => api.suggestTurn(campaignId, characterId) : undefined
      }
      onNarrate={
        assistantOn
          ? (characterId, action, result) =>
              api.narrateTurn(campaignId, characterId, action, result)
          : undefined
      }
      dice={template?.dice}
      dieArt={dieArt ?? undefined}
      catalog={catalogById}
    />
  );

  // Turn order and everything you reach for mid-fight.
  //
  // This pane is WIDE on purpose (Brian, 2026-08-15: the encounter
  // runner is desktop console glass and nothing else). It used to sit
  // in the same max-w-2xl column as every other pane, which meant a
  // fight was run in a phone's worth of width on a monitor; the panel
  // splits into roster + stage once its container has the room.
  if (pane === 'encounter') {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-3 p-3">
        <ConnectionHint connected={connected} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-serif text-xl text-stone-300">{campaign.name}</h1>
          {paneNav}
        </div>
        {encounterPanel}
        {encountersPanel}
      </main>
    );
  }

  // The shelf of foes. Search it, open one to see what it actually is,
  // then drop it into the fight.
  if (pane === 'bestiary') {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-3 p-3">
        <ConnectionHint connected={connected} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-serif text-xl text-stone-300">{campaign.name}</h1>
          {paneNav}
        </div>
        <BestiaryPanel
          npcs={bestiary}
          onSpawn={spawnGroup}
          picks={campaign.data.foePicks}
          onPick={pickFoeSource}
        />
      </main>
    );
  }

  // The world's shops: vendors between sessions, the counter when one
  // is open. Its own pane because a shop visit is a whole scene — a
  // DM-screen panel can sit on it while the posse resupplies.
  if (pane === 'store') {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-3 p-3">
        <ConnectionHint connected={connected} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-serif text-xl text-stone-300">{campaign.name}</h1>
          {paneNav}
        </div>
        <StorePanel
          campaign={campaign}
          characters={characters}
          packs={activePacks}
          template={template}
          session={session}
          gm={gm}
          onVendors={(vendors) => {
            setCampaign((prev) =>
              prev ? { ...prev, data: { ...prev.data, vendors } } : prev,
            );
            api.patchCampaign(campaignId, { data: { vendors } }).catch(() => refetch());
          }}
          onOp={(op) => api.sessionOp(campaignId, op).catch(() => refetch())}
          onPatchCharacter={patchCharacter}
        />
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
        <DisplaysPanel
          campaignId={campaignId}
          characters={characters}
          packs={activePacks}
        />
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

    // Arranging a fight is a mode you enter deliberately: a map you
    // opened to paint fog on shouldn't sprout draggable foes.
    const arrangeable = (campaign.data.encounters ?? []).filter(
      (e) => editing && e.sceneId === editing.id,
    );
    const arranging = arrangeable.find((e) => e.id === arrangingId) ?? null;
    const blueprintNames = new Map(bestiary.map((n) => [n.id, n.name]));

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
              onMoved={(move) => api.logMove(campaignId, move).catch(() => {})}
              fights={arrangeable.map((e) => ({ id: e.id, name: e.name }))}
              arrangingId={arrangingId}
              onArrange={setArrangingId}
              placements={arranging?.foes}
              placementNames={blueprintNames}
              onPlacements={
                arranging
                  ? (foes) => saveEncounters(
                      (campaign.data.encounters ?? []).map((e) =>
                        e.id === arranging.id ? { ...e, foes } : e,
                      ),
                    )
                  : undefined
              }
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
          {onLeave && (
            <button
              className="font-mono text-xs text-stone-500 underline-offset-2 hover:text-amber-300 hover:underline"
              onClick={onLeave}
              title="back to the campaign list — the key stays put"
            >
              ← campaigns
            </button>
          )}
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
            <BooksPanel
              expects={campaign.data.books ?? []}
              onExpects={(books) => {
                setCampaign((prev) =>
                  prev ? { ...prev, data: { ...prev.data, books } } : prev,
                );
                api.patchCampaign(campaignId, { data: { books } }).catch(() => refetch());
              }}
            />
          )}

          {showLibrary && (
          <>
          {/* Layering onto a table you're already running: a module, a
              bestiary, more maps. Landing does the make-a-campaign half. */}
          <BundleImport
            campaignId={campaign.id}
            onDone={() => {
              refetch();
              loadPacks();
            }}
          />

          <RulesPanel
            packs={packs}
            claim={campaign.data.packs}
            missing={missingPacks}
            onClaim={(ids) =>
              api
                .patchCampaign(campaign.id, { data: { packs: ids } })
                .then(refetch)
                .catch(() => refetch())
            }
            onUploaded={loadPacks}
          />

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
          <div className={`${card} flex flex-wrap items-center gap-2`}>
            {CAST_FILTERS.map((f) => {
              const n = characters.filter((c) => f.match(c)).length;
              const on = castFilter === f.key;
              return (
                <button
                  key={f.key}
                  className={`rounded-md px-2 py-1 font-mono text-xs ${
                    on
                      ? 'bg-amber-700 text-stone-950'
                      : 'bg-stone-900 text-stone-400 hover:text-stone-200'
                  }`}
                  onClick={() => setCastFilter(f.key)}
                  aria-pressed={on}
                >
                  {f.label} <span className="opacity-70">{n}</span>
                </button>
              );
            })}
            <input
              className={`${input} ml-auto w-44`}
              placeholder="find someone…"
              value={castQuery}
              onChange={(e) => setCastQuery(e.target.value)}
              aria-label="find a character"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {shownCast.length === 0 && (
              <p className="text-sm text-stone-600">
                {castQuery ? 'nobody by that name' : 'nobody here yet'}
              </p>
            )}
            {shownCast.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                vocabulary={campaign.data.vocabulary}
                lookup={lookup}
                packs={activePacks}
                ownCatalog={campaign.data.catalog}
                template={template}
                holders={tiersHeld}
                onOwnCatalog={(catalog) =>
                  api
                    .patchCampaign(campaign.id, { data: { catalog } })
                    .then(setCampaign)
                    .catch((e) => setError(String(e instanceof Error ? e.message : e)))
                }
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
                onSaveBlueprint={
                  character.kind === 'npc'
                    ? () => saveBlueprint(character)
                    : undefined
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
            {/* The guided path (TEL-75): the same five saddle-up steps
                the rail walks, compressed for prep speed. */}
            <button
              className="text-sm text-amber-400/90 underline-offset-2 hover:underline"
              onClick={() => setCreating(true)}
            >
              …or saddle up from a trade
            </button>
          </div>
        </div>
        )}
      </div>

      {creating && (
        <CreationDialog
          campaignId={campaignId}
          packs={activePacks}
          onDone={refetch}
          onClose={() => setCreating(false)}
        />
      )}
    </main>
  );
}
