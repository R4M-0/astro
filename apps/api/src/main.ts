import { json, type NextFunction, type Request, type Response } from 'express';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { historyContextMiddleware } from './core/history/history-context.middleware';
import { RedisIoAdapter } from './core/redis/redis-io.adapter';
import { APP_ROLE } from './core/jobs/app-role';
import { insecureConfiguration, swaggerEnabled } from './core/auth/deployment';

/** Refuse to boot a public deployment (production or https) on placeholder / weak secrets. */
function assertProductionSecrets() {
  const problems = insecureConfiguration();
  if (problems.length) {
    throw new Error(`Refusing to start with insecure configuration:\n - ${problems.join('\n - ')}`);
  }
}

async function bootstrap() {
  assertProductionSecrets();
  const app = await NestFactory.create(AppModule);
  const isProd = process.env.NODE_ENV === 'production';
  // WebSocket broadcasts go through Redis so they reach users on any replica
  app.useWebSocketAdapter(new RedisIoAdapter(app));
  app.enableShutdownHooks();

  // Behind a reverse proxy (Caddy, optionally a CDN in front) the client IP lives in
  // X-Forwarded-For; without this the throttler and session/audit IPs all see
  // the proxy. TRUST_PROXY = number of hops (default 1 in production).
  const trustProxy = process.env.TRUST_PROXY ?? (isProd ? '1' : '');
  if (trustProxy) {
    app.getHttpAdapter().getInstance().set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  // GED versions carry whole spreadsheets / annotation layers / embedded images:
  // a larger JSON limit on the documents routes only (100 kB elsewhere).
  // (wrapped: Nest skips its own global JSON parser when it finds a middleware named `jsonParser`)
  const documentsJson = json({ limit: '20mb' });
  app.use('/api/v1/documents', (req: Request, res: Response, next: NextFunction) => documentsJson(req, res, next));
  // establish the per-request modification-history context before anything else
  app.use(historyContextMiddleware);
  app.enableCors({
    origin: process.env.APP_URL ?? 'http://localhost:3000',
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  // API docs are never exposed on a public deployment unless explicitly enabled.
  if (swaggerEnabled()) {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Astro API')
    .setDescription('HR management SaaS — REST API')
    .setVersion('1.0')
    .addBearerAuth()
    .addGlobalParameters({
      name: 'X-Organization-Id',
      in: 'header',
      required: false,
      schema: { type: 'string' },
    })
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);
  }

  const port = Number(process.env.API_PORT ?? 3001);
  // API_HOST=127.0.0.1 keeps a dev box API off the LAN (containers keep the all-interfaces default)
  const host = process.env.API_HOST;
  await (host ? app.listen(port, host) : app.listen(port));
  new Logger('Bootstrap').log(`role=${APP_ROLE} listening on ${host ?? ''}:${port}`);
}

void bootstrap();
