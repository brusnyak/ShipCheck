import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { createApiRouter } from './routes/api.ts';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    })
  );

  const allowedOrigin = process.env.CORS_ORIGIN;
  app.use(
    cors({
      origin: allowedOrigin ? allowedOrigin.split(',').map((o) => o.trim()) : true,
      credentials: false,
    })
  );

  app.use(express.json({ limit: '256kb' }));
  app.use('/api', createApiRouter());

  return app;
}
