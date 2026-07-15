"""Build the ragdoll baby and the static nursery inside a pymunk space.

The ragdoll is a 2D side-view of a six-week-old lying supine, head toward +x
(where the parent is). Every dynamic body is one rigid segment; joints hinge
consecutive segments with a rotary limit (angle stop) plus a simple motor
(torque-limited angular-velocity target).

Collision policy (categories/mask on ShapeFilter):
- limbs never tangle with each other (baby is one entity)
- hands may hit the head (self-bonk is the whole point of the game)
- everything collides with the world (floor, walls, crib bar)

Every fixture carries a `collision_type` from `PartCollisionType`; contact
handlers in `baby_env` subscribe to those types to classify pain and hand-face
contact.
"""

import math
from dataclasses import dataclass
from enum import Enum

import pymunk

from motor_babble_rl.config import (
    ANGULAR_DAMPING,
    ARM_DIST_HH,
    ARM_DIST_HW,
    ARM_PROX_HH,
    ARM_PROX_HW,
    BODY_MASK,
    FAR_SIDE_Y,
    FLESH_DENSITY,
    FLESH_FRICTION,
    FLESH_RESTITUTION,
    HAND_MASK,
    HEAD_MASK,
    HEAD_OFFSET_X,
    HEAD_RADIUS,
    HIP_LOCAL_X,
    JOINT_LIMITS_BY_GROUP,
    LEG_DIST_HH,
    LEG_DIST_HW,
    LEG_PROX_HH,
    LEG_PROX_HW,
    LINEAR_DAMPING,
    NEAR_SIDE_Y,
    NECK_ANCHOR_OFFSET_X,
    NECK_LIMIT_HIGH,
    NECK_LIMIT_LOW,
    NECK_TORQUE,
    SHOULDER_LOCAL_X,
    SPAWN_X,
    SPAWN_Y,
    TONE_TORQUE,
    TORSO_BUMP_OFFSET_Y,
    TORSO_BUMP_RADIUS,
    TORSO_HH,
    TORSO_HW,
    CollisionCategory,
    JointGroup,
    MuscleIndex,
)


class PartCollisionType(int, Enum):
    """Collision-type ids for pymunk contact handlers. Different from filter bits.

    Filter bits (BODY/HEAD/HAND/WORLD) decide whether two shapes collide at all.
    Collision types decide which post-solve handler fires; that is how we tell
    a crib-bar hit apart from a head-on-floor faceplant.
    """

    TORSO = 1
    HEAD = 2
    HAND = 3
    LIMB = 4                                # any non-hand limb segment
    FLOOR = 5
    WALL = 6
    CRIB = 7


# Shorthand carried on each Body so higher layers do not need to reach into pymunk.
@dataclass
class LimbChain:
    """A two-segment limb (upper + lower) hinged to the torso.

    - proximal / distal: pymunk.Body instances (upper segment / lower segment)
    - proximal_motor, proximal_limit: constraints at the torso-side hinge
    - distal_motor, distal_limit: constraints at the mid-limb hinge
    - proximal_pivot, distal_pivot: the PivotJoint that physically holds the
      hinge together (added for completeness; layers above rarely touch it)
    """

    proximal: pymunk.Body
    distal: pymunk.Body
    proximal_motor: pymunk.SimpleMotor
    distal_motor: pymunk.SimpleMotor
    proximal_limit: pymunk.RotaryLimitJoint
    distal_limit: pymunk.RotaryLimitJoint
    proximal_pivot: pymunk.PivotJoint
    distal_pivot: pymunk.PivotJoint


