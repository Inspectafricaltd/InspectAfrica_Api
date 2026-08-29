import sharp from 'sharp';
import { logger } from './logger.js';

interface ResizeOptions {
  maxWidth: number;
  maxHeight?: number;
  quality: number;
}

// Report photos come straight from phone cameras (2-5MB, near-lossless) and
// were previously embedded byte-for-byte into the PDF -- this is what pushed
// reports to 40-100MB. Resizing to the actual print/display size before
// embedding is the single biggest lever on report file size.
export async function resizeForReport(buffer: Buffer, opts: ResizeOptions): Promise<Buffer> {
  try {
    return await sharp(buffer)
      .rotate() // honor EXIF orientation before resizing
      .resize({ width: opts.maxWidth, height: opts.maxHeight, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: opts.quality, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    logger.error({ err }, 'imageProcessing: resize failed, falling back to original buffer');
    return buffer;
  }
}

// Chromium's print-to-PDF pipeline re-rasterizes/re-encodes every embedded
// <img> at its own internal quality rather than passing our encoded JPEG
// bytes through -- so our `quality` setting barely affects final PDF size,
// but the pixel dimensions we resize to are respected 1:1 and dominate the
// output size. Targets below match actual on-page display size (~271px for
// a 2-up finding photo, ~552px full-width cover photo) at a generous ~2x for
// print sharpness -- oversizing past that inflates the PDF for no visible
// benefit since Chromium's own re-encode absorbs any extra detail.
export function processCoverPhoto(buffer: Buffer): Promise<Buffer> {
  return resizeForReport(buffer, { maxWidth: 900, quality: 78 });
}

export function processFindingPhoto(buffer: Buffer): Promise<Buffer> {
  return resizeForReport(buffer, { maxWidth: 550, quality: 75 });
}

export async function processSignature(buffer: Buffer): Promise<Buffer> {
  if (buffer.length < 50_000) return buffer;
  try {
    return await sharp(buffer)
      .resize({ width: 400, withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch (err) {
    logger.error({ err }, 'imageProcessing: signature resize failed, falling back to original buffer');
    return buffer;
  }
}
