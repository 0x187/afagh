import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, apiPost } from '@/lib/api';

// ═══ Automatic idle lock — faithful port of the current system's SessionLock.tsx ═══
//
// The source of truth is server-side: the client only sends an "activity heartbeat" and at the end of the idle
// timer it asks the server. The final decision belongs to `/api/v2/session/ping`, which keeps the "time
// of last activity"; therefore:
//  • A refresh/new tab after locking also shows locked (the server records the lock flag),
//  • A working user is never logged out without reason thanks to periodic heartbeats,
//  • The idle duration can differ per role (SESSION_LOCK_MINUTES_ROLES
//    — resolved server-side and returned in the ping response).
//
// Timing constants are ported verbatim from afagh-next/src/components/SessionLock.tsx.

/** Activity heartbeat interval — at most once per minute so the server keeps the session warm. */
export const IDLE_HEARTBEAT_MS = 60_000;

/** "User activity" events — same list as the original. */
export const IDLE_ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'click',
  'wheel',
] as const;

/** Default until the first server response (same as the server-side SESSION_LOCK_MINUTES default). */
export const DEFAULT_IDLE_TIMEOUT_MIN = 15;

/** Idle timer delay — exact formula of the original: `Math.max(1, timeoutMin) * 60 * 1000`. */
export function armDelayMs(timeoutMin: number): number {
  return Math.max(1, timeoutMin) * 60 * 1000;
}

// ── Pure state machine (testable without DOM) ──────────────────────────────────────

/** Interpreted result of a ping request; `null` means network/session error (unknown). */
export type PingResult = { locked: boolean; timeoutMin: number | null } | null;

/**
 * What decision does the activity heartbeat ({active:true}) make?
 *  • Server said locked (explicit flag — e.g. locked in another tab) → lock;
 *  • Healthy "not locked" response or unknown → stay (the heartbeat's result would be ignored;
 *    here only the server's explicit fail-closed lock is propagated).
 */
export function decideOnHeartbeat(ping: PingResult): 'stay' | 'lock' {
  return ping?.locked === true ? 'lock' : 'stay';
}

/**
 * What decision does the idle timer end ({active:false}) make? — exact logic of the original:
 *  • Server said "not locked" (another tab may have been active) → re-arm the timer;
 *  • Locked or unknown response (network/session error) → lock (fail-closed).
 * Recording the lock itself on the server happens via the same ping (see the original route:
 * "the server itself records the lock, not just reporting it") — so a second action is unnecessary.
 */
export function decideOnIdlePing(ping: PingResult): 'rearm' | 'lock' {
  if (ping && ping.locked === false) return 'rearm';
  return 'lock';
}

/** Messages — same strings as SessionLock.tsx and the server's step-up gate. */
export const EMPTY_PASSWORD_MESSAGE = 'رمز عبور را وارد کنید.';
export const WRONG_PASSWORD_MESSAGE = 'رمز نادرست است.';
export const UNLOCK_NETWORK_ERROR_MESSAGE = 'خطا در ارتباط با سرور.';

/**
 * Password error cap — same gate as the server (5 errors / 15 minutes per user + IP).
 * The client-side counter mirrors the gate's UX: on the fifth error, the same gate lock
 * message is shown that the next attempt will get from the server.
 */
export const UNLOCK_FAIL_LIMIT = 5;
export const UNLOCK_LOCKOUT_MINUTES = 15;

export function unlockFailLimitMessage(): string {
  return `تلاش‌های تأیید رمز بیش از حد مجاز شد. ${UNLOCK_LOCKOUT_MINUTES} دقیقهٔ دیگر دوباره تلاش کنید.`;
}

/** Unlock form state — the pure part under test. */
export type UnlockUiState = { fails: number; error: string };

export function initialUnlockUiState(): UnlockUiState {
  return { fails: 0, error: '' };
}

/** Unlock failure: the server message is shown verbatim; on the fifth error, the gate message. */
export function onUnlockFailure(prev: UnlockUiState, serverError: string): UnlockUiState {
  const fails = prev.fails + 1;
  const error = fails >= UNLOCK_FAIL_LIMIT ? unlockFailLimitMessage() : serverError || WRONG_PASSWORD_MESSAGE;
  return { fails, error };
}

/** Unlock success: counter and error are reset to zero. */
export function onUnlockSuccess(_prev: UnlockUiState): UnlockUiState {
  return { fails: 0, error: '' };
}

/** "Empty password" error — without consuming the gate counter (no request is fired). */
export function onEmptyPassword(prev: UnlockUiState): UnlockUiState {
  return { ...prev, error: EMPTY_PASSWORD_MESSAGE };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

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
  /** Whether the password unlock is in progress. */
  pending: boolean;
  /** Last unlock form error (verbatim server message). */
  error: string;
  /** Unlock attempt; `true` means the lock was released. */
  unlock: (password: string) => Promise<boolean>;
};

/**
 * Port of the use-states of SessionLock.tsx for the SPA:
 *  • Any activity → heartbeat {active:true} (at most once per minute) + arming the idle timer;
 *  • Timer end → ping {active:false} → per `decideOnIdlePing`;
 *  • Any server response with `locked:true` shows the lock (explicit server flag —
 *    replacing the SSR version's `initialLocked`: a refresh/new tab stays locked too).
 * Unknown user (null) = lock disabled; `timeoutMin <= 0` also disabled (same as the original).
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

  /** "Activity" heartbeat — at most once per minute so the server keeps the session warm. */
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
        // The final decision is the server's; if it does not yet know about the idle, re-arm
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
      if (lockedRef.current) return; // Behind the lock, activity must not renew the idle clock
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

  // Initial sync with the server — replaces the SSR version's `initialLocked`: if the lock flag
  // is set server-side (another tab/refresh after lock), it must be shown at mount time
  // not after the first activity event or timer end.
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
    // Only once after login
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
        lastPing.current = 0; // Unlock = activity; the idle clock should start counting anew
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
