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
];

const MELTDOWN_LINES = [
  'that is IT. all systems: scream.',
  'i did not ask to be born. WAAAAH.',
];

const MILESTONE_LINES = {
  'hand-to-face': 'the soft attacker... is me. my arm is MINE. i control the arm.',
  'roll-over': 'the world just spun and now the ground hugs me. i meant to do that.',
  'tummy-time': 'holding my head up. the heaviest thing i own. mighty.',
  'scoot': 'i have MOVED. the rug is not forever. distance is a thing i can DO.',
  'reach-parent': 'the big warm face!!! i traveled the whole world to you.',
};

const INSTINCT_LINES = [
  'something ancient in me knows how to wiggle. i will let it drive.',
  'generations of babies whisper: kick like this.',
];

export function createJournal(seedString) {
  /** Event -> journal line generator with a seeded stream so runs are reproducible. */
  const rng = createRng(seedString + '::journal');
  const pick = (lines) => lines[Math.floor(rng() * lines.length)];

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
      case 'meltdown': return pick(MELTDOWN_LINES);
      case 'milestone': return MILESTONE_LINES[event.id] || 'i did a thing. a big thing.';
      case 'instinct': return pick(INSTINCT_LINES);
      default: return null;
    }
  }

  return { lineFor };
}
