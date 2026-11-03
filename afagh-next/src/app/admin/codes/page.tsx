import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { codeFormOptions, codeStats, createCodeRowAction, deleteCodeRowAction, getCodeRowAction, getDegreeRowAction, getTermRowAction, listCodes, setCodeAction, updateCodeRowAction, updateDegreeRowAction, updateTermRowAction } from './actions';
import type { CodeTable } from './tables';
import CodesClient from './CodesClient';

export const dynamic = 'force-dynamic';

/**
 * مرکز کدها — تعریف و بازبینی کد همهٔ جدول‌های مرجع در یک صفحه.
 * تا پیش از این کدها پراکنده بودند و کد دانشکده اصلاً رابط ویرایش نداشت.
 */
export default async function CodesPage() {
  await requireRole(['ADMIN', 'VICE_EDU', 'EDU_EXPERT']);
  const initialTable: CodeTable = 'faculty';

  const [stats, initialRows, options] = await Promise.all([codeStats(), listCodes(initialTable), codeFormOptions()]);

  const totalMissing = stats.reduce((s, x) => s + x.missing, 0);
  const totalDup = stats.reduce((s, x) => s + x.duplicate, 0);

  async function listAction(table: CodeTable, q: string) {
    'use server';
    return listCodes(table, q);
  }

  async function getDegreeAction(id: number) {
    'use server';
    const r = await getDegreeRowAction(id);
    if (!r) return null;
    return {
      title: r.title,
      code: r.code,
      standardCode: r.standardCode ?? '',
      ministryCode: r.ministryCode ?? '',
      defaultPassingGrade: String(r.defaultPassingGrade ?? ''),
      conditionalGpaThreshold: String(r.conditionalGpaThreshold ?? ''),
      maxUnitsPerTerm: r.maxUnitsPerTerm != null ? String(r.maxUnitsPerTerm) : '',
      termCount: r.termCount != null ? String(r.termCount) : '',
      isGraduate: r.isGraduate != null ? String(r.isGraduate) : '0',
    };
  }

  async function updateDegreeAction(fd: FormData) {
    'use server';
    return updateDegreeRowAction(fd);
  }

  async function getTermAction(id: number) {
    'use server';
    return getTermRowAction(id);
  }

  async function updateTermAction(fd: FormData) {
    'use server';
    return updateTermRowAction(fd);
  }

  async function getCodeRow(table: CodeTable, id: number) {
    'use server';
    return getCodeRowAction(table, id);
  }

  async function updateCodeAction(fd: FormData) {
    'use server';
    return updateCodeRowAction(fd);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h1 className="text-lg font-extrabold text-slate-800">🔑 مرکز کدها</h1>
        <p className="mt-1 text-xs leading-6 text-slate-500">
          کد، سند اصالت هر رکورد است: کد رشته می‌گوید کدام رشته، در چه مقطعی، ذیل کدام گروه و کدام دانشکده. انتقال
          داده هم <b>اول با کد</b> تطبیق می‌دهد و تنها اگر کد نبود سراغ نام می‌رود. اینجا می‌توانید کد همهٔ جدول‌های
          مرجع را ببینید، اصلاح کنید و رکوردهای بی‌کد یا دارای کد تکراری را پیدا کنید.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {totalMissing > 0 && (
            <span className="rounded-lg bg-amber-100 px-2.5 py-1 font-bold text-amber-800">
              {totalMissing.toLocaleString('fa-IR')} رکورد بدون کد
            </span>
          )}
          {totalDup > 0 && (
            <span className="rounded-lg bg-red-100 px-2.5 py-1 font-bold text-red-700">
              {totalDup.toLocaleString('fa-IR')} کد تکراری
            </span>
          )}
          {totalMissing === 0 && totalDup === 0 && (
            <span className="rounded-lg bg-emerald-100 px-2.5 py-1 font-bold text-emerald-700">✓ همهٔ کدها سالم‌اند</span>
          )}
        </div>
        <p className="mt-2 text-2xs leading-6 text-slate-400">
          پیش از هر انتقال داده، این صفحه را بررسی کنید. رکوردهای بی‌کد فقط با نام تطبیق می‌خورند و اگر نام تکراری
          باشد، سامانه به‌جای حدس‌زدن خطا می‌دهد و آن ردیف وصل نمی‌شود.
        </p>
      </div>

      <CodesClient
        stats={stats}
        initialTable={initialTable}
        initialRows={initialRows}
        listAction={listAction}
        setCodeAction={setCodeAction}
        createAction={createCodeRowAction}
        deleteAction={deleteCodeRowAction}
        options={options}
        getDegreeAction={getDegreeAction}
        updateDegreeAction={updateDegreeAction}
        getTermAction={getTermAction}
        updateTermAction={updateTermAction}
        getCodeRowAction={getCodeRow}
        updateCodeRowAction={updateCodeAction}
      />

      <p className="text-center text-xs text-slate-400">
        نگاشت کد قدیمی به کد جدید در{' '}
        <Link href="/admin/migration" className="text-indigo-600 hover:underline">انتقال داده ← تطبیق کدها</Link>{' '}
        انجام می‌شود · ساخت گروه آموزشی در{' '}
        <Link href="/admin/departments" className="text-indigo-600 hover:underline">گروه‌های آموزشی</Link>{' '}
        · مقطع، دانشکده و رشته را از دکمهٔ «افزودن» همین صفحه بسازید
      </p>
    </div>
  );
}
