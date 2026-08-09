import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findPython } from '../python.js';
import { logFilePath, vendorAgentPy } from '../paths.js';

const LABEL = 'local.token-monitor-agent';

export function plistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

export function writePlist(): string {
  const py = findPython();
  const agent = vendorAgentPy();
  const workDir = join(agent, '..');
  const log = logFilePath();
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${py.command}</string>
    <string>${agent}</string>
  </array>
  <key>WorkingDirectory</key>  <string>${workDir}</string>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>StandardOutPath</key>   <string>${log}</string>
  <key>StandardErrorPath</key> <string>${log}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PYTHONUNBUFFERED</key><string>1</string>
  </dict>
</dict>
</plist>
`;
  const path = plistPath();
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  return path;
}

export function enableAndStart(): void {
  const path = writePlist();
  spawnSync('launchctl', ['unload', path], { encoding: 'utf8' });
  const r = spawnSync('launchctl', ['load', '-w', path], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || 'launchctl load failed');
  }
}

export function stop(): void {
  spawnSync('launchctl', ['stop', LABEL], { encoding: 'utf8' });
}

export function restart(): void {
  const path = plistPath();
  if (existsSync(path)) {
    spawnSync('launchctl', ['unload', path], { encoding: 'utf8' });
    spawnSync('launchctl', ['load', '-w', path], { encoding: 'utf8' });
  }
  spawnSync('launchctl', ['start', LABEL], { encoding: 'utf8' });
}

export function disableAndRemove(): void {
  const path = plistPath();
  if (existsSync(path)) {
    spawnSync('launchctl', ['unload', '-w', path], { encoding: 'utf8' });
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
}

export function isInstalled(): boolean {
  return existsSync(plistPath());
}

export function isActive(): boolean {
  const r = spawnSync('launchctl', ['list'], { encoding: 'utf8' });
  return (r.stdout || '').includes(LABEL);
}

export function statusText(): string {
  return isActive() ? `${LABEL}: loaded` : `${LABEL}: not loaded`;
}
