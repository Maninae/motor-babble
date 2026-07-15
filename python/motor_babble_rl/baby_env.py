"""The MotorBabbleBaby-v0 gymnasium environment.

State machine: build a fresh pymunk space on every `reset(seed=)`, step it at 60 Hz
with 4-tick frame-skip (15 Hz control), and return a 23-dim observation, a reward
shaped by the selected task, and terminated/truncated flags.

The environment owns the physics `Space`, the ragdoll `Baby`, the static `Nursery`,
the `MilestoneTracker`, and the optional `ActionScramble`. Rendering is delegated
to `motor_babble_rl.rendering`, which reads pymunk body positions on demand.

Rock-to-roll (mirrors js/sim.js):
  An in-plane 180-degree roll is a somersault this morphology cannot do, so the
  env tracks a decaying rocking amplitude of the wrapped torso angle in EVERY task.
  When it crosses `ROLLOVER_AMPLITUDE_TO_ROLL`, the env flips `facing` from 'up'
  to 'down' and grants the `ROLL_OVER` milestone. After the flip, `is_prone` reads
  True whenever the torso is roughly flat, so `TUMMY_TIME` becomes reachable when
  the baby then lifts the head. The rollover task also terminates on this flip;
  the crawl task just accumulates the ROLL_OVER milestone bonus and keeps going.
"""

import math
from typing import Any

import gymnasium as gym
import numpy as np
import pymunk
from gymnasium import spaces
from gymnasium.envs.registration import register, registry

from motor_babble_rl.config import (
    ACTIVATION_DEAD_ZONE,
    FLEX_SIGN_BY_MUSCLE,
    FRAME_SKIP,
    GRAVITY_Y,
    GROUP_BY_MUSCLE,
    JOINT_LIMITS_BY_GROUP,
    MAX_CONTROL_STEPS,
    MOTOR_MAX_RATE,
    MUSCLE_COUNT,
    PAIN_COOLDOWN_SEC,
    PAIN_CRIB_IMPULSE,
    PAIN_GRACE_PERIOD_SEC,
    PAIN_HEAD_FLOOR_IMPULSE,
    PHYSICS_TIMESTEP,
    ROLLOVER_AMPLITUDE_TO_ROLL,
    ROLLOVER_PEAK_DECAY_PER_PHYSICS_STEP,
    TONE_TORQUE,
    TORQUE_CAP_BY_GROUP,
    JointGroup,
    MilestoneId,
    MuscleIndex,
    TaskName,
)
from motor_babble_rl.milestones import MilestoneSnapshot, MilestoneTracker, is_prone, wrap_angle
from motor_babble_rl.morphology import Baby, PartCollisionType, build_baby
from motor_babble_rl.nursery import Nursery, NurseryCollisionTypes, build_nursery
from motor_babble_rl.rendering import BabyRenderer
from motor_babble_rl.rewards import RewardStateSummary, compute_reward
from motor_babble_rl.wiring import ActionScramble, identity_scramble, random_scramble


OBSERVATION_DIM: int = 23   # see `compose_observation` for the layout
CONTROL_DT_SECONDS: float = FRAME_SKIP * PHYSICS_TIMESTEP


