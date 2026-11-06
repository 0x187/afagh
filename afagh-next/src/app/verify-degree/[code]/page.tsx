import { generateSvgQrCode } from '@/lib/certificate-engine';
import { getPublicBaseUrl } from '@/lib/settings';
import { verifyDegree } from '@/lib/graduation-engine';
import QrSvg from '@/components/QrSvg';

export const dynamic = 'force-dynamic';

// استعلام عمومی اصالت مدرک — بدون نیاز به ورود؛ مقصد QR روی مدرک چاپی
const faNum = (v: unknown) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

const DEGREE_LABEL: Record<string, string> = {
  TEMPORARY: 'گواهینامهٔ موقت پایان تحصیلات', PERMANENT: 'دانشنامهٔ رسمی', TRANSCRIPT: 'ریزنمرات رسمی',
};

export default async function VerifyDegreePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const r = await verifyDegree(code);
  const url = `${await getPublicBaseUrl()}/verify-degree/${code}`;
  const qr = await generateSvgQrCode(url, 96);

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full p-6 space-y-4 border border-slate-200">
        <div className="text-center">
          <div className="text-2xl font-black text-slate-900">استعلام اصالت مدرک تحصیلی</div>
          <div className="text-xs text-slate-500 mt-1">دانشگاه آفاق — سامانهٔ جامع آموزشی</div>
        </div>

        {!r.found ? (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-center">
            <div className="text-3xl">⛔</div>
            <p className="text-sm font-black text-rose-800 mt-2">مدرکی با کد استعلام «{code}» یافت نشد.</p>
            <p className="text-2xs text-rose-700 mt-1">لطفاً کد را بررسی کنید یا با اداره آموزش تماس بگیرید.</p>
          </div>
        ) : (
          <>
            <div className={`rounded-xl p-4 text-center border ${
              r.revoked ? 'bg-rose-50 border-rose-200' : r.valid ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className="text-3xl">{r.revoked ? '⛔' : r.valid ? '✅' : '⚠️'}</div>
              <p className={`text-sm font-black mt-2 ${r.revoked ? 'text-rose-800' : r.valid ? 'text-emerald-800' : 'text-amber-800'}`}>
                {r.revoked ? `این مدرک باطل شده است. ${r.revokeReason ?? ''}`
                  : r.valid ? 'این مدرک معتبر و مورد تأیید دانشگاه است.'
                    : 'هشدار: اثر انگشت دیجیتال مدرک با پایگاه داده هم‌خوان نیست.'}
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-xs">
              {([
                ['نوع مدرک', DEGREE_LABEL[r.degreeType] ?? r.degreeType],
                ['نام و نام خانوادگی', String((r.snapshot as Record<string, unknown>).fullName ?? '—')],
                ['کد ملی', faNum((r.snapshot as Record<string, unknown>).nationalCodeMasked)],
                ['شمارهٔ دانشجویی', faNum((r.snapshot as Record<string, unknown>).studentCode)],
                ['رشتهٔ تحصیلی', String((r.snapshot as Record<string, unknown>).major ?? '—')],
                ['مقطع', String((r.snapshot as Record<string, unknown>).degree ?? '—')],
                ['معدل کل', faNum((r.snapshot as Record<string, unknown>).gpa)],
                ['واحد گذرانده', faNum((r.snapshot as Record<string, unknown>).passedUnits)],
                ['شمارهٔ سریال', r.serialNo],
                ['کد صحت وزارت علوم', r.ministryVerificationCode ?? '—'],
                ['تاریخ صدور', faNum(new Date(r.issuedAt).toLocaleDateString('fa-IR'))],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="bg-slate-50 border border-slate-200 rounded-lg p-2">
                  <dt className="text-3xs text-slate-500 font-bold">{k}</dt>
                  <dd className="text-[12px] font-black text-slate-800 break-all">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="flex items-center gap-3 border-t border-slate-100 pt-3">
              <QrSvg svg={qr} className="w-24 h-24 shrink-0" />
              <div className="text-3xs text-slate-500 leading-5 break-all">
                <div className="font-black text-slate-700 mb-1">اثر انگشت دیجیتال (SHA-256):</div>
                <code>{r.documentHash}</code>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
