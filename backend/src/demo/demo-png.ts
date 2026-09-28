import { deflateSync } from 'node:zlib';

/**
 * Tiny dependency-free PNG writer (8-bit RGB). Demo seed only: draws
 * placeholder photos and a signature scribble so visit capture is demoable
 * end to end without bundling binary assets.
 */

/* CRC-32 (ISO 3309), needed for PNG chunk checksums. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, checksum]);
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Raw RGB pixels → a valid PNG buffer. */
export function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[offset++] = clamp(r);
      raw[offset++] = clamp(g);
      raw[offset++] = clamp(b);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A dark-blue pen scribble on white, like a captured customer signature. */
export function demoSignaturePng(seed = 1): Buffer {
  const width = 480;
  const height = 140;
  return encodePng(width, height, (x, y) => {
    const t = x / width;
    const stroke1 =
      height * 0.55 + Math.sin(t * 9 + seed) * 22 + Math.sin(t * 23 + seed * 2) * 9;
    const stroke2 = height * 0.42 + Math.sin(t * 7 + seed * 3 + 1.4) * 26;
    const distance = Math.min(Math.abs(y - stroke1), Math.abs(y - stroke2));
    return distance < 2.4 ? [22, 38, 120] : [255, 255, 255];
  });
}

/** A muted gradient "photo" with a soft machine-like silhouette. */
export function demoPhotoPng(seed = 1): Buffer {
  const width = 640;
  const height = 480;
  return encodePng(width, height, (x, y) => {
    const noise = Math.sin(x * 0.11 + seed) * Math.cos(y * 0.13 + seed * 2);
    let r = 96 + (y / height) * 60 + noise * 14;
    let g = 104 + (y / height) * 52 + noise * 12;
    let b = 112 + (y / height) * 44 + noise * 10;
    const inBody = x > width * 0.3 && x < width * 0.72 && y > height * 0.34 && y < height * 0.8;
    const inHopper = x > width * 0.38 && x < width * 0.64 && y > height * 0.18 && y < height * 0.36;
    if (inBody || inHopper) {
      r *= 0.45;
      g *= 0.47;
      b *= 0.5;
    }
    return [r, g, b];
  });
}
