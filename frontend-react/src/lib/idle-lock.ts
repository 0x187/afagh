import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, apiPost } from '@/lib/api';

// ═══ قفل خودکار بیکاری — پورت وفادار SessionLock.tsx سامانهٔ فعلی ═══
//
// منبع حقیقت سمت سرور است: کلاینت فقط «ضربان فعالیت» می‌فرستد و در پایان تایمر
// بیکاری از سرور می‌پرسد. تصمیم نهایی با `/api/v2/session/ping` است که «زمان
// آخرین فعالیت» را نگه می‌دارد؛ بنابراین:
//  • رفرش/تب جدید پس از قفل هم قفل نشان می‌دهد (سرور پرچم قفل را ثبت می‌کند)،
//  • کاربرِ در حال کار با ضربان‌های دوره‌ای هرگز بی‌دلیل بیرون نمی‌افتد،
//  • مدت بی‌تعاملی برای هر نقش می‌تواند متفاوت باشد (SESSION_LOCK_MINUTES_ROLES
//    — سمت سرور حل می‌شود و در پاسخِ ping برمی‌گردد).
//
// ثابت‌های زمانی عیناً از afagh-next/src/components/SessionLock.tsx پورت شده‌اند.

/** فاصلهٔ ضربان فعالیت — حداکثر یک بار در دقیقه تا سرور نشست را گرم نگه دارد. */
export const IDLE_HEARTBEAT_MS = 60_000;

/** رویدادهای «فعالیت کاربر» — عین لیست اصلی. */
export const IDLE_ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'click',
  'wheel',
] as const;

/** پیش‌فرض تا اولین پاسخِ سرور (همان پیش‌فرض SESSION_LOCK_MINUTES سمت سرور). */
export const DEFAULT_IDLE_TIMEOUT_MIN = 15;

/** تأخیر تایمر بیکاری — عین فرمول اصلی: `Math.max(1, timeoutMin) * 60 * 1000`. */
export function armDelayMs(timeoutMin: number): number {
  return Math.max(1, timeoutMin) * 60 * 1000;
}

// ── ماشین حالت خالص (تست‌پذیر بدون DOM) ──────────────────────────────────────

/** نتیجهٔ تفسیرشدهٔ یک درخواست ping؛ `null` یعنی خطای شبکه/نشست (نامشخص). */
export type PingResult = { locked: boolean; timeoutMin: number | null } | null;

/**
 * ضربان فعالیت ({active:true}) چه تصمیمی می‌گیرد؟
 *  • سرور گفت قفل است (پرچم صریح — مثلاً قفل در تب دیگر) → قفل کن؛
 *  • پاسخ سالمِ «قفل نیست» یا نامشخص → بمان (heartbeat نتیجه‌اش نادیده گرفته
 *    می‌شد؛ این‌جا فقط قفلِ صریحِ سرور fail-closed منتقل می‌شود).
 */
export function decideOnHeartbeat(ping: PingResult): 'stay' | 'lock' {
  return ping?.locked === true ? 'lock' : 'stay';
}

/**
 * پایان تایمر بیکاری ({active:false}) چه تصمیمی می‌گیرد؟ — عین منطق اصلی:
 *  • سرور گفت «قفل نیست» (شاید تب دیگری فعال بوده) → تایمر از نو مسلح شود؛
 *  • قفل یا پاسخِ نامشخص (خطای شبکه/نشست) → قفل کن (fail-closed).
 * ثبتِ خودِ قفل در سرور با همان ping انجام می‌شود (نگاه به route اصلی:
 * «خودِ سرور قفل را ثبت می‌کند، نه فقط گزارش») — پس اکشن دوم لازم نیست.
 */
export function decideOnIdlePing(ping: PingResult): 'rearm' | 'lock' {
  if (ping && ping.locked === false) return 'rearm';
  return 'lock';
}

