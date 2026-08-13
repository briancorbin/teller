import { useMemo, useState } from 'react';
import type { RulesPack } from '../../worker/types';
import { api } from '../lib/api';
import {
  composeAll,
  creationOf,
  gimmeName,
  spreadTotal,
} from '../lib/creation';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui';

// The Warden's creation path (TEL-75): the book's five saddle-up steps
// compressed into one dialog. Prep tooling — speed over ceremony; the
// rail builder is the theatrical version of the same composition.
//
// Every control writes ordinary fields/counters/items via composeAll,
// and the result is a normal character (rule 1). The vocabulary is all
// the pack's: trades, tiers, packs, the naming well (rule 2).

export function CreationDialog({
  campaignId,
  packs,
  onDone,
  onClose,
}: {
  campaignId: string;
  packs: RulesPack[];
  onDone: () => void;
  onClose: () => void;
}) {
  const found = useMemo(() => creationOf(packs), [packs]);
  const trades = found?.trades ?? [];
  const creation = found?.creation ?? {};
  const tiers = creation.tiers ?? [];

  const [tradeId, setTradeId] = useState('');
  const [tierName, setTierName] = useState(tiers[0]?.name ?? '');
  const [abilityId, setAbilityId] = useState('');
  const [eqPacks, setEqPacks] = useState<string[]>([]);
  const [skills, setSkills] = useState<Record<string, string> | null>(null);
  const [keeps, setKeeps] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [wallet, setWallet] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const trade = trades.find((t) => t.id === tradeId);
  const tier = tiers.find((t) => t.name === tierName) ?? tiers[0];
  const budget = creation.skills;
  const spread = skills ?? trade?.skills ?? {};
  const spent = budget ? spreadTotal(spread, budget.die) : 0;
  const packLimit = tier?.packs ?? 1;

  const abilityEntries = useMemo(() => {
    const all = new Map(
      packs.flatMap((p) => (p.catalog?.items ?? []).map((e) => [e.id, e] as const)),
    );
    return (trade?.abilities ?? [])
      .map((id) => all.get(id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
  }, [packs, trade]);

  const eqPackEntries = useMemo(() => {
    const all = new Map(
      packs.flatMap((p) => (p.catalog?.items ?? []).map((e) => [e.id, e] as const)),
    );
    return (creation.equipmentPacks ?? [])
      .map((id) => all.get(id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
  }, [packs, creation]);

  const pickTrade = (id: string) => {
    setTradeId(id);
    setAbilityId('');
    setSkills(null); // back to the new trade's quick build
  };

  const bump = (label: string, delta: number) => {
    if (!budget) return;
    // Functional: two clicks in one frame must both count.
    setSkills((prev) => {
      const cur = prev ?? trade?.skills ?? {};
      const n = parseInt(cur[label] ?? '0', 10) || 0;
      const next = Math.max(budget.min, Math.min(budget.max, n + delta));
      return { ...cur, [label]: `${next}${budget.die}` };
    });
  };

  const create = async () => {
    if (!trade || !tier) return;
    setBusy(true);
    try {
      const finalName = name.trim() || `New ${trade.name}`;
      const created = await api.createCharacter(campaignId, finalName, 'pc');
      const data = composeAll(created.data, {
        packs,
        trade,
        creation,
        tier,
        skills: skills ?? undefined,
        abilityIds: [abilityId, trade.aceInTheHole?.[0] ?? ''].filter(Boolean),
        equipmentPackIds: eqPacks,
        keepsakes: keeps,
        wallet: wallet.trim() === '' ? undefined : Number(wallet),
      });
      await api.patchCharacter(created.id, { data });
      onDone();
      onClose();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setBusy(false);
    }
  };

  if (!trades.length) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className={`${card} max-w-md space-y-2`}>
          <p className="text-sm text-stone-400">
            No pack on this table declares trades — creation needs a pack
            with starting kits.
          </p>
          <button className={btn} onClick={onClose}>
            close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4">
      <div className={`${card} my-4 w-full max-w-2xl space-y-4`}>
        <div className="flex items-baseline justify-between">
          <span className={sectionLabel}>New character, from a trade</span>
          <button className={btnGhost} onClick={onClose}>
            cancel
          </button>
        </div>

        {/* Step 1 — the trade */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {trades.map((t) => (
            <button
              key={t.id}
              className={`rounded-lg border p-2 text-left transition-colors ${
                tradeId === t.id
                  ? 'border-amber-500 bg-amber-950/40'
                  : 'border-stone-700 bg-stone-900 hover:border-stone-500'
              }`}
              onClick={() => pickTrade(t.id)}
            >
              <div className="font-serif text-sm text-stone-100">{t.name}</div>
              {t.tagline && (
                <div className="text-[10px] uppercase tracking-wider text-stone-500">
                  {t.tagline}
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Step: the posse's tier — the Warden's call, not the player's */}
        {tiers.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-stone-400">
            starting tier
            <select
              className={input}
              value={tierName}
              onChange={(e) => {
                setTierName(e.target.value);
                setEqPacks([]);
                setWallet('');
              }}
            >
              {tiers.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} · {t.prestige} Prestige
                </option>
              ))}
            </select>
          </label>
        )}

        {trade && budget && (
          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className={sectionLabel}>skills</span>
              <span
                className={`font-mono text-xs ${
                  spent === budget.total ? 'text-stone-500' : 'text-amber-400'
                }`}
              >
                {spent}/{budget.total} dice
              </span>
              <span className="text-[10px] text-stone-600">
                quick build pre-dealt — adjust if you like
              </span>
            </div>
            <div className="flex flex-wrap gap-3">
              {Object.entries(spread).map(([label, pool]) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="text-xs uppercase tracking-wider text-stone-400">
                    {label}
                  </span>
                  <button className={btnGhost} onClick={() => bump(label, -1)}>
                    −
                  </button>
                  <span className="w-8 text-center font-mono text-sm">{pool}</span>
                  <button className={btnGhost} onClick={() => bump(label, 1)}>
                    +
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step: the edge — one ability; AitH 1 rides along */}
        {trade && (
          <div className="space-y-1">
            <span className={sectionLabel}>starting ability</span>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {abilityEntries.map((a) => (
                <button
                  key={a.id}
                  className={`rounded-lg border p-2 text-left text-xs transition-colors ${
                    abilityId === a.id
                      ? 'border-amber-500 bg-amber-950/40'
                      : 'border-stone-700 bg-stone-900 hover:border-stone-500'
                  }`}
                  onClick={() => setAbilityId(a.id)}
                >
                  <div className="text-sm text-stone-100">{a.name}</div>
                  <div className="mt-0.5 text-stone-400">
                    {a.fields?.find((f) => f.key === 'effect')?.value ?? ''}
                  </div>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-stone-600">
              {trade.aceInTheHole?.length
                ? 'the first Ace-in-the-Hole comes with the trade'
                : ''}
            </p>
          </div>
        )}

        {/* Step: gear — equipment packs, count set by the tier */}
        {trade && eqPackEntries.length > 0 && (
          <div className="space-y-1">
            <span className={sectionLabel}>
              equipment pack{packLimit > 1 ? `s (pick ${packLimit})` : ''}
            </span>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {eqPackEntries.map((p) => {
                const on = eqPacks.includes(p.id);
                return (
                  <button
                    key={p.id}
                    className={`rounded-lg border p-2 text-left text-xs transition-colors ${
                      on
                        ? 'border-amber-500 bg-amber-950/40'
                        : 'border-stone-700 bg-stone-900 hover:border-stone-500'
                    }`}
                    onClick={() =>
                      setEqPacks(
                        on
                          ? eqPacks.filter((id) => id !== p.id)
                          : [...eqPacks, p.id].slice(-packLimit),
                      )
                    }
                  >
                    <div className="text-sm text-stone-100">{p.name}</div>
                    <div className="mt-0.5 text-stone-400">
                      {p.fields?.find((f) => f.key === 'effect')?.value ?? ''}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step: keepsakes */}
        {trade && (creation.keepsakes?.length ?? 0) > 0 && (
          <div className="space-y-1">
            <span className={sectionLabel}>a keepsake or two</span>
            <div className="flex flex-wrap gap-1.5">
              {creation.keepsakes!.map((k) => {
                const on = keeps.includes(k);
                return (
                  <button
                    key={k}
                    className={`rounded-full border px-2 py-1 text-[11px] transition-colors ${
                      on
                        ? 'border-amber-500 bg-amber-950/40 text-stone-100'
                        : 'border-stone-700 bg-stone-900 text-stone-400 hover:border-stone-500'
                    }`}
                    onClick={() =>
                      setKeeps(
                        on ? keeps.filter((x) => x !== k) : [...keeps, k].slice(-2),
                      )
                    }
                  >
                    {k}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step: details — wallet + name */}
        {trade && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-stone-400">
              wallet
              <input
                className={`${input} w-24`}
                type="number"
                placeholder={String(tier?.wallet ?? 0)}
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
              />
              {creation.wallet && tier?.prestige === 0 && (
                <span className="text-[10px] text-stone-600">
                  or roll {creation.wallet.roll} and type the total
                </span>
              )}
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-stone-400">
              name
              <div className="flex gap-2">
                <input
                  className={`${input} min-w-0 flex-1`}
                  placeholder={`New ${trade.name}`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                {creation.names && (
                  <button
                    className={btnGhost}
                    title="draw from the naming well"
                    onClick={() => setName(gimmeName(creation))}
                  >
                    gimme a name
                  </button>
                )}
              </div>
            </label>
            <button className={btnPrimary} disabled={busy || !trade} onClick={create}>
              {busy ? 'creating…' : 'saddle up'}
            </button>
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
