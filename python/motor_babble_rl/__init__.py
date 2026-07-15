"""Motor Babble RL: 2D ragdoll-baby playground for reinforcement learning.

Importing this package registers the `MotorBabbleBaby-v0` gymnasium environment as
a side effect, so you can `gymnasium.make("MotorBabbleBaby-v0", ...)` immediately.
"""

from motor_babble_rl.baby_env import MotorBabbleBabyEnv, register_env
from motor_babble_rl.config import MuscleIndex, TaskName

register_env()

__all__ = ["MotorBabbleBabyEnv", "MuscleIndex", "TaskName", "register_env"]
