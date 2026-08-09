import chalk from 'chalk';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { getService } from '../lib/service/index.js';
import {
  dataDir,
  hasEncryptedConfig,
  configEncPath,
  logFilePath,
  pidFilePath,
  vendorAgentPy,
} from '../lib/paths.js';
import { isDetachedAgentRunning, readPid } from '../lib/process.js';
import { loadAgentConfig } from '../lib/python.js';
import { heading, maskToken, ok, warn } from '../lib/ui.js';

export async function cmdStatus(): Promise<void> {
  heading('Token Monitor — status');

  console.log(chalk.dim('Data dir'), dataDir());
  console.log(chalk.dim('Config  '), hasEncryptedConfig() ? configEncPath() : '(missing)');
  console.log(chalk.dim('Agent   '), vendorAgentPy());
  console.log(chalk.dim('Log     '), logFilePath());
  console.log(chalk.dim('PID file'), pidFilePath());

  const svc = getService();
  console.log();
  console.log(chalk.bold('Service'), `(${svc.name})`);
  if (svc.isInstalled()) {
    console.log('  installed:', chalk.green('yes'));
    console.log('  active:   ', svc.isActive() ? chalk.green('yes') : chalk.yellow('no'));
  } else {
    console.log('  installed:', chalk.dim('no'));
  }

  const detached = isDetachedAgentRunning();
  console.log();
  console.log(chalk.bold('Detached process'));
  if (detached) {
    ok(`running (pid ${readPid()})`);
  } else {
    console.log(chalk.dim('  not running'));
  }

  // Source dirs
  console.log();
  console.log(chalk.bold('Local sources'));
  const home = homedir();
  const sources = [
    ['claude', join(home, '.claude', 'projects')],
    ['puku', join(home, '.puku-cli', 'projects')],
    ['cursor', join(home, '.cursor', 'ai-tracking', 'ai-code-tracking.db')],
  ] as const;
  for (const [name, path] of sources) {
    const present = existsSync(path);
    console.log(
      `  ${name.padEnd(8)}`,
      present ? chalk.green('found') : chalk.dim('missing'),
      chalk.dim(path),
    );
  }

  if (hasEncryptedConfig()) {
    try {
      const cfg = loadAgentConfig();
      console.log();
      console.log(chalk.bold('Config'));
      console.log('  backend ', cfg.backendUrl);
      console.log('  device  ', cfg.deviceId);
      console.log('  hostname', cfg.hostname);
      console.log('  token   ', maskToken(cfg.agentToken));
    } catch (err) {
      warn(err instanceof Error ? err.message : String(err));
    }
  }
}
