import { useCallback, useEffect, useState } from 'react';

// ═══ Light/dark theme — faithful port of ThemeToggle from the current system ═══
// The localStorage "theme" key and the prefers-color-scheme behavior are exactly the same so that
// users see the same theme in both the old and new UI. (The initial flash in index.html
// is also applied before render with the same convention.)

export function useTheme() {
  const [dark, setDark] = useState<boolean | null>(null); // null = not mounted yet

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setDark(saved ? saved === 'dark' : prefersDark);
  }, []);

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      localStorage.setItem('theme', next ? 'dark' : 'light');
      document.documentElement.classList.toggle('dark', next);
      return next;
    });
  }, []);

  return { dark: dark ?? false, mounted: dark !== null, toggle };
}