@dataclass
class Baby:
    """Everything the env needs to read state, apply activations, and render.

    - `muscle_motors[MuscleIndex.X]` -> the SimpleMotor whose rate is written from action X.
    - `muscle_limits[MuscleIndex.X]` -> the RotaryLimitJoint whose (min, max) normalizes obs.
    - `muscle_bodies[MuscleIndex.X]` -> (parent_body, child_body) so we can read joint angle.
    - Named parts hold rendering + milestone info (head_y, torso_x, etc.).
    """

    torso: pymunk.Body
    head: pymunk.Body
    arm_near: LimbChain
    arm_far: LimbChain
    leg_near: LimbChain
    leg_far: LimbChain
    neck_motor: pymunk.SimpleMotor
    neck_limit: pymunk.RotaryLimitJoint
    neck_pivot: pymunk.PivotJoint
    muscle_motors: dict[MuscleIndex, pymunk.SimpleMotor]
    muscle_limits: dict[MuscleIndex, pymunk.RotaryLimitJoint]
    muscle_bodies: dict[MuscleIndex, tuple[pymunk.Body, pymunk.Body]]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def build_torso_body_with_bump() -> pymunk.Body:
    """Torso body: the box + the round back bulge share one Body, so their masses combine.

    Mass and moment must be computed for the composite here, before either fixture is
    attached, because pymunk 7 does not auto-recompute from later shape.density writes
    when the body was constructed with an explicit mass. `moment_for_circle` accepts
    an offset which applies the parallel-axis theorem for the bump's off-center mass.
    """
    box_area = (2.0 * TORSO_HW) * (2.0 * TORSO_HH)
    box_mass = FLESH_DENSITY * box_area
    box_moment = pymunk.moment_for_box(box_mass, (2.0 * TORSO_HW, 2.0 * TORSO_HH))

    bump_area = math.pi * TORSO_BUMP_RADIUS * TORSO_BUMP_RADIUS
    bump_mass = FLESH_DENSITY * bump_area
    bump_moment = pymunk.moment_for_circle(
        bump_mass, inner_radius=0.0, outer_radius=TORSO_BUMP_RADIUS,
        offset=(0.0, TORSO_BUMP_OFFSET_Y),
    )

    body = pymunk.Body(mass=box_mass + bump_mass, moment=box_moment + bump_moment, body_type=pymunk.Body.DYNAMIC)
    body.position = (SPAWN_X, SPAWN_Y)
    body.velocity_func = damped_velocity_update
    return body


def make_box_body(hw: float, hh: float, position: tuple[float, float]) -> pymunk.Body:
    """Dynamic body sized as a 2D box (2*hw wide, 2*hh tall) with flesh density.

    Mass and moment come from the density * area rule so the ragdoll totals ~5 kg.
    We add small linear/angular damping so the baby does not spin like a top when
    it lands on the floor.
    """
    area = (2.0 * hw) * (2.0 * hh)
    mass = FLESH_DENSITY * area
    moment = pymunk.moment_for_box(mass, (2.0 * hw, 2.0 * hh))
    body = pymunk.Body(mass=mass, moment=moment, body_type=pymunk.Body.DYNAMIC)
    body.position = position
    body.velocity_func = damped_velocity_update
    return body


def make_circle_body(radius: float, position: tuple[float, float]) -> pymunk.Body:
    """Dynamic circle body for the head. Same density rule as box parts."""
    area = 3.14159265 * radius * radius
    mass = FLESH_DENSITY * area
    moment = pymunk.moment_for_circle(mass, 0.0, radius)
    body = pymunk.Body(mass=mass, moment=moment, body_type=pymunk.Body.DYNAMIC)
    body.position = position
    body.velocity_func = damped_velocity_update
    return body


def damped_velocity_update(body: pymunk.Body, gravity: tuple[float, float], damping: float, dt: float) -> None:
    """Custom velocity integrator so every limb feels a small viscous drag.

    We call the default integrator with a scaled damping factor rather than fight
    with `space.damping` (which is global). This mirrors planck's per-body
    linearDamping / angularDamping used by the JS build.
    """
    pymunk.Body.update_velocity(body, gravity, damping, dt)
    body.velocity = body.velocity * (1.0 - LINEAR_DAMPING * dt)
    body.angular_velocity *= 1.0 - ANGULAR_DAMPING * dt


def apply_flesh_filter(shape: pymunk.Shape, categories: int, mask: int, collision_type: PartCollisionType) -> None:
    """Attach filter bits, collision type, and standard flesh material to a shape."""
    shape.density = FLESH_DENSITY
    shape.friction = FLESH_FRICTION
    shape.elasticity = FLESH_RESTITUTION
    shape.filter = pymunk.ShapeFilter(categories=categories, mask=mask)
    shape.collision_type = int(collision_type)


