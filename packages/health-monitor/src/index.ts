/**
 * Metagraph Health Monitor — Entry Point
 *
 * Run with: node dist/index.js
 * Or dev:   npx tsx src/index.ts
 * PM2:      pm2 start dist/index.js --name health-monitor
 */

import { getConfig } from './config.js';
import { MetagraphMonitor } from './monitor.js';

const config  = getConfig();
const monitor = new MetagraphMonitor(config);

// Graceful shutdown
process.on('SIGTERM', () => { monitor.stop(); process.exit(0); });
process.on('SIGINT',  () => { monitor.stop(); process.exit(0); });

monitor.start().catch((err) => {
  console.error('[health-monitor] Fatal error:', err);
  process.exit(1);
});
