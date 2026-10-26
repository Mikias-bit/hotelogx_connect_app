import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import routes from './routes.js';
import { errorHandler } from './middlewares/errorHandler.js';

const app = express();
app.set('trust proxy', 1);

// Native Security Headers (OWASP recommended baseline)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.removeHeader('X-Powered-By');
  next();
});

// Configure CORS with allowed origins and environment guards
const allowedOrigins = [
  ...config.frontendUrls,
  ...(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  'http://localhost:3000',
  'http://localhost:5173',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || process.env.NODE_ENV !== 'production' || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not permitted by CORS policy`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-Hub-Signature-256'],
  }),
);

// Coexistence history arrives in batches larger than the default 100 KB JSON limit.
// Keep other API routes at their existing limit, and retain exact signature bytes.
app.use(['/api/whatsapp/webhook', '/api/webhooks/whatsapp'], express.json({
  limit: '10mb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

// Structured daily reports can contain thousands of rows.
app.use('/api/reports/ingest', express.json({ limit: '5mb' }));

// Capture raw body for cryptographic webhook signature verification (Meta WhatsApp)
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);
app.use(express.urlencoded({ extended: true }));

app.use('/api', routes);

app.use(errorHandler);

export default app;
