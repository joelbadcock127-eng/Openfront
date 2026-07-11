/**
 * Minimal dependency-free PNG writer (8-bit RGB, no filtering) for pipeline
 * diagnostic previews. Not used at runtime.
 */
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crcBuf = Buffer.alloc(4);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
  crcBuf.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([head, body, crcBuf]);
}

/** Encode an RGB pixel buffer (width*height*3) as a PNG file buffer. */
export function encodePng(
  width: number,
  height: number,
  rgb: Uint8Array,
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  // compression/filter/interlace all 0
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    // filter byte 0 per scanline
    rgb
      .subarray(y * width * 3, (y + 1) * width * 3)
      .forEach((v, i) => (raw[y * (width * 3 + 1) + 1 + i] = v));
  }
  const idat = deflateSync(raw, { level: 6 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
