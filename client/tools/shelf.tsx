// The 'shelf' tool — port pending (the visual reckoning, console pass).
import { registerTool } from './index.ts';
import { Refusal } from '../panels/render.tsx';

registerTool('shelf', () => <Refusal>'shelf' isn't ported to the new client yet</Refusal>);
