// Invisible while the SSE stream is healthy; a small fixed pill when
// it drops, so a stale passive display (table TV, board, badge) is
// obvious at a glance instead of silently wrong.

export function ConnectionHint({ connected }: { connected: boolean }) {
  if (connected) return null;
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-50 flex animate-pulse items-center gap-2 rounded-full bg-stone-900/90 px-3 py-1.5 text-sm text-amber-300 shadow-lg backdrop-blur">
      <span className="h-2 w-2 rounded-full bg-amber-400" />
      reconnecting…
    </div>
  );
}
