// Tunable constants for Motor Babble. Physics uses meters/kg/seconds at Box2D-friendly sizes
// (a ~0.6 m baby in a ~4.5 m nursery). All gameplay feel lives here, not in the sim code.

export const PHYSICS = {
  GRAVITY_Y: -9.8,
  TIMESTEP: 1 / 60,
  VELOCITY_ITERATIONS: 8,
  POSITION_ITERATIONS: 3,
};

export const ROOM = {
  FLOOR_Y: 0,
  LEFT_WALL_X: -2.4,
  RIGHT_WALL_X: 2.2,
  CRIB_BAR_X: -1.55,
  CRIB_BAR_HALF_WIDTH: 0.025,
  CRIB_BAR_HALF_HEIGHT: 0.42,
  PARENT_ZONE_X: 1.35,
  SPAWN_X: -0.75,
  SPAWN_Y: 0.16,
};

// Collision categories: limbs never tangle with each other, but hands can bonk the head.
// A baby discovering that its own arm is the thing hitting its face IS the game.
export const COLLISION = {
  WORLD: 0x0001,
  BODY: 0x0002,
  HEAD: 0x0004,
  HAND: 0x0008,
};

// The 8 controllable muscles (joints). flexSign gives the motor direction that means "flex"
// under our convention (limbs spawn pointing toward the feet, CCW-positive angles).
export const MUSCLES = [
  { key: 'shoulderNear', label: 'right shoulder', group: 'shoulder', flexSign: -1 },
  { key: 'elbowNear',    label: 'right elbow',    group: 'elbow',    flexSign: -1 },
  { key: 'hipNear',      label: 'right hip',      group: 'hip',      flexSign: -1 },
  { key: 'kneeNear',     label: 'right knee',     group: 'knee',     flexSign: 1 },
  { key: 'shoulderFar',  label: 'left shoulder',  group: 'shoulder', flexSign: -1 },
  { key: 'elbowFar',     label: 'left elbow',     group: 'elbow',    flexSign: -1 },
  { key: 'hipFar',       label: 'left hip',       group: 'hip',      flexSign: -1 },
  { key: 'kneeFar',      label: 'left knee',      group: 'knee',     flexSign: 1 },
];

export const MUSCLE_COUNT = MUSCLES.length;

// Motor speeds/torques per joint group. Babies are jerky: fast twitch, modest torque.
export const MOTOR = {
  SPEED: 10,
  TORQUE: { shoulder: 4.5, elbow: 2.2, hip: 7.0, knee: 4.5 },
  TONE_TORQUE: 0.18,          // resting joint friction when no muscle fires
  NECK_TORQUE_BASE: 0.25,     // head control: grows with development
  NECK_TORQUE_PER_LEVEL: 0.45,
  STRENGTH_BASE: 0.8,         // myelination: muscles strengthen with development
  STRENGTH_PER_LEVEL: 0.06,
};

// Motor noise: young nervous system = every command comes out smeared. Anneals with milestones.
export const NOISE = {
  BASE: 0.5,
  TWITCH_CHANCE: 0.012,       // spontaneous random twitches per joint per step, scaled by noise
  TWITCH_SPEED: 6,
};

export const CALM = {
  START: 80,
  MAX: 100,
  REGEN_PER_SEC: 1.4,
  SOOTHE_PER_SEC: 7,          // hand resting on face: self-soothing
  PAIN_COST: 18,
  BONK_COST: 4,
  MELTDOWN_SECONDS: 2.5,
  MELTDOWN_RESET: 40,
};

export const PAIN = {
  CRIB_IMPULSE: 0.9,          // impulse threshold on the crib bar
  FLOOR_HEAD_IMPULSE: 1.6,    // face-planting the floor
  SELF_BONK_IMPULSE: 0.35,    // own hand to own face (not pain, just betrayal)
  COOLDOWN_SEC: 1.5,
  SCRAMBLE_SEC: 0.8,          // pain briefly scrambles motor control
};

// Vision develops from newborn blur (~20/400) toward clear as milestones land.
export const VISION = { MAX_BLUR_PX: 7 };

// Proprioception: seconds of cumulative use before a key's wiring is revealed on the key strip.
export const REVEAL = { SINGLE_SEC: 2.5, COMBO_SEC: 6 };

export const MILESTONE_DEFS = [
  { id: 'hand-to-face', title: 'Found your face', emoji: '🤚' },
  { id: 'roll-over',    title: 'Rolled over',     emoji: '🔄' },
  { id: 'tummy-time',   title: 'Tummy time champ', emoji: '💪' },
  { id: 'scoot',        title: 'First scoot',     emoji: '➡️' },
  { id: 'reach-parent', title: 'Reached your parent', emoji: '🏆' },
];

export const PALETTE = {
  wallTop: '#f6e7d7',
  wallBottom: '#f0d9c0',
  floor: '#c9a17a',
  floorEdge: '#b08a63',
  rug: '#e8b4b8',
  rugInner: '#f2cdd0',
  crib: '#8a6f56',
  onesie: '#a8d8c9',
  onesieShade: '#8fc4b3',
  skin: '#f5c9a8',
  skinShade: '#e0b090',
  hair: '#6b4a35',
  parentSkin: '#eebc95',
  parentHair: '#4a3428',
  painFlash: 'rgba(220, 60, 50, 0.5)',
};