def build_limb_chain(
    space: pymunk.Space,
    torso: pymunk.Body,
    anchor_world: tuple[float, float],
    proximal_hw: float,
    proximal_hh: float,
    distal_hw: float,
    distal_hh: float,
    proximal_group: JointGroup,
    distal_group: JointGroup,
    distal_categories: int,
    distal_mask: int,
    distal_collision_type: PartCollisionType,
) -> LimbChain:
    """Build a two-segment limb hinged at `anchor_world` on the torso.

    The proximal segment's inner (torso-side) end sits at `anchor_world`; its outer
    end is at anchor_world - (2*proximal_hw, 0). The distal segment starts there and
    extends further out. Motors are created with rate=0 and max_force=TONE_TORQUE
    so the joint has resting tone; the env sets speed/force each control step.
    """
    ax, ay = anchor_world
    proximal_center = (ax - proximal_hw, ay)
    prox_body = make_box_body(proximal_hw, proximal_hh, proximal_center)
    prox_shape = pymunk.Poly.create_box(prox_body, (2.0 * proximal_hw, 2.0 * proximal_hh))
    apply_flesh_filter(prox_shape, int(CollisionCategory.BODY), BODY_MASK, PartCollisionType.LIMB)

    distal_anchor = (ax - 2.0 * proximal_hw, ay)
    distal_center = (distal_anchor[0] - distal_hw, ay)
    dist_body = make_box_body(distal_hw, distal_hh, distal_center)
    dist_shape = pymunk.Poly.create_box(dist_body, (2.0 * distal_hw, 2.0 * distal_hh))
    apply_flesh_filter(dist_shape, distal_categories, distal_mask, distal_collision_type)

    space.add(prox_body, prox_shape, dist_body, dist_shape)

    prox_low, prox_high = JOINT_LIMITS_BY_GROUP[proximal_group]
    dist_low, dist_high = JOINT_LIMITS_BY_GROUP[distal_group]

    prox_pivot = pymunk.PivotJoint(torso, prox_body, anchor_world)
    prox_limit = pymunk.RotaryLimitJoint(torso, prox_body, prox_low, prox_high)
    prox_motor = pymunk.SimpleMotor(torso, prox_body, 0.0)
    prox_motor.max_force = TONE_TORQUE

    dist_pivot = pymunk.PivotJoint(prox_body, dist_body, distal_anchor)
    dist_limit = pymunk.RotaryLimitJoint(prox_body, dist_body, dist_low, dist_high)
    dist_motor = pymunk.SimpleMotor(prox_body, dist_body, 0.0)
    dist_motor.max_force = TONE_TORQUE

    space.add(prox_pivot, prox_limit, prox_motor, dist_pivot, dist_limit, dist_motor)

    return LimbChain(
        proximal=prox_body,
        distal=dist_body,
        proximal_motor=prox_motor,
        distal_motor=dist_motor,
        proximal_limit=prox_limit,
        distal_limit=dist_limit,
        proximal_pivot=prox_pivot,
        distal_pivot=dist_pivot,
    )


# ---------------------------------------------------------------------------
# Public builders
# ---------------------------------------------------------------------------


