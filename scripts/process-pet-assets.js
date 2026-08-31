'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'assets', 'cat');
const OUTPUT_DIR = path.join(ROOT, 'assets', 'cat-processed');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');
const ROOT_DEFAULT = path.join(ROOT, 'FORCOME_IP_FA_02_6_transparent.png');
const PADDING = 7;

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function distance(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function edgeBackgroundColor(data, width, height) {
  const samples = [];
  const add = (x, y) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] > 0 && data[i] > 210 && data[i + 1] > 210 && data[i + 2] > 210) samples.push([data[i], data[i + 1], data[i + 2]]);
  };
  for (let x = 0; x < width; x++) { add(x, 0); add(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { add(0, y); add(width - 1, y); }
  if (!samples.length) return null;
  return [0, 1, 2].map((channel) => Math.round(samples.reduce((sum, sample) => sum + sample[channel], 0) / samples.length));
}

function removeEdgeConnectedBackground(data, width, height) {
  const background = edgeBackgroundColor(data, width, height);
  if (!background) return 0;
  const visited = new Uint8Array(width * height);
  const queue = [];
  const eligible = (x, y) => {
    const i = (y * width + x) * 4;
    return data[i + 3] > 0 && data[i] > 205 && data[i + 1] > 205 && data[i + 2] > 205 && distance([data[i], data[i + 1], data[i + 2]], background) <= 42;
  };
  const add = (x, y) => {
    const index = y * width + x;
    if (!visited[index] && eligible(x, y)) { visited[index] = 1; queue.push(index); }
  };
  for (let x = 0; x < width; x++) { add(x, 0); add(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { add(0, y); add(width - 1, y); }
  let removed = 0;
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]; const x = index % width; const y = Math.floor(index / width); const i = index * 4;
    const pixelDistance = distance([data[i], data[i + 1], data[i + 2]], background);
    data[i + 3] = pixelDistance > 28 ? Math.round((42 - pixelDistance) / 14 * 255) : 0;
    removed++;
    if (x) add(x - 1, y); if (x + 1 < width) add(x + 1, y); if (y) add(x, y - 1); if (y + 1 < height) add(x, y + 1);
  }
  return removed;
}

function alphaBounds(data, width, height) {
  let left = width, top = height, right = -1, bottom = -1, opaque = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 16) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); opaque++; }
  }
  return right < left ? null : { left, top, width: right - left + 1, height: bottom - top + 1, opaque };
}

async function processImage(source, output, defaultAsset = false) {
  const inputHash = hashFile(source);
  const image = sharp(source).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const initialAlpha = alphaBounds(data, info.width, info.height);
  const hasTransparency = Boolean(initialAlpha && initialAlpha.opaque < info.width * info.height);
  const removedPixels = hasTransparency ? 0 : removeEdgeConnectedBackground(data, info.width, info.height);
  const bounds = alphaBounds(data, info.width, info.height);
  if (!bounds) throw new Error('无法识别角色内容边界');
  const left = Math.max(0, bounds.left - PADDING); const top = Math.max(0, bounds.top - PADDING);
  const right = Math.min(info.width, bounds.left + bounds.width + PADDING); const bottom = Math.min(info.height, bounds.top + bounds.height + PADDING);
  const outputData = Buffer.from(data);
  await sharp(outputData, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left, top, width: right - left, height: bottom - top })
    .png({ compressionLevel: 9 }).toFile(output);
  const final = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const finalBounds = alphaBounds(final.data, final.info.width, final.info.height);
  const corner = (x, y) => Array.from(final.data.subarray((y * final.info.width + x) * 4, (y * final.info.width + x) * 4 + 4));
  return {
    inputHash, source: path.relative(ROOT, source).replace(/\\/g, '/'), output: path.relative(ROOT, output).replace(/\\/g, '/'), default: defaultAsset,
    width: final.info.width, height: final.info.height,
    contentBounds: { left: finalBounds.left, top: finalBounds.top, width: finalBounds.width, height: finalBounds.height },
    transparency: { usable: true, transparentPixels: final.info.width * final.info.height - finalBounds.opaque, transparentRatio: Number(((final.info.width * final.info.height - finalBounds.opaque) / (final.info.width * final.info.height)).toFixed(4)), sourceHadAlpha: hasTransparency, removedEdgePixels: removedPixels, corners: [corner(0, 0), corner(final.info.width - 1, 0), corner(0, final.info.height - 1), corner(final.info.width - 1, final.info.height - 1)] }
  };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const previous = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : { assets: [] };
  const cached = new Map(previous.assets.map((asset) => [asset.source, asset]));
  const files = fs.readdirSync(SOURCE_DIR).filter((file) => path.extname(file).toLowerCase() === '.png').sort().map((file) => path.join(SOURCE_DIR, file));
  files.unshift(ROOT_DEFAULT);
  const assets = [];
  for (const source of files) {
    const defaultAsset = source === ROOT_DEFAULT;
    const outputName = defaultAsset ? '待机_000_康康熊透明站立.png' : path.basename(source);
    const output = path.join(OUTPUT_DIR, outputName);
    const key = path.relative(ROOT, source).replace(/\\/g, '/');
    const hash = hashFile(source); const existing = cached.get(key);
    if (existing?.inputHash === hash && fs.existsSync(output)) { assets.push(existing); continue; }
    assets.push(await processImage(source, output, defaultAsset));
  }
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ version: 1, padding: PADDING, assets }, null, 2));
  const converted = assets.filter((asset) => asset.transparency.removedEdgePixels > 0).length;
  console.log(`processed ${assets.length} assets (${converted} white backgrounds removed)`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
