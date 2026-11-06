import { toJalaliFromDate, faDigits } from '@/lib/calendar';
import QrSvg from '@/components/QrSvg';

type Props = {
  title: string;
  url: string;
  qr?: string;
  expiresAt?: string | null;
  hint?: string;
};

function jdate(d: string | Date | null | undefined): string {
  if (!d) return '\u2014';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '\u2014';
  const { jy, jm, jd } = toJalaliFromDate(date);
  return faDigits(jy + '/' + String(jm).padStart(2, '0') + '/' + String(jd).padStart(2, '0'));
}

/**
 * بلوک رسمیت اسناد چاپی: QR استعلام + نشانی + اعتبار.
 *
 * چیدمان دو ستونی است (QR یک ستون، متن ستون دیگر با `min-w-0`) تا نشانی بلند روی
 * QR نیفتد؛ جعبهٔ QR با اندازهٔ SVG یکی است و SVG با `[&>svg]` داخل همان جعبه جا
 * می‌شود. حاشیهٔ سکوت و سطح تصحیح خطای QR در `lib/qr.ts` تنظیم شده است تا
 * اسکنرهای موبایل نسخهٔ چاپی را بخوانند.
 */
export default function VerifyQrBlock({ title, url, qr, expiresAt, hint }: Props) {
  return (
    <div className="break-inside-avoid rounded-lg border border-slate-700 bg-slate-50 p-3">
      <div className="flex flex-wrap items-start gap-4">
        {qr ? (
          <QrSvg
            svg={qr}
            className="h-32 w-32 shrink-0 overflow-hidden rounded border border-slate-300 bg-white p-1 [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
          />
        ) : null}
        <div className="min-w-0 flex-1 text-2xs leading-6 text-slate-600">
          <p className="font-bold text-slate-800">{title}</p>
          <p className="break-all font-mono text-3xs text-slate-500" dir="ltr">{url}</p>
          {expiresAt && <p>اعتبار استعلام تا {jdate(new Date(expiresAt))}</p>}
          <p className="mt-0.5 text-3xs text-slate-500">
            {hint ?? 'QR را با دوربین گوشی اسکن کنید یا نشانی بالا را در مرورگر باز کنید.'}
          </p>
        </div>
      </div>
    </div>
  );
}
