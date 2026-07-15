// Static nursery geometry: floor, walls, and the one crib bar that teaches the baby
// about pain. Every static fixture carries a userData.part tag the sim's contact
// handlers use to classify impacts.

import { COLLISION, ROOM } from './config.js';

const pl = globalThis.planck;

const BABY_MASK = COLLISION.BODY | COLLISION.HEAD | COLLISION.HAND;

export function createNursery(world) {
  /** Build static collision geometry. Returns named static bodies (render uses ROOM directly). */

  function staticBox(x, y, hw, hh, part, friction) {
    const body = world.createBody({ position: new pl.Vec2(x, y), userData: { part } });
    body.createFixture({
      shape: new pl.Box(hw, hh),
      friction,
      filterCategoryBits: COLLISION.WORLD,
      filterMaskBits: BABY_MASK,
      userData: { part },
    });
    return body;
  }

  const floorSpanHalf = (ROOM.RIGHT_WALL_X - ROOM.LEFT_WALL_X) / 2 + 0.5;
  const floorCenterX = (ROOM.RIGHT_WALL_X + ROOM.LEFT_WALL_X) / 2;

  // High-friction floor: scooting works by pushing against it.
  const floor = staticBox(floorCenterX, ROOM.FLOOR_Y - 0.1, floorSpanHalf, 0.1, 'floor', 0.9);
  const leftWall = staticBox(ROOM.LEFT_WALL_X - 0.05, 0.6, 0.05, 0.8, 'wall', 0.3);
  const rightWall = staticBox(ROOM.RIGHT_WALL_X + 0.05, 0.6, 0.05, 0.8, 'wall', 0.3);
  const cribBar = staticBox(
    ROOM.CRIB_BAR_X, ROOM.CRIB_BAR_HALF_HEIGHT,
    ROOM.CRIB_BAR_HALF_WIDTH, ROOM.CRIB_BAR_HALF_HEIGHT,
    'crib', 0.4,
  );

  return { floor, leftWall, rightWall, cribBar };
}
