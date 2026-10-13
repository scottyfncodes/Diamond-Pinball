import { describe, expect, it } from 'vitest';
import { MemoryStorage, SaveStore, SAVE_KEY, MAX_HIGH_SCORES, type HighScoreEntry } from '../src/game/save';

const entry = (score: number): HighScoreEntry => ({
  name: 'YOU',
  pinballScore: score,
  homeRuns: 1,
  hits: 3,
  runsFor: 2,
  runsAgainst: 1,
  won: true,
  innings: 3,
  date: '2026-01-01',
  difficulty: 'medium',
});

describe('save store', () => {
  it('persists settings and reloads them', () => {
    const storage = new MemoryStorage();
    const a = new SaveStore(storage);
    a.updateSettings({ masterVolume: 0.25, innings: 9 });
    const b = new SaveStore(storage);
    expect(b.data.settings.masterVolume).toBe(0.25);
    expect(b.data.settings.innings).toBe(9);
    expect(b.data.settings.difficulty).toBe('medium');
  });

  it('migrates v1 difficulty names and v1 scores onto the three real difficulties', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({
        version: 1,
        settings: { difficulty: 'allstar' },
        highScores: [{ name: 'OLD', pinballScore: 5000, homeRuns: 0, hits: 0, runsFor: 0, runsAgainst: 0, won: false, innings: 3, date: '2026-01-01' }],
        unlocks: ['classic', 'gold'],
      }),
    );
    const store = new SaveStore(storage);
    expect(store.data.settings.difficulty).toBe('hard');
    expect(store.data.highScores[0].difficulty).toBe('medium');
    expect(store.highScoresFor('medium')).toHaveLength(1);
    expect(store.data.unlocks).toContain('gold');
    expect(store.data.unlocks).toContain('skin_steel');
    expect(store.data.version).toBe(2);
  });

  it('ranks scores per difficulty', () => {
    const store = new SaveStore(new MemoryStorage());
    store.submitHighScore({ ...entry(9000), difficulty: 'easy' });
    store.submitHighScore({ ...entry(1000), difficulty: 'hard' });
    expect(store.submitHighScore({ ...entry(2000), difficulty: 'hard' })).toBe(1);
    expect(store.submitHighScore({ ...entry(2000), difficulty: 'easy' })).toBe(2);
    expect(store.highScoresFor('hard').map((h) => h.pinballScore)).toEqual([2000, 1000]);
    expect(store.highScoresFor('easy').map((h) => h.pinballScore)).toEqual([9000, 2000]);
  });

  it('keeps a sorted top-10 high score table', () => {
    const store = new SaveStore(new MemoryStorage());
    for (let i = 0; i < 15; i++) store.submitHighScore(entry(i * 1000));
    expect(store.data.highScores).toHaveLength(MAX_HIGH_SCORES);
    expect(store.data.highScores[0].pinballScore).toBe(14000);
    expect(store.isHighScore(100, 'medium')).toBe(false);
    expect(store.isHighScore(6000, 'medium')).toBe(true);
    // Other difficulties keep their own tables.
    expect(store.isHighScore(100, 'hard')).toBe(true);
    expect(store.highScoresFor('hard')).toEqual([]);
    expect(store.submitHighScore(entry(20000))).toBe(1);
    expect(store.submitHighScore(entry(1))).toBe(0);
  });

  it('survives corrupted data', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{not json');
    const store = new SaveStore(storage);
    expect(store.data.highScores).toEqual([]);
    expect(store.data.settings.masterVolume).toBe(0.8);
  });

  it('tracks achievements and unlocks once', () => {
    const store = new SaveStore(new MemoryStorage());
    expect(store.unlockAchievement('first_hr')).toBe(true);
    expect(store.unlockAchievement('first_hr')).toBe(false);
    expect(store.unlock('gold')).toBe(true);
    expect(store.data.unlocks).toContain('gold');
    store.reset();
    expect(store.data.achievements).toEqual([]);
  });
});
