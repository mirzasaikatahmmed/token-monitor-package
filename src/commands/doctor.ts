import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  findPython,
  checkPythonImport,
  installPythonDeps,
  loadAgentConfig,
  testHeartbeat,
  ensureVendorAgent,
} from '../lib/python.js';
import {
  hasEncryptedConfig,
  dataDir,
  vendorAgentPy,
  vendorRequirements,
} from '../lib/paths.js';
import { getService } from '../lib/service/index.js';
import { fail, heading, maskToken, ok, warn } from '../lib/ui.js';

export async function cmdDoctor(): Promise<void> {
  heading('Token Monitor — doctor');
  let issues = 0;

  // Node
  console.log(chalk.bold('Node'), process.version);
  ok(`platform ${process.platform}/${process.arch}`);

  // Vendor
  try {
    ensureVendorAgent();
    ok(`vendor agent ${vendorAgentPy()}`);
    ok(`requirements ${vendorRequirements()}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    issues++;
  }

  // Python
  try {
    const py = findPython();
    ok(`${py.command} — ${py.version}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    issues++;
    process.exitCode = 1;
    return;
  }

  for (const mod of ['requests', 'watchdog', 'cryptography']) {
    if (checkPythonImport(mod)) {
      ok(`python import ${mod}`);
    } else {
      warn(`missing python module: ${mod} — installing…`);
      try {
        installPythonDeps();
        if (checkPythonImport(mod)) ok(`installed ${mod}`);
        else {
          fail(`still missing ${mod}`);
          issues++;
        }
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        issues++;
      }
    }
  }

  // Config
  console.log();
  console.log(chalk.bold('Config'), dataDir());
  if (!hasEncryptedConfig()) {
    fail('No encrypted config — run token-monitor init');
    issues++;
  } else {
    try {
      const cfg = loadAgentConfig();
      ok(`device=${cfg.deviceId} token=${maskToken(cfg.agentToken)}`);
      ok(`backend=${cfg.backendUrl}`);

      const hb = await testHeartbeat(cfg);
      if (hb.ok) ok(`heartbeat HTTP ${hb.status}`);
      else if (hb.status === 401) {
        fail('heartbeat 401 — invalid agent token');
        issues++;
      } else {
        warn(`heartbeat HTTP ${hb.status}: ${hb.body.slice(0, 100)}`);
        issues++;
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
      issues++;
    }
  }

  // Sources
  console.log();
  console.log(chalk.bold('Sources'));
  const home = homedir();
  for (const [label, path] of [
    ['Claude Code', join(home, '.claude', 'projects')],
    ['Puku CLI', join(home, '.puku-cli', 'projects')],
    ['Cursor AI DB', join(home, '.cursor', 'ai-tracking', 'ai-code-tracking.db')],
    ['Codex CLI', join(home, '.codex', 'sessions')],
    ['Antigravity', join(home, '.gemini', 'antigravity', 'brain')],
    ['Copilot IDE', join(home, '.config', 'Code', 'User', 'globalStorage', 'github.copilot-chat', 'session-store.db')],
    ['Copilot CLI', join(home, '.copilot', 'logs')],
  ] as const) {
    if (existsSync(path)) ok(`${label}: ${path}`);
    else warn(`${label}: not found (${path})`);
  }

  // Service
  console.log();
  const svc = getService();
  console.log(chalk.bold('Service'), svc.name);
  if (svc.isInstalled()) {
    ok(`installed — active=${svc.isActive()}`);
  } else {
    warn('autostart service not installed (token-monitor init)');
  }

  console.log();
  if (issues === 0) ok('All checks passed');
  else {
    fail(`${issues} issue(s) found`);
    process.exitCode = 1;
  }
}
