import { useCallback, useEffect, useState } from 'react';

// ═══ تم روشن/تیره — پورت وفادار ThemeToggle سامانهٔ فعلی ═══
// کلید localStorage «theme» و رفتار prefers-color-scheme دقیقاً یکسان است تا
// کاربر بین UI قدیم و جدید تم یکسانی ببیند. (فلش اولیه هم در index.html
// با همان قرارداد قبل از رندر اعمال می‌شود.)

export function useTheme() {
  const [dark, setDark] = useState<boolean | null>(null); // null = هنوز mount نشده

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
