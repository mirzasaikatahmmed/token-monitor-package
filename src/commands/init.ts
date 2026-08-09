import prompts from 'prompts';
import { hostname as osHostname } from 'node:os';
import ora from 'ora';
import {
  findPython,
  installPythonDeps,
  writeEncryptedConfig,
  testHeartbeat,
  type AgentConfig,
} from '../lib/python.js';
import { getService } from '../lib/service/index.js';
import { dataDir, hasEncryptedConfig } from '../lib/paths.js';
import { fail, heading, info, ok, warn } from '../lib/ui.js';
import { loadAgentConfig } from '../lib/python.js';

export type InitOptions = {
  noService?: boolean;
  yes?: boolean;
  backend?: string;
  token?: string;
  deviceId?: string;
  hostname?: string;
};

export async function cmdInit(opts: InitOptions): Promise<void> {
  heading('Token Monitor — init');

  const spinner = ora('Checking Python…').start();
  try {
    const py = findPython();
    spinner.succeed(`Python: ${py.version}`);
  } catch (err) {
    spinner.fail(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  const depSpin = ora('Installing Python dependencies…').start();
  try {
    installPythonDeps();
    depSpin.succeed('Python dependencies ready');
  } catch (err) {
    depSpin.fail(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  let defaults: Partial<AgentConfig> = {};
  if (hasEncryptedConfig()) {
    try {
      defaults = loadAgentConfig();
      warn('Existing encrypted config found — values pre-filled');
    } catch {
      /* ignore */
    }
  }

  const defaultHost = osHostname();
  const defaultDevice = (defaults.deviceId || defaultHost)
    .toLowerCase()
    .replace(/\s+/g, '-');

  let backendUrl = opts.backend;
  let agentToken = opts.token;
  let deviceId = opts.deviceId;
  let hostnameVal = opts.hostname;

  if (!opts.yes || !backendUrl || !agentToken || !deviceId || !hostnameVal) {
    const answers = await prompts(
      [
        {
          type: () => (opts.backend ? null : 'text'),
          name: 'backendUrl',
          message: 'Backend URL',
          initial: defaults.backendUrl || 'http://localhost:3001',
        },
        {
          type: () => (opts.token ? null : 'password'),
          name: 'agentToken',
          message: 'Agent token (from dashboard → Setup)',
          validate: (v: string) => (v?.trim() ? true : 'Token is required'),
        },
        {
          type: () => (opts.deviceId ? null : 'text'),
          name: 'deviceId',
          message: 'Device ID',
          initial: defaultDevice,
        },
        {
          type: () => (opts.hostname ? null : 'text'),
          name: 'hostname',
          message: 'Hostname',
          initial: defaults.hostname || defaultHost,
        },
      ],
      { onCancel: () => process.exit(1) },
    );
    backendUrl = backendUrl || answers.backendUrl;
    agentToken = agentToken || answers.agentToken;
    deviceId = deviceId || answers.deviceId;
    hostnameVal = hostnameVal || answers.hostname;
  }

  if (!backendUrl || !agentToken || !deviceId || !hostnameVal) {
    fail('Missing required configuration values');
    process.exitCode = 1;
    return;
  }

  const cfg: AgentConfig = {
    backendUrl: backendUrl.replace(/\/$/, ''),
    agentToken: agentToken.trim(),
    deviceId: deviceId.trim(),
    hostname: hostnameVal.trim(),
    pushIntervalSeconds: 30,
  };

  try {
    writeEncryptedConfig(cfg);
    ok(`Encrypted config saved → ${dataDir()}/config.enc`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  const hb = ora('Testing heartbeat…').start();
  const result = await testHeartbeat(cfg);
  if (result.ok) {
    hb.succeed(`Connected (HTTP ${result.status})`);
  } else if (result.status === 401) {
    hb.warn('Backend reached but token is invalid — check the token');
  } else if (result.status === 0) {
    hb.warn(`Could not reach backend: ${result.body}`);
  } else {
    hb.warn(`Unexpected HTTP ${result.status}: ${result.body.slice(0, 120)}`);
  }

  if (!opts.noService) {
    let enable = opts.yes;
    if (!opts.yes) {
      const a = await prompts({
        type: 'confirm',
        name: 'enable',
        message: 'Enable autostart on login?',
        initial: true,
      });
      enable = a.enable;
    }
    if (enable) {
      try {
        const svc = getService();
        svc.enableAndStart();
        ok(`Autostart enabled (${svc.name})`);
      } catch (err) {
        warn(err instanceof Error ? err.message : String(err));
        info('You can start manually with: token-monitor start');
      }
    } else {
      info('Skipped autostart — run: token-monitor start');
    }
  } else {
    info('Skipped service (--no-service)');
  }

  console.log();
  ok('Init complete');
  info(`Data dir: ${dataDir()}`);
}
