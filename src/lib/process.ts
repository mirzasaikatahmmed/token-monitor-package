import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { findPython, ensureVendorAgent, pythonChildEnv } from './python.js';
import { logFilePath, pidFilePath, vendorAgentPy } from './paths.js';

function sleepMs(ms: number): void {
  spawnSync(process.execPath, ['-e', `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ms})`], {
    stdio: 'ignore',
  });
}

export function readPid(): number | null {
  const p = pidFilePath();
  if (!existsSync(p)) return null;
  try {
    const n = parseInt(readFileSync(p, 'utf8').trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writePid(pid: number): void {
  writeFileSync(pidFilePath(), String(pid), { mode: 0o600 });
}

export function clearPid(): void {
  try {
    unlinkSync(pidFilePath());
  } catch {
    /* ignore */
  }
}

export function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isDetachedAgentRunning(): boolean {
  const pid = readPid();
  if (pid == null) return false;
  if (!isPidRunning(pid)) {
    clearPid();
    return false;
  }
  return true;
}

/** Spawn agent detached with log file; write pid. */
export function startDetachedAgent(): number {
  ensureVendorAgent();
  if (isDetachedAgentRunning()) {
    return readPid()!;
  }

  const py = findPython();
  const log = logFilePath();
  const agent = vendorAgentPy();

  if (process.platform === 'win32') {
    const child = spawn(py.command, [agent], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: pythonChildEnv(),
    });
    child.unref();
    if (child.pid == null) throw new Error('Failed to start agent');
    writePid(child.pid);
    return child.pid;
  }

  const child = spawn(
    'bash',
    ['-c', `exec "${py.command}" "${agent}" >> "${log}" 2>&1`],
    {
      detached: true,
      stdio: 'ignore',
      env: pythonChildEnv(),
    },
  );
  child.unref();
  if (child.pid == null) throw new Error('Failed to start agent');
  writePid(child.pid);
  return child.pid;
}

export function stopDetachedAgent(): boolean {
  const pid = readPid();
  if (pid == null) return false;
  if (!isPidRunning(pid)) {
    clearPid();
    return false;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* ignore */
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && isPidRunning(pid)) {
    sleepMs(200);
  }
  if (isPidRunning(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  }
  clearPid();
  return true;
}

/** Run agent in foreground (blocks). */
export function runAgentForeground(): never {
  ensureVendorAgent();
  const py = findPython();
  const r = spawnSync(py.command, [vendorAgentPy()], {
    stdio: 'inherit',
    env: pythonChildEnv(),
  });
  process.exit(r.status ?? 1);
}
