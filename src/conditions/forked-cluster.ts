/**
 * Fork Detection Condition
 *
 * Checks each metagraph layer (ML0, CL1, DL1) for cluster forks by comparing
 * the cluster point-of-view from each node. If any node sees a different set
 * of cluster members than the majority, the layer is forked.
 *
 * Pattern from: Constellation metagraph-monitoring-service-package ForkedCluster
 */

import { createHash } from 'crypto';
import type { Config } from '../config.js';
import type { Layer, ClusterMember, DetectionResult } from '../types.js';
import { getClusterInfo } from '../services/node-api.js';
import { log } from '../logger.js';

/**
 * Hash a cluster POV for comparison.
 * Normalize by sorting on peer ID so order doesn't matter.
 */
function hashClusterPOV(members: ClusterMember[]): string {
  const sorted = [...members]
    .map(m => m.id)
    .sort();
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 12);
}

/**
 * Check a single layer across all nodes for fork.
 * Returns the IPs of nodes in the minority partition (if any).
 */
async function checkLayerFork(
  config: Config,
  layer: Layer,
): Promise<{ forked: boolean; minorityNodes: string[] }> {
  const port = config.ports[layer];

  // Get cluster POV from each node
  const povs: { ip: string; hash: string; members: ClusterMember[] }[] = [];

  for (const node of config.nodes) {
    const members = await getClusterInfo(node.ip, port);
    if (members.length === 0) {
      // Node unreachable or empty cluster — treat as divergent
      povs.push({ ip: node.ip, hash: 'unreachable', members: [] });
    } else {
      povs.push({ ip: node.ip, hash: hashClusterPOV(members), members });
    }
  }

  // Count frequency of each hash — majority wins
  const freq: Record<string, number> = {};
  for (const p of povs) {
    freq[p.hash] = (freq[p.hash] ?? 0) + 1;
  }

  const majorityHash = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  const minorityNodes = povs
    .filter(p => p.hash !== majorityHash)
    .map(p => p.ip);

  if (minorityNodes.length > 0) {
    log(`[ForkDetect] ${layer} FORKED — majority=${majorityHash}, minority nodes: ${minorityNodes.join(', ')}`);
    for (const p of povs) {
      log(`[ForkDetect]   ${p.ip}: hash=${p.hash} members=${p.members.length}`);
    }
  }

  return { forked: minorityNodes.length > 0, minorityNodes };
}

/**
 * Check all metagraph layers for forks.
 */
export async function detectForkedCluster(config: Config): Promise<DetectionResult> {
  log('[ForkDetect] Checking cluster POVs across all nodes...');

  for (const layer of ['ml0', 'cl1', 'dl1'] as Layer[]) {
    const result = await checkLayerFork(config, layer);

    if (result.forked) {
      const allForked = result.minorityNodes.length >= config.nodes.length - 1;

      return {
        detected: true,
        condition: 'ForkedCluster',
        details: `${layer.toUpperCase()} forked — minority nodes: ${result.minorityNodes.join(', ')}`,
        restartScope: allForked ? 'full-layer' : 'individual-node',
        affectedNodes: result.minorityNodes,
        affectedLayers: [layer],
      };
    }
  }

  log('[ForkDetect] No forks detected');
  return { detected: false, condition: 'ForkedCluster', details: '', restartScope: 'none' };
}
