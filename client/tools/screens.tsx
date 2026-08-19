// The 'screens' tool — port pending (the visual reckoning, console pass).
import { registerTool } from './index.ts';
import { Refusal } from '../panels/render.tsx';

registerTool('screens', () => <Refusal>'screens' isn't ported to the new client yet</Refusal>);
