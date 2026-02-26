export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(current, target, alpha) {
  return current + (target - current) * alpha;
}

export function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function normalizedDistance(landmarks, aIdx, bIdx, scale) {
  const a = landmarks[aIdx];
  const b = landmarks[bIdx];
  return Math.hypot(a.x - b.x, a.y - b.y) / Math.max(scale, 1e-5);
}