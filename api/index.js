import { createApp } from '../server.js';
import { BlobStore } from '../lib/blob-store.js';
import { FirebotGateway } from '../lib/firebot.js';

const origin = process.env.PUBLIC_ORIGIN || `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
const app = createApp({
  origin,
  gateway: new FirebotGateway({ storeUrl: origin }),
  store: new BlobStore(),
  // Only this Vercel entry point trusts the IP header overwritten by its edge.
  clientAddress: req => req.headers['x-vercel-forwarded-for'] || req.socket.remoteAddress || 'unknown',
});

export default app.handler;
