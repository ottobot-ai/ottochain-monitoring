/**
 * Notifications — Telegram + Discord
 */

import type { HealthEvent } from './types.js';
import type { MonitorConfig } from './config.js';

const CONDITION_EMOJI: Record<string, string> = {
  FORK_DETECTED:      '🔱',
  SNAPSHOT_STALL:     '⏱️',
  NODE_UNREACHABLE:   '🔴',
  MINORITY_PARTITION: '⚡',
  HEALTHY:            '✅',
};

function formatEvent(event: HealthEvent): string {
  const emoji = CONDITION_EMOJI[event.condition] ?? '⚠️';
  const ts    = new Date(event.timestamp).toLocaleString('en-US', { timeZone: 'America/Chicago' });
  return [
    `${emoji} *OttoChain Monitor*`,
    `*Condition:* ${event.condition}`,
    `*Layer:* ${event.layer}`,
    `*Nodes:* ${event.nodeIds.join(', ')}`,
    `*Detail:* ${event.description}`,
    event.suggestedAction ? `*Action:* ${event.suggestedAction}` : '',
    `_${ts} CST_`,
  ].filter(Boolean).join('\n');
}

export async function notifyTelegram(
  event:  HealthEvent,
  config: MonitorConfig
): Promise<void> {
  if (!config.telegramToken || !config.telegramChatId) return;

  const text = formatEvent(event);
  const url  = `https://api.telegram.org/bot${config.telegramToken}/sendMessage`;

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id:    config.telegramChatId,
        text,
        parse_mode: 'Markdown',
      }),
    });
    if (!res.ok) {
      console.error(`[notify] Telegram error: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`[notify] Telegram failed: ${err}`);
  }
}

export async function notifyDiscord(
  event:  HealthEvent,
  config: MonitorConfig
): Promise<void> {
  if (!config.discordWebhookUrl) return;

  const emoji   = CONDITION_EMOJI[event.condition] ?? '⚠️';
  const content = `${emoji} **${event.condition}** on ${event.layer} — ${event.description}`;

  try {
    const res = await fetch(config.discordWebhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content }),
    });
    if (!res.ok) {
      console.error(`[notify] Discord error: ${res.status}`);
    }
  } catch (err) {
    console.error(`[notify] Discord failed: ${err}`);
  }
}

export async function notify(event: HealthEvent, config: MonitorConfig): Promise<void> {
  console.log(`[notify] ${event.condition} on ${event.layer} — ${event.description}`);
  await Promise.allSettled([
    notifyTelegram(event, config),
    notifyDiscord(event, config),
  ]);
}
