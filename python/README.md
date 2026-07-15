# Motor Babble - Python RL sandbox

A 2D physics baby with 8 muscles, wrapped in Gymnasium, trained with stable-baselines3 PPO. The Python half of Motor Babble; the browser game is at `../js/`.

## What it is

A ragdoll baby (torso, head, two arms, two legs) lies supine in a nursery. The parent is at the far right. The RL agent produces an 8-dim continuous action every 66 ms; each dim drives one revolute motor at a target angular velocity, capped by a per-joint torque limit. The ragdoll physics is pymunk 7; the goal in the default `crawl` task is to reach the parent by any wriggling means the policy can invent.

Milestones give discrete bonuses along the way: hand-to-face, roll-over, tummy-time, first scoot, reach-parent. The reward signal is dense (per-step forward-torso-displacement shaping) plus sparse milestone bonuses, minus a small energy penalty (per-second-scaled sum of squared activations) and pain penalty for crashing into the crib bar.

**Rock-to-roll (mirrors the JS game):** a 180-degree sagittal-plane roll is a somersault this morphology cannot do, so ROLL_OVER is scripted. The env tracks a decaying rocking amplitude of the wrapped torso angle in every task. When it crosses 0.65 rad (the JS game's roll trigger), the env flips a `facing` state from up to down and grants the ROLL_OVER milestone. After the flip, the observation's prone flag reads True whenever the torso settles near flat, and TUMMY_TIME becomes reachable when the baby lifts the head from prone.

## The research knob

`scrambled_wiring=True` applies a per-episode fixed permutation and sign flip to the action vector before it reaches the motors. It is the same handicap the human player suffers in the browser game (random keyboard letters drive random muscles), lifted into a domain-randomization variant an RL agent must learn to solve. Trained with the scramble on, the agent is forced to infer its own effector mapping from noisy exploration alone. Trained with it off, it gets the clean fixed wiring by muscle index.

The scramble is resampled from the episode seed on every `reset(seed=...)`, so a fixed seed pins one wiring for reproducibility, and different seeds train an agent to solve any wiring.

## Install

```
python3.12 -m venv .venv     # or python3.14; Python 3.12+ required
.venv/bin/pip install -r requirements.txt
```

CPU-only. There is no CUDA on Mac and PPO on this env is CPU-bound in pymunk anyway.

## Run

```
# Newborn flailing (no policy, random actions, renders a window)
.venv/bin/python random_rollout.py

# Train PPO on the crawl task, ~200k steps takes a few minutes on 8 CPUs
.venv/bin/python train.py --task crawl --timesteps 200000 --run-name crawl_baseline

# Same, with the scrambled wiring on (much harder; the interesting run)
.venv/bin/python train.py --task crawl --scrambled --timesteps 500000 --run-name crawl_scrambled

# Watch a trained policy
.venv/bin/python watch.py --checkpoint runs/crawl_baseline/final_model.zip --episodes 3

# Record a gif of a trained policy, headless
.venv/bin/python watch.py --checkpoint runs/crawl_baseline/final_model.zip --gif rollout.gif --episodes 1

# TensorBoard
tensorboard --logdir runs
```

## Environment interface

```python
import motor_babble_rl                                    # registers the env id
import gymnasium as gym

env = gym.make("MotorBabbleBaby-v0",
               task="crawl",              # or "rollover"
               scrambled_wiring=False,
               render_mode=None)          # or "human" / "rgb_array"

obs, info = env.reset(seed=42)             # obs: float32 (23,), info: dict
obs, reward, terminated, truncated, info = env.step(action)
```

- **action**: `Box(-1, 1, (8,), float32)`. Order: `[shoulder_near, elbow_near, hip_near, knee_near, shoulder_far, elbow_far, hip_far, knee_far]`.
- **observation** (float32, shape `(23,)`):
  - `[0:8]` joint angles, normalized to `[-1, 1]` against each joint's limits
  - `[8:16]` joint angular velocities, scaled by `1 / MOTOR_MAX_RATE`
  - `[16:18]` torso angle as `(sin, cos)`
  - `[18]` torso height (m)
  - `[19]` torso x-velocity (m/s)
  - `[20]` head height (m)
  - `[21]` hand-on-face contact flag
  - `[22]` prone flag (True only after the scripted roll flips facing, AND the torso has settled near flat)
- **reward** (crawl): per-step forward torso displacement + `+2.0` per new milestone (except REACH_PARENT) + `+10.0` on reach-parent (terminal, exact, not stacked with the milestone bonus) - energy penalty `-REWARD_ENERGY_PENALTY * sum(a^2) * control_dt_seconds` (per-second-scaled; magnitude preserved if FRAME_SKIP is retuned) - `1.0` per pain impact.
- **reward** (rollover): growth of the tracked rocking amplitude `(peak_pos - peak_neg)` of the wrapped torso angle, where the peaks decay 0.5% per physics tick (~1.2 s memory). `+10.0` completion bonus when amplitude first crosses `0.65 rad`, then terminate. Same energy + pain + milestone terms as crawl.
- **terminated**: `reach-parent` (crawl) or rocking amplitude >= 0.65 rad (rollover, flips `facing_down` in the info dict).
- **truncated**: 450 control steps (30 s at 15 Hz).

**Why rollover rewards rocking, not flipping**: a 180-degree in-plane roll from supine to prone is a somersault, physically impossible for this sagittal-view morphology (evolutionary search on the JS side plateaued around 0.8 rad). The task therefore trains the honest physical prerequisite: rocking hard enough that a real flip would follow. In the JS game the actual flip is scripted past this same threshold; the Python RL task stops at threshold and hands the trainer a policy that has learned the physics-side skill. In the crawl task the same threshold-crossing grants the ROLL_OVER milestone but does not terminate.

The torso includes a small round back bulge (radius 0.065 m at local offset (0, -0.005)) that enables rocking; without it the flat back cannot pump an oscillation on a flat floor.

## Rerunning training

Passing an existing `--run-name` aborts by default (SB3's TensorBoard writer would silently create `PPO_2`, `PPO_3`, ... subdirs while other artifacts overwrite in place, producing a mixed-generation directory). Pass `--force` to move the old run to Trash via `/usr/bin/trash` (recoverable) and start over cleanly.

## Honest note on parity with the JS game

The JS build uses planck.js (Box2D port) and the Python build uses pymunk (Chipmunk); the two are not step-identical. Sizes, joint limits, torque caps, and reward shape are matched deliberately, but a trained policy will not transfer verbatim to the JS sim. The Python side is where you do RL; the JS side is where humans wrestle with the scrambled keyboard. They are two sides of the same coin, not two runs of the same simulator.

## Layout

```
python/
  motor_babble_rl/
    __init__.py          # registers MotorBabbleBaby-v0
    config.py            # all constants
    morphology.py        # ragdoll construction
    nursery.py           # static world
    wiring.py            # ActionScramble
    milestones.py        # milestone detector
    rewards.py           # per-task reward shaping
    baby_env.py          # gymnasium.Env
    rendering.py         # pygame renderer
  train.py               # PPO trainer
  watch.py               # load + roll out + gif
  random_rollout.py      # sanity check
  requirements.txt
  CLAUDE.md              # architecture map for future agents
```

See `CLAUDE.md` for module-level rationale and gotchas.
