import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const src = "E:/projects/grok-desktop/src/assets/super-grok-logo.png";
const dest = "E:/projects/grok-desktop/src/assets/grok-mark.png";
const bytes = readFileSync(src);
if (bytes[0] !== 0x89) throw new Error("not a png");
const width = bytes.readUInt32BE(16);
const height = bytes.readUInt32BE(20);
const bitDepth = bytes[24];
const colorType = bytes[25];
if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
  throw new Error(`unsupported png ${bitDepth}/${colorType}`);
}
const channels = colorType === 6 ? 4 : 3;

const chunks = [];
let offset = 8;
while (offset + 8 <= bytes.length) {
  const length = bytes.readUInt32BE(offset);
  const type = bytes.toString("ascii", offset + 4, offset + 8);
  const data = bytes.subarray(offset + 8, offset + 8 + length);
  if (type === "IDAT") chunks.push(data);
  if (type === "IEND") break;
  offset += 12 + length;
}
const raw = inflateSync(Buffer.concat(chunks));
const stride = width * channels;
const rowSize = stride + 1;
const pixels = Buffer.alloc(width * height * 4);
for (let y = 0; y < height; y += 1) {
  const filter = raw[y * rowSize];
  if (filter !== 0) throw new Error(`png filter ${filter}`);
  for (let x = 0; x < width; x += 1) {
    const i = y * rowSize + 1 + x * channels;
    const o = (y * width + x) * 4;
    pixels[o] = raw[i];
    pixels[o + 1] = raw[i + 1];
    pixels[o + 2] = raw[i + 2];
    pixels[o + 3] = channels === 4 ? raw[i + 3] : 255;
  }
}

const isInk = (x, y) => {
  const o = (y * width + x) * 4;
  return pixels[o] < 80 && pixels[o + 1] < 80 && pixels[o + 2] < 80 && pixels[o + 3] > 40;
};

let minX = width;
let minY = height;
let maxX = 0;
let maxY = 0;
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    if (!isInk(x, y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
}
if (maxX <= minX) throw new Error("no ink found");

const columnHasInk = (x) => {
  for (let y = minY; y <= maxY; y += 1) {
    if (isInk(x, y)) return true;
  }
  return false;
};
let gap = 0;
let markMaxX = minX;
for (let x = minX; x <= maxX; x += 1) {
  if (columnHasInk(x)) {
    markMaxX = x;
    gap = 0;
    continue;
  }
  gap += 1;
  if (gap >= 6 && markMaxX - minX > 20) break;
}
const pad = 6;
minX = Math.max(0, minX - pad);
minY = Math.max(0, minY - pad);
maxX = Math.min(width - 1, markMaxX + pad);
maxY = Math.min(height - 1, maxY + pad);
const size = Math.max(maxX - minX + 1, maxY - minY + 1);
const outX = minX - Math.floor((size - (maxX - minX + 1)) / 2);
const outY = minY - Math.floor((size - (maxY - minY + 1)) / 2);

const out = Buffer.alloc(size * size * 4, 0);
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const sx = outX + x;
    const sy = outY + y;
    const o = (y * size + x) * 4;
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
      out[o + 3] = 0;
      continue;
    }
    const i = (sy * width + sx) * 4;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    const ink = r < 80 && g < 80 && b < 80 && a > 40;
    out[o] = 0;
    out[o + 1] = 0;
    out[o + 2] = 0;
    out[o + 3] = ink ? 255 : 0;
  }
}

const rawOut = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y += 1) {
  rawOut[y * (size * 4 + 1)] = 0;
  out.copy(rawOut, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      const take = crc & 1;
      crc = crc >>> 1;
      if (take) crc ^= 0xedb88320;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const outChunk = Buffer.alloc(12 + data.length);
  outChunk.writeUInt32BE(data.length, 0);
  body.copy(outChunk, 4);
  outChunk.writeUInt32BE(crc32(body), 8 + data.length);
  return outChunk;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", (await import("node:zlib")).deflateSync(rawOut)),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(dest, png);
console.log(`cropped ${width}x${height} -> ${size}x${size} at ${minX},${minY}-${maxX},${maxY}`);
