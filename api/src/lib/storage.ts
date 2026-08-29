/**
 * Storage abstraction — Cloudflare R2 (S3-compatible).
 *
 * Bucket-name mapping: callers use logical names
 * ('avatars', 'inspection-photos', 'reports', 'booking-receipts') and we
 * map to the R2 physical names with the `inspectafrica-` prefix.
 *
 * Public URLs (avatars only, behind a flag): set R2_PUBLIC_URL_AVATARS to the
 * R2 dev URL (https://pub-<hash>.r2.dev) or a custom CDN domain. If unset,
 * `getPublicUrl` falls back to a 1-week signed URL.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from './logger.js';

// Logical → physical bucket-name mapping
const BUCKET_MAP: Record<string, string> = {
  'avatars':           'inspectafrica-avatars',
  'inspection-photos': 'inspectafrica-inspection-photos',
  'reports':           'inspectafrica-reports',
  'booking-receipts':  'inspectafrica-booking-receipts',
  'token-receipts':    'inspectafrica-token-receipts',
};

function physicalBucket(logical: string): string {
  return BUCKET_MAP[logical] ?? logical;
}

// Lazy-init S3 client so importing this module doesn't crash in environments
// without R2 creds (CI tests, lint, typecheck). The actual error surfaces only
// when storage operations are called.
let _s3: S3Client | null = null;
function getS3(): S3Client {
  if (_s3) return _s3;
  const endpoint  = process.env.R2_ENDPOINT;
  const keyId     = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !keyId || !secretKey) {
    throw new Error('R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required');
  }
  _s3 = new S3Client({
    region:    'auto',
    endpoint,
    credentials: { accessKeyId: keyId, secretAccessKey: secretKey },
    // R2 requires path-style URLs for signed-URL auth to work consistently.
    forcePathStyle: true,
    // AWS SDK v3 ≥3.353 adds x-amz-checksum-mode=ENABLED to GetObject by
    // default. R2 does not support this parameter and returns 403. Opt out.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return _s3;
}

export interface SignedUrlResult {
  signedUrl: string;
  path:      string;
  expiresIn: number;
}

/**
 * Generate a signed upload URL (PUT). Caller uploads directly via fetch with
 * Content-Type matching what they pass in `contentType`.
 */
export async function getSignedUploadUrl(
  bucket: string,
  path: string,
  expiresIn: number = 300,           // 5 min default
  contentType?: string
): Promise<SignedUrlResult | null> {
  try {
    const cmd = new PutObjectCommand({
      Bucket:      physicalBucket(bucket),
      Key:         path,
      ContentType: contentType,
    });
    const signedUrl = await getSignedUrl(getS3(), cmd, { expiresIn });
    return { signedUrl, path, expiresIn };
  } catch (err) {
    logger.error({ err, bucket, path }, 'storage: failed to create signed upload URL');
    return null;
  }
}

/**
 * Generate a signed download URL (GET).
 */
export async function getSignedDownloadUrl(
  bucket: string,
  path: string,
  expiresIn: number = 3600,          // 1 hour default
  responseContentDisposition?: string
): Promise<string | null> {
  try {
    const cmd = new GetObjectCommand({
      Bucket: physicalBucket(bucket),
      Key:    path,
      ...(responseContentDisposition ? { ResponseContentDisposition: responseContentDisposition } : {}),
    });
    return await getSignedUrl(getS3(), cmd, { expiresIn });
  } catch (err) {
    logger.error({ err, bucket, path }, 'storage: failed to create signed download URL');
    return null;
  }
}

/**
 * Why an upload didn't happen. `exists` is the caller's own rule (upsert=false
 * and the key is taken); `unavailable` means the object store failed us, which
 * is worth retrying and is not the user's fault.
 */
export type UploadResult =
  | { ok: true }
  | { ok: false; reason: 'exists' | 'unavailable'; message: string };

function isNotFound(err: any): boolean {
  return (
    err?.name === 'NotFound' ||
    err?.name === 'NoSuchKey' ||
    err?.$metadata?.httpStatusCode === 404
  );
}

const UPLOAD_ATTEMPTS = 3;
const UPLOAD_RETRY_BASE_MS = 200;

/**
 * Upload a file directly. `file` must be a Buffer (Blob/File not used by API).
 *
 * Transient object-store failures are retried — a single dropped connection
 * shouldn't cost an inspector their upload — and the reason for a definitive
 * failure comes back to the caller so it can say something more useful than
 * "upload failed".
 */
