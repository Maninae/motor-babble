"""No-training sanity check: drive the env with random actions and render it.

This is the "newborn flailing" baseline. It should run end-to-end, print
per-step diagnostics, and let you visually confirm the physics and rendering
are alive before you sink hours into training.

Usage:
    python random_rollout.py                                   # opens a window
    python random_rollout.py --gif flail.gif --steps 200       # writes a gif
    SDL_VIDEODRIVER=dummy python random_rollout.py --headless --frames-dir /tmp/frames  # save PNGs
"""

import argparse
import logging
import os
from pathlib import Path

import numpy as np

import motor_babble_rl                                    # registers MotorBabbleBaby-v0

_ = motor_babble_rl

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("motor_babble_rl.random_rollout")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--task", type=str, default="crawl", choices=["crawl", "rollover"])
    parser.add_argument("--scrambled", action="store_true")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--steps", type=int, default=450, help="max control steps (30s at 15 Hz)")
    parser.add_argument("--headless", action="store_true",
                        help="do not open a window, render to rgb_array")
    parser.add_argument("--frames-dir", type=Path, default=None,
                        help="if set, save one PNG per step to this directory (headless only)")
    parser.add_argument("--frame-stride", type=int, default=50,
                        help="save every Nth frame when --frames-dir is set")
    parser.add_argument("--gif", type=Path, default=None,
                        help="if set, also write a gif of the full rollout (headless only)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.headless or args.gif is not None or args.frames_dir is not None:
        os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
        render_mode = "rgb_array"
    else:
        render_mode = "human"

    import gymnasium as gym

    env = gym.make(
        "MotorBabbleBaby-v0",
        task=args.task,
        scrambled_wiring=args.scrambled,
        render_mode=render_mode,
    )
    rng = np.random.default_rng(args.seed)
    observation, info = env.reset(seed=args.seed)
    logger.info("obs shape: %s, action shape: %s", observation.shape, env.action_space.shape)
    if args.scrambled:
        logger.info("scramble: permutation=%s signs=%s",
                    info["scramble_permutation"], info["scramble_signs"])

    frames: list[np.ndarray] = []
    total_reward = 0.0
    saved_frame_paths: list[Path] = []

    for step_index in range(args.steps):
        action = rng.uniform(-1.0, 1.0, size=env.action_space.shape).astype(np.float32)
        observation, reward, terminated, truncated, info = env.step(action)
        total_reward += float(reward)
        frame = env.render()
        if frame is not None:
            frames.append(frame)
            if args.frames_dir is not None and step_index % args.frame_stride == 0:
                args.frames_dir.mkdir(parents=True, exist_ok=True)
                png_path = args.frames_dir / f"frame_{step_index:04d}.png"
                import imageio.v3 as iio
                iio.imwrite(str(png_path), frame)
                saved_frame_paths.append(png_path)
                logger.info("saved %s (torso_x = %.3f, reward = %.3f)",
                            png_path, info["torso_x"], reward)
        if terminated or truncated:
            break

    logger.info("rollout done: steps = %d, total reward = %.2f, milestones = %s",
                step_index + 1, total_reward, info["milestones_achieved"])

    if args.gif is not None and frames:
        import imageio.v3 as iio
        args.gif.parent.mkdir(parents=True, exist_ok=True)
        iio.imwrite(str(args.gif), np.stack(frames), fps=15, loop=0)
        logger.info("wrote gif with %d frames -> %s", len(frames), args.gif)

    if saved_frame_paths:
        logger.info("saved %d frame PNG(s): %s", len(saved_frame_paths),
                    [str(path) for path in saved_frame_paths])

    env.close()


if __name__ == "__main__":
    main()
