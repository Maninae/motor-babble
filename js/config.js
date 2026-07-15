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
  // Myelination is the win gate: at dev 0 the best gait crawls ~6 mm/s (a newborn
  // cannot cross a room, correctly), at dev 3 it jumps to ~80 mm/s. Milestones are
  // how you earn the muscles that make the parent reachable.
  STRENGTH_BASE: 0.8,
  STRENGTH_PER_LEVEL: 0.12,
};

// Motor noise: young nervous system = every command comes out smeared. Anneals with milestones.
// Tuned via the headless gait lab (scratchpad experiment, 2-key square-wave gaits):
// BASE 0.5 drowned rhythmic input (best human-plausible gait 3.7 mm/s, room
// uncrossable); 0.3 keeps newborn comedy while letting rhythm accumulate force.
export const NOISE = {
  BASE: 0.3,
  SMEAR_SCALE: 0.6,           // fraction of the noise level mixed into active commands
  TWITCH_CHANCE: 0.012,       // spontaneous random twitches per joint per step, scaled by noise
  TWITCH_FLOOR: 0.3,          // twitches never fully vanish, even fully developed
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
  BONK_COOLDOWN_SEC: 0.45,    // a bouncy hand-face impact is one bonk, not five
  SCRAMBLE_SEC: 0.8,          // pain briefly scrambles motor control
  SPAWN_GRACE_SEC: 1.0,       // the spawn drop is not the world's fault
};

// Rock-to-roll: rolling over is triggered by building a rocking oscillation, not by
// physically somersaulting (impossible in a sagittal view, for us and for babies).
// AMPLITUDE_TO_ROLL is calibrated to ~2/3 of what evolutionary search can reach.
export const ROCK = {
  AMPLITUDE_TO_ROLL: 0.65,
  PEAK_DECAY: 0.995,        // per-step decay of tracked rocking peaks (~1.2 s memory)
  ROLL_ANIM_SEC: 0.7,
};

// Vision develops from newborn blur (~20/400) toward clear as milestones land.
// Kept modest so the scene stays legible even at level 0; the crisp foreground
// (baby, floor line, parent's face) is what a real newborn sees best.
export const VISION = { MAX_BLUR_PX: 3.5 };

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
