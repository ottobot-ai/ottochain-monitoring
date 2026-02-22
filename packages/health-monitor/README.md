# @ottochain/health-monitor

Metagraph health monitoring service — fork detection + automated restart.

## What it does

- **Fork detection** — polls `/cluster/info` on all nodes per layer; identifies minority partitions via peer-set comparison
- **GL0 ordinal fork** — compares GL0 snapshot ordinals; flags nodes with divergent values
- **Snapshot stall** — tracks ML0 ordinal over time; alerts + restarts when unchanged for >4 min
- **Automated recovery** — SSH-based Docker restart orchestration:
  - `IndividualNode` — restart single node's layer, rejoin to healthy seed
  - `FullLayer` — stop all, restart with genesis + join sequence
  - `FullMetagraph` — full ordered restart: ML0 → GL0 → CL1 → DL1

## Setup

```bash
# Install
npm install

# Configure
cp .env.example .env
# Edit .env — set node IPs, SSH key, Telegram/Discord credentials

# Run in dev
npm run dev

# Build + run via PM2
npm run build
pm2 start dist/index.js --name health-monitor
```

## Environment Variables

| Var | Default | Description |
|-----|---------|-------------|
| `NODE1_HOST` | `5.78.90.207` | Hetzner node 1 IP |
| `NODE2_HOST` | `5.78.113.25` | Hetzner node 2 IP |
| `NODE3_HOST` | `5.78.107.77` | Hetzner node 3 IP |
| `POLL_INTERVAL_MS` | `30000` | How often to poll (ms) |
| `STALL_THRESHOLD_SEC` | `240` | Seconds before declaring ML0 stall |
| `ACTION_DELAY_MS` | `60000` | Delay before acting on detected condition |
| `SSH_KEY_PATH` | `~/.ssh/hetzner_ottobot` | SSH private key |
| `SSH_USER` | `root` | SSH username |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token |
| `TELEGRAM_CHAT_ID` | — | Telegram chat ID |
| `DISCORD_WEBHOOK_URL` | — | Discord webhook URL |
| `DRY_RUN` | `false` | Log actions without executing SSH |

## Architecture

```
MetagraphMonitor (main loop every 30s)
  ├── pollLayerCluster (GL0/ML0/CL1/DL1)
  │     └── detectForks → FORK_DETECTED / NODE_UNREACHABLE
  ├── fetchGL0Ordinal × 3 nodes
  │     └── detectGL0Fork → FORK_DETECTED
  ├── fetchML0Ordinal × 3 nodes
  │     ├── detectStalls → SNAPSHOT_STALL
  │     └── detectClusterStall → SNAPSHOT_STALL
  └── handleEvent
        ├── notify (Telegram + Discord)
        ├── 60s confirmation delay
        ├── re-poll to confirm condition persists
        └── executeRestartPlan via SSH
```

## Tests

```bash
npm test
# 33 unit tests (cluster detection + snapshot stall logic)
# No SSH required — detection logic is fully unit-testable
```
