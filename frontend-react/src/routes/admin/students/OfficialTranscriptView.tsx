// ═══ Official transcript view — Sama format: 3 terms side by side + header/footer
// + second-page breakdown (port of components/OfficialTranscriptView.tsx).
// This is exactly what the print buttons print (WYSIWYG). ═══
import { useEffect, useState } from 'react';
import type { StudentItem, CodeLabels, CohortStats, TranscriptRow } from '@/lib/students-dossier-api';
import type { TranscriptPrintOptions, OriginUniversity } from './print-options';
import type { TermGroup, TranscriptSummary } from './transcript-utils';
import PersonPhoto from './PersonPhoto';
import { DEFAULT_PRINT_OPTIONS } from './print-options';
import {
  breakdownByType, codeLabel, courseTypeGroup, dateToJalali, entryDateFa,
  faDigit, faNum, faStr, faWords, numOrNull, termDisplayTitle, thesisLegend,
  thesisQualitativeLabel, todayJalali,
} from './transcript-utils';
import { courseTypeFa, gradeStatusFa, quotaFa, studentStatusFa, studyModeFa } from '@/lib/student-labels';
import { faDigits } from '@/lib/fa';
import { getDossierTranscriptQR } from '@/lib/students-dossier-api';

/** Degree levels — the seed array of degree_level_configs (client-safe copy). */
const DEGREE_LEVEL_CONFIGS = [
  { id: 1, title: 'کارشناسی پیوسته', code: 'BS' },
  { id: 2, title: 'کارشناسی ارشد', code: 'MS' },
  { id: 3, title: 'کاردانی پیوسته', code: 'AD' },
  { id: 4, title: 'دکتری حرفه‌ای', code: 'PHD' },
];

// ── Safe QR rendering (port of QrSvg): the SVG string is server-generated, but the
// single insertion point still validates the shape before injecting (fail-closed). ──
const FORBIDDEN_SVG = /<script|<foreignObject|\son[a-z]+\s*=|javascript:/i;

