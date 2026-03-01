/**
 * Hypergraph HTTP API client.
 *
 * Simple client for querying Constellation Network hypergraph endpoints.
 * Tries multiple URLs with first-success semantics.
 */

import type { NodeInfo, ClusterMember } from '../types.js';
import { log } from '../logger.js';

const FETCH_TIMEOUT = 8_000;

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Check a single hypergraph L0 endpoint.
 */
export async function checkHypergraphL0(url: string): Promise<NodeInfo | null> {
  const normalized = url.replace(/\/$/, '');
  return fetchJson<NodeInfo>(`${normalized}/node/info`);
}

/**
 * Get cluster info from a hypergraph endpoint.
 */
export async function getHypergraphCluster(url: string): Promise<ClusterMember[]> {
  const normalized = url.replace(/\/$/, '');
  return (await fetchJson<ClusterMember[]>(`${normalized}/cluster/info`)) ?? [];
}

/**
 * Try multiple URLs, return first successful result.
 */
export async function tryFirstSuccess<T>(
  urls: string[],
  fn: (url: string) => Promise<T | null>,
): Promise<{ result: T; url: string } | null> {
  for (const url of urls) {
    try {
      const result = await fn(url);
      if (result !== null) {
        return { result, url };
      }
    } catch {
      log(`[HypergraphAPI] Failed to reach ${url}`);
    }
  }
  return null;
}

/** Fetch type for dependency injection in tests */
export type HypergraphL0Fetch = (url: string) => Promise<NodeInfo | null>;
export type HypergraphClusterFetch = (url: string) => Promise<ClusterMember[]>;
