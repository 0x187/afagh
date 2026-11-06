import { requireRole } from '@/lib/auth';
import { listMyVirtualOfferings } from './actions';
import ProfVirtualClassesClient from './ProfVirtualClassesClient';

export const dynamic = 'force-dynamic';

export default async function ProfVirtualClassesPage() {
  await requireRole(['PROFESSOR']);
  const res = await listMyVirtualOfferings();
  return (
    <div className="max-w-5xl mx-auto space-y-4" dir="rtl">
      <div className="card">
        <h1 className="font-black text-base sm:text-lg">📡 کلاس‌های آنلاین من (BigBlueButton)</h1>
        <p className="mt-1 text-xs leading-6 text-slate-500">
          فقط کلاس‌های <b>نیم‌سال انتخاب‌شده در سوئیچر بالا</b> نمایش داده می‌شوند. برای هر ارائه، یک کلاس آنلاین
          تعریف کنید تا دانشجویان آن را در داشبورد خود ببینند و با یک کلیک وارد شوند. «شروع جلسه» اتاق فرمان
          (Moderator) را برای شما باز می‌کند.
        </p>
      </div>
      {res.ok ? (
        <ProfVirtualClassesClient rows={res.rows} />
      ) : (
        <div className="card p-4 text-rose-700 font-bold text-sm">{res.error}</div>
      )}
    </div>
  );
}