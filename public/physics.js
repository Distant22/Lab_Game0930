export const WORLD = { width: 400, height: 640, x: 200, y: 535, rimY: 246, gravity: 1250, rimWidth: 82 };
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export function hoopX(elapsed) {
  return 200 + Math.sin(elapsed * 1.15) * 116 + Math.sin(elapsed * 2.1) * 16;
}
export function trajectory(dx, dy) {
  const vx = clamp(dx * 2.3, -390, 390);
  const vy = -(860 + clamp(-dy / 240, 0, 1) * 140);
  const crossing = (-vy + Math.sqrt(vy * vy - 2 * WORLD.gravity * (WORLD.y - WORLD.rimY))) / WORLD.gravity;
  return { vx, vy, crossing, lifetime: -2 * vy / WORLD.gravity + 0.10 };
}
export function position(shot, seconds) {
  return { x: WORLD.x + shot.vx * seconds, y: WORLD.y + shot.vy * seconds + WORLD.gravity * seconds * seconds / 2 };
}
export function resolveShot(dx, dy, startedAt, roundStart, endsAt) {
  const motion = trajectory(dx, dy);
  const crossingAt = startedAt + motion.crossing * 1000;
  const target = hoopX((crossingAt - roundStart) / 1000);
  const hit = crossingAt <= endsAt && Math.abs(position(motion, motion.crossing).x - target) <= WORLD.rimWidth / 2 - 11;
  return { ...motion, startedAt, crossingAt, hit };
}
