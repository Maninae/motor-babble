"""The scrambled nervous system: fixed permutation + sign flip applied to actions.

This is the research-question knob of the whole repo. With `scrambled=False` the
policy sees straightforward muscle indices; with `scrambled=True` a per-episode
random permutation and per-muscle random sign remap the 8 actions before they
reach the motors. It is the same handicap the human player suffers in the JS
game (where random letter keys drive random muscles), lifted into a domain
randomization variant an RL agent must learn to tolerate.

The scramble is resampled from the episode seed on every `reset(seed=...)` when
scrambling is on, so a fixed seed yields a fixed body wiring, and different
seeds train an agent to solve any wiring.
"""

from dataclasses import dataclass

import numpy as np

from motor_babble_rl.config import MUSCLE_COUNT


@dataclass
class ActionScramble:
    """Fixed remap applied to the 8-dim action vector.

    - permutation[i] = j means "the policy's slot i drives the body's muscle j".
    - sign_flip[i] in {+1, -1} multiplies that slot before it reaches its motor.

    Identity scramble (permutation = 0..7, sign_flip = +1) is the "unscrambled"
    default. `apply` maps policy action -> body action, `invert` maps back so
    diagnostics can label body muscles in policy-action terms if needed.
    """

    permutation: np.ndarray                  # int64, shape (8,)
    sign_flip: np.ndarray                    # int8, shape (8,), values +/- 1

    def apply(self, policy_action: np.ndarray) -> np.ndarray:
        """policy_action (8,) -> body_action (8,), with per-slot permutation and sign flip."""
        body_action = np.zeros(MUSCLE_COUNT, dtype=np.float32)
        body_action[self.permutation] = policy_action * self.sign_flip
        return body_action

    def invert(self, body_action: np.ndarray) -> np.ndarray:
        """Inverse of `apply`, for tooling that starts from a body-action vector."""
        policy_action = np.zeros(MUSCLE_COUNT, dtype=np.float32)
        policy_action[:] = body_action[self.permutation] * self.sign_flip
        return policy_action

    def describe(self) -> str:
        """Human-readable summary, e.g. 'perm=[3 0 5 ...] signs=[+ - + ...]'."""
        signs = "".join("+" if s > 0 else "-" for s in self.sign_flip.tolist())
        return f"perm={self.permutation.tolist()} signs={signs}"


def identity_scramble() -> ActionScramble:
    """The no-op wiring: the policy's slot i drives the body's muscle i, positive-going."""
    return ActionScramble(
        permutation=np.arange(MUSCLE_COUNT, dtype=np.int64),
        sign_flip=np.ones(MUSCLE_COUNT, dtype=np.int8),
    )


def random_scramble(rng: np.random.Generator) -> ActionScramble:
    """Sample a fresh random wiring from `rng`.

    The permutation is a full 8-element shuffle. Each sign is +1 or -1 with prob 1/2.
    Two calls with the same seed produce the same scramble.
    """
    permutation = rng.permutation(MUSCLE_COUNT).astype(np.int64)
    sign_flip = np.where(rng.random(MUSCLE_COUNT) < 0.5, -1, 1).astype(np.int8)
    return ActionScramble(permutation=permutation, sign_flip=sign_flip)
