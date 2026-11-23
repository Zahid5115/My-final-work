import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiApp } from './app.ts';

const app = createApiApp({ includeErrorHandler: true });

export function normalizeVercelApiUrl(rawUrl: string | undefined): string {
  const urlStr = rawUrl || '/api';
  try {
    const parsed = new URL(urlStr, 'http://localhost');
    const rewrittenPath = parsed.searchParams.get('__vercel_api_path');
    if (rewrittenPath !== null) {
      parsed.searchParams.delete('__vercel_api_path');
      const cleanSubpath = rewrittenPath.replace(/^\/+/, '');
      const targetPath = cleanSubpath ? `/api/${cleanSubpath}` : '/api';
      const qs = parsed.searchParams.toString();
      return qs ? `${targetPath}?${qs}` : targetPath;
    }

    if (parsed.pathname === '/api/index') {
      const qs = parsed.searchParams.toString();
      return qs ? `/api?${qs}` : '/api';
    }

    return urlStr;
  } catch {
    return urlStr;
  }
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  req.url = normalizeVercelApiUrl(req.url);
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
