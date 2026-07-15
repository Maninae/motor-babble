// Ragdoll construction: a six-week-old in Box2D, lying supine, head toward the parent
// (+x). Limbs spawn pointing toward the feet (-x) and never collide with each other,
// with one deliberate exception: hands can hit the head. That exception is the game.
//
// Runs headless (no DOM): the evolution mode builds throwaway babies off-screen.

import { COLLISION, MOTOR, MUSCLES, ROOM } from './config.js';

const pl = globalThis.planck;

const FLESH_DENSITY = 80;      // 2D kg/m^2 tuned so the whole baby lands ~5 kg
const FLESH_FRICTION = 0.75;

// Joint angle limits under our convention (CCW-positive, limbs at angle 0 = toward feet).
// Keys MUST be lowerAngle/upperAngle (planck's names): these spread straight into the
// joint def. Wrong keys leave limits undefined, which planck treats as 0/0, welding the
// joint shut while the motor silently fights a constraint it can never win.
const JOINT_LIMITS = {
  shoulder: { lowerAngle: -3.0, upperAngle: 0.6 },
  elbow:    { lowerAngle: -2.4, upperAngle: 0.05 },
  hip:      { lowerAngle: -2.4, upperAngle: 0.7 },
  knee:     { lowerAngle: -0.05, upperAngle: 2.4 },
};

function bodyFixtureDef(shape, category, mask, part) {
  return {
    shape,
    density: FLESH_DENSITY,
    friction: FLESH_FRICTION,
    restitution: 0.05,
    filterCategoryBits: category,
    filterMaskBits: mask,
    userData: { part },
  };
}

