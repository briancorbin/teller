// The 'plugins' tool — the old app has no equivalent (plugins are new
// in core-next, §15), so this borrows DmView's general card/section
// grammar rather than porting a specific panel. Enablement stays a
// human act done HERE, in the console, never by the discovery sweep —
// that's the whole point of the enabled/disabled split in `/api/plugins`.
//
// Config is a raw JSON textarea for v1, same posture the vanilla
// client took (`server/public/app.js`'s `prompt('config (JSON)?')`)
// but inline instead of a browser prompt, so it fits the console's own
// card grammar and a bad JSON parse can say so without an alert().

import { useState } from 'react';
import { registerTool } from './index.ts';
import { api } from '../lib/api.ts';
import { useLive } from '../lib/use-session.ts';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui.ts';
import type { PanelDef } from '../../core/panels.ts';

type PluginManifest = { id: string; name: string; version: number; provides: string[]; needs: string[] };
type Found = { dir: string; manifest: PluginManifest; enabled: boolean };
type Problem = { dir: string; problem: string };
type PluginsOut =
  | { found: Found[]; problems: Problem[]; running: string[] }
  | { error: string };
/** Only the half this tool reads — the campaign's resolved pack stack. */
type CampaignOut = {
  system: { id: string; name: string; codePending?: boolean } | null;
  packs: { id: string; name: string; codePending?: boolean }[];
};

