import { mkdirSync, writeFileSync, existsSync, unlinkSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findPython } from '../python.js';
import { dataDir, logFilePath, vendorAgentPy } from '../paths.js';

const TASK = 'TokenMonitorAgent';

export function vbsPath(): string {
  return join(dataDir(), 'run_agent_hidden.vbs');
}

export function writeVbs(): string {
  const py = findPython();
  const agent = vendorAgentPy();
  const log = logFilePath();
  const workDir = join(agent, '..');
  const content = `Set objShell = CreateObject("WScript.Shell")
objShell.CurrentDirectory = "${workDir.replace(/\\/g, '\\\\')}"
objShell.Run "cmd /c set PYTHONUNBUFFERED=1&& set PYTHONIOENCODING=utf-8&& set PYTHONUTF8=1&& ""${py.command}"" ""${agent}"" >> ""${log}"" 2>&1", 0, False
`;
  const path = vbsPath();
  writeFileSync(path, content);
  return path;
}

export function enableAndStart(): void {
  const vbs = writeVbs();
  spawnSync('schtasks', ['/delete', '/tn', TASK, '/f'], { encoding: 'utf8' });
  const create = spawnSync(
    'schtasks',
    [
      '/create',
      '/tn',
      TASK,
      '/tr',
      `wscript.exe "${vbs}"`,
      '/sc',
      'ONLOGON',
      '/rl',
      'HIGHEST',
      '/f',
    ],
    { encoding: 'utf8' },
  );
  if (create.status !== 0) {
    // Fallback: Startup folder
    const startup = join(
      process.env.APPDATA || '',
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Startup',
    );
    mkdirSync(startup, { recursive: true });
    copyFileSync(vbs, join(startup, 'TokenMonitorAgent.vbs'));
  }
  spawnSync('wscript.exe', [vbs], { encoding: 'utf8', windowsHide: true });
}

export function stop(): void {
  spawnSync('schtasks', ['/end', '/tn', TASK], { encoding: 'utf8' });
  // Best-effort kill python agent
  spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'agent\\.py' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ],
    { encoding: 'utf8' },
  );
}

export function restart(): void {
  stop();
  enableAndStart();
}

export function disableAndRemove(): void {
  spawnSync('schtasks', ['/end', '/tn', TASK], { encoding: 'utf8' });
  spawnSync('schtasks', ['/delete', '/tn', TASK, '/f'], { encoding: 'utf8' });
  const startup = join(
    process.env.APPDATA || '',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    'TokenMonitorAgent.vbs',
  );
  try {
    unlinkSync(startup);
  } catch {
    /* ignore */
  }
  try {
    unlinkSync(vbsPath());
  } catch {
    /* ignore */
  }
}

export function isInstalled(): boolean {
  const r = spawnSync('schtasks', ['/query', '/tn', TASK], { encoding: 'utf8' });
  return r.status === 0 || existsSync(vbsPath());
}

export function isActive(): boolean {
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'agent\\.py' }).Count`,
    ],
    { encoding: 'utf8' },
  );
  const n = parseInt((r.stdout || '0').trim(), 10);
  return Number.isFinite(n) && n > 0;
}

export function statusText(): string {
  return isActive() ? `${TASK}: running` : `${TASK}: not running`;
}
