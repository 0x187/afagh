'use client';

import QrSvg from '@/components/QrSvg';

// (تایپ محلی — عمداً از @/lib/verification ایمپورت نمی‌شود چون آن ماژول server-only است)
interface EnrollConfirmData {
  studentId: number;
  studentName: string;
  studentCode: string;
  nationalIdMasked: string;
  majorName: string | null;
  termId: number;
  termTitle: string;
  courses: {
    courseTitle: string;
    courseCode: string;
    units: number;
    groupNumber: number;
    professorName: string | null;
    status: string;
  }[];
  totalUnits: number;
  checkedAt: string;
}

type OkData = EnrollConfirmData;

const faNum = (n: unknown) =>
  n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

const ENROLL_STATUS_FA: Record<string, string> = {
  REGISTERED: 'ثبت قطعی',
  FINALIZED: 'نهایی‌شده',
  WAITLISTED: 'لیست انتظار',
  PENDING_COUNCIL: 'در انتظار شورا',
  DROPPED: 'حذف‌شده',
};

export default function EnrollConfirmClient(props: {
  termTitle: string;
  blocked: string | null;
  verifyUrl: string | null;
  expiresAt: string | null;
  qrSvg: string;
  data: OkData | null;
  emptyMessage: string | null;
}) {
  const { termTitle, blocked, verifyUrl, expiresAt, qrSvg, data, emptyMessage } = props;

  if (blocked || !data) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
        {emptyMessage || blocked || 'تأییدیه‌ای برای این نیمسال صادر نشد.'}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* نوار عملیات — در چاپ نمی‌آید */}
      <div className="print:hidden flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
        <div className="text-xs text-slate-600">
          تأییدیهٔ انتخاب واحد <b>{termTitle}</b> — معتبر تا {expiresAt ? new Date(expiresAt).toLocaleDateString('fa-IR') : '—'}
        </div>
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-500"
        >
          🖨️ چاپ تأییدیه
        </button>
      </div>

      {/* برگهٔ تأییدیه */}
      <div className="rounded-2xl border-2 border-slate-800 bg-white p-5 print:border-black print:rounded-none">
        <div className="flex items-start justify-between gap-3 border-b-2 border-slate-800 pb-3">
          <div>
            <h1 className="text-base font-black text-slate-900">تأییدیهٔ انتخاب واحد</h1>
            <p className="mt-0.5 text-2xs text-slate-500">دانشگاه آفاق — سامانهٔ جامع آموزشی · نیمسال {termTitle}</p>
          </div>
          {qrSvg ? (
            <QrSvg svg={qrSvg} className="h-24 w-24 shrink-0" />
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 py-3 text-xs sm:grid-cols-4">
          {([
            ['نام دانشجو', data.studentName],
            ['شمارهٔ دانشجویی', data.studentCode],
            ['کد ملی (ماسک‌شده)', data.nationalIdMasked],
            ['رشتهٔ تحصیلی', data.majorName ?? '—'],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <div className="text-3xs font-bold text-slate-500">{k}</div>
              <div className="mt-0.5 text-[12px] font-black text-slate-800">{v}</div>
            </div>
          ))}
        </div>

        <table className="w-full text-right text-xs rt">
          <thead>
            <tr className="border-y-2 border-slate-800 text-slate-600">
              <th className="p-2">ردیف</th>
              <th className="p-2">درس</th>
              <th className="p-2">کد</th>
              <th className="p-2 text-center">واحد</th>
              <th className="p-2 text-center">گروه</th>
              <th className="p-2">استاد</th>
              <th className="p-2">وضعیت</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {data.courses.map((c, i) => (
              <tr key={i}>
                <td className="p-2 text-slate-500">{faNum(i + 1)}</td>
                <td className="p-2 font-bold text-slate-900">{c.courseTitle}</td>
                <td className="p-2 font-mono" dir="ltr">{c.courseCode}</td>
                <td className="p-2 text-center">{faNum(c.units)}</td>
                <td className="p-2 text-center">{faNum(c.groupNumber)}</td>
                <td className="p-2">{c.professorName ?? '—'}</td>
                <td className="p-2">{ENROLL_STATUS_FA[c.status] ?? c.status}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-800 font-black">
              <td className="p-2" colSpan={3}>جمع</td>
              <td className="p-2 text-center">{faNum(data.totalUnits)} واحد</td>
              <td className="p-2 text-center" colSpan={3}>{faNum(data.courses.length)} درس</td>
            </tr>
          </tfoot>
        </table>

        <div className="mt-3 flex items-end justify-between gap-3 text-3xs text-slate-500">
          <div className="break-all">
            استعلام اصالت: {verifyUrl}
            <br />
            صدور: {new Date(data.checkedAt).toLocaleString('fa-IR')}
          </div>
          <div className="shrink-0 text-center">
            <div className="h-10" />
            <div className="border-t border-slate-400 px-6 pt-1">مهر و امضای آموزش</div>
          </div>
        </div>
      </div>
    </div>
  );
}
