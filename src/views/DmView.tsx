import { useCallback, useEffect, useRef, useState } from 'react';
import type { Campaign, Character, CharacterData } from '../../worker/types';
import { api, getDmKey, setDmKey } from '../lib/api';
import { useSession } from '../lib/use-session';
import { btn, btnPrimary, card, input, sectionLabel } from '../lib/ui';
import { CharacterCard } from '../components/CharacterCard';
import { CounterSection } from '../components/CounterSection';
import { InitiativePanel } from '../components/InitiativePanel';

export function DmView({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<'pc' | 'npc'>('pc');
  const [notice, setNotice] = useState('');
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

  // SSE poke → debounced refetch (a burst of taps = one fetch).
  const session = useSession(campaignId, () => {
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
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="font-serif text-3xl text-stone-100">{campaign.name}</h1>
        <span className="font-mono text-xs text-stone-500">
          {campaign.system} · {gm}'s console
        </span>
        <span className="ml-auto flex gap-4">
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
        </span>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="space-y-6">
          <InitiativePanel
            session={session}
            characters={characters}
            onOp={(op) => api.sessionOp(campaignId, op).catch(() => refetch())}
          />

          <div className={`${card} space-y-2`}>
            <span className={sectionLabel}>Table notice</span>
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
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            {characters.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                vocabulary={campaign.data.vocabulary}
                onPatch={(patch) => patchCharacter(character.id, patch)}
                onDelete={() =>
                  api.deleteCharacter(character.id).catch(() => refetch())
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
      </div>
    </main>
  );
}
