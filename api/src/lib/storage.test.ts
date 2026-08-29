import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  class Cmd {
    constructor(public input: any) {}
  }
  return {
    S3Client: class {
      send = (...args: any[]) => mockSend(...args);
    },
    PutObjectCommand: class extends Cmd { readonly kind = 'put'; },
    HeadObjectCommand: class extends Cmd { readonly kind = 'head'; },
    GetObjectCommand: class extends Cmd { readonly kind = 'get'; },
    DeleteObjectsCommand: class extends Cmd { readonly kind = 'delete'; },
    ListObjectsV2Command: class extends Cmd { readonly kind = 'list'; },
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }));

import { uploadFile } from './storage.js';

const notFound = Object.assign(new Error('Not Found'), { name: 'NotFound' });
const outage = Object.assign(new Error('socket hang up'), { name: 'TimeoutError' });

// Regression coverage for issue #81. A token-purchase upload 500'd once and
// succeeded on retry, and nothing in the response or the caller said why: the
// upload path returned a bare boolean, never retried, and treated *any* failure
// of its existence check as "key is free".
describe('uploadFile', () => {
  beforeEach(() => {
    process.env.R2_ENDPOINT = 'https://example.r2.cloudflarestorage.com';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    mockSend.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries a transient failure and reports success', async () => {
    mockSend.mockRejectedValueOnce(outage).mockResolvedValueOnce({});

    const res = await uploadFile('reports', 'a/b.pdf', Buffer.from('x'));

    expect(res).toEqual({ ok: true });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget and says the store was unavailable', async () => {
    mockSend.mockRejectedValue(outage);

    const res = await uploadFile('reports', 'a/b.pdf', Buffer.from('x'));

    expect(res).toEqual({ ok: false, reason: 'unavailable', message: 'socket hang up' });
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('reports a taken key distinctly from an outage when upsert is false', async () => {
    // HEAD resolves → the object is already there.
    mockSend.mockResolvedValueOnce({});

    const res = await uploadFile('token-receipts', 'u/1.jpg', Buffer.from('x'), { upsert: false });

    expect(res).toMatchObject({ ok: false, reason: 'exists' });
    // Must not have gone on to overwrite it.
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('treats a 404 from the existence check as a free key and uploads', async () => {
    mockSend.mockRejectedValueOnce(notFound).mockResolvedValueOnce({});

    const res = await uploadFile('token-receipts', 'u/1.jpg', Buffer.from('x'), { upsert: false });

    expect(res).toEqual({ ok: true });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('does not mistake a failing existence check for a free key', async () => {
    // The old bare `catch {}` swallowed this and carried on as if the key were
    // absent, hiding a credential or network fault behind the next failure.
    mockSend.mockRejectedValueOnce(outage);

    const res = await uploadFile('token-receipts', 'u/1.jpg', Buffer.from('x'), { upsert: false });

    expect(res).toMatchObject({ ok: false, reason: 'unavailable' });
    // No PutObject attempted.
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
