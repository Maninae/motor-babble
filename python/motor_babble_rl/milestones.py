"""Milestone detector: the developmental ladder from "found your face" to "reached your parent".

Pure state machine over per-step snapshots. No physics dependency, no pymunk types.
Same logic as js/milestones.js so trained models see the same reward structure a
human player would earn milestone bonuses under.
"""

import math
from dataclasses import dataclass, field

from motor_babble_rl.config import (
    MILESTONE_HOLD_HAND_TO_FACE_SEC,
    MILESTONE_HOLD_ROLL_SEC,
    MILESTONE_HOLD_TUMMY_SEC,
    MILESTONE_ORDER,
    MILESTONE_SCOOT_DISTANCE,
    MILESTONE_TUMMY_HEAD_LIFT,
    PARENT_ZONE_X,
    PRONE_ANGLE_TOLERANCE,
    SPAWN_X,
    MilestoneId,
)


def wrap_angle(angle_radians: float) -> float:
    """Wrap any accumulated body angle into [-pi, pi]."""
    wrapped = angle_radians % (2.0 * math.pi)
    if wrapped > math.pi:
        wrapped -= 2.0 * math.pi
    elif wrapped < -math.pi:
        wrapped += 2.0 * math.pi
    return wrapped


def is_prone(torso_angle_radians: float) -> bool:
    """Face-down: torso is within tolerance of flipping (near +/- pi from supine spawn)."""
    return abs(wrap_angle(torso_angle_radians)) > math.pi - PRONE_ANGLE_TOLERANCE


@dataclass
class MilestoneSnapshot:
    """Per-step body-state summary the tracker consumes.

    - torso_angle_radians: raw pymunk body angle (may exceed +/- pi).
    - torso_x, torso_y, head_y: world positions in meters.
    - hand_on_face: whether any hand fixture is currently touching the head.
    """

    torso_angle_radians: float
    torso_x: float
    torso_y: float
    head_y: float
    hand_on_face: bool


@dataclass
class MilestoneTracker:
    """Accumulates hold-times and emits milestones as they land.

    Milestones fire at most once per episode. `tummy-time` requires `roll-over` first;
    everything else is order-free.
    """

    achieved: set[MilestoneId] = field(default_factory=set)
    hand_hold_seconds: float = 0.0
    prone_hold_seconds: float = 0.0
    tummy_hold_seconds: float = 0.0

    def reset(self) -> None:
        self.achieved.clear()
        self.hand_hold_seconds = 0.0
        self.prone_hold_seconds = 0.0
        self.tummy_hold_seconds = 0.0

    def update(self, dt_seconds: float, snapshot: MilestoneSnapshot) -> list[MilestoneId]:
        """Advance the timers by `dt_seconds`, return any milestones landed on this tick."""
        newly_landed: list[MilestoneId] = []
        prone_now = is_prone(snapshot.torso_angle_radians)

        self.hand_hold_seconds = self.hand_hold_seconds + dt_seconds if snapshot.hand_on_face else 0.0
        self.prone_hold_seconds = self.prone_hold_seconds + dt_seconds if prone_now else 0.0
        head_lifted = snapshot.head_y > snapshot.torso_y + MILESTONE_TUMMY_HEAD_LIFT
        self.tummy_hold_seconds = self.tummy_hold_seconds + dt_seconds if (prone_now and head_lifted) else 0.0

        def land(condition: bool, milestone: MilestoneId) -> None:
            if condition and milestone not in self.achieved:
                self.achieved.add(milestone)
                newly_landed.append(milestone)

        land(self.hand_hold_seconds >= MILESTONE_HOLD_HAND_TO_FACE_SEC, MilestoneId.HAND_TO_FACE)
        land(self.prone_hold_seconds >= MILESTONE_HOLD_ROLL_SEC, MilestoneId.ROLL_OVER)
        land(
            MilestoneId.ROLL_OVER in self.achieved and self.tummy_hold_seconds >= MILESTONE_HOLD_TUMMY_SEC,
            MilestoneId.TUMMY_TIME,
        )
        land(abs(snapshot.torso_x - SPAWN_X) >= MILESTONE_SCOOT_DISTANCE, MilestoneId.SCOOT)
        land(snapshot.torso_x >= PARENT_ZONE_X, MilestoneId.REACH_PARENT)

        return newly_landed

    @property
    def level(self) -> int:
        return len(self.achieved)

    @property
    def total(self) -> int:
        return len(MILESTONE_ORDER)
