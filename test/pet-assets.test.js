'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'cat-processed', 'manifest.json'), 'utf8'));

test('processed asset manifest contains transparent, cropped runnable assets', async () => {
  assert.equal(manifest.assets.length, 107);
  for (const asset of manifest.assets) {
    const output = path.join(root, asset.output);
    assert.equal(fs.existsSync(output), true, asset.output);
    assert.equal(asset.transparency.usable, true);
    assert.equal(asset.contentBounds.width > 0 && asset.contentBounds.height > 0, true);
    assert.equal(asset.transparency.corners.every((pixel) => pixel[3] === 0), true, asset.output);
  }
});

test('edge-connected cleanup keeps opaque, light-colored character details', async () => {
  const output = path.join(root, 'assets', 'cat-processed', '待机_001_站立微笑.png');
  const { data, info } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let visibleLightPixels = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    if (data[index + 3] > 200 && data[index] > 225 && data[index + 1] > 225 && data[index + 2] > 225) visibleLightPixels++;
  }
  assert.equal(visibleLightPixels > 40, true);
});
