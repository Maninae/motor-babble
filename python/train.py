"""Train PPO on MotorBabbleBaby-v0 with stable-baselines3.

Usage:
    python train.py --task crawl --timesteps 200000 --run-name crawl_baseline
    python train.py --task crawl --scrambled --timesteps 500000 --run-name crawl_scrambled

Everything lands under `runs/<run_name>/`:
    tb/               TensorBoard event files (view with `tensorboard --logdir runs`)
    checkpoints/      periodic .zip snapshots
    final_model.zip   the model at the end of training
    config.yaml       resolved hyperparams, so a run can be replayed

Vectorized environments use SubprocVecEnv when --num-envs > 1, which gives real
parallelism on macOS since each PPO env is CPU-bound in pymunk. On the low end
(--num-envs 1) it falls back to DummyVecEnv, which is easier to debug.
"""

import argparse
import json
import logging
from pathlib import Path

import motor_babble_rl                                     # registers MotorBabbleBaby-v0
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import CheckpointCallback
from stable_baselines3.common.env_util import make_vec_env
from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv

_ = motor_babble_rl                                        # keep import so registration runs

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("motor_babble_rl.train")


DEFAULT_PPO_HYPERPARAMS: dict[str, float | int] = {
    # PPO hyperparams that ship well for MuJoCo-scale continuous control on CPU.
    # Tuned to be reasonable, not maximal: n_steps * n_envs = rollout size = 16k.
    "learning_rate": 3e-4,
    "n_steps": 2048,
    "batch_size": 128,
    "n_epochs": 10,
    "gamma": 0.99,
    "gae_lambda": 0.95,
    "clip_range": 0.2,
    "ent_coef": 0.0,
    "vf_coef": 0.5,
    "max_grad_norm": 0.5,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--task", type=str, default="crawl", choices=["crawl", "rollover"])
    parser.add_argument("--scrambled", action="store_true",
                        help="turn on the per-episode action permutation + sign flip")
    parser.add_argument("--timesteps", type=int, default=200_000,
                        help="total environment steps to train for")
    parser.add_argument("--num-envs", type=int, default=8,
                        help="parallel envs; SubprocVecEnv above 1, DummyVecEnv at 1")
    parser.add_argument("--run-name", type=str, default="crawl_baseline",
                        help="name of the subdir under runs/")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--checkpoint-every", type=int, default=50_000,
                        help="env-steps between checkpoints; disable with 0")
    parser.add_argument("--runs-root", type=Path, default=Path(__file__).parent / "runs")
    parser.add_argument("--device", type=str, default="cpu",
                        help="torch device; 'cpu' is the honest choice on Mac (no CUDA)")
    return parser.parse_args()


def make_env_factory(task: str, scrambled: bool):
    """Return a zero-arg factory that gymnasium.make's a fresh env instance.

    make_vec_env calls this once per worker so the SubprocVecEnv fork boundary
    receives a picklable no-arg callable, not a bound env.
    """
    import gymnasium as gym

    def factory() -> gym.Env:
        return gym.make("MotorBabbleBaby-v0", task=task, scrambled_wiring=scrambled)

    return factory


def build_vec_env(num_envs: int, task: str, scrambled: bool, seed: int):
    vec_cls = SubprocVecEnv if num_envs > 1 else DummyVecEnv
    return make_vec_env(
        make_env_factory(task=task, scrambled=scrambled),
        n_envs=num_envs,
        seed=seed,
        vec_env_cls=vec_cls,
    )


def main() -> None:
    args = parse_args()

    run_dir = args.runs_root / args.run_name
    tb_dir = run_dir / "tb"
    checkpoints_dir = run_dir / "checkpoints"
    run_dir.mkdir(parents=True, exist_ok=True)
    tb_dir.mkdir(parents=True, exist_ok=True)
    checkpoints_dir.mkdir(parents=True, exist_ok=True)

    hyperparams = dict(DEFAULT_PPO_HYPERPARAMS)
    resolved_config = {
        "task": args.task,
        "scrambled": args.scrambled,
        "num_envs": args.num_envs,
        "timesteps": args.timesteps,
        "seed": args.seed,
        "ppo": hyperparams,
    }
    (run_dir / "config.json").write_text(json.dumps(resolved_config, indent=2))
    logger.info("run config: %s", resolved_config)

    vec_env = build_vec_env(args.num_envs, args.task, args.scrambled, args.seed)

    model = PPO(
        policy="MlpPolicy",
        env=vec_env,
        tensorboard_log=str(tb_dir),
        seed=args.seed,
        device=args.device,
        verbose=1,
        **hyperparams,
    )

    callbacks = []
    if args.checkpoint_every > 0:
        callbacks.append(CheckpointCallback(
            save_freq=max(1, args.checkpoint_every // max(1, args.num_envs)),
            save_path=str(checkpoints_dir),
            name_prefix="ppo",
        ))

    logger.info("training for %d steps across %d envs (%s)",
                args.timesteps, args.num_envs, "SubprocVecEnv" if args.num_envs > 1 else "DummyVecEnv")
    model.learn(total_timesteps=args.timesteps, callback=callbacks or None, progress_bar=False)

    final_model_path = run_dir / "final_model.zip"
    model.save(str(final_model_path))
    logger.info("saved final model -> %s", final_model_path)

    vec_env.close()


if __name__ == "__main__":
    main()
