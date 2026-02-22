/**
 * Cluster fork detection unit tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { NodeClusterView, ClusterSnapshot, GL0NodeState } from '../src/types.js';
import { clusterKey, findMajority, detectForks, detectGL0Fork, pollNodeCluster } from '../src/cluster.js';

const now = new Date().toISOString();

// ── clusterKey ─────────────────────────────────────────────────────────────────

describe('clusterKey()', () => {
  it('returns stable sorted peer IDs', () => {
    const view: NodeClusterView = {
      nodeId:   '1',
      layer:    'GL0',
      host:     '10.0.0.1',
      port:     9000,
      peers:    [{ id: 'peer-c', state: 'Ready' }, { id: 'peer-a', state: 'Ready' }],
      polledAt: now,
    };
    assert.equal(clusterKey(view), 'peer-a,peer-c');
  });

  it('returns ERROR: prefix for error views', () => {
    const view: NodeClusterView = {
      nodeId: '2', layer: 'GL0', host: '10.0.0.2', port: 9000,
      peers: [], polledAt: now, error: 'timeout',
    };
    assert.equal(clusterKey(view), 'ERROR:2');
  });

  it('returns EMPTY for nodes with no peers', () => {
    const view: NodeClusterView = {
      nodeId: '3', layer: 'ML0', host: '10.0.0.3', port: 9200,
      peers: [], polledAt: now,
    };
    assert.equal(clusterKey(view), 'EMPTY');
  });
});

// ── findMajority ──────────────────────────────────────────────────────────────

describe('findMajority()', () => {
  it('identifies correct majority when 2 of 3 nodes agree', () => {
    const snapshot: ClusterSnapshot = {
      layer: 'GL0', timestamp: now,
      views: [
        { nodeId: '1', layer: 'GL0', host: 'n1', port: 9000, peers: [{ id: 'p2', state: 'Ready' }, { id: 'p3', state: 'Ready' }], polledAt: now },
        { nodeId: '2', layer: 'GL0', host: 'n2', port: 9000, peers: [{ id: 'p2', state: 'Ready' }, { id: 'p3', state: 'Ready' }], polledAt: now },
        { nodeId: '3', layer: 'GL0', host: 'n3', port: 9000, peers: [{ id: 'p3', state: 'Ready' }], polledAt: now }, // minority
      ],
    };

    const result = findMajority(snapshot);
    assert.deepEqual(result.majorityNodes.sort(), ['1', '2']);
    assert.deepEqual(result.minorityNodes, ['3']);
    assert.deepEqual(result.unreachable, []);
  });

  it('identifies unreachable nodes separately from minority', () => {
    const snapshot: ClusterSnapshot = {
      layer: 'ML0', timestamp: now,
      views: [
        { nodeId: '1', layer: 'ML0', host: 'n1', port: 9200, peers: [{ id: 'pa', state: 'Ready' }], polledAt: now },
        { nodeId: '2', layer: 'ML0', host: 'n2', port: 9200, peers: [{ id: 'pa', state: 'Ready' }], polledAt: now },
        { nodeId: '3', layer: 'ML0', host: 'n3', port: 9200, peers: [], polledAt: now, error: 'ECONNREFUSED' },
      ],
    };

    const result = findMajority(snapshot);
    assert.deepEqual(result.majorityNodes.sort(), ['1', '2']);
    assert.deepEqual(result.minorityNodes, []);
    assert.deepEqual(result.unreachable, ['3']);
  });

  it('all nodes agree → no minority', () => {
    const view = (id: string): NodeClusterView => ({
      nodeId: id, layer: 'DL1', host: `n${id}`, port: 9400,
      peers: [{ id: 'peer-x', state: 'Ready' }], polledAt: now,
    });
    const snapshot: ClusterSnapshot = { layer: 'DL1', timestamp: now, views: [view('1'), view('2'), view('3')] };
    const result = findMajority(snapshot);
    assert.equal(result.minorityNodes.length, 0);
    assert.equal(result.majorityNodes.length, 3);
  });

  it('all unreachable → empty majority', () => {
    const view = (id: string): NodeClusterView => ({
      nodeId: id, layer: 'CL1', host: `n${id}`, port: 9300,
      peers: [], polledAt: now, error: 'timeout',
    });
    const snapshot: ClusterSnapshot = { layer: 'CL1', timestamp: now, views: [view('1'), view('2'), view('3')] };
    const result = findMajority(snapshot);
    assert.equal(result.majorityNodes.length, 0);
    assert.equal(result.unreachable.length, 3);
  });
});

// ── detectForks ───────────────────────────────────────────────────────────────

describe('detectForks()', () => {
  it('returns FORK_DETECTED for minority node', () => {
    const snapshot: ClusterSnapshot = {
      layer: 'GL0', timestamp: now,
      views: [
        { nodeId: '1', layer: 'GL0', host: 'n1', port: 9000, peers: [{ id: 'px', state: 'Ready' }], polledAt: now },
        { nodeId: '2', layer: 'GL0', host: 'n2', port: 9000, peers: [{ id: 'px', state: 'Ready' }], polledAt: now },
        { nodeId: '3', layer: 'GL0', host: 'n3', port: 9000, peers: [], polledAt: now }, // empty view = forked solo
      ],
    };

    const events = detectForks(snapshot);
    const fork = events.find(e => e.condition === 'FORK_DETECTED');
    assert.ok(fork, 'Should detect fork');
    assert.deepEqual(fork!.nodeIds, ['3']);
    assert.equal(fork!.layer, 'GL0');
    assert.equal(fork!.suggestedAction, 'IndividualNode');
  });

  it('returns NODE_UNREACHABLE for error views', () => {
    const snapshot: ClusterSnapshot = {
      layer: 'ML0', timestamp: now,
      views: [
        { nodeId: '1', layer: 'ML0', host: 'n1', port: 9200, peers: [{ id: 'py', state: 'Ready' }], polledAt: now },
        { nodeId: '2', layer: 'ML0', host: 'n2', port: 9200, peers: [{ id: 'py', state: 'Ready' }], polledAt: now },
        { nodeId: '3', layer: 'ML0', host: 'n3', port: 9200, peers: [], polledAt: now, error: 'connection refused' },
      ],
    };

    const events = detectForks(snapshot);
    const unreachable = events.find(e => e.condition === 'NODE_UNREACHABLE');
    assert.ok(unreachable, 'Should detect unreachable');
    assert.deepEqual(unreachable!.nodeIds, ['3']);
  });

  it('returns no events when all healthy', () => {
    const view = (id: string): NodeClusterView => ({
      nodeId: id, layer: 'DL1', host: `n${id}`, port: 9400,
      peers: [{ id: 'pz', state: 'Ready' }], polledAt: now,
    });
    const snapshot: ClusterSnapshot = { layer: 'DL1', timestamp: now, views: [view('1'), view('2'), view('3')] };
    const events = detectForks(snapshot);
    assert.equal(events.length, 0);
  });

  it('suggests FullLayer when majority is split evenly', () => {
    // 1 vs 1 vs 1 — no clear majority
    const snapshot: ClusterSnapshot = {
      layer: 'CL1', timestamp: now,
      views: [
        { nodeId: '1', layer: 'CL1', host: 'n1', port: 9300, peers: [{ id: 'a', state: 'Ready' }], polledAt: now },
        { nodeId: '2', layer: 'CL1', host: 'n2', port: 9300, peers: [{ id: 'b', state: 'Ready' }], polledAt: now },
        { nodeId: '3', layer: 'CL1', host: 'n3', port: 9300, peers: [{ id: 'c', state: 'Ready' }], polledAt: now },
      ],
    };
    const events = detectForks(snapshot);
    // With 3-way split, "majority" is 1 node; minority = 2 nodes
    const fork = events.find(e => e.condition === 'FORK_DETECTED');
    assert.ok(fork);
    // When minorityNodes.length >= majorityNodes.length → FullLayer
    assert.equal(fork!.suggestedAction, 'FullLayer');
  });
});

// ── detectGL0Fork ─────────────────────────────────────────────────────────────

describe('detectGL0Fork()', () => {
  it('detects minority node at lower ordinal', () => {
    const states: GL0NodeState[] = [
      { nodeId: '1', ordinal: 6200 },
      { nodeId: '2', ordinal: 6200 },
      { nodeId: '3', ordinal: 5548 }, // lagging / forked
    ];
    const event = detectGL0Fork(states, now);
    assert.ok(event, 'Should detect fork');
    assert.deepEqual(event!.nodeIds, ['3']);
    assert.equal(event!.suggestedAction, 'IndividualNode');
  });

  it('returns null when all nodes agree', () => {
    const states: GL0NodeState[] = [
      { nodeId: '1', ordinal: 6200 },
      { nodeId: '2', ordinal: 6200 },
      { nodeId: '3', ordinal: 6200 },
    ];
    assert.equal(detectGL0Fork(states, now), null);
  });

  it('returns null with fewer than 2 nodes', () => {
    assert.equal(detectGL0Fork([{ nodeId: '1', ordinal: 100 }], now), null);
  });
});

// ── pollNodeCluster — with stub fetchFn ───────────────────────────────────────

describe('pollNodeCluster()', () => {
  const testNode = {
    nodeId: '1', host: '127.0.0.1',
    layers: [{ name: 'GL0' as const, port: 9000 }],
  };

  it('returns peers from successful fetch', async () => {
    const stubFetch = async (_url: string) => [
      { id: 'peer-a', state: 'Ready' },
      { id: 'peer-b', state: 'Ready' },
    ];

    const view = await pollNodeCluster(testNode, 'GL0', stubFetch);
    assert.equal(view.nodeId, '1');
    assert.equal(view.layer, 'GL0');
    assert.equal(view.peers.length, 2);
    assert.equal(view.error, undefined);
  });

  it('captures error string on fetch failure', async () => {
    const stubFetch = async (_url: string): Promise<unknown> => {
      throw new Error('ECONNREFUSED');
    };

    const view = await pollNodeCluster(testNode, 'GL0', stubFetch);
    assert.equal(view.peers.length, 0);
    assert.ok(view.error?.includes('ECONNREFUSED'));
  });

  it('returns error view for unconfigured layer', async () => {
    const stubFetch = async () => [];
    const view = await pollNodeCluster(testNode, 'ML0', stubFetch); // ML0 not in layers
    assert.ok(view.error?.includes('not configured'));
  });
});
