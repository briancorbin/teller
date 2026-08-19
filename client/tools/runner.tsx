// The 'runner' tool — port pending (the visual reckoning, console pass).
// Also owns the 'turn' BLOCK (entity panels' slice of the same state).
import { registerTool } from './index.ts';
import { registerBlock, Refusal } from '../panels/render.tsx';

registerTool('runner', () => <Refusal>'runner' isn't ported to the new client yet</Refusal>);
registerBlock('turn', () => <Refusal>'turn' isn't ported to the new client yet</Refusal>);
