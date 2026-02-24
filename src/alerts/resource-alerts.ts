/**
 * Resource Alert Thresholds
 *
 * Monitors RAM, swap, disk, and CPU usage across all cluster nodes.
 * Spec: docs/stability-swapfile-resource-spec.md
 * Card: 📊 Stability: Node resource profiling (69962fd9dae)
 *
 * @status stub — tests are defined in resource-alerts.test.ts
 *              Implementation tracked by card 69962fd9dae
 */

/** Alert severity levels */
export type Severity = 'warning' | 'critical';

/** Cluster layer identifiers */
export type MonitorLayer = 'GL0' | 'ML0' | 'DL1' | 'CL1' | 'HOST';

/** Metric types for resource monitoring */
export type MetricType =
  | 'ram_pct'
  | 'swap_pct'
  | 'disk_pct'
  | 'cpu_pct'
  | 'process_absent';

/** A resource alert fired when a threshold is crossed */
export interface ResourceAlert {
  nodeIp: string;
  layer: MonitorLayer;
  metric: MetricType;
  value: number;
  threshold: number;
  severity: Severity;
  message: string;
}

/** Raw resource metrics snapshot from a node */
export interface NodeResourceSnapshot {
  /** Node IP address */
  nodeIp: string;
  /** Total RAM in bytes */
  ramTotal: number;
  /** Used RAM in bytes */
  ramUsed: number;
  /** Total swap in bytes */
  swapTotal: number;
  /** Used swap in bytes */
  swapUsed: number;
  /** Total disk in bytes */
  diskTotal: number;
  /** Used disk in bytes */
  diskUsed: number;
  /** CPU usage percentage (0–100) */
  cpuPct: number;
  /** Per-layer RSS in bytes (null if layer not running) */
  layerRss: Partial<Record<MonitorLayer, number | null>>;
}

/** Threshold configuration */
export const THRESHOLDS = {
  ram_warning_pct:   70,
  ram_critical_pct:  85,
  swap_warning_pct:  50,
  swap_critical_pct: 80,
  disk_warning_pct:  70,
  disk_critical_pct: 85,
  cpu_warning_pct:   90,
} as const;

/**
 * Evaluate resource alerts from a node snapshot.
 * Returns an array of alerts for any threshold crossings.
 *
 * @throws Error('not implemented') — stub, awaiting TDD implementation
 */
export function evaluateResourceAlerts(snapshot: NodeResourceSnapshot): ResourceAlert[] {
  throw new Error('not implemented');
}

/**
 * Calculate percentage from used/total bytes.
 * Returns 0 if total is 0 to avoid division by zero.
 *
 * @throws Error('not implemented') — stub, awaiting TDD implementation
 */
export function calcPct(used: number, total: number): number {
  throw new Error('not implemented');
}

/**
 * Evaluate severity for a metric value against warning and critical thresholds.
 * Returns null if below both thresholds.
 *
 * @throws Error('not implemented') — stub, awaiting TDD implementation
 */
export function evalSeverity(
  value: number,
  warningThreshold: number,
  criticalThreshold: number,
): Severity | null {
  throw new Error('not implemented');
}

/**
 * Check if a layer process is absent (RSS is null) and build alert.
 * Returns null if layer is present.
 *
 * @throws Error('not implemented') — stub, awaiting TDD implementation
 */
export function checkProcessAbsent(
  snapshot: NodeResourceSnapshot,
  layer: MonitorLayer,
): ResourceAlert | null {
  throw new Error('not implemented');
}
