"""Reward shaping: one function per task, called every control step by `baby_env`.

Each task returns a `RewardBreakdown` (dict of named terms + total) so training logs
and diagnostics can attribute reward instead of showing only the scalar. The env is
responsible for feeding these functions the state they need; this module has no
pymunk import and no side effects.

Task notes:
- `crawl`: reward = forward torso displacement per step (integrates to distance
  traveled). Terminated on reaching the parent zone; large one-time bonus on that.
- `rollover`: the honest physical skill this morphology can produce is rocking, not
  a 180-degree flip (that is a somersault in the sagittal plane, which no baby can do,
  and evolutionary search on the JS side plateaued around 0.8 rad). Reward is the
  growth of the tracked (peak_pos - peak_neg) angular amplitude; peaks decay
  exponentially per physics step so the policy must keep pumping to grow them.
  Crossing ROLLOVER_AMPLITUDE_TO_ROLL (0.65 rad, calibrated from the JS game's roll
  trigger) is the completion event: bonus + terminate. In the JS game the actual
  flip is scripted past this threshold; the RL task trains the physical prerequisite.
"""

from dataclasses import dataclass

import numpy as np

from motor_babble_rl.config import (
    REWARD_ENERGY_PENALTY,
    REWARD_MILESTONE_BONUS,
    REWARD_PAIN_PENALTY,
    REWARD_REACH_PARENT_BONUS,
    REWARD_ROLLOVER_AMPLITUDE_SCALE,
    REWARD_ROLLOVER_COMPLETE_BONUS,
    REWARD_VELOCITY_SCALE,
    ROLLOVER_AMPLITUDE_TO_ROLL,
    MilestoneId,
    TaskName,
)


@dataclass
class RewardStateSummary:
    """Everything a reward function needs from the physics step, packed for clarity."""

    task: TaskName
    clipped_policy_action: np.ndarray
    prev_torso_x: float
    torso_x: float
    rocking_amplitude_rad: float             # (peak_pos - peak_neg) at the end of the step
    prev_rocking_amplitude_rad: float        # same, at the start of the step
    rollover_just_completed: bool            # amplitude crossed threshold this step (fires once)
    pain_event_count: int
    milestones_landed: list[MilestoneId]


@dataclass
class RewardBreakdown:
    """Per-term reward attribution. `total` is the sum of `components.values()`."""

    total: float
    components: dict[str, float]


def compute_reward(state: RewardStateSummary) -> RewardBreakdown:
    """Dispatch to the per-task shaping and add the shared penalties/bonuses."""
    components: dict[str, float] = {}

    if state.task == TaskName.CRAWL:
        components["velocity"] = _crawl_velocity_reward(prev_torso_x=state.prev_torso_x, torso_x=state.torso_x)
    elif state.task == TaskName.ROLLOVER:
        components["rock_amplitude"] = _rollover_amplitude_reward(
            rocking_amplitude_rad=state.rocking_amplitude_rad,
            prev_rocking_amplitude_rad=state.prev_rocking_amplitude_rad,
        )
        if state.rollover_just_completed:
            components["rollover_complete_bonus"] = REWARD_ROLLOVER_COMPLETE_BONUS
    else:
        raise ValueError(f"Unknown task: {state.task}")

    components["energy"] = -REWARD_ENERGY_PENALTY * float(np.sum(np.square(state.clipped_policy_action)))
    components["milestone_bonus"] = REWARD_MILESTONE_BONUS * len(state.milestones_landed)
    components["pain_penalty"] = -REWARD_PAIN_PENALTY * state.pain_event_count

    if MilestoneId.REACH_PARENT in state.milestones_landed:
        components["reach_parent_bonus"] = REWARD_REACH_PARENT_BONUS

    total_reward = float(sum(components.values()))
    return RewardBreakdown(total=total_reward, components=components)


def _crawl_velocity_reward(prev_torso_x: float, torso_x: float) -> float:
    """Reward per control step = REWARD_VELOCITY_SCALE * delta_x.

    This is per-step distance shaping. Integrated over an episode it is just the
    total distance traveled, so a policy that scoots 1 m earns +1.0 regardless of
    how many steps it took.
    """
    return REWARD_VELOCITY_SCALE * (torso_x - prev_torso_x)


def _rollover_amplitude_reward(rocking_amplitude_rad: float, prev_rocking_amplitude_rad: float) -> float:
    """Reward the growth of rocking amplitude between successive control steps.

    Positive when the baby rocks harder than last step, negative when the peaks decay
    without new excursions, zero at a fixed rocking level. This shape forces the policy
    to keep pumping to earn reward and disincentivizes freezing at a small amplitude.
    """
    return REWARD_ROLLOVER_AMPLITUDE_SCALE * (rocking_amplitude_rad - prev_rocking_amplitude_rad)


def rollover_success(rocking_amplitude_rad: float) -> bool:
    """Whether the current amplitude has crossed the roll trigger."""
    return rocking_amplitude_rad >= ROLLOVER_AMPLITUDE_TO_ROLL
