/**
 * Local persistence: settings, high scores, achievements and unlocks.
 * Everything is stored in localStorage; the game never needs a backend.
 */
import { DEFAULT_DIFFICULTY, normalizeDifficulty, type DifficultyId } from './difficulty';

export interface HighScoreEntry {
  name: string;
  pinballScore: number;
  homeRuns: number;
  hits: number;
  runsFor: number;
  runsAgainst: number;
  won: boolean;
  innings: number;
  date: string;
  /** Difficulty the score was earned on. Tables are kept per difficulty. */
  difficulty: DifficultyId;
}

export interface Settings {
  masterVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  quality: 'auto' | 'low' | 'high';
  innings: 3 | 9;
  difficulty: DifficultyId;
  tutorialDone: boolean;
  theme: string;
  playerName: string;
  /** Pinball skin id (steel, baseball, gold...). */
  ballSkin: string;
  /** Reduced effects: no screen shake, slow motion or flashes. */
  reducedEffects: boolean;
  /**
   * Camera dives: FULL (every attraction and at-bat), MINIMAL (only the city and
   * reactor mini-games) or OFF (pure pinball: attractions pay out instantly and
   * never capture the ball).
   */
  cinematics: 'full' | 'minimal' | 'off';
}

export interface SaveData {
  version: number;
  settings: Settings;
  /** Every high score ever recorded; use {@link SaveStore.highScoresFor} per difficulty. */
  highScores: HighScoreEntry[];
  achievements: string[];
  unlocks: string[];
  stats: {
    gamesPlayed: number;
    totalHomeRuns: number;
    totalRuns: number;
    wins: number;
    bestCombo: number;
    impossibleInnings: number;
    grandSlams: number;
    bossesBeaten: number;
  };
}

export const SAVE_KEY = 'diamond-pinball/save/v1';
export const SAVE_VERSION = 2;
export const MAX_HIGH_SCORES = 10;

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  sfxVolume: 1,
  ambienceVolume: 0.6,
  quality: 'auto',
  innings: 3,
  difficulty: DEFAULT_DIFFICULTY,
  tutorialDone: false,
  theme: 'classic',
  playerName: 'YOU',
  ballSkin: 'steel',
  reducedEffects: false,
  cinematics: 'full',
};

/** Content available from the first launch; everything else is unlocked by achievements. */
export const BASE_UNLOCKS = ['classic', 'skin_steel'];

export const defaultSave = (): SaveData => ({
  version: SAVE_VERSION,
  settings: { ...DEFAULT_SETTINGS },
  highScores: [],
  achievements: [],
  unlocks: [...BASE_UNLOCKS],
  stats: { gamesPlayed: 0, totalHomeRuns: 0, totalRuns: 0, wins: 0, bestCombo: 0, impossibleInnings: 0, grandSlams: 0, bossesBeaten: 0 },
});

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function resolveStorage(): StorageLike {
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = '__dp_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    }
  } catch {
    /* private mode or disabled storage: fall through */
  }
  return new MemoryStorage();
}

export class SaveStore {
  data: SaveData;
  private storage: StorageLike;

  constructor(storage: StorageLike = resolveStorage()) {
    this.storage = storage;
    this.data = this.load();
  }

  private load(): SaveData {
    const base = defaultSave();
    try {
      const raw = this.storage.getItem(SAVE_KEY);
      if (!raw) return base;
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      const settings: Settings = { ...base.settings, ...(parsed.settings ?? {}) };
      // v1 stored rookie / pro / allstar; map them onto the three real difficulties.
      settings.difficulty = normalizeDifficulty(settings.difficulty);
      if (!['full', 'minimal', 'off'].includes(settings.cinematics)) settings.cinematics = 'full';
      const scores = Array.isArray(parsed.highScores) ? parsed.highScores : [];
      const unlocks = Array.isArray(parsed.unlocks) ? parsed.unlocks : [];
      return {
        ...base,
        ...parsed,
        version: SAVE_VERSION,
        settings,
        stats: { ...base.stats, ...(parsed.stats ?? {}) },
        // v1 scores had no difficulty: they were earned on the old default, which maps to MEDIUM.
        highScores: scores.map((h) => ({ ...h, difficulty: normalizeDifficulty(h.difficulty) })),
        achievements: Array.isArray(parsed.achievements) ? parsed.achievements : [],
        unlocks: Array.from(new Set([...base.unlocks, ...unlocks])),
      };
    } catch {
      return base;
    }
  }

  save(): void {
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      /* quota exceeded or disabled: keep in memory */
    }
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
    return this.data.settings;
  }

  /** The top table for one difficulty, best first. */
  highScoresFor(difficulty: DifficultyId): HighScoreEntry[] {
    return this.data.highScores.filter((h) => h.difficulty === difficulty).sort((a, b) => b.pinballScore - a.pinballScore).slice(0, MAX_HIGH_SCORES);
  }

  /**
   * Inserts a result into its difficulty's table. Returns the 1-based rank if
   * it made that table, otherwise 0. Scores never compete across difficulties.
   */
  submitHighScore(entry: HighScoreEntry): number {
    const others = this.data.highScores.filter((h) => h.difficulty !== entry.difficulty);
    const list = [...this.highScoresFor(entry.difficulty), entry].sort((a, b) => b.pinballScore - a.pinballScore).slice(0, MAX_HIGH_SCORES);
    this.data.highScores = [...others, ...list];
    this.save();
    const rank = list.indexOf(entry);
    return rank >= 0 ? rank + 1 : 0;
  }

  isHighScore(pinballScore: number, difficulty: DifficultyId): boolean {
    if (pinballScore <= 0) return false;
    const list = this.highScoresFor(difficulty);
    if (list.length < MAX_HIGH_SCORES) return true;
    return pinballScore > list[list.length - 1].pinballScore;
  }

  unlockAchievement(id: string): boolean {
    if (this.data.achievements.includes(id)) return false;
    this.data.achievements.push(id);
    this.save();
    return true;
  }

  unlock(id: string): boolean {
    if (this.data.unlocks.includes(id)) return false;
    this.data.unlocks.push(id);
    this.save();
    return true;
  }

  reset(): void {
    this.data = defaultSave();
    try {
      this.storage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
  }
}
