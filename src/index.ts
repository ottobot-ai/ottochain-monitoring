/**
 * OttoChain Health Monitor
 *
 * Centralized metagraph monitoring service that detects forks, stalled
 * snapshots, and unhealthy nodes — then orchestrates recovery via SSH.
 *
 * Usage:
 *   npx tsx src/index.ts            # Single check
 *   npx tsx src/index.ts --daemon   # Continuous monitoring
 *   npx tsx src/index.ts --once     # Single check (alias)
 *
 * Modeled after Constellation's metagraph-monitoring-service-package
 * but purpose-built for OttoChain's Hetzner/Docker infrastructure.
 */

import { loadConfig } from './config.js';
import { detectForkedCluster } from './conditions/forked-cluster.js';
import { detectSnapshotsStopped } from './conditions/snapshots-stopped.js';
import { detectUnhealthyNodes } from './conditions/unhealthy-nodes.js';
import { executeRestart } from './restart/orchestrator.js';
import { notify } from './services/notify.js';
import { log } from './logger.js';

async function runHealthCheck(config: ReturnType<typeof loadConfig>): Promise<void> {
  log('==================== HEALTH CHECK ====================');

  // Run conditions in priority order (most critical first)
  const conditions = [
    { name: 'ForkedCluster', detect: () => detectForkedCluster(config) },
    { name: 'SnapshotsStopped', detect: () => detectSnapshotsStopped(config) },
    { name: 'UnhealthyNodes', detect: () => detectUnhealthyNodes(config) },
  ];

  for (const condition of conditions) {
    try {
      const result = await condition.detect();

      if (result.detected) {
        log(`[Monitor] Condition detected: ${condition.name} — ${result.details}`);
        const restarted = await executeRestart(config, result);
        if (restarted) {
          log('[Monitor] Restart performed, skipping remaining checks');
          return;
        }
        // If restart was skipped (cooldown/rate limit), continue checking
      }
    } catch (err) {
      log(`[Monitor] Error checking ${condition.name}: ${err}`);
    }
  }

  log('[Monitor] Metagraph is healthy ✓');
}

async function main(): Promise<void> {
  const config = loadConfig();

  log('OttoChain Health Monitor starting');
  log(`Nodes: ${config.nodes.map(n => `${n.name}(${n.ip})`).join(', ')}`);
  log(`Mode: ${config.daemon ? 'daemon' : 'single check'}`);
  log(`Interval: ${config.healthCheckIntervalSeconds}s`);

  if (config.daemon) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await runHealthCheck(config);
      } catch (err) {
        log(`[Monitor] Unexpected error: ${err}`);
        await notify(config, `🚨 Monitor error: ${err}`);
      }
      await new Promise(resolve => setTimeout(resolve, config.healthCheckIntervalSeconds * 1000));
    }
  } else {
    await runHealthCheck(config);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
