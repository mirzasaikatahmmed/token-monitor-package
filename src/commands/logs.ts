import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { hostPlatform, logFilePath } from '../lib/paths.js';
import { fail, info, warn } from '../lib/ui.js';

export type LogsOptions = {
  follow?: boolean;
  lines?: number;
};

export async function cmdLogs(opts: LogsOptions): Promise<void> {
  const lines = opts.lines ?? 80;
  const plat = hostPlatform();

  if (plat === 'linux') {
    const args = [
      '--user',
      '-u',
      'token-monitor-agent',
      '-n',
      String(lines),
      '--no-pager',
    ];
    if (opts.follow) args.push('-f');
    const r = spawnSync('journalctl', args, { stdio: 'inherit' });
    if (r.status === 0 || r.status === null) return;
    warn('journalctl unavailable — falling back to agent.log');
  }

  const log = logFilePath();
  if (!existsSync(log)) {
    fail(`No log file at ${log}`);
    info('Start the agent once to create logs');
    process.exitCode = 1;
    return;
  }

  if (opts.follow) {
    info(`Tailing ${log} (Ctrl-C to stop)`);
    const child = spawn('tail', ['-n', String(lines), '-f', log], {
      stdio: 'inherit',
    });
    await new Promise<void>((resolve) => {
      child.on('exit', () => resolve());
      process.on('SIGINT', () => {
        child.kill('SIGINT');
      });
    });
    return;
  }

  const content = readFileSync(log, 'utf8');
  const slice = content.split('\n').slice(-lines).join('\n');
  console.log(slice);
}
