// The scrambled nervous system: which letter fires which muscle.
//
// All 26 letters do SOMETHING (a newborn has no dead inputs, only mysterious ones):
//   - 16 letters map to clean single actions (8 muscles x flex/extend)
//   - 10 letters are "crossed wires": co-activations of 2-3 random actions at reduced
//     strength, like the whole-body movements real newborns make
// The mapping is hidden. Proprioception (cumulative use) gradually reveals labels.

import { MUSCLES, MUSCLE_COUNT, REVEAL } from './config.js';
import { createRng, shuffleInPlace } from './rng.js';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const COMBO_STRENGTH = 0.6;

export function createWiring(seedString) {
  /** Build the letter -> muscle-activation wiring for one body (one run).
   *
   * Returns { actions, describeKey, revealedLabel, noteUse, activationsForKeys }.
   * An "action" is { muscleIndex, direction } with direction +1 flex / -1 extend.
   */
  const rng = createRng(seedString + '::wiring');

  const singleActions = [];
  for (let m = 0; m < MUSCLE_COUNT; m++) {
    singleActions.push({ muscleIndex: m, direction: 1 });
    singleActions.push({ muscleIndex: m, direction: -1 });
  }
  shuffleInPlace(singleActions, rng);

  const letters = shuffleInPlace(LETTERS.slice(), rng);
  const keyActions = {};   // letter -> [{muscleIndex, direction, strength}]
  const keyKind = {};      // letter -> 'single' | 'combo'

  letters.forEach((letter, i) => {
    if (i < singleActions.length) {
      keyActions[letter] = [{ ...singleActions[i], strength: 1 }];
      keyKind[letter] = 'single';
    } else {
      const comboSize = 2 + Math.floor(rng() * 2);
      const combo = [];
      for (let c = 0; c < comboSize; c++) {
        const pick = singleActions[Math.floor(rng() * singleActions.length)];
        combo.push({ ...pick, strength: COMBO_STRENGTH });
      }
      keyActions[letter] = combo;
      keyKind[letter] = 'combo';
    }
  });

  const useSeconds = {};   // letter -> cumulative seconds held
  LETTERS.forEach((l) => { useSeconds[l] = 0; });

  function noteUse(letter, dt) {
    if (useSeconds[letter] !== undefined) useSeconds[letter] += dt;
  }

  function isRevealed(letter) {
    const threshold = keyKind[letter] === 'single' ? REVEAL.SINGLE_SEC : REVEAL.COMBO_SEC;
    return useSeconds[letter] >= threshold;
  }

  function describeKey(letter) {
    /** Human label for a revealed key, e.g. "right hip flex" or "crossed: left knee + right shoulder". */
    const actions = keyActions[letter];
    if (!actions) return '';
    if (keyKind[letter] === 'single') {
      const a = actions[0];
      return `${MUSCLES[a.muscleIndex].label} ${a.direction > 0 ? 'flex' : 'extend'}`;
    }
    const parts = actions.map((a) => MUSCLES[a.muscleIndex].label);
    return `crossed: ${parts.join(' + ')}`;
  }

  function revealedLabel(letter) {
    return isRevealed(letter) ? describeKey(letter) : null;
  }

  function activationsForKeys(heldLetters) {
    /** Sum held keys into per-muscle activations in [-1, 1]. */
    const activations = new Array(MUSCLE_COUNT).fill(0);
    for (const letter of heldLetters) {
      const actions = keyActions[letter];
      if (!actions) continue;
      for (const a of actions) {
        activations[a.muscleIndex] += a.direction * a.strength;
      }
    }
    for (let m = 0; m < MUSCLE_COUNT; m++) {
      activations[m] = Math.max(-1, Math.min(1, activations[m]));
    }
    return activations;
  }

  return { keyActions, keyKind, noteUse, isRevealed, describeKey, revealedLabel, activationsForKeys };
}
