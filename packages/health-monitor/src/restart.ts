/**
 * Restart orchestration.
 *
 * Three restart scopes:
 *   IndividualNode — restart one node's layer process, rejoin to healthy seed
 *   FullLayer      — stop all nodes, restart with genesis/join sequence
 *   FullMetagraph  — stop everything, restart ML0 first, then CL1/DL1
 */

import type { NodeInfo, LayerName, RestartPlan } from './types.js';
import type { MonitorConfig } from './config.js';
import { restartLayerOnNode, stopLayerOnNode } from './ssh.js';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Individual node restart ───────────────────────────────────────────────────

/**
 * Restart a single node's layer, pointing it at a healthy seed node.
 */
export async function restartIndividualNode(
  targetNode: NodeInfo,
  layer:      LayerName,
  seedNode:   NodeInfo | undefined,
  config:     MonitorConfig
): Promise<void> {
  console.log(`[restart] IndividualNode: ${layer} node${targetNode.nodeId} → seed=${seedNode?.nodeId ?? 'none'}`);
  await restartLayerOnNode(targetNode, layer, config, seedNode?.host);
  // Allow time to rejoin
  await sleep(15_000);
}

// ── Full layer restart ────────────────────────────────────────────────────────

/**
 * Restart ALL nodes in a layer.
 * Stops all first, then starts the first node (genesis), then joins others.
 */
export async function restartFullLayer(
  nodes:  NodeInfo[],
  layer:  LayerName,
  config: MonitorConfig
): Promise<void> {
  console.log(`[restart] FullLayer: ${layer} on all ${nodes.length} nodes`);

  // Stop all
  await Promise.all(nodes.map((n) => stopLayerOnNode(n, layer, config)));
  await sleep(5_000);

  // Start genesis node (first in list)
  const [genesis, ...joiners] = nodes;
  await restartLayerOnNode(genesis, layer, config, undefined);
  await sleep(30_000);

  // Join remaining nodes to genesis
  for (const joiner of joiners) {
    await restartLayerOnNode(joiner, layer, config, genesis.host);
    await sleep(10_000);
  }

  console.log(`[restart] ✓ FullLayer restart complete for ${layer}`);
}

// ── Full metagraph restart ────────────────────────────────────────────────────

/**
 * Full metagraph restart sequence.
 * Order: stop all → restart ML0 → restart GL0 (if stalled) → restart CL1/DL1.
 * ML0 must come up first since CL1/DL1 depend on it for state.
 */
export async function restartFullMetagraph(
  nodes:  NodeInfo[],
  config: MonitorConfig
): Promise<void> {
  const layerOrder: LayerName[] = ['DL1', 'CL1', 'GL0', 'ML0'];
  const startOrder: LayerName[] = ['ML0', 'GL0', 'CL1', 'DL1'];

  console.log('[restart] FullMetagraph: stopping all layers');
  for (const layer of layerOrder) {
    await Promise.all(nodes.map((n) => stopLayerOnNode(n, layer, config)));
    await sleep(3_000);
  }

  console.log('[restart] FullMetagraph: starting layers in order');
  const [genesis, ...joiners] = nodes;

  for (const layer of startOrder) {
    // Genesis starts first
    await restartLayerOnNode(genesis, layer, config, undefined);
    await sleep(30_000);
    // Others join genesis
    for (const joiner of joiners) {
      await restartLayerOnNode(joiner, layer, config, genesis.host);
      await sleep(10_000);
    }
    // Extra wait between layers
    await sleep(20_000);
  }

  console.log('[restart] ✓ FullMetagraph restart complete');
}

// ── Plan execution ────────────────────────────────────────────────────────────

/**
 * Execute a restart plan.
 */
export async function executeRestartPlan(
  plan:  RestartPlan,
  nodes: NodeInfo[],
  config: MonitorConfig
): Promise<void> {
  const targetNodes = nodes.filter((n) => plan.nodeIds.includes(n.nodeId));
  const seedNode    = plan.seedNode
    ? nodes.find((n) => n.nodeId === plan.seedNode)
    : nodes.find((n) => !plan.nodeIds.includes(n.nodeId));

  console.log(`[restart] Executing plan: ${plan.group} on ${plan.layer}, nodes: ${plan.nodeIds.join(', ')}, reason: ${plan.reason}`);

  switch (plan.group) {
    case 'IndividualNode':
      for (const node of targetNodes) {
        await restartIndividualNode(node, plan.layer, seedNode, config);
      }
      break;

    case 'FullLayer':
      await restartFullLayer(nodes, plan.layer, config);
      break;

    case 'FullMetagraph':
      await restartFullMetagraph(nodes, config);
      break;
  }
}
