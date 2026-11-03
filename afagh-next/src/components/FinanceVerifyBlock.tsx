import { toJalaliFromDate, faDigits } from '@/lib/calendar';
import QrSvg from '@/components/QrSvg';

type Props = { url: string; qr?: string; expiresAt?: string | null };

function jdate(d: string | Date | null | undefined): string {
  if (!d) return '\u2014';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '\u2014';
  const { jy, jm, jd } = toJalaliFromDate(date);
  return faDigits(jy + '/' + String(jm).padStart(2, '0') + '/' + String(jd).padStart(2, '0'));
}

/**
 * بلوک رسمیت انتهای کارنامه: QR استعلام + نشانی + اعتبار.
 *
 * چیدمان: دو ستون (QR در یک ستون، متن در ستون دیگر) تا نشانی بلند روی QR نیفتد.
 * اندازهٔ جعبهٔ QR با اندازهٔ SVG یکی است و SVG با `[&>svg]` داخل همان جعبه جا
 * می‌شود؛ پیش‌تر SVG ۱۶۰ پیکسلی داخل جعبهٔ ۹۶ پیکسلی سرریز می‌کرد، متن را
 * می‌پوشاند و در چاپ بریده می‌شد (اسکن نمی‌شد).
 */
export default function FinanceVerifyBlock({ url, qr, expiresAt }: Props) {
  return (
    <div className="break-inside-avoid rounded-lg border border-slate-700 bg-slate-50 p-3">
      <div className="flex flex-wrap items-start gap-4">
        {qr ? (
          <QrSvg
            svg={qr}
            className="fin-verify-qr h-32 w-32 shrink-0 overflow-hidden rounded border border-slate-300 bg-white p-1 [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
          />
        ) : null}
        <div className="min-w-0 flex-1 text-2xs leading-6 text-slate-600">
          <p className="font-bold text-slate-800">استعلام برخط اصالت این کارنامه</p>
          <p className="break-all font-mono text-3xs text-slate-500" dir="ltr">{url}</p>
          {expiresAt && <p>اعتبار استعلام تا {jdate(new Date(expiresAt))}</p>}
          <p className="mt-0.5 text-3xs text-slate-500">
            QR را با دوربین گوشی اسکن کنید یا نشانی بالا را در مرورگر باز کنید.
          </p>
        </div>
      </div>
    </div>
  );
}
