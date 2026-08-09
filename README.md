# @mirzasaikatahmmed/token-monitor

[![CI](https://github.com/mirzasaikatahmmed/token-monitor-package/actions/workflows/ci.yml/badge.svg)](https://github.com/mirzasaikatahmmed/token-monitor-package/actions/workflows/ci.yml)
[![Publish npm](https://github.com/mirzasaikatahmmed/token-monitor-package/actions/workflows/publish.yml/badge.svg)](https://github.com/mirzasaikatahmmed/token-monitor-package/actions/workflows/publish.yml)
[![npm](https://img.shields.io/npm/v/@mirzasaikatahmmed/token-monitor.svg)](https://www.npmjs.com/package/@mirzasaikatahmmed/token-monitor)

Professional global CLI for the **Token Monitor** agent. Collects Claude Code, Puku CLI, and Cursor usage on this machine and ships it to your dashboard.

**Repository:** https://github.com/mirzasaikatahmmed/token-monitor-package

```bash
npm install -g @mirzasaikatahmmed/token-monitor
token-monitor init
```

## Requirements

- **Node.js** ≥ 18
- **Python** 3 (for the collector runtime)
- Network access to your Token Monitor backend

## Quick start

```bash
npm install -g @mirzasaikatahmmed/token-monitor
token-monitor init          # encrypted config + Python deps + optional autostart
token-monitor status
token-monitor doctor
```

Non-interactive:

```bash
token-monitor init \
  --backend https://token-monitor-api.example.com \
  --token YOUR_AGENT_TOKEN \
  --device-id Office-PC \
  --hostname my-pc \
  --yes
```

## Commands

| Command | Description |
|---------|-------------|
| `token-monitor init` | Setup encrypted config, install Python deps, optional login autostart |
| `token-monitor start` | Start agent (OS service if installed, else detached) |
| `token-monitor start -f` | Run in foreground |
| `token-monitor stop` | Stop service / process |
| `token-monitor restart` | Restart |
| `token-monitor status` | Service, config, local sources |
| `token-monitor config show` | Show config (token masked) |
| `token-monitor config path` | Print data / config paths |
| `token-monitor config set-token <tok>` | Update token |
| `token-monitor config set --backend <url>` | Update fields |
| `token-monitor doctor` | Health checks + heartbeat probe |
| `token-monitor logs [-f]` | View / follow logs |
| `token-monitor uninstall [--wipe]` | Remove autostart; optional wipe data |

## Where data lives (system, encrypted)

Config is **not** stored in the npm package folder.

| OS | Data directory |
|----|----------------|
| Linux | `~/.config/token-monitor-agent/` |
| macOS | `~/Library/Application Support/token-monitor-agent/` |
| Windows | `%APPDATA%\token-monitor-agent\` |

| File | Purpose |
|------|---------|
| `config.enc` | Fernet-encrypted JSON (includes `agentToken`), mode `0600` |
| `secret.key` | Local encryption key, mode `0600` |
| `agent_state.db` | Scan offsets |
| `agent.log` | Agent log |
| `agent.pid` | Detached process pid (when not using OS service) |

Override with `TOKEN_MONITOR_DATA_DIR=/custom/path`.

## Autostart

| OS | Mechanism |
|----|-----------|
| Linux | systemd user unit `token-monitor-agent` |
| macOS | launchd `local.token-monitor-agent` |
| Windows | Task Scheduler `TokenMonitorAgent` |

## Development

```bash
git clone https://github.com/mirzasaikatahmmed/token-monitor-package.git
cd token-monitor-package
npm install
npm run build
npm link                 # exposes token-monitor on PATH
token-monitor doctor
```

Sync the vendored Python agent from a sibling `../token-monitor-agent` checkout (optional):

```bash
npm run sync-vendor
```

In a standalone clone, `vendor/agent/` is already included — sync keeps existing vendor if the sibling is missing.

### Layout

```
.
├── src/              # TypeScript CLI
├── vendor/agent/     # Vendored agent.py + requirements.txt
├── dist/             # Built CLI (npm pack)
└── .github/workflows # CI + npm publish
```

The collector itself remains Python (`vendor/agent/agent.py`). The CLI owns install UX, encrypted config writes (via agent helpers), and OS services.

## CI / CD

Workflows in [`.github/workflows/`](https://github.com/mirzasaikatahmmed/token-monitor-package/tree/main/.github/workflows):

| Workflow | Trigger | Action |
|----------|---------|--------|
| [`ci.yml`](https://github.com/mirzasaikatahmmed/token-monitor-package/blob/main/.github/workflows/ci.yml) | push / PR | typecheck + build |
| [`publish.yml`](https://github.com/mirzasaikatahmmed/token-monitor-package/blob/main/.github/workflows/publish.yml) | push to `main`/`master` | build + `npm publish` |

### Secrets

1. Create a granular npm token at https://www.npmjs.com/settings/~/tokens  
2. Add GitHub Actions secret **`NPM_TOKEN`**:  
   https://github.com/mirzasaikatahmmed/token-monitor-package/settings/secrets/actions

### Release

Bump the version, then push (same version on npm is skipped):

```bash
npm version patch
git push && git push --tags
```

Manual publish: [Actions → Publish npm → Run workflow](https://github.com/mirzasaikatahmmed/token-monitor-package/actions/workflows/publish.yml)

## Links

- GitHub: https://github.com/mirzasaikatahmmed/token-monitor-package
- npm: https://www.npmjs.com/package/@mirzasaikatahmmed/token-monitor
- Issues: https://github.com/mirzasaikatahmmed/token-monitor-package/issues

## License

MIT
