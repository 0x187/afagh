import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { changePassword } from '@/lib/auth-api';

// ═══ Change password — faithful port of change-password/page.tsx ═══
// The "must change password on first login" loop (mustChangePassword); the validation
// messages are the same strings as auth.ts and come back from the server.
export function ChangePassword() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (next !== confirm) {
      setErr('تکرار رمز جدید با رمز جدید یکسان نیست.');
      return;
    }
    setBusy(true);
    let res: { ok: boolean; error?: string } | null = null;
    try {
      res = await changePassword(current, next);
    } catch {
      res = null;
    }
    setBusy(false);
    if (!res) {
      setErr('ارتباط با سرور برقرار نشد.');
      return;
    }
    if (!res.ok) {
      setErr(res.error || 'خطا');
      return;
    }
    setOk(true);
    setTimeout(() => navigate('/', { replace: true }), 900);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm py-6">
        <CardContent className="space-y-4">
          <div className="text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-bold text-white">
              آ
            </div>
            <h1 className="text-lg font-bold">تغییر رمز عبور</h1>
            <p className="text-xs text-muted-foreground">
              برای حساب شما رمز اولیه (پیش‌فرض) تعیین شده است؛ پیش از ورود به سامانه باید آن را تغییر دهید.
            </p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <Input
              dir="ltr"
              type="password"
              className="text-left"
              placeholder="رمز فعلی"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
            <Input
              dir="ltr"
              type="password"
              className="text-left"
              placeholder="رمز جدید (حداقل ۱۰ کاراکتر، حرف و رقم)"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
            />
            <Input
              dir="ltr"
              type="password"
              className="text-left"
              placeholder="تکرار رمز جدید"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
            {err && (
              <p className="rounded-xl bg-red-50 p-2 text-center text-sm text-red-700 dark:border dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                {err}
              </p>
            )}
            {ok && (
              <p className="rounded-xl bg-emerald-50 p-2 text-center text-sm text-emerald-700 dark:border dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                ✓ رمز با موفقیت تغییر کرد. در حال انتقال…
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy || !current || !next || !confirm}>
              {busy ? 'در حال ثبت…' : 'تغییر رمز و ورود'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
