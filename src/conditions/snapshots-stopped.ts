/**
 * Snapshot Stall Detection
 *
 * Tracks ML0 snapshot ordinals over time. If the ordinal hasn't advanced
 * for longer than the configured threshold, triggers a full metagraph restart.
 *
 * Pattern from: Constellation SnapshotsStopped condition
 */

import type { Config } from '../config.js';
import type { DetectionResult } from '../types.js';
import { getLatestOrdinal } from '../services/node-api.js';
import { log } from '../logger.js';

// In-memory state (survives across check cycles within a process)
let lastKnownOrdinal = -1;
let lastOrdinalChangeTime = Date.now();

/**
 * Check if ML0 snapshots have stalled.
 *
 * We check the ML0 ordinal from the first reachable node.
 * If it hasn't changed since the last check, track elapsed time.
 */
export async function detectSnapshotsStopped(config: Config): Promise<DetectionResult> {
  log('[SnapshotStall] Checking ML0 snapshot progress...');

  let currentOrdinal = -1;

  // Try all nodes until we get an ordinal
  for (const node of config.nodes) {
    const ordinal = await getLatestOrdinal(node.ip, config.ports.ml0, 'ml0');
    if (ordinal >= 0) {
      currentOrdinal = ordinal;
      break;
    }
  }

  if (currentOrdinal < 0) {
    // Can't reach any ML0 — this is an unhealthy-nodes problem, not a stall
    log('[SnapshotStall] Cannot reach any ML0 node');
    return { detected: false, condition: 'SnapshotsStopped', details: 'ML0 unreachable', restartScope: 'none' };
  }

  if (currentOrdinal !== lastKnownOrdinal) {
    // Ordinal advanced — reset timer
    log(`[SnapshotStall] ML0 ordinal ${lastKnownOrdinal} → ${currentOrdinal} (healthy)`);
    lastKnownOrdinal = currentOrdinal;
    lastOrdinalChangeTime = Date.now();
    return { detected: false, condition: 'SnapshotsStopped', details: '', restartScope: 'none' };
  }

  // Ordinal unchanged — how long?
  const stalledMinutes = (Date.now() - lastOrdinalChangeTime) / 60_000;

  if (stalledMinutes >= config.snapshotStallMinutes) {
    const msg = `ML0 snapshots stalled at ordinal ${currentOrdinal} for ${stalledMinutes.toFixed(1)} minutes`;
    log(`[SnapshotStall] ${msg}`);
    return {
      detected: true,
      condition: 'SnapshotsStopped',
      details: msg,
      restartScope: 'full-metagraph',
      affectedLayers: ['ml0', 'cl1', 'dl1'],
      affectedNodes: config.nodes.map(n => n.ip),
    };
  }

  log(`[SnapshotStall] ML0 ordinal=${currentOrdinal} unchanged for ${stalledMinutes.toFixed(1)}m (threshold: ${config.snapshotStallMinutes}m)`);
  return { detected: false, condition: 'SnapshotsStopped', details: '', restartScope: 'none' };
}
