import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const production = process.env.NODE_ENV === 'production';
const backendBaseUrl = (process.env.BACKEND_BASE_URL || (production ? 'https://hotelogx-connect-backend-tkissahsva-ez.a.run.app' : `http://localhost:${process.env.PORT || 5000}`)).replace(/\/+$/, '');
const frontendUrls = (process.env.FRONTEND_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:3000').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL || '')) {
  throw new Error('DATABASE_URL must be a PostgreSQL connection URL. Configure the Neon connection in .env or Cloud Run secrets.');
}
export const config = {
  imapWorker: { audience:process.env.IMAP_WORKER_AUDIENCE || '',serviceAccount:process.env.IMAP_WORKER_SERVICE_ACCOUNT || '' },
  microsoftGraph: {
    notificationUrl: process.env.MICROSOFT_GRAPH_NOTIFICATION_URL || `${backendBaseUrl}/api/webhooks/email/microsoft/notifications`,
    taskQueue: process.env.MICROSOFT_TASK_QUEUE || '',
    workerAudience: process.env.MICROSOFT_WORKER_AUDIENCE || '',
    workerServiceAccount: process.env.MICROSOFT_WORKER_SERVICE_ACCOUNT || '',
  },
  googlePubSub: {
    topic: process.env.GOOGLE_PUBSUB_TOPIC || '',
    expectedAudience: process.env.GOOGLE_PUBSUB_AUDIENCE || '',
    pushServiceAccount: process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT || '',
    subscription: process.env.GOOGLE_PUBSUB_SUBSCRIPTION || '',
    workerAudience: process.env.GMAIL_WORKER_AUDIENCE || '',
    workerServiceAccount: process.env.GMAIL_WORKER_SERVICE_ACCOUNT || '',
  },
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  backendBaseUrl,
  frontendUrl: frontendUrls[0],
  frontendUrls,
  jwtSecret: process.env.JWT_SECRET || (production ? (() => { throw new Error('JWT_SECRET is required in production'); })() : 'hotelogx_connect_jwt_secret_key_2026'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  microsoftClientId: process.env.MICROSOFT_OAUTH_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID || '',
  microsoftClientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET || '',
  microsoftTenantId: process.env.MICROSOFT_OAUTH_TENANT_ID || process.env.MICROSOFT_TENANT_ID || 'common',
  microsoftRedirectUri: process.env.MICROSOFT_OAUTH_REDIRECT_URI || process.env.MICROSOFT_REDIRECT_URI || `${backendBaseUrl}/api/email-integrations/microsoft/callback`,
  microsoftGraphBaseUrl: process.env.MICROSOFT_GRAPH_BASE_URL || 'https://graph.microsoft.com/v1.0',
};
