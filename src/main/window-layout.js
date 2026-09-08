'use strict';

function intersectionSize(left, right) {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return { width, height };
}

function ensureWindowBoundsVisible(bounds, displays, primaryWorkArea) {
  if (!bounds || !primaryWorkArea) return bounds;
  const workAreas = (Array.isArray(displays) ? displays : [])
    .map((display) => display?.workArea || display?.bounds)
    .filter((area) => area && [area.x, area.y, area.width, area.height].every(Number.isFinite));
  const visible = workAreas.some((area) => {
    const overlap = intersectionSize(bounds, area);
    return overlap.width >= Math.min(160, bounds.width) && overlap.height >= Math.min(120, bounds.height);
  });
  if (visible) return { ...bounds };

  const width = Math.min(bounds.width, primaryWorkArea.width);
  const height = Math.min(bounds.height, primaryWorkArea.height);
  return {
    x: Math.round(primaryWorkArea.x + (primaryWorkArea.width - width) / 2),
    y: Math.round(primaryWorkArea.y + (primaryWorkArea.height - height) / 2),
    width,
    height
  };
}

module.exports = { ensureWindowBoundsVisible, intersectionSize };
