import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApiApp } from './server/app.ts';
import { UPLOADS_ROOT } from './server/store.ts';
import { assertProductionPersistence, isServerSupabaseConfigured } from './server/supabaseAdmin.ts';

async function startServer() {
  assertProductionPersistence();
  const app = createApiApp({ includeErrorHandler: false });
  const isProd = process.env.NODE_ENV === 'production';

  // Serve local gallery uploads only in local preview mode when Supabase is unconfigured
  if (!isProd && !isServerSupabaseConfigured()) {
    const galleryUploadsDir = path.join(UPLOADS_ROOT, 'gallery');
    fs.mkdirSync(galleryUploadsDir, { recursive: true });
    app.use('/uploads/gallery', express.static(galleryUploadsDir));
  }

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