class MotorBabbleBabyEnv(gym.Env):
    """Gymnasium env: 8 muscle activations in, 23-dim body state out, milestone-shaped reward.

    Kwargs:
        task: 'crawl' (default, reward = torso x-displacement per step; terminates on
            reach-parent) or 'rollover' (reward = growth of tracked rocking amplitude;
            terminates when amplitude crosses 0.65 rad, which is the JS game's roll
            trigger). An in-plane 180-degree flip is a somersault this morphology
            cannot do, so 'rollover' trains the honest physical skill: rocking. In
            both tasks the env's rock-to-roll bookkeeping flips a `facing` state and
            grants the ROLL_OVER milestone once the threshold is reached; only the
            rollover task terminates on that event.
        scrambled_wiring: if True, a per-episode random permutation + sign flip is applied
            to actions before they reach the motors. This is the domain-randomization
            handle that turns the sandbox into a research question: can a policy learn to
            find its own muscle assignment from noisy exploration alone?
        render_mode: None, 'human', or 'rgb_array'.

    Observation layout (all float32, shape (23,)):
        [0:8]   joint angles, each normalized to [-1, 1] against its (lower, upper) limits
        [8:16]  joint angular velocities in rad/s, scaled by 1/MOTOR_MAX_RATE
        [16]    torso angle sin
        [17]    torso angle cos
        [18]    torso height (m)
        [19]    torso x-velocity (m/s), unscaled
        [20]    head height (m)
        [21]    hand-on-face contact flag (0 or 1)
        [22]    prone flag (facing_down AND |wrap(torso angle)| < PRONE_ANGLE_TOLERANCE)
    """

    metadata = {"render_modes": ["human", "rgb_array"], "render_fps": 60}

    def __init__(
        self,
        task: str | TaskName = TaskName.CRAWL,
        scrambled_wiring: bool = False,
        render_mode: str | None = None,
    ) -> None:
        super().__init__()
        self.task: TaskName = TaskName(task) if isinstance(task, str) else task
        self.scrambled_wiring: bool = scrambled_wiring
        self.render_mode: str | None = render_mode

        self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(MUSCLE_COUNT,), dtype=np.float32)
        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(OBSERVATION_DIM,), dtype=np.float32,
        )

        # Physics state (built fresh in reset).
        self.space: pymunk.Space | None = None
        self.baby: Baby | None = None
        self.nursery: Nursery | None = None
        self.milestones: MilestoneTracker = MilestoneTracker()
        self.action_scramble: ActionScramble = identity_scramble()

        # Episode bookkeeping.
        self.control_step: int = 0
        self.sim_time_seconds: float = 0.0
        self.pain_cooldown_seconds: float = 0.0
        self.hand_head_contact_count: int = 0
        self.pending_pain_events: list[str] = []       # 'crib' or 'head_floor', per pain post-solve

        # Rock-to-roll bookkeeping. Peaks decay per physics tick; facing flips on
        # amplitude crossing, granting ROLL_OVER and enabling prone/TUMMY_TIME.
        self.peak_pos_torso_angle_rad: float = 0.0
        self.peak_neg_torso_angle_rad: float = 0.0
        self.prev_rocking_amplitude_rad: float = 0.0
        self.facing_down: bool = False                 # False = supine (spawn), True = post-roll

        # Renderer is created lazily on first render() call.
        self.renderer: BabyRenderer | None = None

    # ---------------------------------------------------------------------
    # Gym API
    # ---------------------------------------------------------------------

    def reset(self, seed: int | None = None, options: dict[str, Any] | None = None) -> tuple[np.ndarray, dict[str, Any]]:
        """Rebuild world, reset counters, resample action scramble if enabled."""
        super().reset(seed=seed)

        self.space = pymunk.Space()
        self.space.gravity = (0.0, GRAVITY_Y)
        # allow_sleep off: motor rate changes do not wake sleeping bodies, so a settled
        # baby would silently ignore muscle commands (verified in the JS build too).
        self.space.sleep_time_threshold = float("inf")

        self.nursery = build_nursery(self.space, part_types=NurseryCollisionTypes(
            floor=int(PartCollisionType.FLOOR),
            wall=int(PartCollisionType.WALL),
            crib=int(PartCollisionType.CRIB),
        ))
        self.baby = build_baby(self.space)
        self.install_collision_handlers()

        self.milestones.reset()
        self.control_step = 0
        self.sim_time_seconds = 0.0
        self.pain_cooldown_seconds = 0.0
        self.hand_head_contact_count = 0
        self.pending_pain_events.clear()
        self.peak_pos_torso_angle_rad = 0.0
        self.peak_neg_torso_angle_rad = 0.0
        self.prev_rocking_amplitude_rad = 0.0
        self.facing_down = False

        if self.scrambled_wiring:
            # np_random is seeded by super().reset(seed=), so this is deterministic per seed.
            self.action_scramble = random_scramble(self.np_random)
        else:
            self.action_scramble = identity_scramble()

        observation = self.compose_observation()
        info = self.compose_info(reward_components={}, milestones_landed=[])
        return observation, info

    def step(self, action: np.ndarray) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        """Advance one control step (4 physics ticks) with the given 8-muscle activation."""
        if self.space is None or self.baby is None:
            raise RuntimeError("step() called before reset(); gym contract violation")

        clipped_policy_action = np.clip(action, -1.0, 1.0).astype(np.float32)
        body_action = self.action_scramble.apply(clipped_policy_action)

        prev_torso_x = self.baby.torso.position.x
        self.apply_muscle_activations(body_action)

        # pending_pain_events is drained at the end of the previous step; no clear needed here.
        for _ in range(FRAME_SKIP):
            self.space.step(PHYSICS_TIMESTEP)
            self.sim_time_seconds += PHYSICS_TIMESTEP
            self.pain_cooldown_seconds = max(0.0, self.pain_cooldown_seconds - PHYSICS_TIMESTEP)
            self.update_rocking_peaks(torso_angle=float(self.baby.torso.angle))

        pain_events_this_step = self.drain_pain_events()

        # Rock-to-roll: cross the amplitude threshold, flip facing, grant ROLL_OVER
        # milestone via the snapshot. This runs in every task; only the rollover task
        # terminates on it.
        current_amplitude = self.peak_pos_torso_angle_rad - self.peak_neg_torso_angle_rad
        rollover_just_completed = (not self.facing_down) and current_amplitude >= ROLLOVER_AMPLITUDE_TO_ROLL
        if rollover_just_completed:
            self.facing_down = True

        milestones_landed = self.advance_milestones(
            dt_seconds=CONTROL_DT_SECONDS,
            rollover_completed_this_step=rollover_just_completed,
        )
        self.control_step += 1

        reward_summary = RewardStateSummary(
            task=self.task,
            clipped_policy_action=clipped_policy_action,
            prev_torso_x=prev_torso_x,
            torso_x=float(self.baby.torso.position.x),
            rocking_amplitude_rad=current_amplitude,
            prev_rocking_amplitude_rad=self.prev_rocking_amplitude_rad,
            rollover_just_completed=rollover_just_completed,
            pain_event_count=len(pain_events_this_step),
            milestones_landed=milestones_landed,
            control_dt_seconds=CONTROL_DT_SECONDS,
        )
        breakdown = compute_reward(reward_summary)
        self.prev_rocking_amplitude_rad = current_amplitude

        terminated = (
            MilestoneId.REACH_PARENT in self.milestones.achieved
            or (self.task == TaskName.ROLLOVER and self.facing_down)
        )
        truncated = self.control_step >= MAX_CONTROL_STEPS

        observation = self.compose_observation()
        info = self.compose_info(reward_components=breakdown.components, milestones_landed=milestones_landed)
        return observation, float(breakdown.total), terminated, truncated, info

    def render(self) -> np.ndarray | None:
        """Dispatch to the lazy renderer. Returns None (human mode) or an HxWx3 uint8 array."""
        if self.render_mode is None:
            return None
        if self.renderer is None:
            self.renderer = BabyRenderer(mode=self.render_mode)
        return self.renderer.draw(env=self)

    def close(self) -> None:
        """Release the pygame renderer if one was created."""
        if self.renderer is not None:
            self.renderer.close()
            self.renderer = None

    # ---------------------------------------------------------------------
    # Physics helpers
    # ---------------------------------------------------------------------

    def apply_muscle_activations(self, body_action: np.ndarray) -> None:
        """Write speed + torque cap onto every muscle motor from the (scrambled) action.

        Below the dead zone the motor holds rest tone; above it, rate is proportional
        to the activation and torque is `max(TONE_TORQUE, cap * |a|)` so small
        activations get at least tone-level backing instead of falling off a cliff
        (activation 0.021 used to command only TORQUE_CAP * 0.021, well below tone).
        """
        assert self.baby is not None
        for index in MuscleIndex:
            activation = float(body_action[int(index)])
            motor = self.baby.muscle_motors[index]
            if abs(activation) < ACTIVATION_DEAD_ZONE:
                motor.rate = 0.0
                motor.max_force = TONE_TORQUE
                continue
            flex_sign = FLEX_SIGN_BY_MUSCLE[index]
            group: JointGroup = GROUP_BY_MUSCLE[index]
            motor.rate = activation * flex_sign * MOTOR_MAX_RATE
            motor.max_force = max(TONE_TORQUE, TORQUE_CAP_BY_GROUP[group] * abs(activation))

    def update_rocking_peaks(self, torso_angle: float) -> None:
        """Decay the tracked peaks and pull in the current wrapped torso angle.

        Called once per physics tick inside the frame-skip loop, so the decay factor
        (ROLLOVER_PEAK_DECAY_PER_PHYSICS_STEP, ~0.995) gives peaks a ~1.2 s memory
        at 60 Hz. A hard flip would drive the peaks toward +/- pi, but this baby
        cannot flip; realistic rocking pushes them into +/-0.3 to +/-0.6 rad.
        """
        wrapped = wrap_angle(torso_angle)
        self.peak_pos_torso_angle_rad = max(
            self.peak_pos_torso_angle_rad * ROLLOVER_PEAK_DECAY_PER_PHYSICS_STEP, wrapped,
        )
        self.peak_neg_torso_angle_rad = min(
            self.peak_neg_torso_angle_rad * ROLLOVER_PEAK_DECAY_PER_PHYSICS_STEP, wrapped,
        )

    def drain_pain_events(self) -> list[str]:
        """Consume queued pain-tagged post-solve events into the cooldown-gated set.

        The first `PAIN_GRACE_PERIOD_SEC` are the spawn-drop and do not count.
        Successive pain events within one cooldown window collapse into one.
        """
        if self.sim_time_seconds < PAIN_GRACE_PERIOD_SEC:
            self.pending_pain_events.clear()
            return []
        emitted: list[str] = []
        for event_kind in self.pending_pain_events:
            if self.pain_cooldown_seconds > 0.0:
                continue
            self.pain_cooldown_seconds = PAIN_COOLDOWN_SEC
            emitted.append(event_kind)
        self.pending_pain_events.clear()
        return emitted

    def advance_milestones(self, dt_seconds: float, rollover_completed_this_step: bool) -> list[MilestoneId]:
        """Read torso/head state, update the milestone tracker, return newly landed ids."""
        assert self.baby is not None
        torso = self.baby.torso
        snapshot = MilestoneSnapshot(
            torso_angle_radians=torso.angle,
            torso_x=torso.position.x,
            torso_y=torso.position.y,
            head_y=self.baby.head.position.y,
            hand_on_face=self.hand_head_contact_count > 0,
            facing_down=self.facing_down,
            rollover_completed_this_step=rollover_completed_this_step,
        )
        return self.milestones.update(dt_seconds=dt_seconds, snapshot=snapshot)

    # ---------------------------------------------------------------------
    # Observation composition
    # ---------------------------------------------------------------------

    def compose_observation(self) -> np.ndarray:
        assert self.baby is not None
        obs = np.zeros(OBSERVATION_DIM, dtype=np.float32)

        for i, index in enumerate(MuscleIndex):
            parent_body, child_body = self.baby.muscle_bodies[index]
            joint_angle = child_body.angle - parent_body.angle
            joint_rate = child_body.angular_velocity - parent_body.angular_velocity
            group = GROUP_BY_MUSCLE[index]
            lower, upper = JOINT_LIMITS_BY_GROUP[group]
            center = 0.5 * (lower + upper)
            half_range = 0.5 * (upper - lower)
            obs[i] = (joint_angle - center) / half_range if half_range > 0 else 0.0
            obs[MUSCLE_COUNT + i] = joint_rate / MOTOR_MAX_RATE

        torso = self.baby.torso
        obs[16] = math.sin(torso.angle)
        obs[17] = math.cos(torso.angle)
        obs[18] = torso.position.y
        obs[19] = torso.velocity.x
        obs[20] = self.baby.head.position.y
        obs[21] = 1.0 if self.hand_head_contact_count > 0 else 0.0
        obs[22] = 1.0 if is_prone(torso.angle, self.facing_down) else 0.0
        return obs

    def compose_info(
        self,
        reward_components: dict[str, float],
        milestones_landed: list[MilestoneId],
    ) -> dict[str, Any]:
        assert self.baby is not None
        rocking_amplitude = self.peak_pos_torso_angle_rad - self.peak_neg_torso_angle_rad
        return {
            "sim_time_seconds": self.sim_time_seconds,
            "control_step": self.control_step,
            "torso_x": float(self.baby.torso.position.x),
            "torso_y": float(self.baby.torso.position.y),
            "milestones_achieved": sorted(m.value for m in self.milestones.achieved),
            "milestones_landed_this_step": [m.value for m in milestones_landed],
            "milestone_level": self.milestones.level,
            "reward_components": reward_components,
            "rocking_amplitude_rad": rocking_amplitude,
            "peak_pos_torso_angle_rad": self.peak_pos_torso_angle_rad,
            "peak_neg_torso_angle_rad": self.peak_neg_torso_angle_rad,
            "facing_down": self.facing_down,
            "scramble_permutation": self.action_scramble.permutation.tolist(),
            "scramble_signs": self.action_scramble.sign_flip.tolist(),
        }

    # ---------------------------------------------------------------------
    # Collision handlers
    # ---------------------------------------------------------------------

    def install_collision_handlers(self) -> None:
        """Wire pymunk callbacks for hand-on-face contacts and pain-tagged impacts.

        pymunk 7's `Space.on_collision(a, b, begin=..., post_solve=..., separate=...)`
        dispatches by (collision_type_a, collision_type_b) on shapes we tag in
        `morphology`. Callbacks return None (pymunk 7 dropped the bool return from begin).
        """
        assert self.space is not None
        space = self.space
        env_self = self

        # Hand-on-face contact: increment on begin, decrement on separate.
        def hand_head_begin(arbiter: pymunk.Arbiter, s: pymunk.Space, data: object) -> None:
            env_self.hand_head_contact_count += 1

        def hand_head_separate(arbiter: pymunk.Arbiter, s: pymunk.Space, data: object) -> None:
            env_self.hand_head_contact_count = max(0, env_self.hand_head_contact_count - 1)

        space.on_collision(
            int(PartCollisionType.HAND), int(PartCollisionType.HEAD),
            begin=hand_head_begin, separate=hand_head_separate,
        )

        # Pain: crib bar hit above threshold impulse, for every baby-side collision type.
        crib_post_solve = make_impulse_pain_handler(env_self, threshold=PAIN_CRIB_IMPULSE, tag="crib")
        for baby_side in (PartCollisionType.TORSO, PartCollisionType.HEAD, PartCollisionType.LIMB, PartCollisionType.HAND):
            space.on_collision(int(baby_side), int(PartCollisionType.CRIB), post_solve=crib_post_solve)

        # Pain: head hard-hitting the floor.
        head_floor_post_solve = make_impulse_pain_handler(env_self, threshold=PAIN_HEAD_FLOOR_IMPULSE, tag="head_floor")
        space.on_collision(int(PartCollisionType.HEAD), int(PartCollisionType.FLOOR), post_solve=head_floor_post_solve)


def make_impulse_pain_handler(
    env_self: "MotorBabbleBabyEnv",
    threshold: float,
    tag: str,
):
    """Build a post-solve callback that flags a pain event when the impulse exceeds `threshold`.

    Returned closure signature matches pymunk 7's `on_collision(post_solve=fn)`.
    """
    def post_solve(arbiter: pymunk.Arbiter, s: pymunk.Space, data: object) -> None:
        impulse_magnitude = float(arbiter.total_impulse.length)
        if impulse_magnitude >= threshold:
            env_self.pending_pain_events.append(tag)
    return post_solve


def register_env() -> None:
    """Register MotorBabbleBaby-v0 with gymnasium's global registry (idempotent)."""
    if "MotorBabbleBaby-v0" in registry:
        return
    register(
        id="MotorBabbleBaby-v0",
        entry_point="motor_babble_rl.baby_env:MotorBabbleBabyEnv",
        max_episode_steps=MAX_CONTROL_STEPS,
    )
