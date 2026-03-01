/**
 * Hypergraph Health Condition
 *
 * Detects issues with the external Constellation Network hypergraph:
 * - Hypergraph L0 unreachable (all URLs fail)
 * - GL0 disconnected from hypergraph cluster
 *
 * These are detection-only (restartScope: 'none') since we can't restart
 * external infrastructure.
 */

import type { Config } from '../config.js';
import type { DetectionResult, HealthSnapshot, NodeInfo, ClusterMember } from '../types.js';
import {
  checkHypergraphL0,
  getHypergraphCluster,
  tryFirstSuccess,
  type HypergraphL0Fetch,
  type HypergraphClusterFetch,
} from '../services/hypergraph-api.js';
import { log } from '../logger.js';

export interface HypergraphHealthDeps {
  checkL0?: HypergraphL0Fetch;
  getCluster?: HypergraphClusterFetch;
}

/**
 * Detect hypergraph health issues.
 *
 * Returns a DetectionResult with restartScope 'none' — we can only alert,
 * not fix external infrastructure.
 */
export async function detectHypergraphHealth(
  config: Config,
  snapshot: HealthSnapshot,
  deps: HypergraphHealthDeps = {},
): Promise<DetectionResult> {
  const hgConfig = config.hypergraph;
  if (!hgConfig?.enabled) {
    return { detected: false, condition: 'HypergraphHealth', details: '', restartScope: 'none' };
  }

  const checkL0Fn = deps.checkL0 ?? checkHypergraphL0;
  const getClusterFn = deps.getCluster ?? getHypergraphCluster;

  // --- Check 1: Is hypergraph L0 reachable? ---
  const l0Result = await tryFirstSuccess(hgConfig.l0Urls, checkL0Fn);

  if (!l0Result) {
    log(`[HypergraphHealth] All hypergraph L0 URLs unreachable: ${hgConfig.l0Urls.join(', ')}`);
    return {
      detected: true,
      condition: 'HypergraphHealth',
      details: `Hypergraph L0 unreachable — all ${hgConfig.l0Urls.length} URLs failed`,
      restartScope: 'none',
    };
  }

  log(`[HypergraphHealth] Hypergraph L0 reachable via ${l0Result.url}`);

  // --- Check 2: Are our GL0 nodes connected to hypergraph? ---
  // Get our GL0 nodes' cluster info from snapshot
  const ourGl0Nodes = snapshot.nodes.filter(n => {
    const gl0 = n.layers.find(l => l.layer === 'gl0');
    return gl0 && gl0.reachable;
  });

  if (ourGl0Nodes.length === 0) {
    // GL0 layer is down entirely — that's caught by other conditions
    log('[HypergraphHealth] No reachable GL0 nodes to check connectivity');
    return { detected: false, condition: 'HypergraphHealth', details: '', restartScope: 'none' };
  }

  // Get hypergraph cluster to see how many peers exist
  const hgCluster = await getClusterFn(l0Result.url);

  if (hgCluster.length === 0) {
    log('[HypergraphHealth] Could not fetch hypergraph cluster info');
    return { detected: false, condition: 'HypergraphHealth', details: '', restartScope: 'none' };
  }

  // Check if our GL0 nodes have cluster sizes larger than just our own nodes.
  // If GL0 cluster size <= our node count, we're likely disconnected from hypergraph.
  const ourNodeCount = config.nodes.length;
  const gl0ClusterSizes = ourGl0Nodes.map(n => {
    const gl0 = n.layers.find(l => l.layer === 'gl0');
    return gl0?.clusterSize ?? 0;
  });

  const maxGl0ClusterSize = Math.max(...gl0ClusterSizes);

  if (maxGl0ClusterSize <= ourNodeCount) {
    log(`[HypergraphHealth] GL0 cluster size ${maxGl0ClusterSize} <= our node count ${ourNodeCount} — disconnected from hypergraph`);
    return {
      detected: true,
      condition: 'HypergraphHealth',
      details: `GL0 disconnected from hypergraph — cluster size ${maxGl0ClusterSize} (only local nodes), hypergraph has ${hgCluster.length} peers`,
      restartScope: 'none',
    };
  }

  log(`[HypergraphHealth] GL0 connected to hypergraph (cluster size: ${maxGl0ClusterSize}, hypergraph peers: ${hgCluster.length})`);
  return { detected: false, condition: 'HypergraphHealth', details: '', restartScope: 'none' };
}
