/**
 * Local persistence: settings, high scores, achievements and unlocks.
 * Everything is stored in localStorage; the game never needs a backend.
 */
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
}

export interface Settings {
  masterVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  quality: 'auto' | 'low' | 'high';
  innings: 3 | 9;
  difficulty: 'rookie' | 'pro' | 'allstar';
  tutorialDone: boolean;
  theme: string;
  playerName: string;
}

export interface SaveData {
  version: number;
  settings: Settings;
  highScores: HighScoreEntry[];
  achievements: string[];
  unlocks: string[];
  stats: {
    gamesPlayed: number;
    totalHomeRuns: number;
    totalRuns: number;
    wins: number;
    bestCombo: number;
  };
}

export const SAVE_KEY = 'diamond-pinball/save/v1';
export const MAX_HIGH_SCORES = 10;

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  sfxVolume: 1,
  ambienceVolume: 0.6,
  quality: 'auto',
  innings: 3,
  difficulty: 'pro',
  tutorialDone: false,
  theme: 'classic',
  playerName: 'YOU',
};

export const defaultSave = (): SaveData => ({
  version: 1,
  settings: { ...DEFAULT_SETTINGS },
  highScores: [],
  achievements: [],
  unlocks: ['classic'],
  stats: { gamesPlayed: 0, totalHomeRuns: 0, totalRuns: 0, wins: 0, bestCombo: 0 },
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
      return {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings ?? {}) },
        stats: { ...base.stats, ...(parsed.stats ?? {}) },
        highScores: Array.isArray(parsed.highScores) ? parsed.highScores.slice(0, MAX_HIGH_SCORES) : [],
        achievements: Array.isArray(parsed.achievements) ? parsed.achievements : [],
        unlocks: Array.isArray(parsed.unlocks) && parsed.unlocks.length ? parsed.unlocks : base.unlocks,
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

  /**
   * Inserts a result into the table. Returns the 1-based rank if it made the
   * table, otherwise 0.
   */
  submitHighScore(entry: HighScoreEntry): number {
    const list = [...this.data.highScores, entry].sort((a, b) => b.pinballScore - a.pinballScore).slice(0, MAX_HIGH_SCORES);
    this.data.highScores = list;
    this.save();
    const rank = list.indexOf(entry);
    return rank >= 0 ? rank + 1 : 0;
  }

  isHighScore(pinballScore: number): boolean {
    if (pinballScore <= 0) return false;
    if (this.data.highScores.length < MAX_HIGH_SCORES) return true;
    return pinballScore > this.data.highScores[this.data.highScores.length - 1].pinballScore;
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
