/**
 * Metagraph Health Monitor — Shared Types
 */

// ── Layer identifiers ─────────────────────────────────────────────────────────

export type LayerName = 'GL0' | 'ML0' | 'CL1' | 'DL1';

export interface NodeInfo {
  nodeId: string;   // 1 | 2 | 3
  host:   string;  // IP address
  layers: LayerConfig[];
}

export interface LayerConfig {
  name:  LayerName;
  port:  number;
}

// ── Cluster state ─────────────────────────────────────────────────────────────

export interface ClusterPeer {
  id:    string;
  ip?:   string;
  state: string;
}

export interface NodeClusterView {
  nodeId:  string;
  layer:   LayerName;
  host:    string;
  port:    number;
  peers:   ClusterPeer[];
  /** ISO timestamp of when this was polled */
  polledAt: string;
  /** True if the HTTP request failed */
  error?: string;
}

export interface ClusterSnapshot {
  layer:     LayerName;
  timestamp: string;
  views:     NodeClusterView[];
}

// ── Health conditions ─────────────────────────────────────────────────────────

export type HealthCondition =
  | 'HEALTHY'
  | 'FORK_DETECTED'
  | 'SNAPSHOT_STALL'
  | 'NODE_UNREACHABLE'
  | 'MINORITY_PARTITION';

export interface HealthEvent {
  condition:   HealthCondition;
  layer:       LayerName;
  nodeIds:     string[];
  description: string;
  timestamp:   string;
  /** Auto-populated by the monitor with suggested action */
  suggestedAction?: RestartGroup;
}

// ── Restart orchestration ─────────────────────────────────────────────────────

export type RestartGroup =
  | 'IndividualNode'
  | 'FullLayer'
  | 'FullMetagraph';

export interface RestartPlan {
  group:     RestartGroup;
  layer:     LayerName;
  nodeIds:   string[];
  reason:    string;
  /** Reference node to use as seed during rejoin */
  seedNode?: string;
}

// ── Snapshot / ordinal tracking ───────────────────────────────────────────────

export interface OrdinalSnapshot {
  nodeId:    string;
  layer:     LayerName;
  ordinal:   number;
  timestamp: string;
}
