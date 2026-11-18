// Build-time only. Keep share cards readable by crawlers and below the image
// budget without changing their dimensions or relying on a remote encoder.
import sharp from 'sharp';

export async function compressSharePng(png: Buffer): Promise<Buffer> {
  const compressed = await sharp(png).png({
    palette: true,
    colours: 256,
    dither: 0,
    compressionLevel: 9,
    effort: 10,
  }).toBuffer();
  if (compressed.length > 300_000) {
    throw new Error(`Share PNG exceeds the 300000-byte budget: ${compressed.length} bytes`);
  }
  return compressed;
}
