import { demoPhotoPng, demoSignaturePng, encodePng } from './demo-png';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function ihdrDimensions(png: Buffer): { width: number; height: number } {
  // Signature (8) + length (4) + "IHDR" (4), then width/height as uint32.
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe('demo-png', () => {
  it('writes a valid PNG with the requested dimensions', () => {
    const png = encodePng(3, 2, (x, y) => [x * 80, y * 120, 9]);
    expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(ihdrDimensions(png)).toEqual({ width: 3, height: 2 });
  });

  it('draws a signature scribble on a white canvas', () => {
    const png = demoSignaturePng(2);
    expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(ihdrDimensions(png)).toEqual({ width: 480, height: 140 });
    // Not a blank image: the scribble is darker than the background somewhere.
    expect(demoSignaturePng(1).equals(demoSignaturePng(2))).toBe(false);
  });

  it('draws a photo placeholder', () => {
    const png = demoPhotoPng(3);
    expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(ihdrDimensions(png)).toEqual({ width: 640, height: 480 });
  });
});
