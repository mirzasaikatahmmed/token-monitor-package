import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { cmdInit } from './commands/init.js';
import { cmdStart } from './commands/start.js';
import { cmdStop } from './commands/stop.js';
import { cmdRestart } from './commands/restart.js';
import { cmdStatus } from './commands/status.js';
import {
  cmdConfigPath,
  cmdConfigShow,
  cmdConfigSetToken,
  cmdConfigSet,
} from './commands/config.js';
import { cmdDoctor } from './commands/doctor.js';
import { cmdLogs } from './commands/logs.js';
import { cmdUninstall } from './commands/uninstall.js';

function packageVersion(): string {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      version: string;
    };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

const program = new Command();

program
  .name('token-monitor')
  .description(
    'Token Monitor agent CLI — collect Claude / Puku / Cursor usage for your dashboard',
  )
  .version(packageVersion());

program
  .command('init')
  .description('Interactive setup: encrypted config, Python deps, optional autostart')
  .option('--no-service', 'Skip OS autostart service')
  .option('-y, --yes', 'Accept defaults / enable service without prompts')
  .option('--backend <url>', 'Backend URL')
  .option('--token <token>', 'Agent token')
  .option('--device-id <id>', 'Device ID')
  .option('--hostname <name>', 'Hostname')
  .action(async (opts) => {
    await cmdInit({
      noService: opts.service === false,
      yes: !!opts.yes,
      backend: opts.backend,
      token: opts.token,
      deviceId: opts.deviceId,
      hostname: opts.hostname,
    });
  });

program
  .command('start')
  .description('Start the agent (service if installed, else detached)')
  .option('-f, --foreground', 'Run in the foreground')
  .action(async (opts) => {
    await cmdStart({ foreground: !!opts.foreground });
  });

program
  .command('stop')
  .description('Stop the agent service / process')
  .action(async () => {
    await cmdStop();
  });

program
  .command('restart')
  .description('Restart the agent')
  .action(async () => {
    await cmdRestart();
  });

program
  .command('status')
  .description('Show service, config, and local source status')
  .action(async () => {
    await cmdStatus();
  });

const config = program
  .command('config')
  .description('Manage encrypted agent configuration');

config
  .command('path')
  .description('Print data / config / key paths')
  .action(async () => {
    await cmdConfigPath();
  });

config
  .command('show')
  .description('Show config (token masked)')
  .action(async () => {
    await cmdConfigShow();
  });

config
  .command('set-token')
  .argument('<token>', 'New agent token')
  .description('Update agentToken in encrypted config')
  .action(async (token: string) => {
    await cmdConfigSetToken(token);
  });

config
  .command('set')
  .description('Update config fields')
  .option('--backend <url>')
  .option('--device-id <id>')
  .option('--hostname <name>')
  .option('--interval <seconds>', 'Push interval seconds', (v) => parseInt(v, 10))
  .action(async (opts) => {
    await cmdConfigSet({
      backend: opts.backend,
      deviceId: opts.deviceId,
      hostname: opts.hostname,
      interval: opts.interval,
    });
  });

program
  .command('doctor')
  .description('Health-check Python, deps, config, heartbeat, sources')
  .action(async () => {
    await cmdDoctor();
  });

program
  .command('logs')
  .description('Show agent logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <n>', 'Number of lines', (v) => parseInt(v, 10), 80)
  .action(async (opts) => {
    await cmdLogs({ follow: !!opts.follow, lines: opts.lines });
  });

program
  .command('uninstall')
  .description('Remove autostart; optionally wipe data dir')
  .option('--wipe', 'Delete encrypted config and state')
  .option('-y, --yes', 'Skip confirmations')
  .action(async (opts) => {
    await cmdUninstall({ wipe: opts.wipe, yes: !!opts.yes });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
