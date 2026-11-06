import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { degree_level_configs, majors, student_cards, students, universities, users } from '@/db/schema';
import { requireRoleOrPermission } from '@/lib/permissions-enforcer';
import { getCurrentUniversity } from '@/lib/university-scope';
import { getPublicBaseUrl, getSetting } from '@/lib/settings';
import { qrSvg } from '@/lib/qr';
import PersonPhoto from '@/app/admin/students/components/PersonPhoto';
import PrintButton from '@/components/PrintButton';
import QrSvg from '@/components/QrSvg';
import { toShamsi } from '@/lib/shamsi';

export const dynamic = 'force-dynamic';

const faNum = (v: unknown) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/**
 * کارت دانشجویی چاپی — با QR گیت حراست.
 *
 * توکن امنیتی کارت (`student_cards.secureToken`) همان چیزی است که نگهبانی در
 * `/id/[token]` استعلام می‌کند؛ QR کارت مستقیماً همان نشانی را رمز می‌کند تا با
 * یک اسکن، هویت و عکس و وضعیت کارت تأیید شود.
 */
export default async function StudentCardPrintPage({ params }: { params: Promise<{ studentId: string }> }) {
  await requireRoleOrPermission(
    ['ADMIN', 'EDU_EXPERT', 'ARCHIVE_EXPERT', 'MILITARY_OFFICER', 'GRADUATEAFFAIRS'],
    ['students:view_dossier'],
  );

  const { studentId: rawId } = await params;
  const studentId = Number(rawId || 0);
  const uni = await getCurrentUniversity().catch(() => null);

  const [row] = await db
    .select({
      studentId: students.id,
      userId: students.userId,
      studentCode: students.studentCode,
      entryYear: students.entryYear,
      status: students.status,
      firstName: users.firstName,
      lastName: users.lastName,
      nationalCode: users.nationalCode,
      hasPhoto: users.photoKey,
      majorName: majors.name,
      degreeTitle: degree_level_configs.title,
      uniTitle: universities.title,
      uniLogo: universities.logoUrl,
      cardToken: student_cards.secureToken,
      cardStatus: student_cards.printStatus,
      cardIssuedAt: student_cards.issuedAt,
      cardExpiresAt: student_cards.expiresAt,
    })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .leftJoin(majors, eq(majors.id, students.majorId))
    .leftJoin(degree_level_configs, eq(degree_level_configs.id, students.degreeLevelId))
    .leftJoin(universities, eq(universities.id, students.universityId))
    .leftJoin(student_cards, eq(student_cards.studentId, students.id))
    .where(eq(students.id, studentId))
    .limit(1);

  if (!row) {
    return <div className="p-8 text-center text-sm font-bold text-rose-700" dir="rtl">دانشجو یافت نشد.</div>;
  }
  if (uni && row.uniTitle && uni.title !== row.uniTitle) {
    return <div className="p-8 text-center text-sm font-bold text-rose-700" dir="rtl">این دانشجو به دانشگاه فعال تعلق ندارد.</div>;
  }

  let qr = '';
  let verifyUrl = '';
  if (row.cardToken) {
    try {
      const base = await getPublicBaseUrl();
      verifyUrl = `${base}/id/${encodeURIComponent(row.cardToken)}`;
      qr = await qrSvg(verifyUrl, { errorCorrectionLevel: 'Q', size: 128, margin: 4 });
    } catch (err) {
      console.warn('[student-card] qr failed', err);
    }
  }
  const logo = row.uniLogo || (await getSetting('UNIVERSITY_LOGO').catch(() => '')) || null;
  const validUntil = row.cardExpiresAt ? toShamsi(row.cardExpiresAt.toISOString()) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4" dir="rtl">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-sm font-black text-slate-800">🪪 کارت دانشجویی — {row.firstName} {row.lastName}</h1>
        <div className="flex gap-2">
          <Link prefetch={false} href="/admin/student-cards" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700">بازگشت</Link>
          <PrintButton />
        </div>
      </div>

      {!row.cardToken && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-bold text-amber-900">
          برای این دانشجو کارتی صادر نشده است؛ ابتدا از فهرست «صدور و مدیریت کارت دانشجویی» کارت صادر کنید تا QR فعال شود.
        </div>
      )}

      <div className="print-area overflow-hidden rounded-2xl border-2 border-slate-800 bg-white shadow-xl print:shadow-none">
        {/* سربرگ */}
        <div className="flex items-center justify-between gap-3 border-b-2 border-slate-800 bg-slate-50 px-4 py-2">
          <div className="flex items-center gap-2">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="آرم دانشگاه" className="h-10 w-10 object-contain" />
            ) : null}
            <div>
              <p className="text-[13px] font-black text-slate-900">{row.uniTitle || uni?.title || ''}</p>
              <p className="text-3xs text-slate-600">کارت شناسایی دانشجویی</p>
            </div>
          </div>
          <p className="text-3xs font-bold text-slate-600">{faNum(row.studentCode)}</p>
        </div>

        <div className="flex flex-wrap gap-4 p-4">
          {/* عکس */}
          <div className="shrink-0">
            <PersonPhoto userId={row.userId} hasPhoto={!!row.hasPhoto} className="h-40 w-32 rounded-lg border border-slate-300" label="عکس دانشجو" />
          </div>

          {/* مشخصات */}
          <div className="min-w-0 flex-1 space-y-1.5 text-2xs">
            <Row label="نام و نام خانوادگی" value={`${row.firstName} ${row.lastName}`} strong />
            <Row label="شمارهٔ دانشجویی" value={faNum(row.studentCode)} mono />
            <Row label="کد ملی" value={faNum(row.nationalCode)} mono />
            <Row label="رشته" value={row.majorName ?? '—'} />
            <Row label="مقطع" value={row.degreeTitle ?? '—'} />
            <Row label="سال ورود" value={faNum(row.entryYear)} />
            <Row label="وضعیت کارت" value={row.cardStatus ?? 'PENDING'} />
            {validUntil && <Row label="اعتبار کارت تا" value={validUntil} />}
          </div>

          {/* QR گیت حراست */}
          <div className="shrink-0 text-center">
            {qr ? (
              <QrSvg
                svg={qr}
                className="h-32 w-32 overflow-hidden rounded border border-slate-300 bg-white p-1 [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
              />
            ) : (
              <div className="flex h-32 w-32 items-center justify-center rounded border border-dashed border-slate-300 text-3xs text-slate-400">
                QR در دسترس نیست
              </div>
            )}
            <p className="mt-1 text-[9px] font-bold text-slate-600">اسکن برای استعلام هویت</p>
          </div>
        </div>

        <div className="border-t border-slate-300 bg-slate-50 px-4 py-1.5 text-[9px] leading-4 text-slate-600">
          این کارت امانت است و در صورت درخواست مأموران باید ارائه شود. استعلام برخط هویت از پایگاه دادهٔ مرکزی دانشگاه انجام می‌شود
          {verifyUrl ? <> — نشانی: <span className="font-mono" dir="ltr">{verifyUrl}</span></> : null}.
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong, mono }: { label: string; value: string; strong?: boolean; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="w-32 shrink-0 font-bold text-slate-500">{label}:</span>
      <span className={`min-w-0 flex-1 ${strong ? 'font-black' : 'font-bold'} text-slate-800 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
