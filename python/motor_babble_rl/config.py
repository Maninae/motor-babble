"""All physics, morphology, and reward constants for the Motor Babble RL environment.

One source of truth. `baby_env`, `morphology`, `milestones`, and `rendering` all import
from here. Values mirror the JS game's constants (../js/config.js, ../js/baby.js) so
the two halves rhyme, even though pymunk and planck are not step-identical simulators.

Units: SI. Meters, kilograms, seconds, radians. Positive x is toward the parent
(baby lies supine at spawn, head toward +x), positive y is up.
"""

from enum import Enum


# ---------------------------------------------------------------------------
# World and time
# ---------------------------------------------------------------------------

GRAVITY_Y: float = -9.8
PHYSICS_TIMESTEP: float = 1.0 / 60.0
FRAME_SKIP: int = 4                       # physics ticks per control step (15 Hz control)
EPISODE_SECONDS: float = 30.0
MAX_CONTROL_STEPS: int = int(EPISODE_SECONDS / (PHYSICS_TIMESTEP * FRAME_SKIP))


# ---------------------------------------------------------------------------
# Room geometry (mirrors js/config.js ROOM)
# ---------------------------------------------------------------------------

FLOOR_Y: float = 0.0
LEFT_WALL_X: float = -2.4
RIGHT_WALL_X: float = 2.2
CRIB_BAR_X: float = -1.55
CRIB_BAR_HALF_WIDTH: float = 0.025
CRIB_BAR_HALF_HEIGHT: float = 0.42
PARENT_ZONE_X: float = 1.35
SPAWN_X: float = -0.75
SPAWN_Y: float = 0.16

FLOOR_FRICTION: float = 0.9
WALL_FRICTION: float = 0.3
CRIB_FRICTION: float = 0.4


# ---------------------------------------------------------------------------
# Baby morphology
# ---------------------------------------------------------------------------

# Density is 2D kg/m^2, tuned so the whole ragdoll masses ~5 kg.
FLESH_DENSITY: float = 80.0
FLESH_FRICTION: float = 0.75
FLESH_RESTITUTION: float = 0.05
LINEAR_DAMPING: float = 0.05
ANGULAR_DAMPING: float = 0.1

# Half-extents for the torso box, plus a small round back bulge attached to the same
# body. The bulge is what turns the torso into a rocker: without it, a flat back on a
# flat floor cannot build the rocking oscillation the `rollover` task rewards. It is
# deliberately small so it does not kill scooting grip in the `crawl` task.
TORSO_HW: float = 0.105
TORSO_HH: float = 0.05
TORSO_BUMP_RADIUS: float = 0.065
TORSO_BUMP_OFFSET_Y: float = -0.005        # bump center in torso local frame (-y = back side, supine)

HEAD_RADIUS: float = 0.078
HEAD_OFFSET_X: float = 0.19                # head center relative to torso center
NECK_ANCHOR_OFFSET_X: float = 0.112        # neck hinge along the torso's +x side

ARM_PROX_HW: float = 0.052                 # upper arm half-length
ARM_PROX_HH: float = 0.02
ARM_DIST_HW: float = 0.048                 # forearm half-length
ARM_DIST_HH: float = 0.017

LEG_PROX_HW: float = 0.058                 # thigh half-length
LEG_PROX_HH: float = 0.026
LEG_DIST_HW: float = 0.052                 # shin half-length
LEG_DIST_HH: float = 0.02

# Shoulder/hip anchor offsets on the torso in its local frame.
SHOULDER_LOCAL_X: float = 0.085
HIP_LOCAL_X: float = -0.085
NEAR_SIDE_Y: float = 0.012                 # near side of the body (visual foreground)
FAR_SIDE_Y: float = -0.012                 # far side (behind)


# ---------------------------------------------------------------------------
# Motors and joint limits
# ---------------------------------------------------------------------------

MOTOR_MAX_RATE: float = 10.0               # rad/s; motor target rate = activation * this
ACTIVATION_DEAD_ZONE: float = 0.02         # |a| below this counts as "idle"
TONE_TORQUE: float = 0.18                  # passive resting joint friction
NECK_TORQUE: float = 0.25                  # passive neck strength (no active neck muscle)


class JointGroup(str, Enum):
    """Named groups of joints that share a torque cap."""

    SHOULDER = "shoulder"
    ELBOW = "elbow"
    HIP = "hip"
    KNEE = "knee"


# Torque cap per group (N * m). Motors are capped at this when firing at |a| = 1.
TORQUE_CAP_BY_GROUP: dict[JointGroup, float] = {
    JointGroup.SHOULDER: 4.5,
    JointGroup.ELBOW: 2.2,
    JointGroup.HIP: 7.0,
    JointGroup.KNEE: 4.5,
}

