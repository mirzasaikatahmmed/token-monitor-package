import chalk from 'chalk';
import {
  dataDir,
  configEncPath,
  keyFilePath,
  hasEncryptedConfig,
} from '../lib/paths.js';
import { loadAgentConfig, setAgentToken, writeEncryptedConfig } from '../lib/python.js';
import { updateConfig } from '../lib/config.js';
import { fail, heading, info, maskToken, ok } from '../lib/ui.js';

export async function cmdConfigPath(): Promise<void> {
  console.log(dataDir());
  console.log(configEncPath());
  console.log(keyFilePath());
}

export async function cmdConfigShow(): Promise<void> {
  heading('Token Monitor — config');
  if (!hasEncryptedConfig()) {
    fail('No encrypted config. Run: token-monitor init');
    process.exitCode = 1;
    return;
  }
  const cfg = loadAgentConfig();
  console.log(chalk.dim('backendUrl'), cfg.backendUrl);
  console.log(chalk.dim('deviceId  '), cfg.deviceId);
  console.log(chalk.dim('hostname  '), cfg.hostname);
  console.log(chalk.dim('token     '), maskToken(cfg.agentToken));
  console.log(chalk.dim('interval  '), cfg.pushIntervalSeconds ?? 30);
  console.log(chalk.dim('sources   '), (cfg.sources || []).join(', '));
  info(`Encrypted file: ${configEncPath()}`);
}

export async function cmdConfigSetToken(token: string): Promise<void> {
  if (!token?.trim()) {
    fail('Token required: token-monitor config set-token <token>');
    process.exitCode = 1;
    return;
  }
  if (!hasEncryptedConfig()) {
    fail('No config yet. Run: token-monitor init');
    process.exitCode = 1;
    return;
  }
  setAgentToken(token.trim());
  ok('agentToken updated (encrypted)');
  info('Restart with: token-monitor restart');
}

export type ConfigSetOptions = {
  backend?: string;
  deviceId?: string;
  hostname?: string;
  interval?: number;
};

export async function cmdConfigSet(opts: ConfigSetOptions): Promise<void> {
  if (!opts.backend && !opts.deviceId && !opts.hostname && opts.interval == null) {
    fail('Nothing to set. Use --backend, --device-id, --hostname, and/or --interval');
    process.exitCode = 1;
    return;
  }
  if (!hasEncryptedConfig()) {
    if (!opts.backend || !opts.deviceId || !opts.hostname) {
      fail('First-time set requires --backend, --device-id, --hostname (and token via init)');
      process.exitCode = 1;
      return;
    }
    writeEncryptedConfig({
      backendUrl: opts.backend,
      agentToken: '',
      deviceId: opts.deviceId,
      hostname: opts.hostname,
      pushIntervalSeconds: opts.interval ?? 30,
    });
    ok('Config created (empty token — run set-token)');
    return;
  }
  updateConfig({
    ...(opts.backend ? { backendUrl: opts.backend.replace(/\/$/, '') } : {}),
    ...(opts.deviceId ? { deviceId: opts.deviceId } : {}),
    ...(opts.hostname ? { hostname: opts.hostname } : {}),
    ...(opts.interval != null ? { pushIntervalSeconds: opts.interval } : {}),
  });
  ok('Config updated');
}
