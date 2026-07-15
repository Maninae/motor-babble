"""Pygame renderer for the Motor Babble baby.

Draws a side-view scene: pastel wall, wooden floor and crib bar, ragdoll with a
distinct color per limb, a heads-up readout of milestones and current reward
components. Runs in two modes:

- "human": opens a real window (`pygame.display.set_mode`) and blocks briefly at
  every frame so the sim looks real-time.
- "rgb_array": renders to an offscreen `Surface` and returns an (H, W, 3) uint8
  ndarray. Used by `--gif` capture in `watch.py` and by the smoke test.

Coordinates: world-space (meters) is translated + scaled to screen-space (pixels)
by `world_to_screen`. World +y is up, screen +y is down, so the y-axis is flipped.
"""

import math
import os
from typing import TYPE_CHECKING

import numpy as np
import pygame

from motor_babble_rl.config import (
    ARM_DIST_HH,
    ARM_DIST_HW,
    ARM_PROX_HH,
    ARM_PROX_HW,
    CRIB_BAR_HALF_HEIGHT,
    CRIB_BAR_HALF_WIDTH,
    CRIB_BAR_X,
    FLOOR_Y,
    HEAD_RADIUS,
    LEFT_WALL_X,
    LEG_DIST_HH,
    LEG_DIST_HW,
    LEG_PROX_HH,
    LEG_PROX_HW,
    PARENT_ZONE_X,
    RENDER_CAMERA_X,
    RENDER_CAMERA_Y,
    RENDER_FPS,
    RENDER_HEIGHT_PX,
    RENDER_PALETTE,
    RENDER_PIXELS_PER_METER,
    RENDER_WIDTH_PX,
    RIGHT_WALL_X,
    ROLLOVER_AMPLITUDE_TO_ROLL,
    TORSO_BUMP_OFFSET_Y,
    TORSO_BUMP_RADIUS,
    TORSO_HH,
    TORSO_HW,
    MilestoneId,
    TaskName,
)

if TYPE_CHECKING:
    from motor_babble_rl.baby_env import MotorBabbleBabyEnv


