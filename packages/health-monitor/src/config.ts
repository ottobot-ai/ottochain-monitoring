/**
 * Metagraph Health Monitor — Configuration
 *
 * Reads from environment variables with sensible defaults for the Hetzner cluster.
 */

import type { NodeInfo } from './types.js';

export interface MonitorConfig {
  /** How often to poll each node (ms). Default: 30s */
  pollIntervalMs: number;
  /** Seconds ML0 ordinal must be unchanged before declaring a stall. Default: 240s */
  snapshotStallThresholdSec: number;
  /** How long to wait before acting after detecting a condition (ms). Default: 60s */
  actionDelayMs: number;
  /** SSH private key path */
  sshKeyPath: string;
  /** SSH username on metagraph nodes */
  sshUser: string;
  /** All metagraph nodes */
  nodes: NodeInfo[];
  /** Telegram bot token (optional) */
  telegramToken?: string;
  /** Telegram chat ID (optional) */
  telegramChatId?: string;
  /** Discord webhook URL (optional) */
  discordWebhookUrl?: string;
  /** If true, only log planned actions without executing SSH commands */
  dryRun: boolean;
}

const DEFAULT_NODES: NodeInfo[] = [
  {
    nodeId: '1',
    host:   process.env.NODE1_HOST ?? '5.78.90.207',
    layers: [
      { name: 'GL0', port: 9000 },
      { name: 'ML0', port: 9200 },
      { name: 'CL1', port: 9300 },
      { name: 'DL1', port: 9400 },
    ],
  },
  {
    nodeId: '2',
    host:   process.env.NODE2_HOST ?? '5.78.113.25',
    layers: [
      { name: 'GL0', port: 9000 },
      { name: 'ML0', port: 9200 },
      { name: 'CL1', port: 9300 },
      { name: 'DL1', port: 9400 },
    ],
  },
  {
    nodeId: '3',
    host:   process.env.NODE3_HOST ?? '5.78.107.77',
    layers: [
      { name: 'GL0', port: 9000 },
      { name: 'ML0', port: 9200 },
      { name: 'CL1', port: 9300 },
      { name: 'DL1', port: 9400 },
    ],
  },
];

export function getConfig(): MonitorConfig {
  return {
    pollIntervalMs:            parseInt(process.env.POLL_INTERVAL_MS     ?? '30000'),
    snapshotStallThresholdSec: parseInt(process.env.STALL_THRESHOLD_SEC  ?? '240'),
    actionDelayMs:             parseInt(process.env.ACTION_DELAY_MS      ?? '60000'),
    sshKeyPath:                process.env.SSH_KEY_PATH                  ?? `${process.env.HOME}/.ssh/hetzner_ottobot`,
    sshUser:                   process.env.SSH_USER                      ?? 'root',
    nodes:                     DEFAULT_NODES,
    telegramToken:             process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId:            process.env.TELEGRAM_CHAT_ID,
    discordWebhookUrl:         process.env.DISCORD_WEBHOOK_URL,
    dryRun:                    process.env.DRY_RUN === 'true',
  };
}
