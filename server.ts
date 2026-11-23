import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApiRouter } from './server/routes.ts';
import { securityHeadersMiddleware } from './server/security.ts';
import { UPLOADS_ROOT } from './server/store.ts';

async function startServer() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  app.set('trust proxy', 1);
  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Serve only public gallery uploads directly; all private buckets require /api/admin/files auth
  const galleryUploadsDir = path.join(UPLOADS_ROOT, 'gallery');
  fs.mkdirSync(galleryUploadsDir, { recursive: true });
  app.use('/uploads/gallery', express.static(galleryUploadsDir));

  // Mount API routes
  app.use('/api', createApiRouter());

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Unexpected server error.';
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Smoker's Lawn Care Service platform listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