export function createBaby(world) {
  /** Build the ragdoll at the spawn point. Returns { parts, joints, muscleJoints, setNeckStrength }.
   *
   * - parts: named dynamic bodies for rendering and milestone checks
   * - muscleJoints: array aligned with config.MUSCLES (index i drives muscle i)
   * - hands are the forearm bodies (category HAND) so hand-face contact is detectable
   */
  const sx = ROOM.SPAWN_X;
  const sy = ROOM.SPAWN_Y;

  function limbBody(x, y, part) {
    return world.createBody({ type: 'dynamic', position: new pl.Vec2(x, y), linearDamping: 0.05, angularDamping: 0.1, userData: { part } });
  }

  // Torso and head. The rounded back bulge is load-bearing for gameplay: a flat box
  // torso is too statically stable to ever tip prone (verified by evolutionary search,
  // which plateaued at 0.6 rad). Babies roll by rocking on a round back; so does ours.
  const torso = limbBody(sx, sy, 'torso');
  torso.createFixture(bodyFixtureDef(new pl.Box(0.105, 0.05), COLLISION.BODY, COLLISION.WORLD, 'torso'));
  torso.createFixture(bodyFixtureDef(new pl.Circle(new pl.Vec2(0, -0.02), 0.085), COLLISION.BODY, COLLISION.WORLD, 'torso'));

  const head = limbBody(sx + 0.19, sy, 'head');
  head.createFixture(bodyFixtureDef(new pl.Circle(0.078), COLLISION.HEAD, COLLISION.WORLD | COLLISION.HAND, 'head'));

  const neckAnchor = new pl.Vec2(sx + 0.112, sy);
  const neck = world.createJoint(new pl.RevoluteJoint({
    enableLimit: true, lowerAngle: -0.7, upperAngle: 0.7,
    enableMotor: true, motorSpeed: 0, maxMotorTorque: MOTOR.NECK_TORQUE_BASE,
  }, torso, head, neckAnchor));

  // One limb chain: (proximal segment, distal segment) hinged at an anchor on the torso.
  function buildLimb(anchorLocal, proximal, distal, groupProx, groupDist, distCategory, distMask, tag) {
    const anchor = new pl.Vec2(sx + anchorLocal.x, sy + anchorLocal.y);

    const prox = limbBody(anchor.x - proximal.hw, anchor.y, `${tag}Prox`);
    prox.createFixture(bodyFixtureDef(new pl.Box(proximal.hw, proximal.hh), COLLISION.BODY, COLLISION.WORLD, `${tag}Prox`));

    const distAnchor = new pl.Vec2(anchor.x - proximal.hw * 2, anchor.y);
    const dist = limbBody(distAnchor.x - distal.hw, distAnchor.y, `${tag}Dist`);
    dist.createFixture(bodyFixtureDef(new pl.Box(distal.hw, distal.hh), distCategory, distMask, `${tag}Dist`));

    const proxJoint = world.createJoint(new pl.RevoluteJoint({
      enableLimit: true, ...JOINT_LIMITS[groupProx],
      enableMotor: true, motorSpeed: 0, maxMotorTorque: MOTOR.TONE_TORQUE,
    }, torso, prox, anchor));

    const distJoint = world.createJoint(new pl.RevoluteJoint({
      enableLimit: true, ...JOINT_LIMITS[groupDist],
      enableMotor: true, motorSpeed: 0, maxMotorTorque: MOTOR.TONE_TORQUE,
    }, prox, dist, distAnchor));

    return { prox, dist, proxJoint, distJoint };
  }

  const armGeom = { proximal: { hw: 0.052, hh: 0.02 }, distal: { hw: 0.048, hh: 0.017 } };
  const legGeom = { proximal: { hw: 0.058, hh: 0.026 }, distal: { hw: 0.052, hh: 0.02 } };
  const handMask = COLLISION.WORLD | COLLISION.HEAD;

  const armNear = buildLimb({ x: 0.085, y: 0.012 }, armGeom.proximal, armGeom.distal, 'shoulder', 'elbow', COLLISION.HAND, handMask, 'armNear');
  const armFar  = buildLimb({ x: 0.085, y: -0.012 }, armGeom.proximal, armGeom.distal, 'shoulder', 'elbow', COLLISION.HAND, handMask, 'armFar');
  const legNear = buildLimb({ x: -0.085, y: 0.012 }, legGeom.proximal, legGeom.distal, 'hip', 'knee', COLLISION.BODY, COLLISION.WORLD, 'legNear');
  const legFar  = buildLimb({ x: -0.085, y: -0.012 }, legGeom.proximal, legGeom.distal, 'hip', 'knee', COLLISION.BODY, COLLISION.WORLD, 'legFar');

  // muscleJoints[i] must line up with config.MUSCLES[i].
  const muscleJoints = [
    armNear.proxJoint,  // shoulderNear
    armNear.distJoint,  // elbowNear
    legNear.proxJoint,  // hipNear
    legNear.distJoint,  // kneeNear
    armFar.proxJoint,   // shoulderFar
    armFar.distJoint,   // elbowFar
    legFar.proxJoint,   // hipFar
    legFar.distJoint,   // kneeFar
  ];

  const parts = {
    torso, head,
    armNearProx: armNear.prox, armNearDist: armNear.dist,
    armFarProx: armFar.prox, armFarDist: armFar.dist,
    legNearProx: legNear.prox, legNearDist: legNear.dist,
    legFarProx: legFar.prox, legFarDist: legFar.dist,
  };

  function setNeckStrength(torque) {
    neck.setMaxMotorTorque(torque);
    neck.setMotorSpeed(0);
  }

  function applyMuscleActivations(activations, strengthScale) {
    /** activations: Float[-1..1] per config.MUSCLES index. Idle joints keep resting tone. */
    for (let i = 0; i < muscleJoints.length; i++) {
      const joint = muscleJoints[i];
      const spec = MUSCLES[i];
      const a = activations[i];
      if (Math.abs(a) < 0.02) {
        joint.setMotorSpeed(0);
        joint.setMaxMotorTorque(MOTOR.TONE_TORQUE);
      } else {
        joint.setMotorSpeed(a * spec.flexSign * MOTOR.SPEED);
        joint.setMaxMotorTorque(MOTOR.TORQUE[spec.group] * strengthScale * Math.abs(a));
      }
    }
  }

  return { parts, muscleJoints, neck, setNeckStrength, applyMuscleActivations };
}
