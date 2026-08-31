'use strict';

const DEFAULT_PET_SIZE = 120;
const MIN_PET_SIZE = 72;
const MAX_PET_SIZE = 260;
const PET_SAFE_PADDING = 8;
const CONTROL_SIZE = 26;
const CONTROL_GAP = 5;
const CONTROL_EDGE_GAP = 8;
const SETTINGS_SIZE = 26;
const CONTROL_SIDE_PADDING = 8;
const BUBBLE_HORIZONTAL_GUTTER = 12;
const MENU_HORIZONTAL_GUTTER = 32;
const BUBBLE_MAX_WIDTH = 240;
const BUBBLE_MAX_HEIGHT = 300;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizePetSize(value, fallback = DEFAULT_PET_SIZE) {
  return clamp(Math.round(Number(value) || fallback), MIN_PET_SIZE, MAX_PET_SIZE);
}

function assetAspect(asset) {
  const width = Number(asset?.contentBounds?.width || asset?.width || 1);
  const height = Number(asset?.contentBounds?.height || asset?.height || 1);
  return clamp(width / Math.max(height, 1), 0.45, 2.4);
}

function getPetBounds(size, asset, bubble = null, interactionButtonCount = 4, menu = null, stableAspect = null, reserveBubbleSpace = false) {
  const visualHeight = normalizePetSize(size);
  const baseWidth = Math.ceil(visualHeight * assetAspect(asset)) + PET_SAFE_PADDING * 2;
  const windowWidth = Math.max(
    baseWidth,
    Math.ceil(visualHeight * clamp(Number(stableAspect) || assetAspect(asset), 0.45, 2.4)) + PET_SAFE_PADDING * 2
  );
  const baseHeight = visualHeight + PET_SAFE_PADDING * 2;
  const buttonCount = Math.max(0, Math.round(Number(interactionButtonCount) || 0));
  const buttonsWidth = buttonCount * CONTROL_SIZE + Math.max(0, buttonCount - 1) * CONTROL_GAP + (buttonCount ? CONTROL_GAP : 0) + SETTINGS_SIZE;
  const controlsWidth = Math.max(windowWidth, buttonsWidth) + CONTROL_SIDE_PADDING * 2;
  const controlsHeight = CONTROL_EDGE_GAP + CONTROL_SIZE + CONTROL_EDGE_GAP;
  const bubbleVisible = Boolean(bubble?.visible || reserveBubbleSpace);
  if (!bubbleVisible && !menu?.visible) {
    return {
      width: controlsWidth,
      height: baseHeight + controlsHeight,
      petLeft: Math.round((controlsWidth - baseWidth) / 2) + PET_SAFE_PADDING,
      petTop: PET_SAFE_PADDING
    };
  }

  const bubbleWidth = bubbleVisible
    ? reserveBubbleSpace ? BUBBLE_MAX_WIDTH : clamp(Math.round(bubble.width || 200), 140, BUBBLE_MAX_WIDTH)
    : 0;
  const bubbleHeight = bubbleVisible
    ? reserveBubbleSpace ? BUBBLE_MAX_HEIGHT : clamp(Math.round(bubble.height || 48), 36, BUBBLE_MAX_HEIGHT)
    : 0;
  const menuWidth = menu?.visible ? clamp(Math.round(menu.width || 140), 140, 260) : 0;
  const menuHeight = menu?.visible && menu.reserveVertical ? clamp(Math.round(menu.height || 36), 36, 300) + 12 : 0;
  const width = Math.max(controlsWidth, bubbleWidth + BUBBLE_HORIZONTAL_GUTTER, menuWidth + MENU_HORIZONTAL_GUTTER);
  const verticalOverlap = bubbleHeight || menuHeight ? 8 : 0;
  return {
    width,
    height: baseHeight + controlsHeight + bubbleHeight + menuHeight - verticalOverlap,
    petLeft: Math.round((width - baseWidth) / 2) + PET_SAFE_PADDING,
    petTop: bubbleHeight + menuHeight - verticalOverlap + PET_SAFE_PADDING
  };
}

function defaultPetPosition(workArea, bounds, { right = 24, bottom = 16 } = {}) {
  return {
    x: Math.round(workArea.x + workArea.width - bounds.width - right),
    y: Math.round(workArea.y + workArea.height - bounds.height - bottom)
  };
}

function clampPetPosition(position, bounds, workArea) {
  return {
    x: clamp(Math.round(position.x), workArea.x, workArea.x + workArea.width - bounds.width),
    y: clamp(Math.round(position.y), workArea.y, workArea.y + workArea.height - bounds.height)
  };
}

function chooseDefaultAsset(assets) {
  const enabled = (Array.isArray(assets) ? assets : []).filter((asset) => asset?.enabled !== false && asset?.transparency?.usable !== false);
  return enabled.find((asset) => asset.default === true)
    || enabled.find((asset) => asset.actionKey === 'idle')
    || enabled.find((asset) => asset.actionKey === 'greet')
    || enabled[0]
    || null;
}

module.exports = { DEFAULT_PET_SIZE, MIN_PET_SIZE, MAX_PET_SIZE, PET_SAFE_PADDING, normalizePetSize, getPetBounds, defaultPetPosition, clampPetPosition, chooseDefaultAsset };
