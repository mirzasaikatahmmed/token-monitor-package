# token-monitor

Professional global CLI for the **Token Monitor** agent. Collects Claude Code, Puku CLI, and Cursor usage on this machine and ships it to your dashboard.

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

## Development (this repo)

```bash
cd token-monitor-package
npm install
npm run build
npm link                 # exposes token-monitor on PATH
token-monitor doctor
```

Sync the vendored Python agent from `../token-monitor-agent`:

```bash
npm run sync-vendor
```

### Layout

```
token-monitor-package/
  src/           # TypeScript CLI
  vendor/agent/  # Vendored agent.py + requirements.txt
  dist/          # Built CLI (npm pack)
```

The collector itself remains Python (`vendor/agent/agent.py`) so Claude / Puku / Cursor parsers stay in one place. The CLI owns install UX, encrypted config writes (via agent helpers), and OS services.

## CI / CD (GitHub → npm)

Workflows live at the monorepo root:

- [`.github/workflows/ci-token-monitor.yml`](../.github/workflows/ci-token-monitor.yml) — typecheck + build on PR/push
- [`.github/workflows/publish-npm.yml`](../.github/workflows/publish-npm.yml) — on push to `main`/`master` (paths under `token-monitor-package/` or agent vendor sources), rebuild and `npm publish`

### One-time setup

1. Create a **granular npm access token** (Read and write / publish) at  
   https://www.npmjs.com/settings/~/tokens  
   Prefer “Bypass 2FA” for CI. **Never commit the token.**
2. In the GitHub repo → **Settings → Secrets and variables → Actions** → New repository secret:
   - Name: `NPM_TOKEN`
   - Value: the npm token
3. Push this monorepo to GitHub (workflows must live in the default branch).
4. Bump the version before each new release (npm won’t republish the same version):

```bash
cd token-monitor-package
npm version patch   # 1.0.0 → 1.0.1
git add -A && git commit -m "release: token-monitor 1.0.1"
git push
```

If `package.json` version already exists on npm, the publish job **skips** safely.

Manual run: GitHub → Actions → **Publish token-monitor npm** → Run workflow.

## License

MIT
