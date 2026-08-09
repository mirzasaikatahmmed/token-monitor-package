import { getService } from '../lib/service/index.js';
import { hasEncryptedConfig } from '../lib/paths.js';
import {
  runAgentForeground,
  startDetachedAgent,
  isDetachedAgentRunning,
} from '../lib/process.js';
import { fail, info, ok, warn } from '../lib/ui.js';

export type StartOptions = {
  foreground?: boolean;
};

export async function cmdStart(opts: StartOptions): Promise<void> {
  if (!hasEncryptedConfig()) {
    fail('No config found. Run: token-monitor init');
    process.exitCode = 1;
    return;
  }

  if (opts.foreground) {
    info('Starting agent in foreground (Ctrl-C to stop)…');
    runAgentForeground();
  }

  const svc = getService();
  if (svc.isInstalled()) {
    try {
      if (svc.isActive()) {
        ok('Service already running');
        return;
      }
      svc.enableAndStart();
      ok(`Started via ${svc.name}`);
      return;
    } catch (err) {
      warn(err instanceof Error ? err.message : String(err));
    }
  }

  if (isDetachedAgentRunning()) {
    ok('Agent already running (pid file)');
    return;
  }

  try {
    const pid = startDetachedAgent();
    ok(`Agent started (pid ${pid})`);
    info('Tip: run token-monitor init to install autostart service');
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
