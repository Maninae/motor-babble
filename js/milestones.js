// Milestone detection: the developmental ladder from "found your face" to "reached
// your parent". Pure state-machine over sim snapshots; no physics, no DOM.

import { MILESTONE_DEFS, ROOM } from './config.js';

const HAND_TO_FACE_HOLD_SEC = 0.4;
const TUMMY_HEAD_LIFT = 0.10;        // head center this far above torso center while prone
const TUMMY_HOLD_SEC = 1.5;
const SCOOT_DISTANCE = 0.55;

export function wrapAngle(angle) {
  /** Wrap any accumulated Box2D angle into [-pi, pi]. */
  let a = angle % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function createMilestoneTracker() {
  /** update(dt, snapshot) -> array of newly achieved milestone ids (usually empty).
   *
   * snapshot: { prone, justRolled, torsoX, torsoY, headY, handOnFace }
   * prone/justRolled come from the sim's rock-to-roll facing state.
   * Milestones can land in any order except tummy-time (needs roll-over first).
   */
  const achieved = new Set();
  let handTimer = 0;
  let tummyTimer = 0;

  function update(dt, s) {
    const fresh = [];

    handTimer = s.handOnFace ? handTimer + dt : 0;
    tummyTimer = (s.prone && s.headY > s.torsoY + TUMMY_HEAD_LIFT) ? tummyTimer + dt : 0;

    function landIf(condition, id) {
      if (condition && !achieved.has(id)) {
        achieved.add(id);
        fresh.push(id);
      }
    }

    landIf(handTimer >= HAND_TO_FACE_HOLD_SEC, 'hand-to-face');
    landIf(s.justRolled, 'roll-over');
    landIf(achieved.has('roll-over') && tummyTimer >= TUMMY_HOLD_SEC, 'tummy-time');
    // Forward only: drifting backward into the crib is not a scoot, it is a mistake.
    landIf(s.torsoX - ROOM.SPAWN_X >= SCOOT_DISTANCE, 'scoot');
    landIf(s.torsoX >= ROOM.PARENT_ZONE_X, 'reach-parent');

    return fresh;
  }

  return {
    update,
    achieved,
    get level() { return achieved.size; },
    get total() { return MILESTONE_DEFS.length; },
  };
}
