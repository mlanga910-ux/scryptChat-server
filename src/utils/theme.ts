import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'scryptchat_theme';

function readStoredTheme(): ThemeMode | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* storage unavailable (private mode) */
  }
  return null;
}

function prefersLight(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  } catch {
    return false;
  }
}

export function resolveTheme(): ThemeMode {
  return readStoredTheme() ?? (prefersLight() ? 'light' : 'dark');
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.classList.toggle('light', mode === 'light');
  root.style.colorScheme = mode;
}

/** Applies the persisted theme as early as possible to avoid a flash. */
export function initTheme(): ThemeMode {
  const mode = resolveTheme();
  applyTheme(mode);
  return mode;
}

export interface ThemeControls {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

export function useTheme(): ThemeControls {
  const [theme, setThemeState] = useState<ThemeMode>(() => resolveTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
    setThemeState(mode);
  }, []);

  useEffect(() => {
    // Follow the OS preference until the user picks a theme explicitly.
    if (readStoredTheme()) return;
    let media: MediaQueryList;
    try {
      media = window.matchMedia('(prefers-color-scheme: light)');
    } catch {
      return;
    }
    const onChange = (event: MediaQueryListEvent) => setThemeState(event.matches ? 'light' : 'dark');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: ThemeMode = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return { theme, setTheme, toggleTheme };
}
