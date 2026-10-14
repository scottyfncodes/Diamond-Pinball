export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  /** Visual unlock granted with the achievement, if any. */
  unlock?: { id: string; title: string };
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_hr', title: 'Going, Going, Gone', description: 'Hit your first home run.', unlock: { id: 'gold', title: 'Gold Rails' } },
  { id: 'bases_loaded', title: 'Ducks on the Pond', description: 'Load the bases.' },
  { id: 'ramp_streak', title: 'Triple Threat', description: 'Three consecutive ramp shots.', unlock: { id: 'neon', title: 'Neon Night Game' } },
  { id: 'double_play', title: 'Twin Killing', description: 'Turn a double play on defense.' },
  { id: 'three_hr', title: 'Slugger', description: 'Three home runs in one game.', unlock: { id: 'cherry', title: 'Cherry Cabinet' } },
  { id: 'comeback', title: 'Last Licks', description: 'Win after trailing in the final inning.' },
  { id: 'perfect_contact', title: 'Sweet Spot', description: 'Record perfect contact.' },
  { id: 'complete_win', title: 'Ballgame!', description: 'Win a complete game.', unlock: { id: 'champion', title: 'Champion Pennants' } },
  { id: 'multiball', title: 'Bullpen Session', description: 'Start multiball.' },
  { id: 'skill_shot', title: 'First Pitch Strike', description: 'Nail the skill shot.' },
  { id: 'grand_slam', title: 'Grand Salami', description: 'Hit a grand slam.' },
  { id: 'steal', title: 'Wheels', description: 'Steal a base.' },
  { id: 'wall_bounce', title: 'Off the Wall', description: 'Light all three outfield wall sections.', unlock: { id: 'rooftop', title: 'Rooftop Arena' } },
  { id: 'squeeze', title: 'Squeeze Play', description: 'Score a runner from third with the lit home plate.' },
  { id: 'scoreboard', title: 'Lights Out', description: 'Cycle all three bumpers for a SCOREBOARD boost.' },
  { id: 'modifier_5', title: 'Lawbreaker', description: 'Trigger five different table modifiers.', unlock: { id: 'skin_gold', title: 'Gold Ball' } },
  { id: 'black_hole', title: 'Event Horizon', description: 'Feed the pinball black hole.', unlock: { id: 'lunar', title: 'Lunar Park' } },
  { id: 'derby', title: 'Derby Champion', description: 'Hit three homers in one HOME RUN DERBY.', unlock: { id: 'skin_baseball', title: 'Baseball Ball' } },
  { id: 'chaos', title: 'Embrace Chaos', description: 'Start CHAOS MULTIBALL.' },
  { id: 'boss_ace', title: 'Ace Chaser', description: 'Chase THE ACE from the mound.' },
  { id: 'boss_wall', title: 'Wall Breaker', description: 'Shatter THE WALL.', unlock: { id: 'skin_fire', title: 'Fireball Trail' } },
  { id: 'boss_commissioner', title: 'Commissioner Approved', description: "Complete the COMMISSIONER'S CHALLENGE." },
  { id: 'boss_nightmare', title: 'Sweet Dreams', description: 'Walk off the NINTH-INNING NIGHTMARE.', unlock: { id: 'cosmic', title: 'Cosmic Championship' } },
  { id: 'combo_10', title: 'Absolute Legend', description: 'Reach a x10 combo.' },
  { id: 'impossible_easy', title: 'The Impossible Inning (Slugger)', description: 'Complete THE IMPOSSIBLE INNING on EASY.' },
  { id: 'impossible_medium', title: 'The Impossible Inning (All-Star)', description: 'Complete THE IMPOSSIBLE INNING on MEDIUM.', unlock: { id: 'skin_cosmic', title: 'Cosmic Ball' } },
  { id: 'impossible_hard', title: 'The Impossible Inning (Hall of Fame)', description: 'Complete THE IMPOSSIBLE INNING on HARD. Nobody does this.' },
  { id: 'hard_win', title: 'Hall of Famer', description: 'Win a complete game on HARD.' },
  { id: 'hard_homer', title: 'Small Ball, Big Fly', description: 'Hit a home run on HARD.' },
  { id: 'hard_combo', title: 'Barely Tolerated', description: 'Reach a x7 combo on HARD.' },
  { id: 'easy_grand', title: 'Superhero', description: 'Hit a grand slam on EASY.' },
  { id: 'city_rush', title: 'Track Star', description: 'Finish a WALL CATCH at the sandlot.' },
  { id: 'city_legend', title: 'Robbed!', description: 'A clean WALL CATCH that robs the home run.' },
  { id: 'reactor_overload', title: 'Critical Mass', description: 'Overload the REACTOR CORE.' },
  { id: 'meltdown', title: 'Meltdown', description: 'Sync all five reactor pulses.' },
  { id: 'grand_tour', title: 'Grand Tour', description: 'Homer, finish a Wall Catch and overload the reactor in one game.' },
];

/** Ball skins: the id is also the unlock id. */
export const BALL_SKINS: Array<{ id: string; name: string; description: string }> = [
  { id: 'skin_steel', name: 'Chrome Steel', description: 'The regulation pinball.' },
  { id: 'skin_baseball', name: 'Baseball', description: 'Stitched horsehide. Unlocked by Derby Champion.' },
  { id: 'skin_gold', name: 'Gold', description: 'Solid gold. Unlocked by Lawbreaker.' },
  { id: 'skin_fire', name: 'Fireball', description: 'A burning trail. Unlocked by Wall Breaker.' },
  { id: 'skin_cosmic', name: 'Cosmic', description: 'Starlight chrome. Unlocked by The Impossible Inning.' },
];

export const achievementById = (id: string): AchievementDef | undefined => ACHIEVEMENTS.find((a) => a.id === id);