def build_baby(space: pymunk.Space) -> Baby:
    """Instantiate one ragdoll at the spawn point and register every constraint with `space`.

    The returned `Baby` exposes named parts and the `muscle_motors` / `muscle_limits`
    dicts indexed by `MuscleIndex`, which is the only thing higher layers need to
    apply an 8-dim action or read an observation.
    """
    torso = build_torso_body_with_bump()
    torso_shape = pymunk.Poly.create_box(torso, (2.0 * TORSO_HW, 2.0 * TORSO_HH))
    apply_flesh_filter(torso_shape, int(CollisionCategory.BODY), BODY_MASK, PartCollisionType.TORSO)
    # Round back bulge: a second fixture on the same body so the torso rocks on it
    # instead of lying flat. Local -y is the back when the baby is supine.
    torso_bump = pymunk.Circle(torso, TORSO_BUMP_RADIUS, offset=(0.0, TORSO_BUMP_OFFSET_Y))
    apply_flesh_filter(torso_bump, int(CollisionCategory.BODY), BODY_MASK, PartCollisionType.TORSO)
    space.add(torso, torso_shape, torso_bump)

    head_position = (SPAWN_X + HEAD_OFFSET_X, SPAWN_Y)
    head = make_circle_body(HEAD_RADIUS, head_position)
    head_shape = pymunk.Circle(head, HEAD_RADIUS)
    apply_flesh_filter(head_shape, int(CollisionCategory.HEAD), HEAD_MASK, PartCollisionType.HEAD)
    space.add(head, head_shape)

    neck_anchor_world = (SPAWN_X + NECK_ANCHOR_OFFSET_X, SPAWN_Y)
    neck_pivot = pymunk.PivotJoint(torso, head, neck_anchor_world)
    neck_limit = pymunk.RotaryLimitJoint(torso, head, NECK_LIMIT_LOW, NECK_LIMIT_HIGH)
    neck_motor = pymunk.SimpleMotor(torso, head, 0.0)
    neck_motor.max_force = NECK_TORQUE
    space.add(neck_pivot, neck_limit, neck_motor)

    # Near-side arm (upper: BODY category; forearm: HAND category, may hit head)
    arm_near = build_limb_chain(
        space, torso,
        anchor_world=(SPAWN_X + SHOULDER_LOCAL_X, SPAWN_Y + NEAR_SIDE_Y),
        proximal_hw=ARM_PROX_HW, proximal_hh=ARM_PROX_HH,
        distal_hw=ARM_DIST_HW, distal_hh=ARM_DIST_HH,
        proximal_group=JointGroup.SHOULDER, distal_group=JointGroup.ELBOW,
        distal_categories=int(CollisionCategory.HAND), distal_mask=HAND_MASK,
        distal_collision_type=PartCollisionType.HAND,
    )
    arm_far = build_limb_chain(
        space, torso,
        anchor_world=(SPAWN_X + SHOULDER_LOCAL_X, SPAWN_Y + FAR_SIDE_Y),
        proximal_hw=ARM_PROX_HW, proximal_hh=ARM_PROX_HH,
        distal_hw=ARM_DIST_HW, distal_hh=ARM_DIST_HH,
        proximal_group=JointGroup.SHOULDER, distal_group=JointGroup.ELBOW,
        distal_categories=int(CollisionCategory.HAND), distal_mask=HAND_MASK,
        distal_collision_type=PartCollisionType.HAND,
    )

    # Legs (upper + lower are both BODY; feet do not need to hit head)
    leg_near = build_limb_chain(
        space, torso,
        anchor_world=(SPAWN_X + HIP_LOCAL_X, SPAWN_Y + NEAR_SIDE_Y),
        proximal_hw=LEG_PROX_HW, proximal_hh=LEG_PROX_HH,
        distal_hw=LEG_DIST_HW, distal_hh=LEG_DIST_HH,
        proximal_group=JointGroup.HIP, distal_group=JointGroup.KNEE,
        distal_categories=int(CollisionCategory.BODY), distal_mask=BODY_MASK,
        distal_collision_type=PartCollisionType.LIMB,
    )
    leg_far = build_limb_chain(
        space, torso,
        anchor_world=(SPAWN_X + HIP_LOCAL_X, SPAWN_Y + FAR_SIDE_Y),
        proximal_hw=LEG_PROX_HW, proximal_hh=LEG_PROX_HH,
        distal_hw=LEG_DIST_HW, distal_hh=LEG_DIST_HH,
        proximal_group=JointGroup.HIP, distal_group=JointGroup.KNEE,
        distal_categories=int(CollisionCategory.BODY), distal_mask=BODY_MASK,
        distal_collision_type=PartCollisionType.LIMB,
    )

    muscle_motors: dict[MuscleIndex, pymunk.SimpleMotor] = {
        MuscleIndex.SHOULDER_NEAR: arm_near.proximal_motor,
        MuscleIndex.ELBOW_NEAR: arm_near.distal_motor,
        MuscleIndex.HIP_NEAR: leg_near.proximal_motor,
        MuscleIndex.KNEE_NEAR: leg_near.distal_motor,
        MuscleIndex.SHOULDER_FAR: arm_far.proximal_motor,
        MuscleIndex.ELBOW_FAR: arm_far.distal_motor,
        MuscleIndex.HIP_FAR: leg_far.proximal_motor,
        MuscleIndex.KNEE_FAR: leg_far.distal_motor,
    }
    muscle_limits: dict[MuscleIndex, pymunk.RotaryLimitJoint] = {
        MuscleIndex.SHOULDER_NEAR: arm_near.proximal_limit,
        MuscleIndex.ELBOW_NEAR: arm_near.distal_limit,
        MuscleIndex.HIP_NEAR: leg_near.proximal_limit,
        MuscleIndex.KNEE_NEAR: leg_near.distal_limit,
        MuscleIndex.SHOULDER_FAR: arm_far.proximal_limit,
        MuscleIndex.ELBOW_FAR: arm_far.distal_limit,
        MuscleIndex.HIP_FAR: leg_far.proximal_limit,
        MuscleIndex.KNEE_FAR: leg_far.distal_limit,
    }
    muscle_bodies: dict[MuscleIndex, tuple[pymunk.Body, pymunk.Body]] = {
        MuscleIndex.SHOULDER_NEAR: (torso, arm_near.proximal),
        MuscleIndex.ELBOW_NEAR: (arm_near.proximal, arm_near.distal),
        MuscleIndex.HIP_NEAR: (torso, leg_near.proximal),
        MuscleIndex.KNEE_NEAR: (leg_near.proximal, leg_near.distal),
        MuscleIndex.SHOULDER_FAR: (torso, arm_far.proximal),
        MuscleIndex.ELBOW_FAR: (arm_far.proximal, arm_far.distal),
        MuscleIndex.HIP_FAR: (torso, leg_far.proximal),
        MuscleIndex.KNEE_FAR: (leg_far.proximal, leg_far.distal),
    }

    return Baby(
        torso=torso, head=head,
        arm_near=arm_near, arm_far=arm_far,
        leg_near=leg_near, leg_far=leg_far,
        neck_motor=neck_motor, neck_limit=neck_limit, neck_pivot=neck_pivot,
        muscle_motors=muscle_motors, muscle_limits=muscle_limits, muscle_bodies=muscle_bodies,
    )


