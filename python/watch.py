"""Load a trained PPO checkpoint and watch it (or record a gif).

Usage:
    # window mode
    python watch.py --checkpoint runs/crawl_baseline/final_model.zip

    # save a gif to disk (headless, no window)
    python watch.py --checkpoint runs/crawl_baseline/final_model.zip --gif rollout.gif --episodes 1

Prints per-episode reward and the milestones reached. The `--deterministic` flag
uses the policy's mean action instead of sampling.
"""

import argparse
import logging
import os
from pathlib import Path

import numpy as np

import motor_babble_rl                                     # registers MotorBabbleBaby-v0

_ = motor_babble_rl

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("motor_babble_rl.watch")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkpoint", type=Path, required=True,
                        help="path to a .zip saved by stable-baselines3 PPO")
    parser.add_argument("--task", type=str, default="crawl", choices=["crawl", "rollover"])
    parser.add_argument("--scrambled", action="store_true")
    parser.add_argument("--episodes", type=int, default=3)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--deterministic", action="store_true",
                        help="use policy mean instead of sampling")
    parser.add_argument("--gif", type=Path, default=None,
                        help="if set, render to rgb_array and write this gif; no window opens")
    parser.add_argument("--gif-fps", type=int, default=15,
                        help="frames per second in the output gif (control-rate is 15 Hz)")
    return parser.parse_args()


def rollout(env, model, seed: int, deterministic: bool, capture_frames: bool) -> tuple[float, list[str], list[np.ndarray]]:
    """Run one episode. Returns (total_reward, milestones_reached, captured_frames)."""
    observation, info = env.reset(seed=seed)
    frames: list[np.ndarray] = []
    total_reward = 0.0
    while True:
        action, _states = model.predict(observation, deterministic=deterministic)
        observation, reward, terminated, truncated, info = env.step(action)
        total_reward += float(reward)
        frame = env.render()
        if capture_frames and frame is not None:
            frames.append(frame)
        if terminated or truncated:
            break
    milestones = list(info.get("milestones_achieved", []))
    return total_reward, milestones, frames


def main() -> None:
    args = parse_args()

    if args.gif is not None:
        # Headless capture: no window, offscreen surface only.
        os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
        render_mode = "rgb_array"
    else:
        render_mode = "human"

    import gymnasium as gym
    from stable_baselines3 import PPO

    env = gym.make(
        "MotorBabbleBaby-v0",
        task=args.task,
        scrambled_wiring=args.scrambled,
        render_mode=render_mode,
    )
    model = PPO.load(str(args.checkpoint), device="cpu")

    all_frames: list[np.ndarray] = []
    for episode_index in range(args.episodes):
        total_reward, milestones, frames = rollout(
            env=env, model=model,
            seed=args.seed + episode_index,
            deterministic=args.deterministic,
            capture_frames=args.gif is not None,
        )
        logger.info("episode %d: reward = %.2f, milestones = %s", episode_index, total_reward, milestones)
        all_frames.extend(frames)

    if args.gif is not None and all_frames:
        import imageio.v3 as iio
        args.gif.parent.mkdir(parents=True, exist_ok=True)
        iio.imwrite(str(args.gif), np.stack(all_frames), fps=args.gif_fps, loop=0)
        logger.info("wrote gif with %d frames -> %s", len(all_frames), args.gif)

    env.close()


if __name__ == "__main__":
    main()
