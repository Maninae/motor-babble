// The baby-brain journal: the game's inner voice. Every event becomes a first-person
// thought from someone six weeks old with no world model. The comedy rule: the baby
// never correctly attributes cause and effect. Superstitions are load-bearing.

import { createRng } from './rng.js';

const OPENING_LINES = [
  'i exist. this is new information.',
  'status report: i am awake. everything is enormous.',
  'day one of being a person. so far: confusing.',
];

const FIRST_KEY_LINES = [
  'wait. something MOVED. was that... me??',
  'i have discovered a lever. somewhere. in me.',
  'a thing twitched and i think i did it. power.',
];

const SELF_BONK_LINES = [
  'SOMETHING JUST HIT MY FACE. who did this.',
  'attacked. in my own crib. unbelievable.',
  'a soft thing struck my cheek. i will find whoever did this.',
  'face impact detected. suspect: unknown. definitely not me.',
];

const PAIN_LINES = [
  'OW. OW?? the world has STRUCK me. why. WHY.',
  'PAIN. sudden and total. this place is cruel and i want a refund.',
  'something hard exists and my leg found it. crying now, questions later.',
];

const SUPERSTITION_LINES = [
  'i have concluded the "{key}" feeling causes pain. never again.',
  'note to self: the mobile did this. i know it. it has been watching.',
  'this happened because the light changed earlier. it all connects.',
];

const SOOTHE_LINES = [
  'found a warm thing near my mouth. it is mine?? it was mine ALL ALONG.',
  'hand acquired. calm restored. i am a genius.',
  'soft. warm. tastes like: me. no notes.',
  'my hand is a good hand. we are best friends now.',
];

const MELTDOWN_LINES = [
  'that is IT. all systems: scream.',
  'i did not ask to be born. WAAAAH.',
  'complaint filed with the universe. loudly. and forever.',
  'everything is bad and i will be informing MANAGEMENT.',
];

// Idle musings: fired on a timer when the journal has been quiet for a while.
// The camera on the ceiling is a load-bearing character. Newborns really do stare at it.
const IDLE_MUSING_LINES = [
  'the ceiling continues to exist. i am watching it.',
  'still soft. still down here. still confused.',
  'a shape drifted past. it was probably a shape.',
  'i think a lot about my toes. but i cannot see them.',
  'existence: ongoing. review: mixed.',
  'the light is doing a slow thing. i respect it.',
  'somewhere in me a leg is planning something.',
  'a spider is looking at me. wait no. that is a fingernail.',
  'i have a lot of thoughts and none of them are words.',
  'i can hear my own heart. it is very loud in here.',
];

const MILESTONE_LINES = {
  'hand-to-face': 'the soft attacker... is me. my arm is MINE. i control the arm.',
  'roll-over': 'the world just spun and now the ground hugs me. i meant to do that.',
  'tummy-time': 'holding my head up. the heaviest thing i own. mighty.',
  'scoot': 'i have MOVED. the rug is not forever. distance is a thing i can DO.',
  'reach-parent': 'the big warm face!!! i traveled the whole world to you.',
};

const REPEAT_ROLL_LINES = [
  'the world spun again. i am a tumbleweed now.',
  'flip! ceiling, floor, ceiling. i contain multitudes.',
  'rolled again. the ground and i are taking turns.',
];

const INSTINCT_LINES = [
  'something ancient in me knows how to wiggle. i will let it drive.',
  'generations of babies whisper: kick like this.',
];

export function createJournal(seedString) {
  /** Event -> journal line generator with a seeded stream so runs are reproducible. */
  const rng = createRng(seedString + '::journal');
  // Per-list memory of the index we just returned, so we never hand out the
  // same line twice in a row from the same pool (single-item pools excepted).
  // A back-to-back repeat reads as a bug and drains the comedy fast.
  const lastPickIndex = new Map();
  function pick(lines) {
    if (lines.length <= 1) return lines[0];
    const prev = lastPickIndex.get(lines);
    let i = Math.floor(rng() * lines.length);
    if (i === prev) i = (i + 1) % lines.length;
    lastPickIndex.set(lines, i);
    return lines[i];
  }

  function lineFor(event) {
    switch (event.type) {
      case 'opening': return pick(OPENING_LINES);
      case 'first-key': return pick(FIRST_KEY_LINES);
      case 'self-bonk': return pick(SELF_BONK_LINES);
      case 'pain': {
        // Half the time, the baby forms a wrong theory about what caused the pain.
        if (event.recentKey && rng() < 0.5) {
          return pick(PAIN_LINES) + ' ' + pick(SUPERSTITION_LINES).replace('{key}', event.recentKey);
        }
        return pick(PAIN_LINES);
      }
      case 'soothe': return pick(SOOTHE_LINES);
      case 'roll': return pick(REPEAT_ROLL_LINES);
      case 'meltdown': return pick(MELTDOWN_LINES);
      case 'milestone': return MILESTONE_LINES[event.id] || 'i did a thing. a big thing.';
      case 'instinct': return pick(INSTINCT_LINES);
      case 'idle-musing': return pick(IDLE_MUSING_LINES);
      default: return null;
    }
  }

  return { lineFor };
}
