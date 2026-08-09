import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { btn } from '../lib/ui';

// The book, open at a page.
//
// Three places want this now — the library, a rule you looked up, a foe
// you're about to drop on the table — so it stopped being the library's
// private modal. Point it at a book and a page; it fetches the ticket
// itself, because a ticket is short-lived and minting one early just
// means minting one that's expired.
//
// There is no viewer code here on purpose: it's the browser's own PDF
// reader over a URL the host serves in ranges, so opening page 200 of a
// 300-page book fetches roughly page 200 and not the book.

export type BookTarget = { bookId: string; page: number; name: string };

export function BookReader({
  target,
  onClose,
}: {
  target: BookTarget;
  onClose: () => void;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setUrl('');
    setError('');
    api
      .bookTicket(target.bookId)
      .then(({ url }) => live && setUrl(url))
      .catch(() => live && setError(`“${target.name}” isn't on this host.`));
    return () => {
      live = false;
    };
  }, [target.bookId, target.name]);

  // Escape closes it — a fullscreen layer that traps you is worse than
  // no layer, and a DM mid-fight shouldn't have to aim at a button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-stone-950">
      <div className="flex items-center gap-2 border-b border-stone-800 p-2">
        <span className="font-serif text-lg text-stone-200">{target.name}</span>
        {target.page > 1 && (
          <span className="font-mono text-[11px] text-amber-400">p.{target.page}</span>
        )}
        <button className={`${btn} ml-auto`} onClick={onClose}>
          close
        </button>
      </div>
      {error ? (
        <p className="p-4 text-sm text-amber-500/80">{error}</p>
      ) : url ? (
        <iframe title={target.name} className="flex-1" src={`${url}#page=${target.page}`} />
      ) : (
        <p className="p-4 font-mono text-xs text-stone-600">opening…</p>
      )}
    </div>
  );
}
