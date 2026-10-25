import { Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme';

// ═══ ThemeToggle — پورت وفادار از src/components/ThemeToggle.tsx ═══
// همان کلید localStorage «theme» و همان رفتار prefers-color-scheme؛
// فقط آیکون‌ها از lucide آمده‌اند (به‌جای SVG دستی).
export function ThemeToggle() {
  const { dark, mounted, toggle } = useTheme();
  if (!mounted) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={toggle}
      aria-label={dark ? 'حالت روز' : 'حالت شب'}
      title={dark ? 'حالت روز' : 'حالت شب'}
      className="bg-transparent border-header-foreground/20 text-header-foreground hover:bg-header-foreground/10 hover:text-header-foreground"
    >
      {dark ? <Sun className="text-amber-400" /> : <Moon />}
    </Button>
  );
}
