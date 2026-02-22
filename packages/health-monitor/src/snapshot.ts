/**
 * Snapshot stall detection.
 *
 * Polls ML0 /data-application/v1/checkpoint (or GL0 /dag/total-supply for ordinal)
 * and detects when the snapshot ordinal hasn't changed for > threshold seconds.
 */

import type { NodeInfo, HealthEvent, OrdinalSnapshot } from './types.js';
import type { FetchFn } from './cluster.js';
import { defaultFetch } from './cluster.js';

// ── Ordinal polling ─────────────────────────────────────────────────────────────

interface CheckpointResponse {
  ordinal: number;
  state?:  unknown;
}

interface GL0OrdinalResponse {
  /** /node/info returns snapshotOrdinal on GL0 */
  snapshotOrdinal?: number;
  /** Some tessellation versions expose lastSnapshotOrdinal */
  lastSnapshotOrdinal?: number;
}

/**
 * Fetch ML0 checkpoint ordinal from a single node.
 */
export async function fetchML0Ordinal(
  node:    NodeInfo,
  fetchFn: FetchFn = defaultFetch
): Promise<OrdinalSnapshot | null> {
  const layer = node.layers.find((l) => l.name === 'ML0');
  if (!layer) return null;

  const url = `http://${node.host}:${layer.port}/data-application/v1/checkpoint`;
  try {
    const data = await fetchFn(url) as CheckpointResponse;
    return {
      nodeId:    node.nodeId,
      layer:     'ML0',
      ordinal:   data.ordinal ?? 0,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch GL0 snapshot ordinal from /node/info.
 */
export async function fetchGL0Ordinal(
  node:    NodeInfo,
  fetchFn: FetchFn = defaultFetch
): Promise<OrdinalSnapshot | null> {
  const layer = node.layers.find((l) => l.name === 'GL0');
  if (!layer) return null;

  const url = `http://${node.host}:${layer.port}/node/info`;
  try {
    const data = await fetchFn(url) as GL0OrdinalResponse;
    const ordinal = data.snapshotOrdinal ?? data.lastSnapshotOrdinal ?? 0;
    return {
      nodeId:    node.nodeId,
      layer:     'GL0',
      ordinal,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ── Stall tracker ─────────────────────────────────────────────────────────────

/**
 * Tracks the last time an ordinal changed for a node+layer.
 * Key: `${nodeId}:${layer}`
 */
export class StallTracker {
  /** Last seen ordinal per node+layer */
  private lastOrdinal = new Map<string, number>();
  /** Timestamp when the ordinal last changed */
  private lastChanged = new Map<string, number>();

  key(nodeId: string, layer: string): string {
    return `${nodeId}:${layer}`;
  }

  /**
   * Update tracker with a new ordinal snapshot.
   * Returns true if the ordinal changed (not stalled).
   */
  update(snap: OrdinalSnapshot): boolean {
    const k    = this.key(snap.nodeId, snap.layer);
    const prev = this.lastOrdinal.get(k);

    if (prev === undefined || snap.ordinal > prev) {
      this.lastOrdinal.set(k, snap.ordinal);
      this.lastChanged.set(k, Date.now());
      return true;
    }
    return false;
  }

  /**
   * How many seconds since the ordinal last changed for a given node+layer.
   * Returns null if we've never seen an update.
   */
  staleSecs(nodeId: string, layer: string): number | null {
    const k       = this.key(nodeId, layer);
    const changed = this.lastChanged.get(k);
    if (changed === undefined) return null;
    return (Date.now() - changed) / 1000;
  }

  /** The last seen ordinal (or undefined if never seen). */
  lastOrdinalFor(nodeId: string, layer: string): number | undefined {
    return this.lastOrdinal.get(this.key(nodeId, layer));
  }

  /** Reset all tracked state (for testing). */
  reset(): void {
    this.lastOrdinal.clear();
    this.lastChanged.clear();
  }
}

// ── Stall detection ────────────────────────────────────────────────────────────

/**
 * Given an array of fresh ordinal snapshots and a stall tracker, detect
 * any nodes that haven't advanced their ordinal for > thresholdSec.
 */
export function detectStalls(
  snapshots:    OrdinalSnapshot[],
  tracker:      StallTracker,
  thresholdSec: number
): HealthEvent[] {
  const now = new Date().toISOString();

  // First, update the tracker with fresh readings
  for (const snap of snapshots) {
    tracker.update(snap);
  }

  const events: HealthEvent[] = [];

  for (const snap of snapshots) {
    const secs = tracker.staleSecs(snap.nodeId, snap.layer);
    if (secs !== null && secs >= thresholdSec) {
      const lastOrd = tracker.lastOrdinalFor(snap.nodeId, snap.layer) ?? 0;
      events.push({
        condition:       'SNAPSHOT_STALL',
        layer:           snap.layer,
        nodeIds:         [snap.nodeId],
        description:     `${snap.layer} node ${snap.nodeId} stalled at ordinal ${lastOrd} for ${Math.round(secs)}s (threshold: ${thresholdSec}s)`,
        timestamp:       now,
        suggestedAction: 'FullMetagraph',
      });
    }
  }

  return events;
}

/**
 * Detect cluster-level stall: ALL nodes in a layer are stalled.
 * This is more definitive than individual node stalls.
 */
export function detectClusterStall(
  layer:        'ML0' | 'GL0',
  nodes:        NodeInfo[],
  tracker:      StallTracker,
  thresholdSec: number
): HealthEvent | null {
  const now = new Date().toISOString();

  const stalledNodes = nodes.filter((n) => {
    const secs = tracker.staleSecs(n.nodeId, layer);
    return secs !== null && secs >= thresholdSec;
  });

  if (stalledNodes.length === nodes.length && nodes.length > 0) {
    const sample     = stalledNodes[0];
    const lastOrd    = tracker.lastOrdinalFor(sample.nodeId, layer) ?? 0;
    const stallSecs  = tracker.staleSecs(sample.nodeId, layer)!;

    return {
      condition:       'SNAPSHOT_STALL',
      layer,
      nodeIds:         stalledNodes.map((n) => n.nodeId),
      description:     `ALL ${layer} nodes stalled at ordinal ~${lastOrd} for ${Math.round(stallSecs)}s — full metagraph restart recommended`,
      timestamp:       now,
      suggestedAction: 'FullMetagraph',
    };
  }

  return null;
}