# Joint angle limits under our convention: limbs spawn pointing toward the feet (-x),
# and CCW rotation is positive. See js/baby.js for the derivation.
JOINT_LIMITS_BY_GROUP: dict[JointGroup, tuple[float, float]] = {
    JointGroup.SHOULDER: (-3.0, 0.6),
    JointGroup.ELBOW: (-2.4, 0.05),
    JointGroup.HIP: (-2.4, 0.7),
    JointGroup.KNEE: (-0.05, 2.4),
}

NECK_LIMIT_LOW: float = -0.7
NECK_LIMIT_HIGH: float = 0.7


class MuscleIndex(int, Enum):
    """The 8 controllable muscles, indexed as they appear in the action vector.

    Order matches js/config.js MUSCLES: near-side chain first (shoulder, elbow, hip,
    knee), then far-side chain. Do not reorder without updating the wiring scramble
    and every trained checkpoint.
    """

    SHOULDER_NEAR = 0
    ELBOW_NEAR = 1
    HIP_NEAR = 2
    KNEE_NEAR = 3
    SHOULDER_FAR = 4
    ELBOW_FAR = 5
    HIP_FAR = 6
    KNEE_FAR = 7


MUSCLE_COUNT: int = 8


# Per-muscle "flex sign": the motor rate direction that means "curl" for that joint.
# Elbow/shoulder/hip flex is a negative angular velocity in our frame; knee flex is
# positive. This is a rendering-frame convention lifted straight from the JS game.
FLEX_SIGN_BY_MUSCLE: dict[MuscleIndex, int] = {
    MuscleIndex.SHOULDER_NEAR: -1,
    MuscleIndex.ELBOW_NEAR: -1,
    MuscleIndex.HIP_NEAR: -1,
    MuscleIndex.KNEE_NEAR: 1,
    MuscleIndex.SHOULDER_FAR: -1,
    MuscleIndex.ELBOW_FAR: -1,
    MuscleIndex.HIP_FAR: -1,
    MuscleIndex.KNEE_FAR: 1,
}


GROUP_BY_MUSCLE: dict[MuscleIndex, JointGroup] = {
    MuscleIndex.SHOULDER_NEAR: JointGroup.SHOULDER,
    MuscleIndex.ELBOW_NEAR: JointGroup.ELBOW,
    MuscleIndex.HIP_NEAR: JointGroup.HIP,
    MuscleIndex.KNEE_NEAR: JointGroup.KNEE,
    MuscleIndex.SHOULDER_FAR: JointGroup.SHOULDER,
    MuscleIndex.ELBOW_FAR: JointGroup.ELBOW,
    MuscleIndex.HIP_FAR: JointGroup.HIP,
    MuscleIndex.KNEE_FAR: JointGroup.KNEE,
}


HUMAN_MUSCLE_LABELS: dict[MuscleIndex, str] = {
    MuscleIndex.SHOULDER_NEAR: "right shoulder",
    MuscleIndex.ELBOW_NEAR: "right elbow",
    MuscleIndex.HIP_NEAR: "right hip",
    MuscleIndex.KNEE_NEAR: "right knee",
    MuscleIndex.SHOULDER_FAR: "left shoulder",
    MuscleIndex.ELBOW_FAR: "left elbow",
    MuscleIndex.HIP_FAR: "left hip",
    MuscleIndex.KNEE_FAR: "left knee",
}


# ---------------------------------------------------------------------------
# Collision categories (pymunk ShapeFilter.categories / .mask)
# ---------------------------------------------------------------------------

class CollisionCategory(int, Enum):
    """Bitmask categories for pymunk ShapeFilter. Powers of two only."""

    WORLD = 0x0001                          # floor, walls, crib bar
    BODY = 0x0002                           # torso, legs (upper + lower)
    HEAD = 0x0004                           # the head circle
    HAND = 0x0008                           # forearm (arm distal segment)


# Which categories each fixture is allowed to hit. Limbs never tangle with each
# other; the one exception is hand-to-head, which is the whole point of the game.
BODY_MASK: int = CollisionCategory.WORLD
HEAD_MASK: int = CollisionCategory.WORLD | CollisionCategory.HAND
HAND_MASK: int = CollisionCategory.WORLD | CollisionCategory.HEAD
WORLD_MASK: int = CollisionCategory.BODY | CollisionCategory.HEAD | CollisionCategory.HAND


# ---------------------------------------------------------------------------
# Rewards, milestones, pain
# ---------------------------------------------------------------------------

class TaskName(str, Enum):
    """Reward-shaping regimes. Selectable via env kwarg."""

    CRAWL = "crawl"
    ROLLOVER = "rollover"


class MilestoneId(str, Enum):
    HAND_TO_FACE = "hand-to-face"
    ROLL_OVER = "roll-over"
    TUMMY_TIME = "tummy-time"
    SCOOT = "scoot"
    REACH_PARENT = "reach-parent"