/** پیام‌ها — عین رشته‌های SessionLock.tsx و گیت step-up سرور. */
export const EMPTY_PASSWORD_MESSAGE = 'رمز عبور را وارد کنید.';
export const WRONG_PASSWORD_MESSAGE = 'رمز نادرست است.';
export const UNLOCK_NETWORK_ERROR_MESSAGE = 'خطا در ارتباط با سرور.';

/**
 * سقف خطای رمز — همان گیت سمت سرور (۵ خطا / ۱۵ دقیقه به‌ازای کاربر + IP).
 * شمارندهٔ سمت کلاینت آینهٔ UX همان گیت است: در خطای پنجم، همان پیامِ قفلِ
 * گیت نمایش داده می‌شود که تلاش بعدی از سرور خواهد گرفت.
 */
export const UNLOCK_FAIL_LIMIT = 5;
export const UNLOCK_LOCKOUT_MINUTES = 15;

export function unlockFailLimitMessage(): string {
  return `تلاش‌های تأیید رمز بیش از حد مجاز شد. ${UNLOCK_LOCKOUT_MINUTES} دقیقهٔ دیگر دوباره تلاش کنید.`;
}

/** وضعیت فرم بازگشایی قفل — بخش خالصی که تست می‌شود. */
export type UnlockUiState = { fails: number; error: string };

export function initialUnlockUiState(): UnlockUiState {
  return { fails: 0, error: '' };
}

/** شکست بازگشایی: پیام سرور عیناً نمایش داده می‌شود؛ در خطای پنجم پیام گیت. */
export function onUnlockFailure(prev: UnlockUiState, serverError: string): UnlockUiState {
  const fails = prev.fails + 1;
  const error = fails >= UNLOCK_FAIL_LIMIT ? unlockFailLimitMessage() : serverError || WRONG_PASSWORD_MESSAGE;
  return { fails, error };
}

/** موفقیت بازگشایی: شمارنده و خطا صفر می‌شود. */
export function onUnlockSuccess(_prev: UnlockUiState): UnlockUiState {
  return { fails: 0, error: '' };
}

/** خطای «رمز خالی» — بدون مصرفِ شمارندهٔ گیت (درخواستی زده نمی‌شود). */
export function onEmptyPassword(prev: UnlockUiState): UnlockUiState {
  return { ...prev, error: EMPTY_PASSWORD_MESSAGE };
}

// ── هوک ──────────────────────────────────────────────────────────────────────

async function ping(active: boolean): Promise<PingResult> {
  try {
    const j = await apiPost<{ ok: boolean; locked?: unknown; timeoutMin?: unknown }>('/session/ping', { active });
    const timeoutMin = typeof j.timeoutMin === 'number' && Number.isFinite(j.timeoutMin) ? j.timeoutMin : null;
    return { locked: j.locked === true, timeoutMin };
  } catch {
    return null;
  }
}

export type IdleLock = {
  locked: boolean;
  /** در جریان بودن بازگشایی با رمز. */
  pending: boolean;
  /** آخرین خطای فرم بازگشایی (عین پیام سرور). */
  error: string;
  /** تلاش بازگشایی؛ `true` یعنی قفل باز شد. */
  unlock: (password: string) => Promise<boolean>;
};

/**
 * پورت use-state های SessionLock.tsx برای SPA:
 *  • هر فعالیت → ضربان {active:true} (حداکثر هر دقیقه) + مسلح‌کردن تایمر بیکاری؛
 *  • پایان تایمر → ping {active:false} → طبق `decideOnIdlePing`؛
 *  • هر پاسخِ سرور که `locked:true` دارد قفل را نشان می‌دهد (پرچم صریح سرور —
 *    جانشین `initialLocked` نسخهٔ SSR: رفرش/تب جدید هم قفل می‌ماند).
 * کاربرِ نامعلوم (null) = قفل غیرفعال؛ `timeoutMin <= 0` هم غیرفعال (عین اصلی).
 */
