import { DmView } from './views/DmView';
import { Landing } from './views/Landing';
import { SeatView } from './views/SeatView';
import { TableView } from './views/TableView';

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

export default function App() {
  const route = parseRoute(window.location.pathname);
  switch (route.view) {
    case 'dm':
      return <DmView campaignId={route.campaignId} />;
    case 'table':
      return <TableView campaignId={route.campaignId} />;
    case 'seat':
      return <SeatView characterId={route.characterId} />;
    default:
      return <Landing />;
  }
}
