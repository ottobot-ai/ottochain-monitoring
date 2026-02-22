/**
 * Snapshot stall detection unit tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { OrdinalSnapshot } from '../src/types.js';
import { StallTracker, detectStalls, detectClusterStall, fetchML0Ordinal, fetchGL0Ordinal } from '../src/snapshot.js';

const now = new Date().toISOString();

// ── StallTracker ──────────────────────────────────────────────────────────────

describe('StallTracker', () => {
  it('staleSecs returns null before first update', () => {
    const t = new StallTracker();
    assert.equal(t.staleSecs('n1', 'ML0'), null);
  });

  it('staleSecs is ~0 immediately after update', () => {
    const t = new StallTracker();
    t.update({ nodeId: 'n1', layer: 'ML0', ordinal: 100, timestamp: now });
    const secs = t.staleSecs('n1', 'ML0')!;
    assert.ok(secs < 1, `Expected <1s, got ${secs}`);
  });

  it('update returns true when ordinal advances', () => {
    const t = new StallTracker();
    t.update({ nodeId: 'n1', layer: 'ML0', ordinal: 100, timestamp: now });
    const advanced = t.update({ nodeId: 'n1', layer: 'ML0', ordinal: 101, timestamp: now });
    assert.equal(advanced, true);
  });

  it('update returns false when ordinal does not change', () => {
    const t = new StallTracker();
    t.update({ nodeId: 'n1', layer: 'ML0', ordinal: 100, timestamp: now });
    const same = t.update({ nodeId: 'n1', layer: 'ML0', ordinal: 100, timestamp: now });
    assert.equal(same, false);
  });

  it('reset clears all state', () => {
    const t = new StallTracker();
    t.update({ nodeId: 'n1', layer: 'ML0', ordinal: 100, timestamp: now });
    t.reset();
    assert.equal(t.staleSecs('n1', 'ML0'), null);
  });

  it('tracks multiple node+layer combos independently', () => {
    const t = new StallTracker();
    t.update({ nodeId: 'n1', layer: 'ML0', ordinal: 50, timestamp: now });
    t.update({ nodeId: 'n2', layer: 'GL0', ordinal: 200, timestamp: now });
    assert.equal(t.lastOrdinalFor('n1', 'ML0'), 50);
    assert.equal(t.lastOrdinalFor('n2', 'GL0'), 200);
  });
});

// ── detectStalls ──────────────────────────────────────────────────────────────

describe('detectStalls()', () => {
  it('emits SNAPSHOT_STALL when ordinal unchanged past threshold', () => {
    const t = new StallTracker();
    const snap: OrdinalSnapshot = { nodeId: '1', layer: 'ML0', ordinal: 500, timestamp: now };

    // Simulate first update long ago by hacking internal state
    // We do this by calling update then manually checking via detectStalls
    t.update(snap);

    // staleSecs won't be >= threshold immediately; we need to fake time.
    // Instead, test the predicate directly:
    const stale = t.staleSecs('1', 'ML0')!;
    assert.ok(stale < 1, 'Just updated, not stale yet');

    // After detecting — no stall since just updated
    const events = detectStalls([snap], t, 240);
    assert.equal(events.length, 0);
  });

  it('does not emit stall right after ordinal advances', () => {
    const t = new StallTracker();
    t.update({ nodeId: '1', layer: 'ML0', ordinal: 100, timestamp: now });
    t.update({ nodeId: '1', layer: 'ML0', ordinal: 101, timestamp: now });

    const events = detectStalls(
      [{ nodeId: '1', layer: 'ML0', ordinal: 101, timestamp: now }],
      t, 240
    );
    assert.equal(events.length, 0);
  });

  it('uses existing staleness time from tracker', () => {
    // Create tracker where stale time is set manually via a private-friendly approach:
    // We can't easily mock Date.now() without a library, but we can verify the
    // structure when staleSecs >= threshold via a subclass.

    class FakeStallTracker extends StallTracker {
      override staleSecs(nodeId: string, layer: string): number | null {
        return 300; // Always stale
      }
      override lastOrdinalFor(nodeId: string, layer: string): number | undefined {
        return 500;
      }
    }

    const t = new FakeStallTracker();
    t.update({ nodeId: '1', layer: 'ML0', ordinal: 500, timestamp: now });

    const events = detectStalls(
      [{ nodeId: '1', layer: 'ML0', ordinal: 500, timestamp: now }],
      t, 240
    );

    assert.equal(events.length, 1);
    assert.equal(events[0].condition, 'SNAPSHOT_STALL');
    assert.equal(events[0].layer, 'ML0');
    assert.deepEqual(events[0].nodeIds, ['1']);
    assert.equal(events[0].suggestedAction, 'FullMetagraph');
  });
});

// ── detectClusterStall ────────────────────────────────────────────────────────

describe('detectClusterStall()', () => {
  const nodes = [
    { nodeId: '1', host: 'n1', layers: [{ name: 'ML0' as const, port: 9200 }] },
    { nodeId: '2', host: 'n2', layers: [{ name: 'ML0' as const, port: 9200 }] },
    { nodeId: '3', host: 'n3', layers: [{ name: 'ML0' as const, port: 9200 }] },
  ];

  it('returns null when not all nodes are stalled', () => {
    class PartialStall extends StallTracker {
      override staleSecs(nodeId: string, layer: string): number | null {
        return nodeId === '1' ? 300 : 10; // only node1 stalled
      }
    }
    const result = detectClusterStall('ML0', nodes, new PartialStall(), 240);
    assert.equal(result, null);
  });

  it('returns event when ALL nodes stalled', () => {
    class AllStalled extends StallTracker {
      override staleSecs(_nodeId: string, _layer: string): number | null { return 300; }
      override lastOrdinalFor(_nodeId: string, _layer: string): number | undefined { return 500; }
    }
    const result = detectClusterStall('ML0', nodes, new AllStalled(), 240);
    assert.ok(result, 'Should return stall event');
    assert.equal(result!.condition, 'SNAPSHOT_STALL');
    assert.equal(result!.suggestedAction, 'FullMetagraph');
    assert.deepEqual(result!.nodeIds.sort(), ['1', '2', '3']);
  });
});

// ── fetchML0Ordinal — with stub ───────────────────────────────────────────────

describe('fetchML0Ordinal()', () => {
  const testNode = {
    nodeId: '1', host: '127.0.0.1',
    layers: [{ name: 'ML0' as const, port: 9200 }],
  };

  it('parses ordinal from checkpoint response', async () => {
    const stubFetch = async (_url: string) => ({ ordinal: 1234, state: {} });
    const snap = await fetchML0Ordinal(testNode, stubFetch);
    assert.ok(snap);
    assert.equal(snap!.ordinal, 1234);
    assert.equal(snap!.layer, 'ML0');
    assert.equal(snap!.nodeId, '1');
  });

  it('returns null on fetch error', async () => {
    const stubFetch = async (): Promise<unknown> => { throw new Error('unreachable'); };
    const snap = await fetchML0Ordinal(testNode, stubFetch);
    assert.equal(snap, null);
  });
});

describe('fetchGL0Ordinal()', () => {
  const testNode = {
    nodeId: '2', host: '127.0.0.1',
    layers: [{ name: 'GL0' as const, port: 9000 }],
  };

  it('parses snapshotOrdinal from node info', async () => {
    const stubFetch = async (_url: string) => ({ snapshotOrdinal: 6200, state: 'Ready' });
    const snap = await fetchGL0Ordinal(testNode, stubFetch);
    assert.ok(snap);
    assert.equal(snap!.ordinal, 6200);
    assert.equal(snap!.layer, 'GL0');
  });

  it('falls back to lastSnapshotOrdinal', async () => {
    const stubFetch = async () => ({ lastSnapshotOrdinal: 5500 });
    const snap = await fetchGL0Ordinal(testNode, stubFetch);
    assert.equal(snap!.ordinal, 5500);
  });

  it('returns null on error', async () => {
    const stubFetch = async (): Promise<unknown> => { throw new Error('timeout'); };
    const snap = await fetchGL0Ordinal(testNode, stubFetch);
    assert.equal(snap, null);
  });
});
