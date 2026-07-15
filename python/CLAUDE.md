# motor_babble_rl - agent onboarding

This is the Python half of Motor Babble: a 2D physics baby with 8 muscles, wrapped in a Gymnasium environment, trained with stable-baselines3 PPO. The JS browser game lives at `../js/`; the two rhyme but are not step-identical (planck.js vs pymunk are different physics engines).

## Module map

Every file has a module docstring; read that first. This is the shape:

| File | Responsibility |
|---|---|
| `motor_babble_rl/config.py` | All physics, morphology, reward, and rendering constants. One source of truth. |
| `motor_babble_rl/morphology.py` | Build the ragdoll `Baby` (bodies + revolute joints + motors) in a pymunk `Space`. |
| `motor_babble_rl/nursery.py` | Build the static world (floor, walls, crib bar). Split from morphology to keep each single-responsibility. |
| `motor_babble_rl/wiring.py` | `ActionScramble`: fixed permutation + sign flip applied to the 8-dim action vector. The research knob. |
| `motor_babble_rl/milestones.py` | Milestone state machine (hand-to-face -> ... -> reach-parent). Pure over snapshots, no pymunk types. |
| `motor_babble_rl/rewards.py` | Per-task reward shaping. Returns a `RewardBreakdown` (total + per-component). |
| `motor_babble_rl/baby_env.py` | The `MotorBabbleBabyEnv` gymnasium env. Coordinator: owns space + baby + milestones + wiring. |
| `motor_babble_rl/rendering.py` | Pygame renderer. Human window mode and offscreen `rgb_array` mode. |
| `motor_babble_rl/__init__.py` | Package init. Registers `MotorBabbleBaby-v0` with gymnasium on import. |
| `train.py` | Stable-baselines3 PPO trainer, vectorized envs, TensorBoard, checkpoints. |
| `watch.py` | Load a checkpoint, run episodes with pygame window or gif capture. |
| `random_rollout.py` | No-training sanity check: newborn flailing. |

## Data flow

```
policy action (8-dim)
  -> ActionScramble.apply (optional per-episode permute + sign flip)
  -> _apply_muscle_activations: sets rate + max_force on each pymunk.SimpleMotor
  -> space.step x FRAME_SKIP (60 Hz physics, 15 Hz control)
  -> pymunk on_collision callbacks fire: hand-on-face count, pending pain events
  -> MilestoneTracker.update reads torso/head snapshot
  -> compute_reward assembles per-task shaping + shared penalties/bonuses
  -> _compose_observation packs joint angles/velocities + torso/head state
```

## Adding a new task

1. Add a `TaskName` member in `config.py`.
2. Add reward constants (scales, bonuses) in `config.py`.
3. Extend the dispatch in `rewards.compute_reward`.
4. If it needs new state (like the rocking peaks), add it to `RewardStateSummary` and to the env's per-step bookkeeping (init in `__init__`, reset in `reset`, update inside the frame-skip loop or after it in `step`).
5. If it needs new observation dims, update `OBSERVATION_DIM` and `_compose_observation` together.
6. If it needs a task-specific termination, extend the `terminated = ...` expression in `step()`.

## The rollover task: rocking, not flipping

An in-plane 180-degree flip is physically impossible for this sagittal-view morphology (it is a somersault, and evolutionary search on the JS side plateaued around 0.8 rad). The `rollover` task instead rewards the honest physical skill: rocking. The env tracks per-physics-step decaying peaks of the wrapped torso angle:

```
peak_pos = max(peak_pos * 0.995, wrap_angle(torso.angle))
peak_neg = min(peak_neg * 0.995, wrap_angle(torso.angle))
```

Reward = `SCALE * ((peak_pos - peak_neg) - previous_amplitude)`, so growth pays and decay costs. Amplitude crossing 0.65 rad grants the completion bonus and terminates the episode. In the JS game the actual flip is scripted past this same threshold; the RL task hands off a policy that has learned the physics-side skill. The torso's small round back bulge is what makes this achievable; a flat back on a flat floor cannot rock.

## Adding a new muscle

Do not, casually. The 8-muscle contract is baked into the observation shape, the action space, the scramble, and every JS/Python reward. If you must, edit `MuscleIndex`, `MUSCLE_COUNT`, `FLEX_SIGN_BY_MUSCLE`, `GROUP_BY_MUSCLE`, the muscle dicts on `Baby`, and every checkpoint becomes garbage.

## Rendering

Two modes only, per gymnasium convention: `"human"` opens a real pygame window; `"rgb_array"` renders offscreen and returns `(H, W, 3) uint8`. For headless capture (CI, gif), set `SDL_VIDEODRIVER=dummy` in the environment before instantiating the env. `watch.py --gif` and `random_rollout.py --headless` do this for you.

## Determinism

- Physics is deterministic per (seed, action sequence) on the same machine. `super().reset(seed=)` seeds `self.np_random`.
- The action scramble is sampled from `self.np_random`, so scrambled wiring is also seed-deterministic.
- Sleep is disabled (`space.sleep_time_threshold = inf`) because `SimpleMotor.rate` writes do not wake sleeping bodies.

## Gotchas

- **pymunk 7**: collision handlers use `space.on_collision(a, b, begin=..., post_solve=..., separate=...)`. The pre-7 `add_collision_handler` no longer exists.
- **pygame-ce, not pygame**: upstream `pygame` 2.6.1 has a circular-import bug on Python 3.14. `pygame-ce` is the community-maintained fork with the fix.
- **Env checker**: `gymnasium.utils.env_checker.check_env(env.unwrapped, skip_render_check=True)` passes with soft warnings about infinite observation bounds. Those are cosmetic; joint velocities are physically unbounded.
- **SubprocVecEnv on macOS**: gymnasium 1.x requires `if __name__ == "__main__":` guards for `spawn` start method; `train.py` has one.

## Testing

There is no formal test suite yet. Quick sanity checks:

```
.venv/bin/python -c "import motor_babble_rl; import gymnasium as gym; env = gym.make('MotorBabbleBaby-v0'); env.reset(seed=0); print(env.step(env.action_space.sample()))"
SDL_VIDEODRIVER=dummy .venv/bin/python random_rollout.py --headless --steps 50 --frames-dir /tmp/mbf
.venv/bin/python -m gymnasium.utils.env_checker  # or embed check_env in a script
```
