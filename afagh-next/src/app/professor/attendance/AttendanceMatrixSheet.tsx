import type { AttendanceCourseOffering } from './ProfessorAttendanceClient';

const faNum = (n: unknown) => (n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]));

const SYMBOL: Record<string, string> = { PRESENT: '✓', ABSENT: '✗', EXCUSED: 'م', LATE: 'ت' };

/**
 * برگهٔ چاپی «حضور و غیاب کل جلسات درس» — همهٔ جلسات در یک برگه (افقی).
 *
 * ماتریس دانشجو × جلسه است: هر ستون یک جلسه (شماره + تاریخ) و هر خانه وضعیت
 * همان دانشجو در آن جلسه. ستون‌های پایانی: حاضر / غایب / درصد حضور.
 *
 * چرا داخل DOM و visible است؟ منطق چاپ مشترک (`doPrintTranscript`) یک کپی از
 * `.transcript-print-area` را در ریشهٔ body می‌گذارد؛ پس این بلوک باید در DOM
 * حاضر باشد (نه داخل <details> بسته یا hidden، چون آن حالت به کپی هم می‌رسد).
 * نتیجه: استاد همین ماتریس را روی صفحه هم می‌بیند و با یک کلیک چاپ می‌کند.
 */
export default function AttendanceMatrixSheet({
  professor,
  termTitle,
  offering,
  todayJalali,
}: {
  professor: { name: string; staffCode: string; academicRank?: string };
  termTitle: string;
  offering: AttendanceCourseOffering;
  todayJalali: string;
}) {
  const sessions = offering.sessions;
  const students = offering.students;
  if (!students.length || !sessions.length) return null;

  return (
    <div className="transcript-print-area tr-root bg-white border-2 border-slate-800 shadow-sm text-xs text-slate-800">
      <table className="tr-doc rt">
        <thead>
          <tr>
            <td className="tr-doc-cell">
              {/* سربرگ سند */}
              <div className="border-b-2 border-slate-800 px-3 pb-2 pt-3 text-center">
                <p className="text-3xs font-bold text-slate-600">باسمه تعالی</p>
                <h2 className="text-sm font-black text-slate-900">برگهٔ حضور و غیاب کل جلسات درس</h2>
                <div className="mt-1 grid grid-cols-3 gap-1 text-3xs font-bold text-slate-600">
                  <span className="text-right">درس: {offering.code} — {offering.title}</span>
                  <span className="text-center">استاد: {professor.name}{professor.staffCode ? ` (${professor.staffCode})` : ''}</span>
                  <span className="text-left">نیمسال: {termTitle || '—'} · گروه {faNum(offering.groupNumber)}</span>
                </div>
                <p className="mt-0.5 text-3xs text-slate-500">
                  محل و زمان: {offering.roomName || '—'} · {offering.scheduleTime || '—'} · تعداد جلسات: {faNum(sessions.length)} · تعداد دانشجو: {faNum(students.length)}
                </p>
              </div>
            </td>
          </tr>
        </thead>
        <tbody>
          <tr className="tr-doc-row">
            <td className="tr-doc-cell">
              {/* ماتریس دانشجو × جلسه */}
              <table className="tr-term-table w-full border-collapse text-center rt">
                <thead>
                  <tr className="bg-slate-100 text-3xs text-slate-700">
                    <th className="border border-slate-300 px-1 py-1">ردیف</th>
                    <th className="border border-slate-300 px-1 py-1">شمارهٔ دانشجویی</th>
                    <th className="border border-slate-300 px-1 py-1 text-right">نام و نام خانوادگی</th>
                    {sessions.map(s => (
                      <th key={s.id} className="border border-slate-300 px-0.5 py-1">
                        {faNum(s.sessionNo)}
                        <span className="block font-normal text-[8px] text-slate-500">{s.sessionDate}</span>
                      </th>
                    ))}
                    <th className="border border-slate-300 px-1 py-1">حاضر</th>
                    <th className="border border-slate-300 px-1 py-1">غایب</th>
                    <th className="border border-slate-300 px-1 py-1">درصد</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((st, i) => {
                    const cells = sessions.map(s => s.studentStatuses[st.id]?.status ?? null);
                    const present = cells.filter(c => c === 'PRESENT' || c === 'LATE').length;
                    const absent = cells.filter(c => c === 'ABSENT').length;
                    const marked = cells.filter(Boolean).length;
                    const pct = marked > 0 ? Math.round((100 * present) / marked) : null;
                    return (
                      <tr key={st.id} className="border-t border-slate-200">
                        <td className="border border-slate-200 px-1 py-0.5 text-slate-500">{faNum(i + 1)}</td>
                        <td className="border border-slate-200 px-1 py-0.5 font-mono" dir="ltr">{st.studentCode}</td>
                        <td className="tr-course-title border border-slate-200 px-1 py-0.5 text-right font-bold">{st.fullName}</td>
                        {cells.map((c, j) => (
                          <td key={j} className={`border border-slate-200 px-0.5 py-0.5 font-black ${
                            c === 'ABSENT' ? 'bg-rose-50 text-rose-700'
                              : c === 'PRESENT' ? 'text-emerald-700'
                                : c ? 'text-amber-700' : 'text-slate-300'}`}>
                            {c ? SYMBOL[c] ?? '•' : '·'}
                          </td>
                        ))}
                        <td className="border border-slate-200 px-1 py-0.5 font-black text-emerald-700">{faNum(present)}</td>
                        <td className="border border-slate-200 px-1 py-0.5 font-black text-rose-700">{faNum(absent)}</td>
                        <td className="border border-slate-200 px-1 py-0.5 font-black">{pct === null ? '—' : `${faNum(pct)}٪`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2 text-3xs text-slate-600">
                <span>راهنما: <b>✓</b> حاضر · <b>✗</b> غایب · <b>م</b> غیبت موجه · <b>ت</b> تأخیر · <b>·</b> ثبت‌نشده</span>
                <span>تاریخ چاپ: {faNum(todayJalali)}</span>
              </div>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td className="tr-doc-cell tr-signatures">
              <div className="grid grid-cols-3 gap-2 px-3 pb-3 pt-3 text-center text-3xs text-slate-600">
                <div>
                  <p className="mb-6 font-medium">امضای استاد</p>
                  <div className="border-t border-slate-400 pt-1">نام و امضا</div>
                </div>
                <div>
                  <p className="mb-6 font-medium">مهر گروه آموزشی</p>
                  <div className="border-t border-slate-400 pt-1">مهر</div>
                </div>
                <div>
                  <p className="mb-6 font-medium">تأیید ادارهٔ آموزش</p>
                  <div className="border-t border-slate-400 pt-1">نام و امضا</div>
                </div>
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
