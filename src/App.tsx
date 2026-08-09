import { useCallback, useEffect, useState } from 'react';
import type { Display } from '../worker/types';
import { clearDmKey, displaySlot, getDmKey } from './lib/api';
import { useDisplay } from './lib/use-display';
import { useSession } from './lib/use-session';
import { ArtView } from './views/ArtView';
import { BadgeView } from './views/BadgeView';
import { BoardView } from './views/BoardView';
import { DmView } from './views/DmView';
import { Landing } from './views/Landing';
import { SeatView } from './views/SeatView';
import { BlankScreen, IdentifyFlash, Standby } from './views/Standby';
import { TableView } from './views/TableView';

// One door.
//
// There are no per-screen URLs any more. Everything — phone, tablet,
// table TV, rail panel — arrives here, shows a code, and becomes
// whatever the DM says it is. The only asymmetry is that somebody has
// to hold the key first: a console can't be assigned by a console that
// doesn't exist yet. See CLAUDE.md rule 7.

const CAMPAIGN_STORAGE = 'teller.campaignId';
const PANE_STORAGE = 'teller.pane';
const IDENTIFY_MS = 4000;

export default function App() {
  const { display, handle, ready, refresh } = useDisplay();
  const [key, setKey] = useState(getDmKey());
  const [campaignId, setCampaignId] = useState(
    () => localStorage.getItem(CAMPAIGN_STORAGE) ?? '',
  );
  const [pane, setPane] = useState<string | null>(
    () => localStorage.getItem(PANE_STORAGE) || null,
  );

  const openCampaign = useCallback((id: string) => {
    localStorage.setItem(CAMPAIGN_STORAGE, id);
    setCampaignId(id);
  }, []);

  const choosePane = useCallback((next: string | null) => {
    if (next) localStorage.setItem(PANE_STORAGE, next);
    else localStorage.removeItem(PANE_STORAGE);
    setPane(next);
  }, []);

  /** Forget a campaign that no longer exists and show the list again. */
  const forgetCampaign = useCallback(() => {
    localStorage.removeItem(CAMPAIGN_STORAGE);
    setCampaignId('');
  }, []);

  const lock = useCallback(() => {
    clearDmKey();
    localStorage.removeItem(CAMPAIGN_STORAGE);
    setKey('');
    setCampaignId('');
  }, []);

  // Changing slots mid-tab should re-mount as that screen.
  useEffect(() => {
    const reload = () => window.location.reload();
    window.addEventListener('hashchange', reload);
    return () => window.removeEventListener('hashchange', reload);
  }, []);

  // The key outranks any assignment: this is the DM's own device. A
  // slotted tab opts out, so the machine holding the key can still
  // watch what the table sees.
  if (key && !displaySlot()) {
    return campaignId ? (
      <DmView
        campaignId={campaignId}
        pane={pane}
        onPane={choosePane}
        onLock={lock}
        onMissing={forgetCampaign}
      />
    ) : (
      <Landing onOpen={openCampaign} onLock={lock} />
    );
  }

  if (!ready) return <main className="min-h-screen" />;

  if (!display?.campaignId) {
    return <Standby display={display} onUnlock={() => setKey(getDmKey())} />;
  }

  return <Assigned display={display} handle={handle} onAssign={refresh} />;
}

/**
 * A screen doing its job. It listens on its own stream for the two
 * things the console can say to it directly: "you're something else
 * now" and "flash, so I can find you".
 */
function Assigned({
  display,
  handle,
  onAssign,
}: {
  display: Display;
  handle: string;
  onAssign: () => void;
}) {
  const [flashing, setFlashing] = useState(false);

  useSession(display.campaignId, undefined, {
    handle,
    onAssign,
    onIdentify: () => setFlashing(true),
  });

  useEffect(() => {
    if (!flashing) return;
    const timer = setTimeout(() => setFlashing(false), IDENTIFY_MS);
    return () => clearTimeout(timer);
  }, [flashing]);

  const campaignId = display.campaignId!;
  const characterId = display.params.characterId ?? '';

  let body = <BlankScreen display={display} />;
  if (display.role === 'table')
    body = (
      <TableView campaignId={campaignId} ppi={display.ppi} ppiY={display.ppiY} />
    );
  else if (display.role === 'board') body = <BoardView campaignId={campaignId} />;
  else if (display.role === 'art') body = <ArtView campaignId={campaignId} />;
  else if (display.role === 'badge' && characterId)
    body = <BadgeView characterId={characterId} />;
  else if (display.role === 'seat' && characterId)
    body = <SeatView characterId={characterId} />;
  else if (display.role === 'console')
    body = (
      <DmView
        campaignId={campaignId}
        pane={display.params.pane ?? null}
        onPane={() => {
          /* An assigned panel is what the DM said it is. */
        }}
      />
    );

  return (
    <>
      {body}
      {flashing && <IdentifyFlash display={display} />}
    </>
  );
}
