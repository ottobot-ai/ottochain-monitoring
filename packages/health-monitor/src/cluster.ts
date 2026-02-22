/**
 * Cluster fork detection.
 *
 * Polls /cluster/info on every node for a given layer, then:
 *   1. Groups peers by which set of peer IDs they see
 *   2. Identifies the majority partition
 *   3. Returns nodes that disagree (minority / forked)
 */

import type { NodeInfo, LayerName, NodeClusterView, ClusterSnapshot, HealthEvent, ClusterPeer } from './types.js';

// ── HTTP helper (stubbed in tests via dependency injection) ────────────────────

export type FetchFn = (url: string, timeoutMs?: number) => Promise<unknown>;

/** Default fetch using native Node.js fetch (Node 18+) */
export const defaultFetch: FetchFn = async (url: string, timeoutMs = 5000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
};

// ── Cluster view polling ───────────────────────────────────────────────────────

/**
 * Poll /cluster/info on a single node+layer combination.
 */
export async function pollNodeCluster(
  node:    NodeInfo,
  layer:   LayerName,
  fetchFn: FetchFn = defaultFetch
): Promise<NodeClusterView> {
  const layerConfig = node.layers.find((l) => l.name === layer);
  if (!layerConfig) {
    return {
      nodeId:   node.nodeId,
      layer,
      host:     node.host,
      port:     0,
      peers:    [],
      polledAt: new Date().toISOString(),
      error:    `Layer ${layer} not configured for node ${node.nodeId}`,
    };
  }

  const url = `http://${node.host}:${layerConfig.port}/cluster/info`;
  try {
    const data = await fetchFn(url) as ClusterPeer[];
    return {
      nodeId:   node.nodeId,
      layer,
      host:     node.host,
      port:     layerConfig.port,
      peers:    Array.isArray(data) ? data : [],
      polledAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      nodeId:   node.nodeId,
      layer,
      host:     node.host,
      port:     layerConfig.port,
      peers:    [],
      polledAt: new Date().toISOString(),
      error:    String(err),
    };
  }
}

/**
 * Poll all nodes in parallel for a given layer.
 */
export async function pollLayerCluster(
  nodes:   NodeInfo[],
  layer:   LayerName,
  fetchFn: FetchFn = defaultFetch
): Promise<ClusterSnapshot> {
  const views = await Promise.all(
    nodes.map((node) => pollNodeCluster(node, layer, fetchFn))
  );
  return {
    layer,
    timestamp: new Date().toISOString(),
    views,
  };
}

// ── Fork detection ─────────────────────────────────────────────────────────────

/**
 * Canonical key for a cluster view: sorted peer IDs joined.
 * Two nodes see the same cluster iff their canonical keys match.
 */
export function clusterKey(view: NodeClusterView): string {
  if (view.error) return `ERROR:${view.nodeId}`;
  const ids = view.peers.map((p) => p.id).sort().join(',');
  return ids || 'EMPTY';
}

/**
 * Find the majority partition by cluster key.
 * Returns the key seen by the most nodes, and the set of nodeIds that hold it.
 */
export function findMajority(snapshot: ClusterSnapshot): {
  majorityKey:    string;
  majorityNodes:  string[];
  minorityNodes:  string[];
  unreachable:    string[];
} {
  const keyGroups = new Map<string, string[]>();

  for (const view of snapshot.views) {
    if (view.error) continue; // unreachable — handled separately
    const key = clusterKey(view);
    const group = keyGroups.get(key) ?? [];
    group.push(view.nodeId);
    keyGroups.set(key, group);
  }

  const unreachable = snapshot.views
    .filter((v) => !!v.error)
    .map((v) => v.nodeId);

  if (keyGroups.size === 0) {
    // All nodes unreachable
    return {
      majorityKey:   'EMPTY',
      majorityNodes: [],
      minorityNodes: [],
      unreachable,
    };
  }

  // Majority = largest group
  let majorityKey   = '';
  let majorityNodes: string[] = [];
  for (const [key, nodes] of keyGroups) {
    if (nodes.length > majorityNodes.length) {
      majorityKey   = key;
      majorityNodes = nodes;
    }
  }

  const minorityNodes: string[] = [];
  for (const [key, nodes] of keyGroups) {
    if (key !== majorityKey) minorityNodes.push(...nodes);
  }

  return { majorityKey, majorityNodes, minorityNodes, unreachable };
}

/**
 * Detect fork conditions from a cluster snapshot.
 * Returns HealthEvents if any forks or unreachable nodes are detected.
 */
export function detectForks(snapshot: ClusterSnapshot): HealthEvent[] {
  const events: HealthEvent[] = [];
  const { majorityNodes, minorityNodes, unreachable } = findMajority(snapshot);

  if (minorityNodes.length > 0) {
    events.push({
      condition:       'FORK_DETECTED',
      layer:           snapshot.layer,
      nodeIds:         minorityNodes,
      description:     `Fork detected on ${snapshot.layer}: node(s) ${minorityNodes.join(', ')} are in a minority partition (majority: ${majorityNodes.join(', ')})`,
      timestamp:       snapshot.timestamp,
      suggestedAction: minorityNodes.length < majorityNodes.length ? 'IndividualNode' : 'FullLayer',
    });
  }

  if (unreachable.length > 0) {
    events.push({
      condition:       'NODE_UNREACHABLE',
      layer:           snapshot.layer,
      nodeIds:         unreachable,
      description:     `Unreachable node(s) on ${snapshot.layer}: ${unreachable.join(', ')}`,
      timestamp:       snapshot.timestamp,
      suggestedAction: 'IndividualNode',
    });
  }

  return events;
}

/**
 * Detect GL0-level fork by comparing snapshot ordinals.
 * Returns HealthEvent if GL0 nodes disagree on the latest ordinal.
 */
export interface GL0NodeState {
  nodeId:  string;
  ordinal: number;
  hash?:   string;
}

export function detectGL0Fork(states: GL0NodeState[], timestamp: string): HealthEvent | null {
  if (states.length < 2) return null;

  // Find the majority ordinal
  const ordinalCount = new Map<number, string[]>();
  for (const s of states) {
    const nodes = ordinalCount.get(s.ordinal) ?? [];
    nodes.push(s.nodeId);
    ordinalCount.set(s.ordinal, nodes);
  }

  let majorityOrdinal = 0;
  let majorityNodes:  string[] = [];
  for (const [ordinal, nodes] of ordinalCount) {
    if (nodes.length > majorityNodes.length) {
      majorityOrdinal = ordinal;
      majorityNodes   = nodes;
    }
  }

  const minorityNodes = states
    .filter((s) => s.ordinal !== majorityOrdinal)
    .map((s) => s.nodeId);

  if (minorityNodes.length === 0) return null;

  return {
    condition:       'FORK_DETECTED',
    layer:           'GL0',
    nodeIds:         minorityNodes,
    description:     `GL0 fork: node(s) ${minorityNodes.join(', ')} are at divergent ordinals (majority: ${majorityOrdinal})`,
    timestamp,
    suggestedAction: 'IndividualNode',
  };
}
