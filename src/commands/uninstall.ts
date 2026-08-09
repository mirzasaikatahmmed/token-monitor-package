import prompts from 'prompts';
import { rmSync } from 'node:fs';
import { getService } from '../lib/service/index.js';
import { stopDetachedAgent } from '../lib/process.js';
import { dataDir } from '../lib/paths.js';
import { fail, heading, info, ok, warn } from '../lib/ui.js';

export type UninstallOptions = {
  wipe?: boolean;
  yes?: boolean;
};

export async function cmdUninstall(opts: UninstallOptions): Promise<void> {
  heading('Token Monitor — uninstall');

  try {
    getService().disableAndRemove();
    ok('Autostart service removed');
  } catch (err) {
    warn(err instanceof Error ? err.message : String(err));
  }

  stopDetachedAgent();
  ok('Stopped any detached agent process');

  let wipe = opts.wipe;
  if (wipe == null && !opts.yes) {
    const a = await prompts({
      type: 'confirm',
      name: 'wipe',
      message: `Also delete data dir (${dataDir()})?`,
      initial: false,
    });
    wipe = a.wipe;
  }

  if (wipe) {
    try {
      rmSync(dataDir(), { recursive: true, force: true });
      ok(`Removed ${dataDir()}`);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  } else {
    info(`Left data dir intact: ${dataDir()}`);
  }

  info('Global npm package remains — remove with: npm uninstall -g @mirzasaikatahmmed/token-monitor');
}
