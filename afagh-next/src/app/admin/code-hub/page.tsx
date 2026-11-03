import Link from 'next/link';
import { requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const HUB: { href: string; icon: string; title: string; desc: string; accent: string }[] = [
  {
    href: '/admin/codes',
    icon: '🔑',
    title: 'مرکز کدها',
    desc: 'تعریف و بازبینی کد دانشکده، گروه، رشته، مقطع و درس',
    accent: 'from-amber-950 to-slate-950 border-amber-700/50',
  },
  {
    href: '/admin/grade-status-codes',
    icon: '🏷️',
    title: 'مدیریت دروس و کدهای وضعیت نمره',
    desc: 'تعریف، ویرایش و کدگذاری وضعیت نمره دروس بانک و چارت',
    accent: 'from-orange-950 to-slate-950 border-orange-700/50',
  },
  {
    href: '/admin/regulation-check',
    icon: '🔍',
    title: 'بررسی کدهای وضعیت نمره',
    desc: 'تشخیص و اصلاح خودکار کدهای وضعیت نمره سما بر اساس آیین‌نامه',
    accent: 'from-rose-950 to-slate-950 border-rose-700/50',
  },
];

/** هاب یکپارچهٔ «کدها و وضعیت نمره» — جایگزینی برای سه کاشیِ پراکنده در داشبورد آموزش */
export default async function CodeHubPage() {
  await requireRole(['ADMIN', 'EDU_EXPERT', 'VICE_EDU']);
  return (
    <div className="space-y-4" dir="rtl">
      <div className="card">
        <h1 className="font-black text-lg">🧩 کدها و وضعیت نمره</h1>
        <p className="text-xs text-slate-500 mt-1">
          سه ابزار کُدگذاری در یک جا جمع شدند تا شبکهٔ داشبورد خلوت بماند؛ هر کدام مستقیم از منوی
          مدیریت هم در دسترس‌اند.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {HUB.map(m => (
          <Link
            key={m.href}
            href={m.href}
            className={`group flex flex-col gap-3 rounded-2xl border bg-gradient-to-br ${m.accent} p-5 text-white shadow transition-transform hover:-translate-y-0.5`}
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl">{m.icon}</span>
              <h3 className="font-black text-sm leading-5">{m.title}</h3>
            </div>
            <p className="text-2xs text-white/70 leading-4">{m.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}