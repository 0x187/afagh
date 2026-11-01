import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useIdleLock } from '@/lib/idle-lock';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// ═══ Idle lock — faithful port of SessionLock.tsx on the Afagh design system ═══
//
// Refresh/new tab also shows the lock: the lock flag is stored server-side and the first
// heartbeat of this same page returns it (replaces the SSR version's `initialLocked`).
// After a successful unlock, the session query is invalidated so the header gets fresh state.

export function SessionLockOverlay() {
  const { data } = useSession();
  const user = data?.user ?? null;
  const { locked, pending, error, unlock } = useIdleLock(user);
  const queryClient = useQueryClient();
  const [pw, setPw] = useState('');

  // Same as the original: the form is cleared when locked (not only after unlocking)
  useEffect(() => {
    if (locked) setPw('');
  }, [locked]);

  if (!locked) return null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await unlock(pw);
    if (ok) {
      setPw('');
      await queryClient.invalidateQueries({ queryKey: ['session'] });
    }
  };

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm print:hidden"
    >
      <form
        onSubmit={onSubmit}
        className="bg-card border-border max-w-sm w-full overflow-hidden rounded-2xl border shadow-2xl"
      >
        <div className="bg-header text-header-foreground px-5 py-4 text-center">
          <div className="text-3xl" aria-hidden>
            🔒
          </div>
          <h3 className="mt-1 text-sm font-extrabold">صفحه به‌علت بیکاری قفل شد</h3>
          <p className="text-header-foreground/70 mt-1 text-[11px]">
            {user?.name ?? 'کاربر'} — برای ادامه رمز عبور را وارد کنید.
          </p>
        </div>
        <div className="space-y-3 p-5">
          <Input
            type="password"
            autoFocus
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="رمز عبور"
            aria-label="رمز عبور"
            autoComplete="current-password"
            dir="ltr"
            className="text-center font-mono"
          />
          {error && <p className="text-destructive text-center text-xs font-bold">{error}</p>}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'در حال بررسی…' : '🔓 بازگشایی'}
          </Button>
        </div>
      </form>
    </div>
  );
}
