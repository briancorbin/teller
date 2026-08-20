// THE ART FRAME — a fullscreen surface for the thing the table is
// meant to be looking at: a letter, a WANTED poster, the scene's own
// picture. DM-screen wings, a spare tablet on the shelf.
//
// It rests, and today resting is all it does. THE NEW WORLD HAS NO
// HANDOUT: the old app had `campaign.data.handout` — one picture the
// console pushed at every art screen — and nothing in `core/` or
// `server/` carries that fact yet. Rather than invent a shape the
// console can't fill, this renders the quiet mark and waits.
//
// What it will take, when handouts are designed: a place for the fact
// to live (a manifest ref beside `refs.board` is the obvious shape —
// "the active handout" is a fact about the campaign in exactly the way
// "the active board" is), the console control that sets it, and its
// presence in the public snapshot. The image bytes need nothing new —
// `fileUrl` already puts a ticketed url on a key in the data dir, which
// is how the table draws its board.
//
// Passive throughout: no controls, and nothing here writes.

import { publicSnapshot, type PublicSnapshot } from '../lib/api.ts';
import { useLive } from '../lib/use-session.ts';
import { useWakeLock } from '../lib/use-wake-lock.ts';

export function ArtView() {
  useWakeLock();
  const snapshot = useLive<PublicSnapshot>(publicSnapshot, []);

  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-3 overflow-hidden bg-stone-950">
      <h1 className="font-serif text-5xl text-stone-800">teller</h1>
      {snapshot.data && (
        <p className="text-lg text-stone-800">{snapshot.data.campaign.name}</p>
      )}
    </main>
  );
}
