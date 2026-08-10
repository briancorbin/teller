import { useCallback, useEffect, useState } from 'react';
import type { Character, Display, DisplayRole } from '../../worker/types';
import { api } from '../lib/api';
import { PANES } from '../lib/panes';
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

const COLORS = ['#f59e0b', '#38bdf8', '#a3e635', '#f472b6', '#c084fc', '#fb7185'];

/** Starting points only — a slot is any short name you like. */
const SLOT_SUGGESTIONS = ['tv', 'board', 'art', 'seat'];

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

  // Only to name the campaign a stray screen is currently on — "on
  // Dry Gulch" beats an opaque id when you're deciding whether to move it.
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    api
      .listCampaigns()
      .then((cs) => setNames(Object.fromEntries(cs.map((c) => [c.id, c.name]))))
      .catch(() => setNames({}));
  }, []);

  const bring = async (id: string) => {
    try {
      await api.bringDisplay(campaignId, id);
      setError('');
      load();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  useEffect(load, [load]);
  useEffect(() => {
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  // This campaign's screens, and this host's screens pointed somewhere
  // else. Unadopted ones (no campaign at all) stay out of both: they are
  // showing a pairing code and arrive that way.
  const mine = displays.filter((d) => d.campaignId === campaignId);
  const elsewhere = displays.filter(
    (d) => d.campaignId && d.campaignId !== campaignId,
  );

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

        {/*
          A fragment gives this machine another screen, and nothing in
          the UI would otherwise hint that it exists. Offer it where
          you'd want it: while you're trying to add a screen and haven't
          got a spare device in your hand.
        */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-sm text-stone-500">
          <span>No spare device? Open one on this machine:</span>
          {SLOT_SUGGESTIONS.map((slot) => (
            <a
              key={slot}
              className="rounded-full bg-stone-900 px-2 py-0.5 font-mono text-xs text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100"
              href={`/#${slot}`}
              target="_blank"
              rel="noreferrer"
            >
              #{slot}
            </a>
          ))}
          <span className="text-stone-600">
            — any name works, and each one is its own screen
          </span>
        </div>
      </section>

      {/*
        Screens on this host but pointed at another campaign. They were
        never lost — the console just used to filter them out, which made
        adoption look permanent. Bringing one is a move, not a re-pair.

        Unadopted screens are deliberately NOT here: those still arrive by
        pairing code, so nobody can quietly absorb a stranger's screen
        that happens to be on the same LAN.
      */}
      {elsewhere.length > 0 && (
        <section className={`${card} space-y-2`}>
          <div className="flex items-baseline gap-2">
            <span className={sectionLabel}>on another campaign</span>
            <span className="font-mono text-[11px] text-stone-600">
              {elsewhere.length} screen{elsewhere.length > 1 ? 's' : ''}
            </span>
            {elsewhere.length > 1 && (
              <button
                className="ml-auto font-mono text-xs text-stone-500 underline-offset-2 hover:text-amber-300 hover:underline"
                onClick={() => elsewhere.forEach((d) => void bring(d.id))}
                title="move every one of them to this campaign"
              >
                bring all →
              </button>
            )}
          </div>
          <ul className="space-y-1">
            {elsewhere.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: isLive(d) ? d.color || '#f59e0b' : '#44403c',
                  }}
                  title={isLive(d) ? 'live' : `last seen ${d.lastSeenAt}`}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-stone-300">
                  {d.name || 'unnamed screen'}
                </span>
                <span className="font-mono text-[11px] text-stone-600">
                  {d.role}
                  {' · '}
                  {names[d.campaignId ?? ''] ?? 'a campaign that’s gone'}
                </span>
                <button
                  className="font-mono text-[11px] text-amber-400/90 underline-offset-2 hover:underline"
                  onClick={() => void bring(d.id)}
                  title={
                    d.role === 'seat' || d.role === 'badge'
                      ? 'move it here — it points at a character over there, so it arrives blank'
                      : 'move it here'
                  }
                >
                  bring here →
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mine.map((d) => {
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

      {mine.length === 0 && elsewhere.length === 0 && (
        <p className="px-1 text-sm text-stone-500">No screens yet.</p>
      )}
    </div>
  );
}