export async function uploadFile(
  bucket: string,
  path: string,
  file: Buffer,
  options?: { contentType?: string; upsert?: boolean }
): Promise<UploadResult> {
  // R2/S3 PutObject is upsert by default. To enforce no-overwrite, HEAD first
  // and bail if the key is taken.
  if (options?.upsert === false) {
    try {
      await getS3().send(new HeadObjectCommand({
        Bucket: physicalBucket(bucket), Key: path,
      }));
      logger.warn({ bucket, path }, 'storage: upload aborted, key exists and upsert=false');
      return { ok: false, reason: 'exists', message: 'A file already exists at that path' };
    } catch (err) {
      // Only a 404 means the key is free. Anything else — bad credentials, a
      // network fault — used to be swallowed here and read as "absent", which
      // hid the real problem behind whatever the upload did next.
      if (!isNotFound(err)) {
        logger.error({ err, bucket, path }, 'storage: existence check failed');
        return { ok: false, reason: 'unavailable', message: (err as Error)?.message ?? 'Storage unavailable' };
      }
    }
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      await getS3().send(new PutObjectCommand({
        Bucket:      physicalBucket(bucket),
        Key:         path,
        Body:        file,
        ContentType: options?.contentType,
      }));
      if (attempt > 1) logger.info({ bucket, path, attempt }, 'storage: upload succeeded on retry');
      return { ok: true };
    } catch (err) {
      lastErr = err;
      logger.error(
        { err, bucket, path, attempt, attempts: UPLOAD_ATTEMPTS },
        'storage: failed to upload file'
      );
      if (attempt < UPLOAD_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, UPLOAD_RETRY_BASE_MS * attempt));
      }
    }
  }

  return {
    ok: false,
    reason: 'unavailable',
    message: (lastErr as Error)?.message ?? 'Storage unavailable',
  };
}

/**
 * Download a file's bytes (used by ReportService for embedding signatures /
 * cover photos into PDFs).
 */
export async function downloadFile(
  bucket: string,
  path: string
): Promise<Buffer | null> {
  try {
    const res = await getS3().send(new GetObjectCommand({
      Bucket: physicalBucket(bucket),
      Key:    path,
    }));
    if (!res.Body) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    logger.error({ err, bucket, path }, 'storage: failed to download file');
    return null;
  }
}

/**
 * Delete one or more files. R2 supports DeleteObjects in batches of up to 1000.
 */
export async function deleteFiles(
  bucket: string,
  paths: string[]
): Promise<boolean> {
  if (paths.length === 0) return true;
  try {
    await getS3().send(new DeleteObjectsCommand({
      Bucket: physicalBucket(bucket),
      Delete: { Objects: paths.map(p => ({ Key: p })) },
    }));
    return true;
  } catch (err) {
    logger.error({ err, bucket, paths }, 'storage: failed to delete files');
    return false;
  }
}

/**
 * List objects under a prefix.
 */
export async function listFiles(
  bucket: string,
  prefix: string = '',
  options?: { limit?: number }
): Promise<{ name: string; id: string; created_at: string }[]> {
  try {
    const res = await getS3().send(new ListObjectsV2Command({
      Bucket:  physicalBucket(bucket),
      Prefix:  prefix,
      MaxKeys: options?.limit ?? 100,
    }));
    return (res.Contents ?? []).map(o => ({
      name:       (o.Key ?? '').replace(new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?'), ''),
      id:         o.ETag ?? '',
      created_at: o.LastModified?.toISOString() ?? '',
    }));
  } catch (err) {
    logger.error({ err, bucket, prefix }, 'storage: failed to list files');
    return [];
  }
}

/**
 * Public URL for a file. Currently only configured for the avatars bucket
 * (R2 public dev URL or custom domain). For other buckets — or if the avatars
 * public URL isn't set — we return a 1-week signed URL so callers stay valid.
 *
 * Note: this is now async because the signed-URL fallback is async. Callers
 * that previously did `getPublicUrl(...)` synchronously must await.
 */
export async function getPublicUrl(bucket: string, path: string): Promise<string> {
  const publicAvatarsBase = process.env.R2_PUBLIC_URL_AVATARS || '';
  if (bucket === 'avatars' && publicAvatarsBase) {
    return `${publicAvatarsBase.replace(/\/$/, '')}/${path}`;
  }
  // Fall back to a long-lived signed URL (1 week)
  const signed = await getSignedDownloadUrl(bucket, path, 7 * 24 * 60 * 60);
  return signed ?? '';
}
