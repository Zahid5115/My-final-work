import 'dotenv/config';
import express from 'express';
import { createApiRouter } from './routes.ts';
import { securityHeadersMiddleware } from './security.ts';

export function createApiApp(
  options: { includeErrorHandler?: boolean; mountRootApi?: boolean } = {}
): express.Express {
  const { includeErrorHandler = true, mountRootApi = false } = options;
  const app = express();

  app.set('trust proxy', 1);
  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  const apiRouter = createApiRouter();
  app.use('/api', apiRouter);
  if (mountRootApi) {
    app.use('/', apiRouter);
  }

  if (includeErrorHandler) {
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const message = err instanceof Error ? err.message : 'Unexpected server error.';
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      }
    });
  }

  return app;
}
