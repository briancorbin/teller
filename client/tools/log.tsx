// The 'log' tool — port pending (the visual reckoning, console pass).
import { registerTool } from './index.ts';
import { Refusal } from '../panels/render.tsx';

registerTool('log', () => <Refusal>'log' isn't ported to the new client yet</Refusal>);
