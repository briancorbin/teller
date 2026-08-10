import { useState } from 'react';
import type { Campaign, Encounter, Placement, Scene } from '../../worker/types';
import type { SourcedNpc } from '../../worker/bestiary';
import { api, newLocalId } from '../lib/api';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui';

// Prepared fights.
//
// An encounter is a RECIPE, never a saved fight: who's in it, and where
// they start if there's a map. Deploying stamps out characters; the
// encounter stays pristine, so the same ambush can be run again next
// week for a different group. That's what makes a module a module.
//
// **Mapless is the normal case.** The table is the ground and most
// in-person fights happen on a mat or in description, so a scene is
// enrichment — exactly what a book is to a pack. Attaching one only
// adds markers on the table.
//
// Every foe is its own placement. Never a stack of three, because each
// one wants its own square, its own name, and its own answer to "is it
// hidden".

function foeLabel(placement: Placement, byId: Map<string, SourcedNpc>): string {
  return placement.name ?? byId.get(placement.blueprintId)?.name ?? 'missing foe';
}

/** Health is the counter people override; find it without hard-coding one. */
function healthName(npc: SourcedNpc | undefined): string | undefined {
  return npc?.counters.find((c) => /health|hp/i.test(c.name))?.name;
}

function PlacementRow({
  placement,
  npc,
  onChange,
  onRemove,
}: {
  placement: Placement;
  npc: SourcedNpc | undefined;
  onChange: (patch: Partial<Placement>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hp = healthName(npc);
  const hpOverride = hp ? placement.overrides?.counters?.[hp]?.max : undefined;
  const base = npc?.counters.find((c) => c.name === hp);

  return (
    <li className="rounded-md bg-stone-900">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          className="min-w-0 flex-1 truncate text-left text-sm text-stone-100"
          onClick={() => setOpen(!open)}
        >
          {foeLabel(placement, new Map(npc ? [[npc.id, npc]] : []))}
          {!npc && (
            <span className="ml-2 font-mono text-[11px] text-amber-500/80">
              not on this host
            </span>
          )}
        </button>
        {placement.hidden && (
          <span className="font-mono text-[11px] text-stone-500" title="behind the screen">
            hidden
          </span>
        )}
        {hpOverride != null && (
          <span className="font-mono text-[11px] text-amber-400">{hpOverride} hp</span>
        )}
        <button className={`${btnGhost} hover:text-red-300`} onClick={onRemove}>
          ✕
        </button>
      </div>

      {open && (
        <div className="space-y-2 border-t border-stone-800 px-2 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${input} min-w-0 flex-1`}
              placeholder={npc?.name ?? 'name'}
              value={placement.name ?? ''}
              onChange={(e) => onChange({ name: e.target.value || undefined })}
            />
            {hp && (
              <input
                className={`${input} w-20`}
                type="number"
                placeholder={String(base?.max ?? '')}
                value={hpOverride ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  const counters = { ...(placement.overrides?.counters ?? {}) };
                  if (value === '') delete counters[hp];
                  else counters[hp] = { max: Number(value) };
                  onChange({
                    overrides: { ...placement.overrides, counters },
                  });
                }}
              />
            )}
          </div>
          <label className="flex items-center gap-2 text-xs text-stone-400">
            <input
              type="checkbox"
              checked={placement.hidden ?? false}
              onChange={(e) => onChange({ hidden: e.target.checked })}
            />
            starts behind the screen
          </label>
          <input
            className={`${input} w-full`}
            placeholder="starting conditions — asleep, dug in…"
            value={(placement.tags ?? []).join(', ')}
            onChange={(e) =>
              onChange({
                tags: e.target.value
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
          />
          <p className="font-mono text-[11px] text-stone-600">
            anything left blank tracks {npc?.from ?? 'the bestiary'}
          </p>
        </div>
      )}
    </li>
  );
}

export function EncountersPanel({
  campaign,
  bestiary,
  onChange,
  onDeployed,
}: {
  campaign: Campaign;
  bestiary: SourcedNpc[];
  onChange: (encounters: Encounter[]) => void;
  onDeployed: () => void;
}) {
  const encounters = campaign.data.encounters ?? [];
  const scenes: Scene[] = campaign.data.maps ?? [];
  const byId = new Map(bestiary.map((n) => [n.id, n]));

  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [count, setCount] = useState(1);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const patch = (id: string, next: Partial<Encounter>) =>
    onChange(encounters.map((e) => (e.id === id ? { ...e, ...next } : e)));

  const create = () => {
    const encounter: Encounter = {
      id: newLocalId('enc'),
      name: `Encounter ${encounters.length + 1}`,
      foes: [],
    };
    onChange([...encounters, encounter]);
    setOpen(encounter.id);
  };

  /** Adding three makes three placements — never one row that says ×3. */
  const addFoes = (encounter: Encounter, blueprintId: string, howMany: number) => {
    const fresh: Placement[] = Array.from({ length: howMany }, () => ({
      id: newLocalId('plc'),
      blueprintId,
    }));
    patch(encounter.id, { foes: [...encounter.foes, ...fresh] });
  };

  const deploy = async (encounter: Encounter) => {
    setBusy(true);
    setStatus('');
    try {
      const { characters, missing, cleared } = await api.deployEncounter(
        campaign.id,
        encounter.id,
      );
      const parts = [`${characters.length} on the table`];
      if (cleared) parts.push(`cleared ${cleared} from last time`);
      if (missing.length) parts.push(`couldn’t find ${missing.length}`);
      setStatus(parts.join(' · '));
      onDeployed();
    } catch (e) {
      setStatus(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const clear = async (encounter: Encounter) => {
    setBusy(true);
    try {
      const { cleared } = await api.clearEncounter(campaign.id, encounter.id);
      setStatus(cleared ? `took ${cleared} off the table` : 'nothing was out');
      onDeployed();
    } catch (e) {
      setStatus(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${card} space-y-3`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>Prepared fights</span>
        <button className={btnGhost} onClick={create}>
          new encounter
        </button>
      </div>

      {encounters.length === 0 && (
        <p className="text-sm text-stone-600">
          nothing prepared — an encounter is who’s in a fight, ready to drop on the
          table. A map is optional.
        </p>
      )}

      {status && <p className="font-mono text-xs text-amber-400">{status}</p>}

      <ul className="space-y-2">
        {encounters.map((encounter) => {
          const expanded = open === encounter.id;
          return (
            <li key={encounter.id} className="rounded-md border border-stone-800">
              <div className="flex items-center gap-2 p-2">
                <button
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => setOpen(expanded ? null : encounter.id)}
                >
                  <span className="text-sm text-stone-100">{encounter.name}</span>
                  <span className="ml-2 font-mono text-[11px] text-stone-600">
                    {encounter.foes.length} foe{encounter.foes.length === 1 ? '' : 's'}
                    {encounter.sceneId
                      ? ` · ${scenes.find((s) => s.id === encounter.sceneId)?.name ?? 'a map'}`
                      : ' · no map'}
                  </span>
                </button>
                <button
                  className={btnPrimary}
                  disabled={busy || !encounter.foes.length}
                  onClick={() => deploy(encounter)}
                >
                  deploy
                </button>
                <button className={btn} disabled={busy} onClick={() => clear(encounter)}>
                  clear
                </button>
              </div>

              {expanded && (
                <div className="space-y-3 border-t border-stone-800 p-2">
                  <div className="flex flex-wrap gap-2">
                    <input
                      className={`${input} min-w-0 flex-1`}
                      value={encounter.name}
                      onChange={(e) => patch(encounter.id, { name: e.target.value })}
                    />
                    <select
                      className={`${input} text-xs`}
                      value={encounter.sceneId ?? ''}
                      onChange={(e) =>
                        patch(encounter.id, { sceneId: e.target.value || null })
                      }
                    >
                      <option value="">no map</option>
                      {scenes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <ul className="space-y-1">
                    {encounter.foes.map((placement) => (
                      <PlacementRow
                        key={placement.id}
                        placement={placement}
                        npc={byId.get(placement.blueprintId)}
                        onChange={(p) =>
                          patch(encounter.id, {
                            foes: encounter.foes.map((f) =>
                              f.id === placement.id ? { ...f, ...p } : f,
                            ),
                          })
                        }
                        onRemove={() =>
                          patch(encounter.id, {
                            foes: encounter.foes.filter((f) => f.id !== placement.id),
                          })
                        }
                      />
                    ))}
                  </ul>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className={`${input} min-w-0 flex-1 text-xs`}
                      value={adding}
                      onChange={(e) => setAdding(e.target.value)}
                    >
                      <option value="">add a foe…</option>
                      {bestiary.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                          {n.from ? ` — ${n.from}` : ''}
                        </option>
                      ))}
                    </select>
                    <span className="flex items-center gap-1 rounded-md bg-stone-900 px-1">
                      <button
                        className={btnGhost}
                        onClick={() => setCount((n) => Math.max(1, n - 1))}
                        aria-label="fewer"
                      >
                        −
                      </button>
                      <span className="w-7 text-center font-mono text-sm text-stone-300">
                        ×{count}
                      </span>
                      <button
                        className={btnGhost}
                        onClick={() => setCount((n) => Math.min(20, n + 1))}
                        aria-label="more"
                      >
                        +
                      </button>
                    </span>
                    <button
                      className={btn}
                      disabled={!adding}
                      onClick={() => {
                        addFoes(encounter, adding, count);
                        setAdding('');
                      }}
                    >
                      add
                    </button>
                  </div>

                  <textarea
                    className={`${input} min-h-16 w-full resize-y text-xs`}
                    placeholder="notes — how it starts, what they want, when they flee"
                    value={encounter.notes ?? ''}
                    onChange={(e) => patch(encounter.id, { notes: e.target.value })}
                  />

                  <button
                    className={`${btnGhost} text-[11px] hover:text-red-300`}
                    onClick={() => {
                      if (!window.confirm(`Delete “${encounter.name}”?`)) return;
                      onChange(encounters.filter((e) => e.id !== encounter.id));
                    }}
                  >
                    delete this encounter
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
