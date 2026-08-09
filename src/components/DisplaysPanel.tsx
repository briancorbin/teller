import { useCallback, useEffect, useState } from 'react';
import type { Character, Display, DisplayRole } from '../../worker/types';
import { api } from '../lib/api';
import { btnPrimary, card, input, sectionLabel } from '../lib/ui';

// Every screen in the room, and what each one is. This panel is the
// patch bay: screens arrive knowing nothing, the DM says what they are.

const ROLES: { value: DisplayRole; label: string; needsCharacter?: boolean }[] = [
  { value: 'blank', label: 'blank' },
  { value: 'table', label: 'table' },
  { value: 'board', label: 'board' },
  { value: 'art', label: 'art' },
  { value: 'badge', label: 'badge', needsCharacter: true },
  { value: 'seat', label: 'seat', needsCharacter: true },
  { value: 'console', label: 'console' },
];

const PANES = ['session', 'map', 'characters', 'library', 'displays'] as const;

const COLORS = ['#f59e0b', '#38bdf8', '#a3e635', '#f472b6', '#c084fc', '#fb7185'];

/** A screen is "live" if it has spoken to us lately. */
function isLive(display: Display): boolean {
  const seen = Date.parse(display.lastSeenAt.replace(' ', 'T') + 'Z');
  return Number.isFinite(seen) && Date.now() - seen < 60_000;
}

export function DisplaysPanel({
  campaignId,
  characters,
}: {
  campaignId: string;
  characters: Character[];
}) {
  const [displays, setDisplays] = useState<Display[]>([]);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api
      .displays(campaignId)
      .then(setDisplays)
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, [campaignId]);

  useEffect(load, [load]);
  useEffect(() => {
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const claim = async () => {
    if (!code.trim()) return;
    try {
      await api.claimDisplay(campaignId, code.trim());
      setCode('');
      setError('');
      load();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  const patch = (id: string, patchBody: Parameters<typeof api.patchDisplay>[1]) => {
    setDisplays((ds) => ds.map((d) => (d.id === id ? { ...d, ...patchBody } : d)));
    api.patchDisplay(id, patchBody).then(load).catch(load);
  };

  return (
    <div className="space-y-3">
      <section className={`${card} space-y-2`}>
        <span className={sectionLabel}>Add a screen</span>
        <p className="text-sm text-stone-500">
          Open teller on it — phone, tablet, panel, TV — and type the code it's
          showing.
        </p>
        <div className="flex gap-2">
          <input
            className={`${input} flex-1 font-mono uppercase tracking-widest`}
            placeholder="K7RM4P"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && claim()}
          />
          <button className={btnPrimary} onClick={claim}>
            adopt
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      {displays.map((d) => {
        const role = ROLES.find((r) => r.value === d.role);
        return (
          <section key={d.id} className={`${card} space-y-2`}>
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: isLive(d) ? d.color || '#f59e0b' : '#44403c' }}
                title={isLive(d) ? 'live' : `last seen ${d.lastSeenAt}`}
              />
              {/*
                Uncontrolled and committed on blur, deliberately: a
                round trip per keystroke means the refetch lands mid-word
                and overwrites what you're still typing. Same reason
                CharacterCard names work this way.
              */}
              <input
                className={`${input} min-w-0 flex-1`}
                defaultValue={d.name}
                aria-label="screen name"
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== d.name) patch(d.id, { name });
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <button
                className="rounded-md px-2 py-1 text-sm text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-200"
                title="flash this screen so you can tell which one it is"
                onClick={() => api.identifyDisplay(d.id)}
              >
                identify
              </button>
              <button
                className="rounded-md px-2 py-1 text-sm text-stone-600 transition-colors hover:bg-red-950 hover:text-red-300"
                title="forget this screen"
                onClick={() => {
                  if (!window.confirm(`Forget "${d.name}"? It'll show a new code.`)) return;
                  api.forgetDisplay(d.id).then(load);
                }}
              >
                ✕
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                className={input}
                value={d.role}
                onChange={(e) => patch(d.id, { role: e.target.value as DisplayRole })}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>

              {role?.needsCharacter && (
                <select
                  className={input}
                  value={d.params.characterId ?? ''}
                  onChange={(e) =>
                    patch(d.id, {
                      params: { ...d.params, characterId: e.target.value || null },
                    })
                  }
                >
                  <option value="">— whose? —</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}

              {d.role === 'console' && (
                <select
                  className={input}
                  value={d.params.pane ?? ''}
                  onChange={(e) =>
                    patch(d.id, {
                      params: {
                        ...d.params,
                        pane: (e.target.value || null) as never,
                      },
                    })
                  }
                >
                  <option value="">full console</option>
                  {PANES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              )}

              <span className="ml-auto flex gap-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className={`h-5 w-5 rounded-full transition-transform ${
                      d.color === c ? 'scale-110 ring-2 ring-stone-300' : ''
                    }`}
                    style={{ backgroundColor: c }}
                    title="identify colour"
                    onClick={() => patch(d.id, { color: c })}
                  />
                ))}
              </span>
            </div>
          </section>
        );
      })}

      {displays.length === 0 && (
        <p className="px-1 text-sm text-stone-500">No screens yet.</p>
      )}
    </div>
  );
}
