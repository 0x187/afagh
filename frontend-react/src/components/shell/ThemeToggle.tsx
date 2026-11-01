import { Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme';

// ═══ ThemeToggle — faithful port from src/components/ThemeToggle.tsx ═══
// Same "theme" localStorage key and same prefers-color-scheme behavior;
// only the icons come from lucide (instead of hand-drawn SVG).
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
