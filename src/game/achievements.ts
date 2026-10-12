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
];

export const achievementById = (id: string): AchievementDef | undefined => ACHIEVEMENTS.find((a) => a.id === id);
