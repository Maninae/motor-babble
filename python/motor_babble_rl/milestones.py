"""Milestone detector: the developmental ladder from "found your face" to "reached your parent".

Pure state machine over per-step snapshots. No physics dependency, no pymunk types.
Same logic as js/milestones.js so trained models see the same reward structure a
human player would earn milestone bonuses under.

Rock-to-roll semantics (mirrors js/sim.js):
  A 180-degree sagittal-plane flip is a somersault this morphology cannot do, so
  the roll is *scripted*: the env tracks a decaying rocking amplitude of the wrapped
  torso angle in every task; when it crosses `ROLLOVER_AMPLITUDE_TO_ROLL`, the env
  flips a `facing` state from 'up' to 'down' and emits `rollover_completed_this_step`
  in the milestone snapshot. That flag lands the ROLL_OVER milestone here. After the
  flip, `is_prone` reports True whenever the torso is roughly flat
  (|wrap_angle| < PRONE_ANGLE_TOLERANCE), which then feeds the head-lift condition
  for TUMMY_TIME.
"""

import math
from dataclasses import dataclass, field

from motor_babble_rl.config import (
    MILESTONE_HOLD_HAND_TO_FACE_SEC,
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


def is_prone(torso_angle_radians: float, facing_down: bool) -> bool:
    """After the scripted roll (`facing_down=True`), prone means "torso lying flat".

    Before the roll (`facing_down=False`) the baby is supine by construction, so
    `is_prone` is always False no matter the physical torso angle. After the roll,
    prone is `|wrap_angle(torso)| < PRONE_ANGLE_TOLERANCE`: the torso has settled
    back near flat rather than still rocking sideways.
    """
    if not facing_down:
        return False
    return abs(wrap_angle(torso_angle_radians)) < PRONE_ANGLE_TOLERANCE


@dataclass
class MilestoneSnapshot:
    """Per-step body-state summary the tracker consumes.

    - torso_angle_radians: raw pymunk body angle (may exceed +/- pi).
    - torso_x, torso_y, head_y: world positions in meters.
    - hand_on_face: whether any hand fixture is currently touching the head.
    - facing_down: True after the env's scripted roll has flipped facing.
    - rollover_completed_this_step: True on the exact step the env flipped facing.
    """

    torso_angle_radians: float
    torso_x: float
    torso_y: float
    head_y: float
    hand_on_face: bool
    facing_down: bool
    rollover_completed_this_step: bool


@dataclass
class MilestoneTracker:
    """Accumulates hold-times and emits milestones as they land.

    Milestones fire at most once per episode. `tummy-time` requires `roll-over` first;
    everything else is order-free. ROLL_OVER is granted event-style by the env via
    the snapshot's `rollover_completed_this_step` flag (rock-to-roll); the tracker
    no longer waits for a prone-hold, which never fired for this morphology.
    """

    achieved: set[MilestoneId] = field(default_factory=set)
    hand_hold_seconds: float = 0.0
    tummy_hold_seconds: float = 0.0

    def reset(self) -> None:
        self.achieved.clear()
        self.hand_hold_seconds = 0.0
        self.tummy_hold_seconds = 0.0

    def update(self, dt_seconds: float, snapshot: MilestoneSnapshot) -> list[MilestoneId]:
        """Advance the timers by `dt_seconds`, return any milestones landed on this tick."""
        newly_landed: list[MilestoneId] = []
        prone_now = is_prone(snapshot.torso_angle_radians, snapshot.facing_down)

        self.hand_hold_seconds = self.hand_hold_seconds + dt_seconds if snapshot.hand_on_face else 0.0
        head_lifted = snapshot.head_y > snapshot.torso_y + MILESTONE_TUMMY_HEAD_LIFT
        self.tummy_hold_seconds = self.tummy_hold_seconds + dt_seconds if (prone_now and head_lifted) else 0.0

        def land(condition: bool, milestone: MilestoneId) -> None:
            if condition and milestone not in self.achieved:
                self.achieved.add(milestone)
                newly_landed.append(milestone)

        land(self.hand_hold_seconds >= MILESTONE_HOLD_HAND_TO_FACE_SEC, MilestoneId.HAND_TO_FACE)
        # ROLL_OVER: fired by the env's rock-to-roll bookkeeping, delivered via the snapshot.
        land(snapshot.rollover_completed_this_step, MilestoneId.ROLL_OVER)
        # TUMMY_TIME still depends on rolled + prone + head lifted for the hold duration.
        land(
            MilestoneId.ROLL_OVER in self.achieved and self.tummy_hold_seconds >= MILESTONE_HOLD_TUMMY_SEC,
            MilestoneId.TUMMY_TIME,
        )
        # Forward only (parity with js/milestones.js): backward drift is not a scoot.
        land(snapshot.torso_x - SPAWN_X >= MILESTONE_SCOOT_DISTANCE, MilestoneId.SCOOT)
        land(snapshot.torso_x >= PARENT_ZONE_X, MilestoneId.REACH_PARENT)

        return newly_landed

    @property
    def level(self) -> int:
        return len(self.achieved)

    @property
    def total(self) -> int:
        return len(MILESTONE_ORDER)
