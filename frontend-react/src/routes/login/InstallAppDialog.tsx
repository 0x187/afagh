import { useEffect, useRef, useState } from 'react';
import { Smartphone, X } from 'lucide-react';

/**
 * "Install the app" guide shown from the login screen.
 *
 * The PWA is installable already (manifest + service worker live at /app), but
 * browsers bury that action, so the login page offers the steps explicitly.
 * When the browser fires `beforeinstallprompt` we keep the event and let the
 * user install straight from here; otherwise we show the manual steps.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function useInstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);
  return event;
}

const STEPS = [
  {
    key: 'android',
    label: 'اندروید',
    steps: [
      'سامانه را در مرورگر Chrome باز کنید.',
      'منوی سه‌نقطهٔ بالا را بزنید و «Install app» یا «افزودن به صفحهٔ اصلی» را انتخاب کنید.',
      'آیکون آفاق روی صفحهٔ اصلی ساخته می‌شود و مثل یک اپ باز می‌شود.',
    ],
  },
  {
    key: 'ios',
    label: 'آیفون',
    steps: [
      'سامانه را در Safari باز کنید.',
      'دکمهٔ اشتراک‌گذاری (مربع با فلش بالا) را بزنید.',
      '«Add to Home Screen» را انتخاب و نام «آفاق» را تأیید کنید.',
    ],
  },
];

export function InstallAppDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prompt = useInstallPrompt();
  const [tab, setTab] = useState<'android' | 'ios'>('android');
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  const active = STEPS.find((s) => s.key === tab) ?? STEPS[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#171310] p-5 text-white shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06]">
              <Smartphone className="size-4" aria-hidden />
            </span>
            <h2 id="install-title" className="text-sm font-black">
              نصب آفاق روی گوشی
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="mt-4 flex gap-1 rounded-full border border-white/10 bg-white/5 p-1 text-xs font-bold">
          {STEPS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setTab(s.key as 'android' | 'ios')}
              aria-pressed={tab === s.key}
              className={`flex-1 rounded-full px-3 py-1.5 transition-colors ${
                tab === s.key ? 'bg-white text-[#0b0b0d]' : 'text-white/60 hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <ol className="mt-4 space-y-2.5 text-xs leading-6 text-white/70">
          {active.steps.map((step, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-black text-white/80">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        {prompt && (
          <button
            type="button"
            onClick={async () => {
              await prompt.prompt();
              await prompt.userChoice;
              onClose();
            }}
            className="mt-5 h-11 w-full rounded-full bg-[#f7f6f3] text-sm font-bold text-[#0b0b0d] transition-colors hover:bg-white"
          >
            نصب مستقیم در همین مرورگر
          </button>
        )}

        <p className="mt-3 text-center text-[10px] leading-5 text-white/35">
          نصب اپلیکیشن اختیاری است؛ همهٔ امکانات در مرورگر هم کار می‌کند.
        </p>
      </div>
    </div>
  );
}
