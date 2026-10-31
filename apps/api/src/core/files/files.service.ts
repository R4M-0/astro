import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { Readable } from 'stream';

/** RFC 6266/5987 attachment header, immune to quote/CRLF injection from the stored name. */
function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName).replace(/[\r\n]/g, '')}`;
}

@Injectable()
export class FilesService implements OnModuleInit {
  private readonly logger = new Logger(FilesService.name);
  private readonly client: S3Client;
  /** Signs the URLs handed to browsers; differs from `client` when MinIO sits behind a proxy. */
  private readonly presigner: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get('S3_BUCKET', 'astro');
    const endpoint = this.config.get('S3_ENDPOINT', 'http://localhost:9000');
    const make = (url: string) =>
      new S3Client({
        endpoint: url,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: {
          accessKeyId: this.config.get('S3_ACCESS_KEY', 'astro'),
          secretAccessKey: this.config.get('S3_SECRET_KEY', 'astro-secret'),
        },
      });
    this.client = make(endpoint);
    // In Docker the API reaches MinIO at http://minio:9000, which browsers cannot;
    // S3_PUBLIC_ENDPOINT (e.g. https://files.example.com) is the host they can.
    const publicEndpoint = this.config.get<string>('S3_PUBLIC_ENDPOINT');
    this.presigner = publicEndpoint && publicEndpoint !== endpoint ? make(publicEndpoint) : this.client;
  }

  async onModuleInit() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created bucket ${this.bucket}`);
      } catch (err) {
        this.logger.error(`Cannot ensure bucket ${this.bucket}: ${(err as Error).message}`);
      }
    }
  }

  buildKey(orgId: string, entityType: string, fileName: string) {
    const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const type = entityType.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${orgId}/${type}/${Date.now()}-${randomBytes(4).toString('hex')}-${safe}`;
  }

  /** Signed PUT bound to the declared size so the DB record cannot understate the object. */
  async presignUpload(key: string, mimeType: string, size?: number) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
      ...(size ? { ContentLength: size } : {}),
    });
    return getSignedUrl(this.presigner, command, {
      expiresIn: 600,
      ...(size ? { signableHeaders: new Set(['content-length', 'content-type']) } : {}),
    });
  }

  async presignDownload(key: string, fileName?: string) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(fileName ? { ResponseContentDisposition: contentDisposition(fileName) } : {}),
    });
    return getSignedUrl(this.presigner, command, { expiresIn: 600 });
  }

  /** Signed GET served inline (in-browser PDF preview); only for content types a browser cannot execute. */
  async presignInline(key: string, fileName: string, mimeType: string) {
    const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentType: mimeType,
      ResponseContentDisposition: `inline; filename="${ascii}"`,
    });
    return getSignedUrl(this.presigner, command, { expiresIn: 600 });
  }

  /** Raw object body as a Node stream (server-side export). */
  async getObjectStream(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error('Empty object body');
    return res.Body as Readable;
  }

  async putObject(key: string, body: Buffer, mimeType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: mimeType }),
    );
    return key;
  }

  /** Multipart upload of a stream of unknown length (e.g. a generated ZIP). Resolves once stored. */
  async uploadStream(key: string, body: Readable, mimeType: string) {
    await new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: mimeType },
      queueSize: 2,
      partSize: 16 * 1024 * 1024,
    }).done();
    return key;
  }

  /** True when the object exists; false only on a definite 404 (other errors are rethrown). */
  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (err as Error).name === 'NotFound') return false;
      throw err;
    }
  }

  async deleteObject(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
