import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Origins the browser may talk to: the API (http/ws) and the file store.
const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').origin;
  } catch {
    return 'http://localhost:3001';
  }
})();
const filesOrigin = process.env.NEXT_PUBLIC_FILES_ORIGIN ?? 'http://localhost:9000';
const wsOrigin = apiOrigin.replace(/^http/, 'ws');
const graphOrigin = process.env.NEXT_PUBLIC_GRAPH_URL ?? 'http://localhost:3012';
const isDev = process.env.NODE_ENV !== 'production';

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // Next.js injects inline scripts/styles; no third-party script origins are used.
  // 'unsafe-eval' is only needed by the dev-mode React refresh runtime.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  `img-src 'self' data: blob: ${filesOrigin}`,
  // in-app PDF preview (HACCP › Méthodologie) frames a presigned object-storage URL
  `frame-src 'self' ${filesOrigin}`,
  `connect-src 'self' ${apiOrigin} ${wsOrigin} ${filesOrigin} ${graphOrigin}`,
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // own browsing-context group: a cross-origin window can't script us via window.opener
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // preload: submit the apex domain to hstspreload.org once every subdomain serves HTTPS
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig: NextConfig = {
  // self-contained server (node server.js) with only the traced dependencies — small image, low RAM
  output: 'standalone',
  // monorepo: trace workspace packages from the repo root
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@astro/shared'],
  poweredByHeader: false,
  async redirects() {
    return [
      // self-hosted: no public sign-up (members are invited by an admin)
      ...(process.env.NEXT_PUBLIC_DEPLOYMENT_MODE === 'self-hosted'
        ? [{ source: '/register', destination: '/login', permanent: false }]
        : []),
    ];
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
