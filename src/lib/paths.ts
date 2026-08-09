import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP = 'token-monitor-agent';

/** Resolve package root from the compiled CLI entry (dist/cli.js). */
export function resolvePackageRoot(): string {
  // tsup bundles into a single dist/cli.js → parent is package root
  const cliDir = dirname(fileURLToPath(import.meta.url));
  return join(cliDir, '..');
}

export function vendorAgentDir(): string {
  return join(resolvePackageRoot(), 'vendor', 'agent');
}

export function vendorAgentPy(): string {
  return join(vendorAgentDir(), 'agent.py');
}

export function vendorRequirements(): string {
  return join(vendorAgentDir(), 'requirements.txt');
}

/** Per-user system data directory (encrypted config, state, logs). */
export function dataDir(): string {
  const override = process.env.TOKEN_MONITOR_DATA_DIR;
  if (override) {
    const d = override.replace(/^~(?=$|[/\\])/, homedir());
    mkdirSync(d, { recursive: true });
    return d;
  }

  let base: string;
  switch (platform()) {
    case 'win32':
      base = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
      break;
    case 'darwin':
      base = join(homedir(), 'Library', 'Application Support');
      break;
    default:
      base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  }

  const d = join(base, APP);
  mkdirSync(d, { recursive: true });
  return d;
}

export function configEncPath(): string {
  return join(dataDir(), 'config.enc');
}

export function keyFilePath(): string {
  return join(dataDir(), 'secret.key');
}

export function stateDbPath(): string {
  return join(dataDir(), 'agent_state.db');
}

export function logFilePath(): string {
  return join(dataDir(), 'agent.log');
}

export function pidFilePath(): string {
  return join(dataDir(), 'agent.pid');
}

export function hasEncryptedConfig(): boolean {
  return existsSync(configEncPath());
}

export type HostPlatform = 'linux' | 'macos' | 'windows' | 'other';

export function hostPlatform(): HostPlatform {
  switch (platform()) {
    case 'linux':
      return 'linux';
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    default:
      return 'other';
  }
}