function SafeQrSvg({ svg, className }: { svg?: string | null; className?: string }) {
  if (!svg || !svg.startsWith('<svg') || !svg.endsWith('</svg>') || FORBIDDEN_SVG.test(svg)) return null;
  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function VerifyQrBlock({ title, url, qr, expiresAt }: { title: string; url: string; qr?: string; expiresAt: string | null }) {
  const jdate = (d: string | null): string => {
    if (!d) return '—';
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return '—';
    return faDigits(`${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`);
  };
  return (
    <div className="break-inside-avoid rounded-lg border border-slate-700 bg-slate-50 p-3">
      <div className="flex flex-wrap items-start gap-4">
        {qr ? <SafeQrSvg svg={qr} className="h-32 w-32 shrink-0 overflow-hidden rounded border border-slate-300 bg-white p-1 [&>svg]:block [&>svg]:h-full [&>svg]:w-full" /> : null}
        <div className="min-w-0 flex-1 text-2xs leading-6 text-slate-600">
          <p className="font-bold text-slate-800">{title}</p>
          <p className="break-all font-mono text-3xs text-slate-500" dir="ltr">{url}</p>
          {expiresAt && <p>اعتبار استعلام تا {jdate(expiresAt)}</p>}
          <p className="mt-0.5 text-3xs text-slate-500">QR را با دوربین گوشی اسکن کنید یا نشانی بالا را در مرورگر باز کنید.</p>
        </div>
      </div>
    </div>
  );
}

export type TranscriptPrintOptionsShape = TranscriptPrintOptions;

/** Official transcript view (Sama format) */
export default function OfficialTranscriptView({
  student,
  summary,
  logoUrl,
  codeLabels,
  canEditGrades,
  onEditGrade,
  printOptions = DEFAULT_PRINT_OPTIONS,
  originUniversity = null,
  universityCode = null,
  cohortStats = null,
  cohortLoading = false,
}: {
  student: StudentItem;
  summary: TranscriptSummary;
  logoUrl?: string | null;
  codeLabels?: CodeLabels | null;
  canEditGrades?: boolean;
  onEditGrade?: (row: TranscriptRow) => void;
  printOptions?: TranscriptPrintOptions;
  originUniversity?: OriginUniversity | null;
  /** code of the university owning the record (e.g. ZARINE) */
  universityCode?: string | null;
  cohortStats?: CohortStats | null;
  cohortLoading?: boolean;
}) {
  const lbl = {
    accept: (v: string | null | undefined) => {
      if (!v || v === '—') return '—';
      return codeLabels?.accept[v] || codeLabels?.acceptByTarget[v] || v;
    },
    period: (v: string | null | undefined) => codeLabel(codeLabels?.period, v),
    quota: (v: string | null | undefined) => codeLabel(codeLabels?.quota, v),
  };
  const probation = summary.terms.filter((t) => t.probation).length;

  // ── Online authenticity QR (admin API; silently optional) ──
  const [verifyQr, setVerifyQr] = useState<{ url: string; qr: string; expiresAt: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    setVerifyQr(null);
    if (!student?.id) return;
    getDossierTranscriptQR(student.id).then((d) => { if (alive && d?.url) setVerifyQr({ url: d.url, qr: d.qr ?? '', expiresAt: d.expiresAt }); });
    return () => { alive = false; };
  }, [student?.id]);

  // Terms per kind (Sama footer) — same rule as groupTranscript
  const termKindCounts = (() => {
    let regular = 0, summer = 0, equiv = 0;
    for (const t of summary.terms) {
      const code = t.termCode || '';
      const title = t.termTitle || '';
      if (code.endsWith('5') || code.toUpperCase().includes('EQ') || title.includes('معادل')) equiv++;
      else if (code.endsWith('3') || title.includes('تابستان')) summer++;
      else regular++;
    }
    return { regular, summer, equiv };
  })();

  const info: [string, string][] = [
    ['نام خانوادگی و نام', `${student.lastName} ${student.firstName}`],
    ['شماره دانشجویی', faDigits(student.studentCode)],
    ['نام پدر', student.fatherName || '—'],
    ['شماره شناسنامه', student.birthCertNo ? faDigits(student.birthCertNo) : '—'],
    ['محل صدور', student.placeOfIssue || '—'],
    ['محل تولد', student.placeOfBirth || '—'],
    ['کد ملی', faDigits(student.nationalCode)],
    ['تاریخ تولد', dateToJalali(student.birthDate)],
    ['مقطع', student.degreeLevel],
    // Course kind lives in studyingMode (COURSTYPE); the label maps first, then the Sama table
    ['نوع دوره', lbl.period(student.studyingMode) !== '—' ? lbl.period(student.studyingMode) : courseTypeFa(student.studyingMode)],
    ['دانشکده', student.facultyName || '—'],
    ['رشته تحصیلی', student.majorName],
    ...(printOptions.showAcceptance ? [['نحوه ورود', lbl.accept(student.acceptanceType)] as [string, string]] : []),
    ...(originUniversity ? [[
      'دانشگاه مبدا',
      originUniversity.dissolved ? `${originUniversity.title} (منحله)` : originUniversity.title,
    ] as [string, string]] : []),
    ...(printOptions.showStudyMode ? [['شیوه آموزشی', studyModeFa(student.trainingMethod)] as [string, string]] : []),
    ['سهمیه قبولی', quotaFa(student.quotaType)],
    ['سهمیه نهایی', quotaFa(student.quotaType)],
    ['سهمیه ثبت‌نامی', lbl.quota(student.acceptanceAllocation) !== '—' ? lbl.quota(student.acceptanceAllocation) : quotaFa(student.quotaType)],
    ...(printOptions.showNationality ? [[
      'ملیت',
      student.nationality === '120001' ? 'ایرانی' : (!student.nationality || /^\s*unknown\s*$/i.test(student.nationality) ? '—' : student.nationality),
    ] as [string, string]] : []),
    ['استاد راهنما', '—'],
  ];
  // Empty cells of the last info row (so the gray gap band is not visible)
  const infoFillers = (3 - (info.length % 3)) % 3;
  // Terms grouped in chunks of 3 (like Sama)
  const chunks: TermGroup[][] = [];
  for (let i = 0; i < summary.terms.length; i += 3) chunks.push(summary.terms.slice(i, i + 3));
  const breakdown = breakdownByType(summary.terms.flatMap((t) => t.rows));
  // Grade-status legend (only rows with a raw Sama code)
  const statusLegend = new Map<string, string>();
  for (const t of summary.terms) for (const r of t.rows) {
    if (r.gradeStatusCode && !statusLegend.has(r.gradeStatusCode)) {
      statusLegend.set(r.gradeStatusCode, r.gradeStatusTitle || r.gradeStatusCode);
    }
  }
  const statusCell = (r: TermGroup['rows'][number]) => {
    if (r.gradeStatusCode) {
      return (
        <span title={r.gradeStatusTitle || r.gradeStatusCode} className="font-mono font-bold">
          {faDigits(r.gradeStatusCode)}
        </span>
      );
    }
    return gradeStatusFa(r.gradeStatus);
  };
  /** Grade cell: with the qualitative thesis tick, thesis courses show the label */
  const gradeCell = (r: TermGroup['rows'][number]) => {
    if (printOptions.thesisQualitative && courseTypeGroup(r.courseType) === 'پایان‌نامه') {
      return <span className="font-sans">{thesisQualitativeLabel(numOrNull(r.gradeValue), summary.passGrade)}</span>;
    }
    return faStr(r.gradeValue);
  };
  const termCell = (t: TermGroup) => (
    <section key={t.termCode} className="term-block min-w-0">
      <div className="bg-slate-100 border-b border-slate-300 px-1 py-1 font-extrabold text-3xs text-center">
        {termDisplayTitle(t.termCode, t.termTitle)}
        <span className="block font-normal text-slate-700">وضعیت دانشجو: {t.termStatusTitle || '—'} — <b className={t.probation ? 'text-red-700' : 'text-emerald-700'}>{t.probation ? 'مشروط' : 'عادی'}</b></span>
      </div>
      <table className="tr-term-table w-full text-[9px]" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '15%' }} />
          <col style={{ width: '40%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '21%' }} />
        </colgroup>
        <thead>
          <tr className="border-b border-slate-300 text-slate-500">
            <th className="p-1">کد درس</th>
            <th className="p-1">نام درس</th>
            <th className="p-1">واحد</th>
            <th className="p-1">نمره</th>
            <th className="p-1">وضع</th>
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr
              key={i}
              className={`border-b border-slate-100 ${canEditGrades && onEditGrade ? 'hover:bg-amber-100/60 cursor-pointer' : ''}`}
              onClick={() => {
                if (canEditGrades && onEditGrade) onEditGrade(r);
              }}
              title={canEditGrades && onEditGrade ? 'برای ویرایش یا ثبت نمره کلیک کنید' : undefined}
            >
              <td className="p-1 font-mono text-center" dir="ltr">{faDigits(r.courseCode)}</td>
              <td className="tr-course-title p-1 leading-tight">
                {r.courseTitle}
                {r._excludedByRegulation && (
                  <span className="block text-[7px] text-amber-600 font-bold">({r._excludedByRegulation} اعمال شد)</span>
                )}
              </td>
              <td className="p-1 text-center font-mono">{r.units == null ? '—' : faStr(r.units, 1)}</td>
              <td className="p-1 text-center font-mono font-bold">{gradeCell(r)}</td>
              <td className="p-1 text-center text-[8px]">{statusCell(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tr-term-footer border-t-2 border-slate-400 text-[9px] px-1 py-1 space-y-0.5 bg-slate-50">
        <p><b>نیمسال</b> — اخذشده: <b className="font-mono">{faNum(t.taken, 0)}</b> گذرانده: <b className="font-mono">{faNum(t.passed, 0)}</b> مردودی: <b className="font-mono">{faNum(t.failed, 0)}</b></p>
        <p>معدل: <b className="font-mono">{faNum(t.gpa)}</b> امتیاز: <b className="font-mono">{faNum(t.points, 1)}</b> حذف: <b className="font-mono">{faNum(t.droppedUnits, 0)}</b></p>
        <p className="border-t border-slate-300 pt-0.5"><b>کل</b> — اخذشده: <b className="font-mono">{faNum(t.cumTaken, 0)}</b> گذرانده: <b className="font-mono">{faNum(t.cumPassed, 0)}</b> مردودی: <b className="font-mono">{faNum(t.cumFailed, 0)}</b></p>
        <p>معدل: <b className="font-mono">{faNum(t.cumGpa)}</b> امتیاز: <b className="font-mono">{faNum(t.cumPoints, 1)}</b> موثر: <b className="font-mono">{faNum(t.cumEffectiveUnits, 0)}</b></p>
      </div>
    </section>
  );

  return (
    <div dir="rtl" className="tr-root border-2 border-slate-700 text-slate-900 bg-white">
      {/* The whole header/info block lives in thead so it repeats on every printed page */}
      <table className="tr-doc w-full">
        <thead>
          <tr><td className="tr-doc-cell">
            {/* Sama header */}
            <div className="flex items-start justify-between border-b-2 border-slate-700 px-3 py-2">
              <div className="text-3xs text-center">
                <p className="font-bold">باسمه تعالی</p>
                <p>اداره کل امور آموزشی</p>
                <p className="font-extrabold">کارنامه کل</p>
                <p className="mt-1">تاریخ تهیه: <b className="font-mono">{todayJalali()}</b></p>
              </div>
              <div className="text-center">
                <p className="text-3xs">موسسه آموزش عالی غیرانتفاعی - غیردولتی آفاق</p>
                {printOptions.showPhoto && student.photoKey ? (
                  <div className="mx-auto mt-1 w-14 h-[70px] flex items-center justify-center">
                    <PersonPhoto userId={student.userId} hasPhoto={!!student.photoKey} className="w-14 h-[70px]" icon="👤" label="عکس" />
                  </div>
                ) : null}
              </div>
              <div className="w-16 h-16 flex items-center justify-center">
                {printOptions.showLogo ? (logoUrl ? <img src={logoUrl} alt="ارم دانشگاه" className="max-w-16 max-h-16 object-contain" /> : <span className="text-[9px] text-slate-400 border border-dashed border-slate-300 rounded p-1">ارم دانشگاه</span>) : null}
              </div>
            </div>
            {/* Info grid — always 3 columns in print (like Sama) */}
            <div className="tr-info-grid grid grid-cols-2 sm:grid-cols-3 gap-px bg-slate-300 border-b-2 border-slate-700 text-3xs">
              {info.map(([k, v]) => (
                <div key={k} className="bg-white px-2 py-1 flex justify-between gap-1">
                  <span className="font-bold whitespace-nowrap">{k}:</span>
                  <span className="text-left">{v}</span>
                </div>
              ))}
              {Array.from({ length: infoFillers }).map((_, i) => (
                <div key={`filler-${i}`} className="bg-white px-2 py-1" aria-hidden="true" />
              ))}
            </div>
          </td></tr>
        </thead>
        {/* Signatures in tfoot so they repeat under every printed page */}
        <tfoot>
          <tr><td className="tr-doc-cell">
            <div className="tr-signatures flex justify-between px-3 py-2 text-3xs">
              <span>امضاء رئیس خدمات آموزش</span>
              <span>امضاء و مهر اداره کل آموزش</span>
              <span>امضاء و مهر امور آموزشی دانشگاه منتخب</span>
            </div>
          </td></tr>
        </tfoot>
        <tbody>
          {/* Terms in rows of 3 */}
          {chunks.map((ch, i) => (
            <tr key={i} className="tr-doc-row"><td className="tr-doc-cell">
              <div className="tr-term-row flex gap-1">{ch.map(termCell)}</div>
            </td></tr>
          ))}
          {/* Grade-status legend — only when the Sama tick is on and codes exist */}
          {printOptions.showLegend && statusLegend.size > 0 && (
            <tr><td className="tr-doc-cell">
              <div className="border-t-2 border-slate-700 px-3 py-1.5 text-[9px] bg-slate-50 leading-relaxed">
                <b>توضیح وضع نمرات:</b>{' '}
                {[...statusLegend.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([code, title]) => (
                  <span key={code} className="inline-block ml-3">
                    <b className="font-mono">{code}</b>={title}
                  </span>
                ))}
              </div>
            </td></tr>
          )}
          {/* Footer */}
          <tr><td className="tr-doc-cell">
            <div className="border-t-2 border-slate-700 px-3 py-2 text-3xs space-y-1">
              <div className="flex flex-wrap gap-x-6">
                <span>تعداد نیمسال مشروط: <b className="font-mono">{probation.toLocaleString('fa-IR')}</b></span>
                <span>وضعیت کلی دانشجو: <b>{studentStatusFa(student.status, student.samaStatusCode, universityCode)}</b></span>
                <span>مقطع فارغ‌التحصیلی: <b>{student.graduateDegreeLevelId ? (() => { const d = DEGREE_LEVEL_CONFIGS.find((d2) => d2.id === student.graduateDegreeLevelId); return d ? d.title : '—'; })() : '—'}</b></span>
                <span>تاریخ شروع تحصیل: <b className="font-mono">{entryDateFa(student.entryYear, student.entryTerm)}</b></span>
                <span>تاریخ توقف تحصیل: <b className="font-mono">{student.graduateDate ? faDigit(student.graduateDate) : '—'}</b></span>
              </div>
              <div className="flex flex-wrap gap-x-6">
                <span>معدل کل به عدد: <b className="font-mono">{faNum(summary.gpa)}</b></span>
                <span>معدل کل به حروف: <b>{faWords(summary.gpa)}</b></span>
              </div>
              <p className="text-center text-slate-600">این کارنامه بدون مهر و امضا فقط برای اطلاع دانشجو صادر شده است و ارزش دیگری ندارد</p>
              <div className="flex flex-wrap gap-x-6">
                <span>تعداد نیمسال‌ها: در حال تحصیل (<b className="font-mono">{faNum(termKindCounts.regular, 0)}</b>) ترم تابستان (<b className="font-mono">{faNum(termKindCounts.summer, 0)}</b>){termKindCounts.equiv > 0 ? <> معادل‌سازی (<b className="font-mono">{faNum(termKindCounts.equiv, 0)}</b>)</> : null}</span>
              </div>
              {originUniversity?.dissolved && (
                <div className="flex flex-wrap gap-x-6">
                  <span>توضیح: این دانشجو از دانشگاه منحلهٔ <b>{originUniversity.title}</b> منتقل شده است.</span>
                </div>
              )}
              {printOptions.thesisQualitative && (
                <p className="text-slate-500 text-[9px]">توضیح: نمرهٔ دروس پایان‌نامه/رساله به‌صورت کیفی درج شده است ({thesisLegend(summary.passGrade)}).</p>
              )}
              <p className="text-center text-slate-500 text-[9px]">سیستم مدیریت آموزش دانشگاه‌ها — آفاق · شماره دانشجویی <b className="font-mono">{faDigits(student.studentCode)}</b> · تاریخ تهیه <b className="font-mono">{todayJalali()}</b></p>
            </div>
          </td></tr>
          {/* Second page: passed-courses breakdown */}
          {printOptions.showBreakdown && (
            <tr><td className="tr-doc-cell">
              <div className="tr-breakdown border-t-2 border-slate-700 px-3 py-2">
                <p className="font-extrabold text-2xs mb-1">جدول وضعیت دروس گذرانده (کاتالوگ رشته)</p>
                <table className="w-full text-3xs border border-slate-400">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300">
                      <th className="p-1 border-l border-slate-300">نوع درس</th>
                      {breakdown.map((b) => <th key={b.type} className="p-1 border-l border-slate-300">{b.type}</th>)}
                      <th className="p-1">مجموع</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-200">
                      <td className="p-1 font-bold border-l border-slate-300">تعداد واحد</td>
                      {breakdown.map((b) => <td key={b.type} className="p-1 text-center font-mono border-l border-slate-300">{faNum(b.units, 1)}</td>)}
                      <td className="p-1 text-center font-mono font-bold">{faNum(summary.totalPassed, 1)}</td>
                    </tr>
                    <tr>
                      <td className="p-1 font-bold border-l border-slate-300">معدل</td>
                      {breakdown.map((b) => <td key={b.type} className="p-1 text-center font-mono border-l border-slate-300">{faNum(b.gpa)}</td>)}
                      <td className="p-1 text-center font-mono font-bold">{faNum(summary.gpa)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </td></tr>
          )}
          {/* Rank in the entry cohort (Sama tick) */}
          {printOptions.showRank && (
            <tr><td className="tr-doc-cell">
              <div className="border-t border-slate-300 px-3 py-1.5 text-3xs bg-slate-50 leading-relaxed">
                <div className="flex flex-wrap gap-x-6">
                  <span>رتبهٔ معدل کل دانشجو در رشته ورودی{cohortStats ? (cohortStats.scope === 'term' ? ' (هم‌ورودی ترم)' : ' (هم‌ورودی سال)') : ''}: <b className="font-mono">{cohortLoading ? '…' : (cohortStats && cohortStats.rank != null ? `${faNum(cohortStats.rank, 0)} / ${faNum(cohortStats.total, 0)}` : '—')}</b></span>
                  <span>میانگین معدل دانشجویان هم‌رشته ورودی: <b className="font-mono">{cohortLoading ? '…' : faNum(cohortStats?.avgGpa)}</b></span>
                  <span>میانگین واحد گذرانده دانشجویان هم‌رشته ورودی: <b className="font-mono">{cohortLoading ? '…' : faNum(cohortStats?.avgPassed, 1)}</b></span>
                </div>
              </div>
            </td></tr>
          )}
          {/* Authenticity block: online verify QR (before signatures) */}
          {verifyQr && (
            <tr><td className="tr-doc-cell">
              <div className="px-3 pt-3">
                <VerifyQrBlock
                  title="استعلام برخط اصالت این کارنامه"
                  url={verifyQr.url}
                  qr={verifyQr.qr}
                  expiresAt={verifyQr.expiresAt}
                />
              </div>
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
