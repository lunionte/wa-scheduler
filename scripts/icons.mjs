import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// Rasterize the code-native clock icon without a graphics dependency.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function distanceToLine(x, y, ax, ay, bx, by) {
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
}
mkdirSync('public', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let alpha = 0, white = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + .5) / 4) / size * 24, py = (y + (sy + .5) / 4) / size * 24;
      const radius = Math.hypot(px - 12, py - 12);
      if (radius > 11.5) continue;
      alpha++;
      if (Math.abs(radius - 7.5) < .8 || distanceToLine(px, py, 12, 7.5, 12, 12) < .8 || distanceToLine(px, py, 12, 12, 15.5, 14) < .8) white++;
    }
    const index = y * (size * 4 + 1) + 1 + x * 4;
    const ratio = alpha ? white / alpha : 0;
    raw[index] = Math.round(255 * ratio);
    raw[index + 1] = Math.round(128 + 127 * ratio);
    raw[index + 2] = Math.round(105 + 150 * ratio);
    raw[index + 3] = Math.round(alpha / 16 * 255);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  writeFileSync(`public/icon-${size}.png`, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}
