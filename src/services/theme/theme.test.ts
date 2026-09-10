import {
  THEME_STORAGE_KEY,
  isThemeMode,
  readStoredTheme,
  toggleThemeMode,
  writeStoredTheme,
} from './theme';

describe('theme service', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it('recognizes valid theme values', () => {
    expect(isThemeMode('night')).toBe(true);
    expect(isThemeMode('day')).toBe(true);
    expect(isThemeMode('other')).toBe(false);
  });

  it('reads and writes the stored theme', () => {
    expect(readStoredTheme()).toBeNull();

    writeStoredTheme('day');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('day');
    expect(readStoredTheme()).toBe('day');
    expect(document.documentElement).toHaveAttribute('data-theme', 'day');

    writeStoredTheme('night');
    expect(document.documentElement).toHaveAttribute('data-theme', 'night');
  });

  it('falls back to null for invalid stored values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'broken');

    expect(readStoredTheme()).toBeNull();
  });

  it('toggles between day and night', () => {
    expect(toggleThemeMode('night')).toBe('day');
    expect(toggleThemeMode('day')).toBe('night');
  });
});