class BabyRenderer:
    """Owns one `pygame.Surface` (window or offscreen). One instance per env."""

    def __init__(self, mode: str) -> None:
        if mode not in ("human", "rgb_array"):
            raise ValueError(f"Unsupported render mode: {mode}")
        self.mode = mode

        # In headless/offscreen use, SDL_VIDEODRIVER=dummy avoids opening a real window.
        # Callers set this env var; we just honor it and pick the right init path.
        pygame.init()
        if mode == "human":
            self.surface = pygame.display.set_mode((RENDER_WIDTH_PX, RENDER_HEIGHT_PX))
            pygame.display.set_caption("Motor Babble - RL")
            self.clock = pygame.time.Clock()
        else:
            # rgb_array: draw into an offscreen Surface that never needs a display.
            os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
            pygame.display.init()
            self.surface = pygame.Surface((RENDER_WIDTH_PX, RENDER_HEIGHT_PX))
            self.clock = None

        self.font_small = pygame.font.SysFont("Menlo, Consolas, monospace", 14)
        self.font_big = pygame.font.SysFont("Menlo, Consolas, monospace", 20, bold=True)

    def close(self) -> None:
        pygame.quit()

    # ------------------------------------------------------------------
    # Coordinate conversion
    # ------------------------------------------------------------------

    def world_to_screen(self, world_x: float, world_y: float) -> tuple[int, int]:
        """Map (world_x, world_y) meters to (screen_x, screen_y) pixels.

        Flips y since pygame's y-axis points down. Camera is fixed on
        (RENDER_CAMERA_X, RENDER_CAMERA_Y) in world coords.
        """
        sx = RENDER_WIDTH_PX * 0.5 + (world_x - RENDER_CAMERA_X) * RENDER_PIXELS_PER_METER
        sy = RENDER_HEIGHT_PX * 0.5 - (world_y - RENDER_CAMERA_Y) * RENDER_PIXELS_PER_METER
        return int(sx), int(sy)

    def scale_length(self, meters: float) -> int:
        return int(meters * RENDER_PIXELS_PER_METER)

    # ------------------------------------------------------------------
    # Draw
    # ------------------------------------------------------------------

    def draw(self, env: "MotorBabbleBabyEnv") -> np.ndarray | None:
        """Render one frame of `env`. Returns the RGB array in rgb_array mode."""
        self._draw_background()
        self._draw_nursery()
        self._draw_parent_zone()
        self._draw_baby(env)
        self._draw_hud(env)

        if self.mode == "human":
            pygame.event.pump()
            pygame.display.flip()
            if self.clock is not None:
                self.clock.tick(RENDER_FPS)
            return None

        # rgb_array: pygame.surfarray gives (W, H, 3); swap to (H, W, 3) for gym/imageio.
        pixel_array = pygame.surfarray.array3d(self.surface)
        return np.transpose(pixel_array, (1, 0, 2)).astype(np.uint8)

    def _draw_background(self) -> None:
        self.surface.fill(RENDER_PALETTE["wall"])

    def _draw_nursery(self) -> None:
        """Floor strip and the crib bar."""
        floor_top = self.world_to_screen(0.0, FLOOR_Y)[1]
        pygame.draw.rect(
            self.surface, RENDER_PALETTE["floor"],
            pygame.Rect(0, floor_top, RENDER_WIDTH_PX, RENDER_HEIGHT_PX - floor_top),
        )
        pygame.draw.line(
            self.surface, RENDER_PALETTE["floor_edge"],
            (0, floor_top), (RENDER_WIDTH_PX, floor_top), 2,
        )
        # Crib bar (vertical post at CRIB_BAR_X)
        crib_top_left = self.world_to_screen(CRIB_BAR_X - CRIB_BAR_HALF_WIDTH, CRIB_BAR_HALF_HEIGHT * 2)
        crib_width = self.scale_length(2 * CRIB_BAR_HALF_WIDTH)
        crib_height = self.scale_length(2 * CRIB_BAR_HALF_HEIGHT)
        pygame.draw.rect(
            self.surface, RENDER_PALETTE["crib"],
            pygame.Rect(crib_top_left[0], crib_top_left[1], max(3, crib_width), crib_height),
        )
        # Left / right walls
        left_wall_top = self.world_to_screen(LEFT_WALL_X, 1.4)
        right_wall_top = self.world_to_screen(RIGHT_WALL_X, 1.4)
        wall_height = self.scale_length(1.4)
        pygame.draw.line(
            self.surface, RENDER_PALETTE["floor_edge"],
            left_wall_top, (left_wall_top[0], left_wall_top[1] + wall_height), 2,
        )
        pygame.draw.line(
            self.surface, RENDER_PALETTE["floor_edge"],
            right_wall_top, (right_wall_top[0], right_wall_top[1] + wall_height), 2,
        )

    def _draw_parent_zone(self) -> None:
        """Faint marker for the reach-parent goal line."""
        top_x, top_y = self.world_to_screen(PARENT_ZONE_X, 0.6)
        bottom_x, bottom_y = self.world_to_screen(PARENT_ZONE_X, FLOOR_Y)
        pygame.draw.line(
            self.surface, RENDER_PALETTE["milestone"], (top_x, top_y), (bottom_x, bottom_y), 3,
        )
        label = self.font_small.render("parent", True, RENDER_PALETTE["milestone"])
        self.surface.blit(label, (top_x - label.get_width() // 2, top_y - 20))

    def _draw_baby(self, env: "MotorBabbleBabyEnv") -> None:
        """Render torso, head, arms, legs. Colors distinguish near vs far side."""
        assert env.baby is not None
        baby = env.baby

        near_color = RENDER_PALETTE["onesie"]
        far_color = RENDER_PALETTE["onesie_shade"]

        # Legs first so they render behind arms.
        self._draw_box_body(baby.leg_far.proximal, LEG_PROX_HW, LEG_PROX_HH, far_color)
        self._draw_box_body(baby.leg_far.distal, LEG_DIST_HW, LEG_DIST_HH, far_color)
        self._draw_box_body(baby.leg_near.proximal, LEG_PROX_HW, LEG_PROX_HH, near_color)
        self._draw_box_body(baby.leg_near.distal, LEG_DIST_HW, LEG_DIST_HH, near_color)

        # Torso: the box, plus the small round back bulge that enables rocking.
        self._draw_box_body(baby.torso, TORSO_HW, TORSO_HH, RENDER_PALETTE["onesie"])
        self._draw_circle_offset(
            baby.torso, offset_local=(0.0, TORSO_BUMP_OFFSET_Y),
            radius=TORSO_BUMP_RADIUS, color=RENDER_PALETTE["onesie_shade"],
        )

        # Arms
        self._draw_box_body(baby.arm_far.proximal, ARM_PROX_HW, ARM_PROX_HH, RENDER_PALETTE["skin_shade"])
        self._draw_box_body(baby.arm_far.distal, ARM_DIST_HW, ARM_DIST_HH, RENDER_PALETTE["skin_shade"])
        self._draw_box_body(baby.arm_near.proximal, ARM_PROX_HW, ARM_PROX_HH, RENDER_PALETTE["skin"])
        self._draw_box_body(baby.arm_near.distal, ARM_DIST_HW, ARM_DIST_HH, RENDER_PALETTE["skin"])

        # Head
        head_center = self.world_to_screen(baby.head.position.x, baby.head.position.y)
        radius_px = self.scale_length(HEAD_RADIUS)
        pygame.draw.circle(self.surface, RENDER_PALETTE["skin"], head_center, radius_px)
        pygame.draw.circle(self.surface, RENDER_PALETTE["hair"], head_center, radius_px, 2)

    def _draw_box_body(self, body, hw: float, hh: float, color: tuple[int, int, int]) -> None:
        """Draw a rotated box body as a filled polygon."""
        cx, cy = body.position.x, body.position.y
        cos_a = math.cos(body.angle)
        sin_a = math.sin(body.angle)
        local_corners = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
        world_corners = []
        for lx, ly in local_corners:
            wx = cx + cos_a * lx - sin_a * ly
            wy = cy + sin_a * lx + cos_a * ly
            world_corners.append(self.world_to_screen(wx, wy))
        pygame.draw.polygon(self.surface, color, world_corners)
        pygame.draw.polygon(self.surface, RENDER_PALETTE["floor_edge"], world_corners, 1)

    def _draw_circle_offset(
        self, body, offset_local: tuple[float, float], radius: float, color: tuple[int, int, int],
    ) -> None:
        """Draw a filled circle attached to `body` at an offset in its local frame."""
        ox, oy = offset_local
        cos_a = math.cos(body.angle)
        sin_a = math.sin(body.angle)
        wx = body.position.x + cos_a * ox - sin_a * oy
        wy = body.position.y + sin_a * ox + cos_a * oy
        center_px = self.world_to_screen(wx, wy)
        pygame.draw.circle(self.surface, color, center_px, self.scale_length(radius))
        pygame.draw.circle(self.surface, RENDER_PALETTE["floor_edge"], center_px, self.scale_length(radius), 1)

    def _draw_hud(self, env: "MotorBabbleBabyEnv") -> None:
        """Top-left readout: task, time, milestones, scrambled flag, rocking amplitude."""
        lines: list[tuple[str, tuple[int, int, int]]] = []
        lines.append((f"task: {env.task.value}", RENDER_PALETTE["text"]))
        lines.append((f"scrambled: {env.scrambled_wiring}", RENDER_PALETTE["text"]))
        lines.append((f"t = {env.sim_time_seconds:5.2f} s", RENDER_PALETTE["text_dim"]))
        assert env.baby is not None
        lines.append((f"torso x = {env.baby.torso.position.x:+.3f} m", RENDER_PALETTE["text_dim"]))
        if env.task == TaskName.ROLLOVER:
            amplitude = env.peak_pos_torso_angle_rad - env.peak_neg_torso_angle_rad
            color = RENDER_PALETTE["milestone"] if amplitude >= ROLLOVER_AMPLITUDE_TO_ROLL else RENDER_PALETTE["text_dim"]
            lines.append((f"rocking amp = {amplitude:.3f} rad (goal {ROLLOVER_AMPLITUDE_TO_ROLL:.2f})", color))
        lines.append((f"milestones {env.milestones.level}/{env.milestones.total}:", RENDER_PALETTE["text"]))
        for milestone in MilestoneId:
            got = milestone in env.milestones.achieved
            marker = "[X]" if got else "[ ]"
            color = RENDER_PALETTE["milestone"] if got else RENDER_PALETTE["text_dim"]
            lines.append((f"  {marker} {milestone.value}", color))

        y = 12
        for text, color in lines:
            surface = self.font_small.render(text, True, color)
            self.surface.blit(surface, (14, y))
            y += 18
