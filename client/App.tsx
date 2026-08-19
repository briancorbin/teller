// Boot + routes. Hash-first, matching the vanilla client exactly so
// bookmarks and assignments survive the swap: #console, #panel=<name>
// (&entity=<id>), #entity=<id>, #board=<id>. Bare hash = this screen's
// assignment (pairing flow when unclaimed).

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  api,
  hello,
  stored,
  forgetSlips,
  type DisplayInfo,
} from './lib/api.ts';
import { onIdentify, useLive } from './lib/use-session.ts';
import { btnPrimary, card, input, sectionLabel } from './lib/ui.ts';
import type { PanelDef } from '../core/panels.ts';
import { PanelSurface, type BlockCtx, type Glass } from './panels/render.tsx';
import { SeatChrome } from './components/seat/SeatChrome.tsx';

function useHash(): string {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    () => window.location.hash.replace(/^#/, ''),
  );
}

function hashParams(hash: string): URLSearchParams {
  return new URLSearchParams(hash);
}

// ---- identify flash ----------------------------------------------------

function IdentifyFlash({ me }: { me?: DisplayInfo }) {
  const [shown, setShown] = useState(false);
  useEffect(
    () =>
      onIdentify(() => {
        setShown(true);
        setTimeout(() => setShown(false), 2500);
      }),
    [],
  );
  if (!shown || !me) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: me.color ?? '#b45309' }}
    >
      <p className="font-serif text-6xl text-stone-50">{me.name ?? 'this screen'}</p>
    </div>
  );
}

// ---- key gate ----------------------------------------------------------

function KeyGate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState('');
  const [bad, setBad] = useState(false);
  return (
    <div className="flex min-h-dvh items-center justify-center p-8">
      <form
        className={`${card} flex w-80 flex-col gap-3`}
        onSubmit={(e) => {
          e.preventDefault();
          stored.key = value.trim();
          forgetSlips();
          api('/api/campaign')
            .then(() => onUnlock())
            .catch(() => {
              stored.key = null;
              setBad(true);
            });
        }}
      >
        <p className={sectionLabel}>the key</p>
        <input
          className={input}
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="DM key"
        />
        {bad && <p className="text-sm text-red-500">that's not it</p>}
        <button className={btnPrimary} type="submit">
          unlock
        </button>
      </form>
    </div>
  );
}

// ---- panel route -------------------------------------------------------

/** Aspect-derived glass, live: a rotated tablet re-renders, it doesn't
 * keep the arrangement it woke up with. An ASSIGNED glass still wins. */
function useGlass(params: Record<string, unknown> | undefined): Glass {
  const aspect = useSyncExternalStore(
    (cb) => {
      window.addEventListener('resize', cb);
      return () => window.removeEventListener('resize', cb);
    },
    // ≥ 1.3, the old app's own `wide` threshold (src/views/SeatView.tsx)
    // — a desktop browser is wide glass; only a genuinely portrait hand
    // gets the held arrangement.
    () => (window.innerWidth / window.innerHeight >= 1.3 ? 'mounted' : 'held'),
  );
  const declared = params?.glass;
  if (declared === 'mounted' || declared === 'held') return declared;
  return aspect;
}

