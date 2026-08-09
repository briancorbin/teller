import { useEffect, useState } from 'react';
import type { Campaign, SystemTemplate } from '../../worker/types';
import { api, getDmKey, setDmKey } from '../lib/api';
import { btnPrimary, card, input, sectionLabel } from '../lib/ui';

// The console's front door — the one place the key is entered, and the
// only asymmetry left in the system (a console can't be assigned by a
// console that doesn't exist yet).
export function Landing({
  onOpen,
  onLock,
}: {
  onOpen: (campaignId: string) => void;
  onLock: () => void;
}) {
  const [key, setKey] = useState(getDmKey());
  const [templates, setTemplates] = useState<SystemTemplate[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [name, setName] = useState('');
  const [system, setSystem] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.templates().then((t) => {
      setTemplates(t);
      setSystem((s) => s || t[0]?.system || '');
    });
  }, []);

  useEffect(() => {
    if (!getDmKey()) return;
    api
      .listCampaigns()
      .then((c) => {
        setCampaigns(c);
        setError('');
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, [key]);

  const create = async () => {
    if (!name.trim()) return;
    try {
      const campaign = await api.createCampaign(name.trim(), system);
      onOpen(campaign.id);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-serif text-5xl text-stone-100">teller</h1>
          <p className="mt-2 text-stone-400">The table plays. teller keeps the books.</p>
        </div>
        <button
          className="text-sm text-stone-600 transition-colors hover:text-stone-300"
          onClick={onLock}
        >
          lock
        </button>
      </header>

      <section className={`${card} space-y-2`}>
        <span className={sectionLabel}>DM key</span>
        <input
          className={`${input} w-full`}
          type="password"
          placeholder="the Warden's key"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setDmKey(e.target.value);
          }}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      {campaigns && campaigns.length > 0 && (
        <section className={`${card} space-y-2`}>
          <span className={sectionLabel}>Campaigns</span>
          <ul className="space-y-1">
            {campaigns.map((c) => (
              <li key={c.id} className="flex items-center gap-1">
                <button
                  className="flex min-w-0 flex-1 items-baseline justify-between rounded-md px-2 py-1.5 text-left transition-colors hover:bg-stone-800"
                  onClick={() => onOpen(c.id)}
                >
                  <span className="truncate text-stone-100">{c.name}</span>
                  <span className="ml-3 font-mono text-xs text-stone-500">{c.system}</span>
                </button>
                <button
                  className="rounded-md px-2 py-1 text-sm text-stone-600 transition-colors hover:bg-red-950 hover:text-red-300"
                  title="delete campaign"
                  onClick={() => {
                    if (!window.confirm(`Delete "${c.name}" and all its characters? This cannot be undone.`)) return;
                    api.deleteCampaign(c.id).then(() =>
                      setCampaigns((cs) => (cs ?? []).filter((x) => x.id !== c.id)),
                    );
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={`${card} space-y-3`}>
        <span className={sectionLabel}>New campaign</span>
        <input
          className={`${input} w-full`}
          placeholder="The Ballad of Dry Gulch"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <div className="flex gap-2">
          <select
            className={`${input} flex-1`}
            value={system}
            onChange={(e) => setSystem(e.target.value)}
          >
            {templates.map((t) => (
              <option key={t.system} value={t.system}>
                {t.name}
              </option>
            ))}
          </select>
          <button className={btnPrimary} onClick={create}>
            create
          </button>
        </div>
      </section>
    </main>
  );
}
