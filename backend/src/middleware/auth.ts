import type { NextFunction, Request, Response } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from '../../../firebase-applet-config.json' with { type: 'json' };

const isConfigured =
  Boolean(firebaseConfig.projectId) &&
  firebaseConfig.projectId !== 'remixed-project-id';

if (isConfigured) {
  if (!getApps().length) {
    initializeApp({
      projectId: firebaseConfig.projectId,
    });
  } else {
    getApp();
  }
}

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sign in with Google to manage projects and deploy webhooks.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Missing authentication token.' });
    return;
  }

  // Allow deterministic unit/integration test token override strictly in test environment
  if (
    (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') &&
    process.env.TEST_AUTH_BYPASS === 'true' &&
    token.startsWith('test-uid:')
  ) {
    const uid = token.slice('test-uid:'.length);
    req.user = {
      uid,
      email: `${uid}@shipcheck.test`,
      email_verified: true,
    } as DecodedIdToken;
    next();
    return;
  }

  if (!isConfigured) {
    res.status(503).json({ error: 'Authentication service is not configured.' });
    return;
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Firebase token verification failed:', err);
    res.status(401).json({ error: 'Invalid or expired authentication session.' });
  }
}

export async function optionalAuth(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ') || !isConfigured) {
    next();
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    next();
    return;
  }
  try {
    req.user = await getAuth().verifyIdToken(token);
  } catch {
    // Ignore invalid optional tokens
  }
  next();
}