function PanelRoute({
  name,
  entityId,
  seatName,
}: {
  name: string;
  entityId?: string;
  /** This screen's own name — the seat chrome's player line (rule 7). */
  seatName?: string;
}) {
  const glass = useGlass(undefined);
  const panels = useLive(
    () => api<PanelDef[]>('/api/stack/declarations/panels'),
    [],
  );
  const records = useLive(
    () =>
      Promise.all(
        ['accents', 'dials', 'brand', 'portraits', 'dice', 'marks'].map((slot) =>
          api<Record<string, unknown>>(`/api/stack/record/${slot}`).then(
            (r) => [slot, r] as const,
          ),
        ),
      ).then(Object.fromEntries),
    [],
  );
  const entity = useLive(
    () =>
      entityId
        ? api(`/api/entities/${entityId}?resolved=1`)
        : Promise.resolve(undefined),
    [entityId],
  );

  const panel = panels.data?.find((p) => p.name === name);
  if (panels.error)
    return <p className="p-8 text-sm text-red-500">{panels.error.message}</p>;
  if (!panels.data) return null;
  if (!panel)
    return (
      <p className="p-8 text-sm text-stone-500">no panel named '{name}'</p>
    );
  if (panel.subject === 'entity' && !entityId)
    return (
      <p className="p-8 text-sm text-stone-500">
        '{name}' arranges an entity, and this screen isn't pointed at one
      </p>
    );

  const ctx: BlockCtx = {
    glass,
    entity: entity.data,
    records: (records.data ?? {}) as BlockCtx['records'],
    write: entityId
      ? (edit) =>
          api(`/api/entities/${entityId}/entry`, { body: edit }).then(() => {})
      : undefined,
  };
  // Glass discipline (rule 6): mounted is fixed-height and never scrolls
  // — overflow is CLIPPED, the diagnostic that a layout doesn't fit that
  // glass. Held is elastic and scrolls down, same as the page always has.
  return (
    <div
      className={
        ctx.glass === 'mounted'
          ? 'h-dvh overflow-hidden p-3'
          : 'min-h-dvh p-3'
      }
    >
      {/* An entity-subject panel is a SEAT, wherever it's viewed from — a
          real seat, or the console previewing one — so it always wears
          the seat chrome (top bar + the segmented bar across the other
          declared layouts). A tool panel (Roster, Runner, …) has no
          subject and stays bare. */}
      {panel.subject === 'entity' && entityId ? (
        <SeatChrome
          entityId={entityId}
          initialPanel={panel.name}
          seatName={seatName}
          glass={ctx.glass}
        />
      ) : (
        <PanelSurface
          panel={panel}
          ctx={ctx}
          fallback={
            <p className="p-8 text-sm text-stone-500">
              '{name}' failed to render — the floor has it
            </p>
          }
        />
      )}
    </div>
  );
}

// ---- home (console directory) -----------------------------------------

function Home() {
  const panels = useLive(
    () => api<PanelDef[]>('/api/stack/declarations/panels'),
    [],
  );
  if (!panels.data) return null;
  const arrangements = panels.data.filter((p) => p.subject === 'entity');
  const tools = panels.data.filter((p) => p.subject !== 'entity');
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <h1 className="font-serif text-2xl text-stone-100">teller</h1>
      {[
        ['tools', tools],
        ['arrangements', arrangements],
      ].map(([label, list]) => (
        <section key={label as string} className="flex flex-col gap-3">
          <p className={sectionLabel}>{label as string}</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {(list as PanelDef[]).map((p) => (
              <a
                key={p.name}
                className={`${card} transition-colors hover:border-stone-600`}
                href={`#panel=${p.name}`}
              >
                <p className="text-stone-100">{p.label ?? p.name}</p>
                {p.blurb && (
                  <p className="mt-1 text-sm text-stone-500">{p.blurb}</p>
                )}
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---- pairing -----------------------------------------------------------

function PairScreen() {
  const me = useLive(() => hello(), []);
  const display = me.data?.display;
  useEffect(() => {
    if (!display?.code) return;
    const t = setInterval(() => me.reload(), 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display?.code]);
  if (!display) return null;
  if (display.code)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
        <p className={sectionLabel}>pair this screen</p>
        <p className="font-mono text-7xl tracking-[0.3em] text-amber-500">
          {display.code}
        </p>
        <p className="text-sm text-stone-500">
          read this code to the DM — they'll adopt it from the console
        </p>
      </div>
    );
  const params = (display.params ?? {}) as Record<string, unknown>;
  if (display.role === 'seat' && typeof params.entityId === 'string')
    return (
      <PanelRoute
        name={typeof params.layout === 'string' ? params.layout : 'sheet'}
        entityId={params.entityId}
        seatName={display.name}
      />
    );
  if (display.role === 'console')
    return typeof params.pane === 'string' ? (
      <PanelRoute name={params.pane} />
    ) : (
      <Home />
    );
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-sm text-stone-500">
        adopted as '{display.role ?? 'blank'}' — waiting for a job
      </p>
    </div>
  );
}

// ---- app ---------------------------------------------------------------

export default function App() {
  const hash = useHash();
  const [unlocked, setUnlocked] = useState(() => Boolean(stored.key));
  const me = useLive(() => hello(), []);

  const params = hashParams(hash);
  const wantsConsole =
    hash === 'console' ||
    params.has('panel') ||
    params.has('entity') ||
    params.has('board');

  let view: React.ReactNode;
  if (wantsConsole && !unlocked) view = <KeyGate onUnlock={() => setUnlocked(true)} />;
  else if (params.has('panel'))
    view = (
      <PanelRoute
        name={params.get('panel')!}
        entityId={params.get('entity') ?? undefined}
        seatName={me.data?.display?.name}
      />
    );
  else if (hash === 'console') view = <Home />;
  else view = <PairScreen />;

  return (
    <>
      {view}
      <IdentifyFlash me={me.data?.display} />
    </>
  );
}
