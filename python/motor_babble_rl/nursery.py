"""Static nursery geometry: floor, walls, crib bar.

Every static fixture carries a `PartCollisionType` tag (from `morphology`) so the
env's collision handlers can classify crib impacts and head-on-floor faceplants.
The rendering layer reads world extents from `config` directly; this module owns
the collision side only.
"""

from dataclasses import dataclass

import pymunk

from motor_babble_rl.config import (
    CRIB_BAR_HALF_HEIGHT,
    CRIB_BAR_HALF_WIDTH,
    CRIB_BAR_X,
    CRIB_FRICTION,
    FLOOR_FRICTION,
    FLOOR_Y,
    LEFT_WALL_X,
    RIGHT_WALL_X,
    WALL_FRICTION,
    WORLD_MASK,
    CollisionCategory,
)


@dataclass
class Nursery:
    """Static world geometry. Rendering reads extents from config; env reads these bodies."""

    floor: pymunk.Body
    left_wall: pymunk.Body
    right_wall: pymunk.Body
    crib_bar: pymunk.Body


def build_nursery(space: pymunk.Space, part_types: "NurseryCollisionTypes") -> Nursery:
    """Add the floor, walls, and crib bar to `space` as static bodies.

    `part_types` supplies the `collision_type` ints to tag each fixture with, so
    this module does not need to import `PartCollisionType` from `morphology`
    (which imports from here). Callers pass the enum values directly.
    """
    floor_span_half = (RIGHT_WALL_X - LEFT_WALL_X) / 2.0 + 0.5
    floor_center_x = (RIGHT_WALL_X + LEFT_WALL_X) / 2.0
    floor = add_static_box(
        space, floor_center_x, FLOOR_Y - 0.1,
        floor_span_half, 0.1, FLOOR_FRICTION, part_types.floor,
    )
    left_wall = add_static_box(
        space, LEFT_WALL_X - 0.05, 0.6, 0.05, 0.8, WALL_FRICTION, part_types.wall,
    )
    right_wall = add_static_box(
        space, RIGHT_WALL_X + 0.05, 0.6, 0.05, 0.8, WALL_FRICTION, part_types.wall,
    )
    crib_bar = add_static_box(
        space, CRIB_BAR_X, CRIB_BAR_HALF_HEIGHT,
        CRIB_BAR_HALF_WIDTH, CRIB_BAR_HALF_HEIGHT,
        CRIB_FRICTION, part_types.crib,
    )
    return Nursery(floor=floor, left_wall=left_wall, right_wall=right_wall, crib_bar=crib_bar)


@dataclass(frozen=True)
class NurseryCollisionTypes:
    """The collision-type ints `build_nursery` stamps onto its fixtures."""

    floor: int
    wall: int
    crib: int


def add_static_box(
    space: pymunk.Space,
    center_x: float, center_y: float,
    hw: float, hh: float,
    friction: float,
    collision_type: int,
) -> pymunk.Body:
    """Convenience: static box at (center_x, center_y) with the standard world filter."""
    body = pymunk.Body(body_type=pymunk.Body.STATIC)
    body.position = (center_x, center_y)
    shape = pymunk.Poly.create_box(body, (2.0 * hw, 2.0 * hh))
    shape.friction = friction
    shape.elasticity = 0.0
    shape.filter = pymunk.ShapeFilter(categories=int(CollisionCategory.WORLD), mask=WORLD_MASK)
    shape.collision_type = collision_type
    space.add(body, shape)
    return body
