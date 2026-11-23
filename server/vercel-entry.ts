import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { createApiApp } from './app.ts';

const app = createApiApp({ includeErrorHandler: true });

export function normalizeVercelApiUrl(
  rawUrl: string | undefined,
  headers?: IncomingHttpHeaders
): string {
  const urlStr = rawUrl || '/api';
  try {
    const parsed = new URL(urlStr, 'http://localhost');

    // Legacy rewrite query param support
    const rewrittenPath = parsed.searchParams.get('__vercel_api_path');
    if (rewrittenPath !== null) {
      parsed.searchParams.delete('__vercel_api_path');
      const cleanSubpath = rewrittenPath.replace(/^\/+/, '');
      const targetPath = cleanSubpath ? `/api/${cleanSubpath}` : '/api';
      const qs = parsed.searchParams.toString();
      return qs ? `${targetPath}?${qs}` : targetPath;
    }

    // Handle catch-all fallback if Vercel rewrites pathname to /api/[...path]
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (decodedPath === '/api/[...path]') {
      const headerUri =
        (typeof headers?.['x-vercel-original-uri'] === 'string' && headers['x-vercel-original-uri']) ||
        (typeof headers?.['x-invoke-path'] === 'string' && headers['x-invoke-path']) ||
        '';
      if (headerUri.startsWith('/api')) {
        const headerParsed = new URL(headerUri, 'http://localhost');
        const qs = parsed.searchParams.toString();
        return qs ? `${headerParsed.pathname}?${qs}` : headerParsed.pathname;
      }

      const catchAllParam =
        parsed.searchParams.get('...path') ?? parsed.searchParams.get('path');
      if (catchAllParam !== null) {
        parsed.searchParams.delete('...path');
        parsed.searchParams.delete('path');
        const cleanSubpath = catchAllParam.replace(/^\/+/, '');
        const targetPath = cleanSubpath ? `/api/${cleanSubpath}` : '/api';
        const qs = parsed.searchParams.toString();
        return qs ? `${targetPath}?${qs}` : targetPath;
      }
    }

    if (decodedPath === '/api/index') {
      const qs = parsed.searchParams.toString();
      return qs ? `/api?${qs}` : '/api';
    }

    return urlStr;
  } catch {
    return urlStr;
  }
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  req.url = normalizeVercelApiUrl(req.url, req.headers);
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
