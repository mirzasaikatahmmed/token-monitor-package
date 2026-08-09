import { cmdStop } from './stop.js';
import { cmdStart } from './start.js';
import { info } from '../lib/ui.js';

export async function cmdRestart(): Promise<void> {
  info('Restarting…');
  await cmdStop();
  await new Promise((r) => setTimeout(r, 500));
  await cmdStart({});
}
