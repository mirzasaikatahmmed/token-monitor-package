import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync } from 'node:fs';
import { vendorAgentDir, vendorAgentPy, vendorRequirements } from './paths.js';

export type PythonInfo = {
  command: string;
  version: string;
};

function tryPython(cmd: string): PythonInfo | null {
  const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const version = (r.stdout || r.stderr || '').trim();
  return { command: cmd, version };
}

/** Prefer python3, fall back to python (Windows). */
export function findPython(): PythonInfo {
  const found = tryPython('python3') || tryPython('python');
  if (!found) {
    throw new Error(
      'Python 3 not found. Install from https://python.org and ensure it is on PATH.',
    );
  }
  return found;
}

export function runPython(
  args: string[],
  opts?: { input?: string; env?: NodeJS.ProcessEnv },
): SpawnSyncReturns<string> {
  const py = findPython();
  return spawnSync(py.command, args, {
    encoding: 'utf8',
    input: opts?.input,
    env: { ...process.env, ...opts?.env, PYTHONUNBUFFERED: '1' },
  });
}

export function ensureVendorAgent(): void {
  if (!existsSync(vendorAgentPy())) {
    throw new Error(`Vendored agent missing at ${vendorAgentPy()}`);
  }
}

/** pip install -r vendor/agent/requirements.txt */
export function installPythonDeps(): void {
  ensureVendorAgent();
  const py = findPython();
  const req = vendorRequirements();
  const attempts: string[][] = [
    ['-m', 'pip', 'install', '-r', req, '-q', '--break-system-packages'],
    ['-m', 'pip', 'install', '-r', req, '-q', '--user'],
    ['-m', 'pip', 'install', '-r', req, '-q'],
  ];
  let lastErr = '';
  for (const args of attempts) {
    const r = spawnSync(py.command, args, { encoding: 'utf8' });
    if (r.status === 0) return;
    lastErr = r.stderr || r.stdout || 'unknown error';
  }
  throw new Error(`pip install failed:\n${lastErr}`);
}

export function checkPythonImport(mod: string): boolean {
  const py = findPython();
  const r = spawnSync(py.command, ['-c', `import ${mod}`], { encoding: 'utf8' });
  return r.status === 0;
}

export type AgentConfig = {
  backendUrl: string;
  agentToken: string;
  deviceId: string;
  hostname: string;
  pushIntervalSeconds?: number;
  sources?: string[];
};

/** Write encrypted config via agent.py --write-config (stdin JSON). */
export function writeEncryptedConfig(cfg: AgentConfig): void {
  ensureVendorAgent();
  const payload = JSON.stringify({
    backendUrl: cfg.backendUrl,
    agentToken: cfg.agentToken,
    deviceId: cfg.deviceId,
    hostname: cfg.hostname,
    pushIntervalSeconds: cfg.pushIntervalSeconds ?? 30,
    sources: cfg.sources ?? ['claude_code', 'puku_cli', 'cursor'],
  });
  const r = runPython([vendorAgentPy(), '--write-config'], { input: payload });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || 'Failed to write encrypted config');
  }
}

export function setAgentToken(token: string): void {
  ensureVendorAgent();
  const r = runPython([vendorAgentPy(), '--set-token', token]);
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || 'Failed to set token');
  }
}

/** Load decrypted config via agent.load_config(). */
export function loadAgentConfig(): AgentConfig {
  ensureVendorAgent();
  const py = findPython();
  const agentDir = vendorAgentDir();
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(agentDir)})
from agent import load_config
c = load_config()
print(json.dumps({
  "backendUrl": c.get("backendUrl",""),
  "agentToken": c.get("agentToken",""),
  "deviceId": c.get("deviceId",""),
  "hostname": c.get("hostname",""),
  "pushIntervalSeconds": c.get("pushIntervalSeconds", 30),
  "sources": c.get("sources") or [],
}))
`;
  const r = spawnSync(py.command, ['-c', script], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || 'Failed to load config');
  }
  return JSON.parse(r.stdout.trim()) as AgentConfig;
}

export async function testHeartbeat(cfg: AgentConfig): Promise<{
  ok: boolean;
  status: number;
  body: string;
}> {
  const url = `${cfg.backendUrl.replace(/\/$/, '')}/api/devices/heartbeat`;
  const os = `${process.platform} ${process.arch}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.agentToken}`,
      },
      body: JSON.stringify({
        deviceId: cfg.deviceId,
        hostname: cfg.hostname,
        os,
        platform: process.platform === 'win32' ? 'windows' : process.platform,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: err instanceof Error ? err.message : String(err),
    };
  }
}
