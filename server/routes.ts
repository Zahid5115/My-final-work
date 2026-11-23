import express, { type NextFunction, type Request, type Response } from 'express';
import { registerAuthAndUsersRoutes } from './routes/authAndUsersRoutes.ts';
import { registerCmsAndSystemRoutes } from './routes/cmsAndSystemRoutes.ts';
import { registerOperationsRoutes } from './routes/operationsRoutes.ts';
import { registerPublicRoutes } from './routes/publicRoutes.ts';
import { isProductionEnvironment, isServerSupabaseConfigured } from './supabaseAdmin.ts';

export function createApiRouter(): express.Router {
  const router = express.Router();

  // Fail closed in production if Supabase server credentials are missing
  router.use((req, res, next) => {
    if (
      isProductionEnvironment() &&
      !isServerSupabaseConfigured() &&
      req.path !== '/admin/auth/status'
    ) {
      res.status(503).json({
        error:
          'Production persistence is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (local JSON persistence is disabled in production).'
      });
      return;
    }
    next();
  });

  registerPublicRoutes(router);
  registerAuthAndUsersRoutes(router);
  registerOperationsRoutes(router);
  registerCmsAndSystemRoutes(router);

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error.';
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  });

  return router;
}
