import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findPython } from '../python.js';
import { vendorAgentPy } from '../paths.js';

const UNIT = 'token-monitor-agent';

export function unitPath(): string {
  return join(homedir(), '.config', 'systemd', 'user', `${UNIT}.service`);
}

export function isSystemdUserAvailable(): boolean {
  const r = spawnSync('systemctl', ['--user', 'status'], { encoding: 'utf8' });
  // status without unit may return non-zero but command exists
  return r.error == null;
}

export function writeUnit(): string {
  const py = findPython();
  const agent = vendorAgentPy();
  const workDir = join(agent, '..');
  const content = `[Unit]
Description=Token Monitor Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${workDir}
ExecStart=${py.command} ${agent}
Restart=always
RestartSec=10
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=default.target
`;
  const path = unitPath();
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, { mode: 0o644 });
  return path;
}

export function enableAndStart(): void {
  writeUnit();
  spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8' });
  spawnSync('systemctl', ['--user', 'enable', UNIT], { encoding: 'utf8' });
  const r = spawnSync('systemctl', ['--user', 'start', UNIT], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || 'systemctl start failed');
  }
}

export function stop(): void {
  spawnSync('systemctl', ['--user', 'stop', UNIT], { encoding: 'utf8' });
}

export function restart(): void {
  spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8' });
  const r = spawnSync('systemctl', ['--user', 'restart', UNIT], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || 'systemctl restart failed');
  }
}

export function disableAndRemove(): void {
  spawnSync('systemctl', ['--user', 'stop', UNIT], { encoding: 'utf8' });
  spawnSync('systemctl', ['--user', 'disable', UNIT], { encoding: 'utf8' });
  try {
    unlinkSync(unitPath());
  } catch {
    /* ignore */
  }
  spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8' });
}

export function isActive(): boolean {
  const r = spawnSync('systemctl', ['--user', 'is-active', UNIT], {
    encoding: 'utf8',
  });
  return (r.stdout || '').trim() === 'active';
}

export function isInstalled(): boolean {
  return existsSync(unitPath());
}

export function statusText(): string {
  const r = spawnSync('systemctl', ['--user', 'status', UNIT, '--no-pager'], {
    encoding: 'utf8',
  });
  return (r.stdout || r.stderr || '').trim();
}
