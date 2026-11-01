import { describe, expect, it } from 'vitest';

import {
  armDelayMs,
  decideOnHeartbeat,
  decideOnIdlePing,
  DEFAULT_IDLE_TIMEOUT_MIN,
  IDLE_ACTIVITY_EVENTS,
  IDLE_HEARTBEAT_MS,
  initialUnlockUiState,
  onEmptyPassword,
  onUnlockFailure,
  onUnlockSuccess,
  UNLOCK_FAIL_LIMIT,
  unlockFailLimitMessage,
  type PingResult,
} from './idle-lock';

// ═══ Idle lock state machine tests — port of SessionLock.tsx rules ═══

describe('ثابت‌های زمانی (پورت عین SessionLock.tsx)', () => {
  it('ضربان ۶۰ ثانیه است', () => {
    expect(IDLE_HEARTBEAT_MS).toBe(60_000);
  });

  it('رویدادهای فعالیت عین لیست اصلی‌اند', () => {
    expect(IDLE_ACTIVITY_EVENTS).toEqual([
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
      'scroll',
      'click',
      'wheel',
    ]);
  });

  it('تأخیر تایمر = Math.max(1, timeoutMin) × ۶۰ ثانیه', () => {
    expect(armDelayMs(15)).toBe(15 * 60 * 1000);
    expect(armDelayMs(0)).toBe(60 * 1000); // Floor and cap: 1 minute
    expect(armDelayMs(-3)).toBe(60 * 1000);
  });

  it('پیش‌فرض سقف بیکاری ۱۵ دقیقه است (همان SESSION_LOCK_MINUTES سرور)', () => {
    expect(DEFAULT_IDLE_TIMEOUT_MIN).toBe(15);
  });
});

describe('decideOnHeartbeat — ضربان فعالیت {active:true}', () => {
  it('پاسخ سالمِ «قفل نیست» → بمان', () => {
    const ok: PingResult = { locked: false, timeoutMin: 15 };
    expect(decideOnHeartbeat(ok)).toBe('stay');
  });

  it('پاسخ نامشخص (خطای شبکه/نشست) → بمان', () => {
    expect(decideOnHeartbeat(null)).toBe('stay');
  });

  it('پرچم صریح قفل سرور (مثلاً قفل در تب دیگر) → قفل کن', () => {
    const locked: PingResult = { locked: true, timeoutMin: 15 };
    expect(decideOnHeartbeat(locked)).toBe('lock');
  });
});

describe('decideOnIdlePing — پایان تایمر بیکاری {active:false}', () => {
  it('سرور گفت قفل نیست → تایمر دوباره مسلح شود', () => {
    const ok: PingResult = { locked: false, timeoutMin: 15 };
    expect(decideOnIdlePing(ok)).toBe('rearm');
  });

  it('سرور قفل ثبت کرده → قفل کن', () => {
    const locked: PingResult = { locked: true, timeoutMin: 15 };
    expect(decideOnIdlePing(locked)).toBe('lock');
  });

  it('پاسخ نامشخص → قفل کن (fail-closed، عین اصلی)', () => {
    expect(decideOnIdlePing(null)).toBe('lock');
  });
});

describe('شمارندهٔ خطای بازگشایی رمز', () => {
  it('حالت اولیه بدون خطا و بدون خطا', () => {
    expect(initialUnlockUiState()).toEqual({ fails: 0, error: '' });
  });

  it('خطای اول پیام سرور را عیناً نشان می‌دهد', () => {
    const next = onUnlockFailure(initialUnlockUiState(), 'رمز نادرست است.');
    expect(next).toEqual({ fails: 1, error: 'رمز نادرست است.' });
  });

  it('پیام خالی سرور → پیام عمومی «رمز نادرست است.»', () => {
    const next = onUnlockFailure(initialUnlockUiState(), '');
    expect(next.error).toBe('رمز نادرست است.');
  });

  it(`تا ${UNLOCK_FAIL_LIMIT - 1} خطا پیام سرور می‌ماند؛ در خطای ${UNLOCK_FAIL_LIMIT}ام پیام گیت می‌آید`, () => {
    let state = initialUnlockUiState();
    for (let i = 0; i < UNLOCK_FAIL_LIMIT - 1; i++) {
      state = onUnlockFailure(state, 'رمز نادرست است.');
      expect(state.error).toBe('رمز نادرست است.');
    }
    state = onUnlockFailure(state, 'رمز نادرست است.');
    expect(state.fails).toBe(UNLOCK_FAIL_LIMIT);
    expect(state.error).toBe(unlockFailLimitMessage());
  });

  it('خطاهای بعد از سقف هم پیام گیت را نگه می‌دارند', () => {
    let state = initialUnlockUiState();
    for (let i = 0; i < UNLOCK_FAIL_LIMIT + 2; i++) state = onUnlockFailure(state, 'رمز نادرست است.');
    expect(state.error).toBe(unlockFailLimitMessage());
  });

  it('موفقیت، شمارنده و خطا را صفر می‌کند', () => {
    let state = onUnlockFailure(initialUnlockUiState(), 'رمز نادرست است.');
    state = onUnlockFailure(state, 'رمز نادرست است.');
    expect(onUnlockSuccess(state)).toEqual({ fails: 0, error: '' });
  });

  it('رمز خالی خطا می‌دهد ولی شمارندهٔ گیت را مصرف نمی‌کند', () => {
    let state = onUnlockFailure(initialUnlockUiState(), 'رمز نادرست است.');
    state = onEmptyPassword(state);
    expect(state.error).toBe('رمز عبور را وارد کنید.');
    expect(state.fails).toBe(1);
  });

  it('پیام گیت همان قالب سمت سرور است (۵ خطا / ۱۵ دقیقه)', () => {
    expect(unlockFailLimitMessage()).toBe('تلاش‌های تأیید رمز بیش از حد مجاز شد. 15 دقیقهٔ دیگر دوباره تلاش کنید.');
  });
});
