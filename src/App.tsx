import { ArtView } from './views/ArtView';
import { BadgeView } from './views/BadgeView';
import { BoardView } from './views/BoardView';
import { DmView } from './views/DmView';
import { Landing } from './views/Landing';
import { SeatView } from './views/SeatView';
import { TableView } from './views/TableView';

type Route =
  | { view: 'landing' }
  | { view: 'dm'; campaignId: string }
  | { view: 'table'; campaignId: string }
  | { view: 'board'; campaignId: string }
  | { view: 'art'; campaignId: string }
  | { view: 'seat'; characterId: string }
  | { view: 'badge'; characterId: string };

function parseRoute(pathname: string): Route {
  let m = pathname.match(/^\/dm\/([^/]+)$/);
  if (m) return { view: 'dm', campaignId: m[1] };
  m = pathname.match(/^\/table\/([^/]+)$/);
  if (m) return { view: 'table', campaignId: m[1] };
  m = pathname.match(/^\/board\/([^/]+)$/);
  if (m) return { view: 'board', campaignId: m[1] };
  m = pathname.match(/^\/art\/([^/]+)$/);
  if (m) return { view: 'art', campaignId: m[1] };
  m = pathname.match(/^\/seat\/([^/]+)$/);
  if (m) return { view: 'seat', characterId: m[1] };
  m = pathname.match(/^\/badge\/([^/]+)$/);
  if (m) return { view: 'badge', characterId: m[1] };
  return { view: 'landing' };
}

export default function App() {
  const route = parseRoute(window.location.pathname);
  switch (route.view) {
    case 'dm':
      return <DmView campaignId={route.campaignId} />;
    case 'table':
      return <TableView campaignId={route.campaignId} />;
    case 'board':
      return <BoardView campaignId={route.campaignId} />;
    case 'art':
      return <ArtView campaignId={route.campaignId} />;
    case 'seat':
      return <SeatView characterId={route.characterId} />;
    case 'badge':
      return <BadgeView characterId={route.characterId} />;
    default:
      return <Landing />;
  }
}
