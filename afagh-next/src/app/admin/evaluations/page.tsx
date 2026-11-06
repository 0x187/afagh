import { desc, eq, isNull, or } from 'drizzle-orm';
import { db } from '@/db';
import { academic_terms } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { sortTermsChronologically } from '@/lib/term-scope';
import { getCurrentUniversity } from '@/lib/university-scope';
import {
  createEvaluationPeriodAction,
  listEvaluationPeriods,
  toggleEvaluationPeriodAction,
} from './actions';
import DeletePeriodButton from './DeletePeriodButton';

export const dynamic = 'force-dynamic';

/** Date → مقدار ورودی `datetime-local` به وقت تهران (UTC+3:30 ثابت) */
const toLocalInput = (d: Date): string =>
  new Date(d.getTime() + 3.5 * 3600 * 1000).toISOString().slice(0, 16);

const fmt = (d: Date | null): string => {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Tehran',
    }).format(d);
  } catch {
    return d.toISOString();
  }
};

export default async function AdminEvaluationsPage({
  searchParams,
}: {
  // ⚠ Next.js 15/16: `searchParams` یک Promise است. خواندنِ آن به‌صورت آبجکت
  // خام باعث می‌شد پیام‌های msg/err (که با redirect برگردانده می‌شوند) هرگز
  // نمایش داده نشوند. گارد: tests/searchparams-await.test.ts
  searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  await requireRole(['ADMIN']);
  const sp = (await searchParams) ?? {};
  const uni = await getCurrentUniversity();

  const terms = sortTermsChronologically(
    await db
      .select({ id: academic_terms.id, termCode: academic_terms.termCode, title: academic_terms.title })
      .from(academic_terms)
      .where(or(eq(academic_terms.universityId, uni.id), isNull(academic_terms.universityId)))
      .orderBy(desc(academic_terms.id)),
  );

  const { rows: periods } = await listEvaluationPeriods();
  const now = new Date();
  const defaultStart = toLocalInput(now);
  const defaultEnd = toLocalInput(new Date(now.getTime() + 7 * 24 * 3600 * 1000));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h1 className="text-lg font-black text-slate-900">پنجرهٔ ارزشیابی اساتید و کلاس‌ها</h1>
        <p className="mt-1 text-xs leading-6 text-slate-600">
          ارزشیابی دانشجو فقط داخل دوره‌های فعالِ این صفحه پذیرفته می‌شود (ثبت ارزشیابی در کارت امتحان).
          بازه را طوری تعیین کنید که <b>پیش از شروع امتحانات</b> باشد و پس از پایان نمرات بسته شود.
          بدون دورهٔ فعال، ارزشیابی برای همه بسته است.
        </p>
      </div>

      {sp.msg && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">✓ {sp.msg}</p>}
      {sp.err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">⛔ {sp.err}</p>}

      {/* ساخت دورهٔ جدید */}
      <form action={createEvaluationPeriodAction} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <label className="space-y-1 text-xs font-bold text-slate-700">
          <span className="block">عنوان دوره</span>
          <input name="title" required placeholder="مثلاً ارزشیابی نیمسال ۱۴۰۵۱" className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
        </label>
        <label className="space-y-1 text-xs font-bold text-slate-700">
          <span className="block">ترم</span>
          <select name="termId" required defaultValue={terms[0]?.id ?? ''} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
            {terms.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-bold text-slate-700">
          <span className="block">شروع (به وقت تهران)</span>
          <input name="start" type="datetime-local" required defaultValue={defaultStart} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
        </label>
        <label className="space-y-1 text-xs font-bold text-slate-700">
          <span className="block">پایان (به وقت تهران)</span>
          <input name="end" type="datetime-local" required defaultValue={defaultEnd} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
        </label>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <input type="checkbox" name="isActive" defaultChecked className="rounded border-slate-300" />
            فعال
          </label>
          <button className="rounded-lg bg-indigo-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-900">
            ساخت دوره
          </button>
        </div>
      </form>

      {/* فهرست دوره‌ها */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-bold text-slate-800">دوره‌های تعیین‌شده ({periods.length})</h2>
        {periods.length === 0 ? (
          <p className="text-xs text-slate-500">هنوزه دوره‌ای ساخته نشده — ارزشیابی بسته است.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-right text-slate-500">
                  <th className="p-2">عنوان</th>
                  <th className="p-2">ترم</th>
                  <th className="p-2">شروع</th>
                  <th className="p-2">پایان</th>
                  <th className="p-2">وضعیت</th>
                  <th className="p-2">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {periods.map(p => {
                  const inside = p.startDate != null && p.endDate != null && now >= p.startDate && now <= p.endDate;
                  return (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="p-2 font-bold text-slate-800">{p.title}</td>
                      <td className="p-2 text-slate-600">{p.termTitle ?? '—'}</td>
                      <td className="p-2 text-slate-600">{fmt(p.startDate)}</td>
                      <td className="p-2 text-slate-600">{fmt(p.endDate)}</td>
                      <td className="p-2">
                        {p.isActive !== 1 ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-600">غیرفعال</span>
                        ) : inside ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">باز</span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700">فعال، خارج از بازه</span>
                        )}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          <form action={toggleEvaluationPeriodAction} className="inline">
                            <input type="hidden" name="id" value={p.id} />
                            <button className="rounded-lg bg-slate-100 px-2 py-1 font-bold text-slate-700 hover:bg-slate-200">
                              {p.isActive === 1 ? 'غیرفعال کن' : 'فعال کن'}
                            </button>
                          </form>
                          <DeletePeriodButton id={p.id} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
