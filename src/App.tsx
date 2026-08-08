import { useEffect, useState } from 'react';
import type { SessionState, StreamEvent } from '../worker/types';

// v0 shell: proves the plumbing (routing, API, SSE) end to end.
// Real surfaces — DM console, seat card, table view — replace these
// placeholders next.

type Route =
  | { view: 'landing' }
  | { view: 'dm'; campaignId: string }
  | { view: 'table'; campaignId: string }
  | { view: 'seat'; characterId: string };

function parseRoute(pathname: string): Route {
  let m = pathname.match(/^\/dm\/([^/]+)$/);
  if (m) return { view: 'dm', campaignId: m[1] };
  m = pathname.match(/^\/table\/([^/]+)$/);
  if (m) return { view: 'table', campaignId: m[1] };
  m = pathname.match(/^\/seat\/([^/]+)$/);
  if (m) return { view: 'seat', characterId: m[1] };
  return { view: 'landing' };
}

function useSession(campaignId: string): SessionState | null {
  const [session, setSession] = useState<SessionState | null>(null);
  useEffect(() => {
    const source = new EventSource(`/api/campaigns/${campaignId}/stream`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as StreamEvent;
      if (event.type === 'hello' || event.type === 'session') {
        setSession(event.state);
      }
    };
    return () => source.close();
  }, [campaignId]);
  return session;
}

function Landing() {
  const [health, setHealth] = useState<string>('…');
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((body) => setHealth(JSON.stringify(body)))
      .catch((e) => setHealth(String(e)));
  }, []);
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-8">
      <h1 className="font-serif text-5xl">teller</h1>
      <p className="text-stone-400">
        The table plays. teller keeps the books.
      </p>
      <p className="text-sm text-stone-500">
        Surfaces: <code>/dm/:campaignId</code> · <code>/table/:campaignId</code>{' '}
        · <code>/seat/:characterId?token=…</code>
      </p>
      <p className="font-mono text-xs text-stone-600">api {health}</p>
    </main>
  );
}

function SessionDebug({ campaignId, title }: { campaignId: string; title: string }) {
  const session = useSession(campaignId);
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-8">
      <h1 className="font-serif text-3xl">{title}</h1>
      <p className="text-sm text-stone-500">campaign {campaignId}</p>
      <pre className="rounded bg-stone-900 p-4 font-mono text-xs text-stone-400">
        {session ? JSON.stringify(session, null, 2) : 'connecting to session…'}
      </pre>
    </main>
  );
}

function Seat({ characterId }: { characterId: string }) {
  const [body, setBody] = useState<string>('loading…');
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    fetch(`/api/seat/${characterId}?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => setBody(JSON.stringify(data, null, 2)))
      .catch((e) => setBody(String(e)));
  }, [characterId]);
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-8">
      <h1 className="font-serif text-3xl">seat</h1>
      <pre className="rounded bg-stone-900 p-4 font-mono text-xs text-stone-400">{body}</pre>
    </main>
  );
}

export default function App() {
  const route = parseRoute(window.location.pathname);
  switch (route.view) {
    case 'dm':
      return <SessionDebug campaignId={route.campaignId} title="DM console" />;
    case 'table':
      return <SessionDebug campaignId={route.campaignId} title="table" />;
    case 'seat':
      return <Seat characterId={route.characterId} />;
    default:
      return <Landing />;
  }
}
