import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { notification_channels } from '@/db/schema';
import { getSessionUser } from '@/lib/auth';
import { getSetting } from '@/lib/settings';

// پیام‌رسان‌هایی که کاربر می‌تواند به آن‌ها وصل شود (تلگرام فقط-ارسالی است و
// اتصال جدید نمی‌پذیرد، پس در پیشنهادها نیست).
const LINKABLE: { key: string; label: string; usernameKey: string }[] = [
  { key: 'SOROUSH', label: 'سروش', usernameKey: 'SOROUSH_BOT_USERNAME' },
  { key: 'BALE', label: 'بله', usernameKey: 'BALE_BOT_USERNAME' },
  { key: 'EITAA', label: 'ایتا', usernameKey: 'EITAA_BOT_USERNAME' },
];

const CHANNEL_FA: Record<string, string> = {
  SOROUSH: 'سروش',
  BALE: 'بله',
  EITAA: 'ایتا',
  TELEGRAM: 'تلگرام',
};

/**
 * بنر عضویت پیام‌رسان — سه حالت:
 * · هیچ اتصالی ندارد → راهنمای کامل (آدرس بات + کد صحت‌سنجی)
 * · اتصال دارد ولی تأیید نشده → فقط «کد را بده»
 * · یک (یا چند) کانال تأییدشده دارد ولی کانال دیگری هنوز وصل نیست →
 *   بنر جمع‌وجور «پیام‌رسان دیگر هم اضافه کن» تا صفحهٔ /messenger گم نشود.
 * · همهٔ کانال‌های قابل‌اتصال وصل‌اند → هیچ‌چیز (سکوت)
 */
export default async function MessengerOnboardBanner() {
  const me = await getSessionUser();
  if (!me) return null;

  let rows: { channel: string; isActive: number | null; verifiedAt: Date | null }[] = [];
  try {
    rows = (await db
      .select({
        channel: notification_channels.channel,
        isActive: notification_channels.isActive,
        verifiedAt: notification_channels.verifiedAt,
      })
      .from(notification_channels)
      .where(eq(notification_channels.userId, me.id))) as typeof rows;
  } catch {
    return null;
  }

  const verified = new Set(
    rows.filter(r => (r.isActive ?? 0) === 1 && r.verifiedAt).map(r => r.channel),
  );
  const hasAny = rows.length > 0;
  const missing = LINKABLE.filter(c => !verified.has(c.key));

  // همه وصل‌اند → سکوت
  if (hasAny && verified.size > 0 && missing.length === 0) return null;
  // هیچ ردیفی ندارد و چیزی برای پیشنهاد نیست → سکوت (نباید بنر خالی نشان داد)
  if (!hasAny && missing.length === 0) return null;

  // نام‌کاربری بات‌ها فقط برای نمایش آدرس عضویت
  const usernames: Record<string, string> = {};
  await Promise.all(
    missing.map(async c => {
      try {
        usernames[c.key] = (await getSetting(c.usernameKey)).trim().replace(/^@/, '');
      } catch {
        usernames[c.key] = '';
      }
    }),
  );
  const addr = (key: string, label: string) =>
    usernames[key] ? (
      <>
        {' '}{label} <span className="font-mono font-bold" dir="ltr">@{usernames[key]}</span>
      </>
    ) : (
      <> {label}</>
    );

  // حالت سوم: قبلاً یک کانال وصل کرده و حالا می‌خواهد کانال دیگری اضافه کند
  if (verified.size > 0 && missing.length > 0) {
    const doneNames = [...verified].map(c => CHANNEL_FA[c] ?? c).join('، ');
    return (
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3 text-xs leading-6 text-indigo-900" dir="rtl">
        <p>
          <span className="font-black">✅ اتصال {doneNames} فعال است.</span>
          {' '}می‌خواهید اعلان‌ها را در پیام‌رسان دیگری هم بگیرید؟ در
          {missing.map((c, i) => (
            <span key={c.key}>{i > 0 ? ' یا' : ''}{addr(c.key, c.label)}</span>
          ))}
          {' '}عضو شوید، در صفحهٔ اتصال کد بگیرید و بفرستید:
        </p>
        <Link prefetch={false}
          href="/messenger"
          className="mt-1.5 inline-block rounded-xl bg-indigo-700 px-4 py-1.5 text-xs font-black text-white hover:bg-indigo-800"
        >
          افزودن پیام‌رسان دیگر ←
        </Link>
      </div>
    );
  }

  const [soroushBot, baleBot] = [usernames['SOROUSH'] ?? '', usernames['BALE'] ?? ''];

  return (
    <div className="rounded-2xl border border-indigo-300 bg-indigo-50/80 p-4 text-xs leading-6 text-indigo-900" dir="rtl">
      {hasAny ? (
        <>
          <p className="font-black">📩 اتصال پیام‌رسان شما ناقص است — فقط کد صحت‌سنجی مانده:</p>
          <p className="mt-1 text-indigo-800">
            در صفحهٔ اتصال، کد یک‌بارمصرف بگیرید و در بات بفرستید، بعد همان‌جا تأیید کنید.
          </p>
          <Link prefetch={false}
            href="/messenger"
            className="mt-2 inline-block rounded-xl bg-indigo-700 px-4 py-2 text-xs font-black text-white hover:bg-indigo-800"
          >
            دریافت کد و تأیید ←
          </Link>
        </>
      ) : (
        <>
          <p className="font-black">🔔 اعلان‌های مهم (نمره، کلاس، فیش) را در پیام‌رسان بگیرید:</p>
          <ol className="mt-1 list-decimal space-y-0.5 pr-5 text-indigo-800">
            <li>
              در پیام‌رسان عضو بات شوید:
              {soroushBot ? <> سروش <span className="font-mono font-bold" dir="ltr">@{soroushBot}</span></> : ' سروش'}
              {baleBot ? <> · بله <span className="font-mono font-bold" dir="ltr">@{baleBot}</span></> : ''}
            </li>
            <li>در همین سامانه، صفحهٔ «اتصال پیام‌رسان»، کد صحت‌سنجی بگیرید و در بات بفرستید.</li>
            <li>به صفحه برگردید و «تأیید نهایی» را بزنید — تمام.</li>
          </ol>
          <Link prefetch={false}
            href="/messenger"
            className="mt-2 inline-block rounded-xl bg-indigo-700 px-4 py-2 text-xs font-black text-white hover:bg-indigo-800"
          >
            شروع اتصال در ۳۰ ثانیه ←
          </Link>
        </>
      )}
    </div>
  );
}
