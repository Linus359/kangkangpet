'use strict';

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function nearestDesktopEdge(bounds, workArea) {
  const distances = [
    ['left', Math.abs(bounds.x - workArea.x)],
    ['right', Math.abs(workArea.x + workArea.width - (bounds.x + bounds.width))]
  ];
  return distances.reduce((closest, candidate) => candidate[1] < closest[1] ? candidate : closest)[0];
}

function edgeHeadBounds(edge, bounds, workArea, size) {
  const headSize = Math.max(48, Math.round(size));
  const centerX = bounds.x + bounds.width / 2;
  const maxX = workArea.x + Math.max(0, workArea.width - headSize);
  const maxY = workArea.y + Math.max(0, workArea.height - headSize);
  const x = clamp(Math.round(centerX - headSize / 2), workArea.x, maxX);
  const y = clamp(Math.round(bounds.y + bounds.height / 2 - headSize / 2), workArea.y, maxY);

  if (edge === 'left') return { x: workArea.x, y, width: headSize, height: headSize };
  if (edge === 'right') return { x: maxX, y, width: headSize, height: headSize };
  return { x, y, width: headSize, height: headSize };
}

function restoredPetBounds(edge, headBounds, petBounds, workArea) {
  const maxX = workArea.x + Math.max(0, workArea.width - petBounds.width);
  const maxY = workArea.y + Math.max(0, workArea.height - petBounds.height);
  const centeredX = Math.round(headBounds.x + headBounds.width / 2 - petBounds.width / 2);
  const centeredY = Math.round(headBounds.y + headBounds.height / 2 - petBounds.height / 2);

  if (edge === 'left') return { x: workArea.x, y: clamp(centeredY, workArea.y, maxY), width: petBounds.width, height: petBounds.height };
  if (edge === 'right') return { x: maxX, y: clamp(centeredY, workArea.y, maxY), width: petBounds.width, height: petBounds.height };
  return { x: edge === 'left' ? workArea.x : maxX, y: clamp(centeredY, workArea.y, maxY), width: petBounds.width, height: petBounds.height };
}

module.exports = { edgeHeadBounds, nearestDesktopEdge, restoredPetBounds };