function PluginRow({
  found,
  running,
  onChanged,
}: {
  found: Found;
  running: boolean;
  onChanged: () => void;
}) {
  const [configuring, setConfiguring] = useState(false);
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const toggle = async () => {
    setBusy(true);
    try {
      await api(`/api/plugins/${found.manifest.id}`, {
        method: 'POST',
        body: { enabled: !found.enabled },
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = async () => {
    setErr('');
    let config: unknown = null;
    try {
      config = raw.trim() ? JSON.parse(raw) : null;
    } catch (e) {
      setErr(`not JSON: ${e instanceof Error ? e.message : e}`);
      return;
    }
    await api(`/api/plugins/${found.manifest.id}/config`, { method: 'PUT', body: { config } });
    setConfiguring(false);
    onChanged();
  };

  return (
    <li className="rounded-md border border-stone-800 bg-stone-900/60">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="text-sm text-stone-100" title={found.manifest.id}>
          {found.manifest.name}
        </span>
        <span className="font-mono text-[11px] text-stone-600">v{found.manifest.version}</span>
        {running && (
          <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-amber-300">
            running
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <button className={btnGhost} onClick={() => setConfiguring(!configuring)}>
            configure
          </button>
          <button className={found.enabled ? btnGhost : btnPrimary} disabled={busy} onClick={toggle}>
            {found.enabled ? 'disable' : 'enable'}
          </button>
        </span>
      </div>
      <div className="px-3 pb-2 font-mono text-[11px] text-stone-600">
        provides {found.manifest.provides.join(', ') || '(nothing)'} · needs{' '}
        {found.manifest.needs.join(', ') || '(nothing)'}
      </div>
      {configuring && (
        <div className="space-y-2 border-t border-stone-800 px-3 py-2">
          <textarea
            className={`${input} min-h-20 w-full resize-y font-mono text-xs`}
            placeholder="{ }"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
          {err && <p className="text-xs text-amber-500/80">{err}</p>}
          <div className="flex justify-end gap-2">
            <button className={btnGhost} onClick={() => setConfiguring(false)}>
              cancel
            </button>
            <button className={btn} onClick={saveConfig}>
              save
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** A `.panel` folder that compiled code but has no trust row yet (§E
 * UN-DEFERRED: "trust rides the plugins table" — the SAME toggle a
 * plugin uses, `POST /api/plugins/<pan_id>`, just aimed at a `pan_`
 * id instead of a plugin's manifest id). Enabling it reloads the
 * content stack server-side, so the next `declarations/panels` fetch
 * carries `code` instead of `codePending`. */
function PendingPanelRow({ panel, onChanged }: { panel: PanelDef; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const enable = async () => {
    if (!panel.id) return;
    setBusy(true);
    try {
      await api(`/api/plugins/${panel.id}`, { method: 'POST', body: { enabled: true } });
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-stone-800 bg-stone-900/60 px-3 py-2">
      <span className="text-sm text-stone-100">{panel.label ?? panel.name}</span>
      <span className="font-mono text-[11px] text-stone-600">{panel.name}</span>
      <span className="ml-auto">
        <button className={btnPrimary} disabled={busy || !panel.id} onClick={enable}>
          enable
        </button>
      </span>
    </li>
  );
}

function PluginsSection() {
  const { data, reload } = useLive(() => api<PluginsOut>('/api/plugins'), []);
  if (!data) return null;

  if ('error' in data) {
    return (
      <section className={card}>
        <span className={sectionLabel}>Plugins</span>
        <p className="mt-2 text-sm text-amber-500/80">{data.error}</p>
      </section>
    );
  }

  const running = new Set(data.running);

  return (
    <section className={`${card} space-y-3`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>Plugins</span>
        <span className="font-mono text-[11px] text-stone-600">{data.found.length} on the shelf</span>
      </div>

      {data.found.length === 0 && (
        <p className="text-sm text-stone-600">
          nothing on the shelf — drop a plugin folder in &lt;data&gt;/plugins/
        </p>
      )}

      <ul className="space-y-2">
        {data.found.map((f) => (
          <PluginRow key={f.manifest.id} found={f} running={running.has(f.manifest.id)} onChanged={reload} />
        ))}
      </ul>

      {data.problems.length > 0 && (
        <div className="space-y-1">
          {data.problems.map((p, i) => (
            <p key={i} className="font-mono text-[11px] text-amber-500/80">
              {p.dir}: {p.problem}
            </p>
          ))}
        </div>
      )}

      <p className="text-[11px] text-stone-600">
        the sweep only discovers; enabling is yours alone.
      </p>
    </section>
  );
}

/** A `.panel` with compiled code and no trust row — same sweep-discovers,
 * human-enables posture as the plugin list above, just over the panel
 * declaration collection instead of `/api/plugins` (§E: "trust rides
 * the plugins table" — one table, two kinds of thing riding it). */
function PendingPanelCode() {
  const { data, reload } = useLive(() => api<PanelDef[]>('/api/stack/declarations/panels'), []);
  const pending = (data ?? []).filter((p) => p.codePending);
  if (!pending.length) return null;

  return (
    <section className={`${card} space-y-3`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>Panel code awaiting enablement</span>
        <span className="font-mono text-[11px] text-stone-600">{pending.length}</span>
      </div>
      <ul className="space-y-2">
        {pending.map((p) => (
          <PendingPanelRow key={p.id ?? p.name} panel={p} onChanged={reload} />
        ))}
      </ul>
      <p className="text-[11px] text-stone-600">
        a `.panel` folder compiled code the sweep found but nobody's enabled yet —
        same trust table as a plugin, just naming a `pan_` id instead.
      </p>
    </section>
  );
}

/** A pack folder that compiled `presentations/*.tsx` and has no trust
 * row yet (§L phase 2). Same table, same toggle, same posture as the
 * panel section above — only the id prefix differs (`pak_`). The pack's
 * DATA is already loaded and always was: trust gates code, never facts.
 * `/api/campaign` is the seam because the pending flag belongs to the
 * campaign's RESOLVED stack, which is the list that endpoint already
 * carries — a second endpoint would only restate it. */
function PendingPackCode() {
  const { data, reload } = useLive(() => api<CampaignOut>('/api/campaign'), []);
  // The active SYSTEM rides this list too (§M): its folder carries
  // presentations on exactly the same terms, and the toggle is the same
  // one aimed at a `sys_` id.
  const pending = [
    ...(data?.system?.codePending ? [data.system] : []),
    ...(data?.packs ?? []).filter((p) => p.codePending),
  ];
  if (!pending.length) return null;

  return (
    <section className={`${card} space-y-3`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>System code awaiting enablement</span>
        <span className="font-mono text-[11px] text-stone-600">{pending.length}</span>
      </div>
      <ul className="space-y-2">
        {pending.map((p) => (
          <PendingPackRow key={p.id} pack={p} onChanged={reload} />
        ))}
      </ul>
      <p className="text-[11px] text-stone-600">
        a system or pack folder carries presentation code the sweep compiled but nobody's
        enabled yet — its rules and bestiary loaded regardless; only the components wait.
      </p>
    </section>
  );
}

function PendingPackRow({
  pack,
  onChanged,
}: {
  pack: { id: string; name: string };
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const enable = async () => {
    setBusy(true);
    try {
      await api(`/api/plugins/${pack.id}`, { method: 'POST', body: { enabled: true } });
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-stone-800 bg-stone-900/60 px-3 py-2">
      <span className="text-sm text-stone-100">{pack.name}</span>
      <span className="font-mono text-[11px] text-stone-600">{pack.id}</span>
      <span className="ml-auto">
        <button className={btnPrimary} disabled={busy} onClick={enable}>
          enable
        </button>
      </span>
    </li>
  );
}

registerTool('plugins', () => (
  <div className="space-y-4">
    <PluginsSection />
    <PendingPanelCode />
    <PendingPackCode />
  </div>
));
