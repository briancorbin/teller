import { useSession } from '../lib/use-session';

// The table TV's v0: a big, glanceable initiative rail. Passive — no
// controls, just state. (Scenes/fog/maps arrive here in a later phase.)

export function TableView({ campaignId }: { campaignId: string }) {
  const session = useSession(campaignId);
  const initiative = session?.initiative ?? [];
  const turn = session?.turn ?? null;

  if (session?.notice) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <p className="animate-pulse text-center font-serif text-7xl text-amber-300">
          {session.notice}
        </p>
      </main>
    );
  }

  if (initiative.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2">
        <h1 className="font-serif text-6xl text-stone-700">teller</h1>
        <p className="text-stone-600">waiting for the {`Warden's`} books to open…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      {turn !== null && (
        <p className="font-mono text-lg uppercase tracking-[0.3em] text-stone-500">
          round {session?.round}
        </p>
      )}
      <ol className="flex flex-col items-center gap-3">
        {initiative.map((entry, index) => (
          <li
            key={entry.id}
            className={`rounded-xl px-8 py-3 font-serif transition-all ${
              index === turn
                ? 'scale-110 bg-amber-700 text-4xl text-stone-950 shadow-lg shadow-amber-900/50'
                : 'bg-stone-900 text-2xl text-stone-400'
            }`}
          >
            {entry.label}
          </li>
        ))}
      </ol>
    </main>
  );
}
