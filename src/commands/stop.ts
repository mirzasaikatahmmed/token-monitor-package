import { getService } from '../lib/service/index.js';
import { stopDetachedAgent, isDetachedAgentRunning } from '../lib/process.js';
import { info, ok, warn } from '../lib/ui.js';

export async function cmdStop(): Promise<void> {
  let stopped = false;
  const svc = getService();
  if (svc.isInstalled()) {
    try {
      svc.stop();
      stopped = true;
      ok(`Stopped ${svc.name} service`);
    } catch (err) {
      warn(err instanceof Error ? err.message : String(err));
    }
  }

  if (isDetachedAgentRunning()) {
    stopDetachedAgent();
    stopped = true;
    ok('Stopped detached agent process');
  }

  if (!stopped) {
    info('No running agent found');
  }
}