export function useIdleLock(user: { id: number } | null | undefined): IdleLock {
  const loggedIn = !!user;
  const [locked, setLocked] = useState(false);
  const [pending, setPending] = useState(false);
  const [ui, setUi] = useState<UnlockUiState>(initialUnlockUiState);
  const [timeoutMin, setTimeoutMin] = useState(DEFAULT_IDLE_TIMEOUT_MIN);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPing = useRef(0);
  const lockedRef = useRef(false);
  const timeoutMinRef = useRef(DEFAULT_IDLE_TIMEOUT_MIN);

  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  const disabled = !loggedIn || !(timeoutMin > 0);

  const lock = useCallback(() => {
    setUi(initialUnlockUiState());
    setLocked(true);
    lockedRef.current = true;
  }, []);

  const applyServerState = useCallback(
    (r: PingResult) => {
      if (!r) return;
      if (typeof r.timeoutMin === 'number' && r.timeoutMin !== timeoutMinRef.current) {
        timeoutMinRef.current = r.timeoutMin;
        setTimeoutMin(r.timeoutMin);
      }
      if (r.locked) lock();
    },
    [lock],
  );

  /** ضربان «فعالیت» — حداکثر یک بار در دقیقه تا سرور نشست را گرم نگه دارد. */
  const beat = useCallback(() => {
    if (disabled) return;
    const now = Date.now();
    if (now - lastPing.current < IDLE_HEARTBEAT_MS) return;
    lastPing.current = now;
    void ping(true).then((r) => applyServerState(r));
  }, [disabled, applyServerState]);

  const arm = useCallback(() => {
    if (disabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void ping(false).then((r) => {
        // تصمیم نهایی با سرور است؛ اگر هنوز بیکار نمی‌داند، دوباره مسلح کن
        if (decideOnIdlePing(r) === 'rearm') {
          applyServerState(r);
          arm();
          return;
        }
        lock();
      });
    }, armDelayMs(timeoutMinRef.current));
  }, [disabled, applyServerState, lock]);

  useEffect(() => {
    const onAct = () => {
      if (lockedRef.current) return; // پشت قفل، فعالیت نباید ساعت بیکاری را نو کند
      beat();
      arm();
    };
    for (const e of IDLE_ACTIVITY_EVENTS) window.addEventListener(e, onAct, { passive: true });
    arm();
    return () => {
      for (const e of IDLE_ACTIVITY_EVENTS) window.removeEventListener(e, onAct);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [arm, beat]);

  // همگام‌سازی اولیه با سرور — جانشین `initialLocked` نسخهٔ SSR: اگر پرچم قفل
  // سمت سرور روشن است (تب دیگر/رفرش پس از قفل)، همان لحظهٔ mount نشان داده شود
  // نه بعد از اولین رویداد فعالیت یا پایان تایمر.
  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    void ping(false).then((r) => {
      if (cancelled) return;
      applyServerState(r);
      if (r && r.timeoutMin !== null) timeoutMinRef.current = r.timeoutMin;
      arm();
    });
    return () => {
      cancelled = true;
    };
    // فقط یک‌بار پس از ورود
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn]);

  const unlock = useCallback(
    async (password: string): Promise<boolean> => {
      if (!password) {
        setUi((prev) => onEmptyPassword(prev));
        return false;
      }
      setPending(true);
      setUi((prev) => ({ ...prev, error: '' }));
      try {
        let serverError = '';
        try {
          await apiPost('/session/unlock', { password });
        } catch (e) {
          serverError =
            e instanceof ApiError && e.status !== 0 ? e.message : UNLOCK_NETWORK_ERROR_MESSAGE;
        }
        if (serverError) {
          setUi((prev) => onUnlockFailure(prev, serverError));
          return false;
        }
        setUi((prev) => onUnlockSuccess(prev));
        setLocked(false);
        lockedRef.current = false;
        lastPing.current = 0; // بازگشایی = فعالیت؛ ساعت بیکاری از نو شمرده شود
        arm();
        return true;
      } finally {
        setPending(false);
      }
    },
    [arm],
  );

  return { locked, pending, error: ui.error, unlock };
}
