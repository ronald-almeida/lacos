import { createApp } from '../server.js';
import { BlobStore } from '../lib/blob-store.js';
import { FirebotGateway } from '../lib/firebot.js';

const origin = process.env.PUBLIC_ORIGIN || `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
const app = createApp({
  origin,
  gateway: new FirebotGateway({ storeUrl: origin }),
  store: new BlobStore(),
});

export default app.handler;