MILESTONE_ORDER: tuple[MilestoneId, ...] = (
    MilestoneId.HAND_TO_FACE,
    MilestoneId.ROLL_OVER,
    MilestoneId.TUMMY_TIME,
    MilestoneId.SCOOT,
    MilestoneId.REACH_PARENT,
)

MILESTONE_HOLD_HAND_TO_FACE_SEC: float = 0.4
MILESTONE_HOLD_TUMMY_SEC: float = 1.5
MILESTONE_TUMMY_HEAD_LIFT: float = 0.10     # head above torso center to count as tummy time
MILESTONE_SCOOT_DISTANCE: float = 0.55
# After the scripted roll (`facing == 'down'`), prone means the torso has settled back
# near flat (|wrap_angle(torso)| < 0.8), so the baby is prone-and-still rather than
# still rocking sideways. Threshold widened from the pre-roll 0.7 because rock-to-roll
# now handles the flip, not a physically-impossible somersault detection.
PRONE_ANGLE_TOLERANCE: float = 0.8

# Reward shape (crawl task).
REWARD_VELOCITY_SCALE: float = 1.0          # coefficient on per-step torso x-displacement (m -> reward)
REWARD_MILESTONE_BONUS: float = 2.0         # one-time bonus per newly reached milestone (except REACH_PARENT)
# Energy penalty is expressed per SECOND per unit sum(a^2), and multiplied by the
# control step's wall time inside compute_reward. So the per-step magnitude scales
# with FRAME_SKIP * PHYSICS_TIMESTEP and stays consistent if either is retuned.
# At FRAME_SKIP=4 (control_dt ~ 0.0667 s) the per-step magnitude is 7.5e-3 * 0.0667
# ~ 5e-4 * sum(a^2), matching the pre-refactor per-step value.
REWARD_ENERGY_PENALTY: float = 7.5e-3       # per second per unit sum(a^2)
REWARD_PAIN_PENALTY: float = 1.0            # subtracted on a pain impact
REWARD_REACH_PARENT_BONUS: float = 10.0     # terminal payout for reaching the parent (exact, not stacked with milestone bonus)

# Reward shape (rollover task).
#
# An in-plane 180-degree flip is a somersault this morphology cannot do (evolutionary
# search on the JS side plateaued around 0.8 rad of tilt). The task instead rewards
# the honest physical skill: building a rocking oscillation. Peaks of the wrapped
# torso angle are tracked with an exponential decay so they act as short-memory
# "how hard did the baby just rock in each direction". Reward is the growth of
# (peak_pos - peak_neg); crossing ROLLOVER_AMPLITUDE_TO_ROLL yields the completion
# bonus and terminates the episode (mirroring the JS game, which scripts the actual
# flip once rocking crosses this threshold).
REWARD_ROLLOVER_AMPLITUDE_SCALE: float = 4.0
REWARD_ROLLOVER_COMPLETE_BONUS: float = 10.0
ROLLOVER_AMPLITUDE_TO_ROLL: float = 0.65
ROLLOVER_PEAK_DECAY_PER_PHYSICS_STEP: float = 0.995   # ~1.2 s memory at 60 Hz

# Pain thresholds (pymunk impulse magnitudes)
PAIN_CRIB_IMPULSE: float = 0.9
PAIN_HEAD_FLOOR_IMPULSE: float = 1.6
PAIN_GRACE_PERIOD_SEC: float = 1.0          # spawn-drop grace: no pain in the first second
PAIN_COOLDOWN_SEC: float = 1.5              # min gap between successive pain events


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

# Camera: window pixels per world meter, and world-space origin (baby feet region).
RENDER_PIXELS_PER_METER: float = 260.0
RENDER_WIDTH_PX: int = 1080
RENDER_HEIGHT_PX: int = 480
RENDER_CAMERA_X: float = 0.0                # world x at horizontal center of screen
RENDER_CAMERA_Y: float = 0.55               # world y at vertical center of screen
RENDER_FPS: int = 60                        # for the "human" render mode

# Pastel palette, matches the JS UI.
RENDER_PALETTE: dict[str, tuple[int, int, int]] = {
    "wall": (240, 217, 192),
    "floor": (201, 161, 122),
    "floor_edge": (176, 138, 99),
    "crib": (138, 111, 86),
    "onesie": (168, 216, 201),
    "onesie_shade": (143, 196, 179),
    "skin": (245, 201, 168),
    "skin_shade": (224, 176, 144),
    "hair": (107, 74, 53),
    "text": (58, 44, 34),
    "text_dim": (120, 100, 80),
    "milestone": (233, 138, 138),
    "pain_flash": (220, 60, 50),
}
