import { getStudentByUser, requireRole } from '@/lib/auth';
import { getTermScope } from '@/lib/term-scope';
import { isDemoStudentUser } from '@/lib/demo-accounts';
import { DEMO_LIVE_SESSIONS, DEMO_RECORDINGS, demoTermFilterNotice } from '@/lib/demo-student-data';
import VirtualClassroomWidget from '@/components/VirtualClassroomWidget';
import { listTermVirtualClasses } from './live-classes-data';

export const dynamic = 'force-dynamic';

export default async function StudentVirtualClassesPage() {
  const user = await requireRole(['STUDENT']);
  const me = await getStudentByUser(user.id);
  const scope = await getTermScope(me?.universityId ?? user.universityId);
  const selectedTerm = scope.selectedId
    ? scope.terms.find(t => t.id === scope.selectedId) ?? null
    : null;

  const demo = await isDemoStudentUser(user.id);
  const demoTermBlocked = demo && !!selectedTerm;

  const [liveSessions] = await Promise.all([
    demo
      ? Promise.resolve(DEMO_LIVE_SESSIONS)
      : me
        ? listTermVirtualClasses(me.id, selectedTerm?.id ?? null)
        : Promise.resolve([]),
  ]);

  const shownSessions = demoTermBlocked ? [] : liveSessions;

  return (
    <div className="space-y-6" dir="rtl">
      <div className="bg-emerald-900 text-white rounded-3xl p-6 shadow-xl border border-emerald-700/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-400 text-slate-950">
            کلاس آنلاین
          </span>
          <h1 className="text-xl sm:text-2xl font-black mt-2">
            کلاس‌های آنلاین من
          </h1>
          <p className="text-xs text-emerald-200 mt-1">
            دانشجو: {user.name}
            {me ? <> · شماره دانشجویی: <span dir="ltr">{me.studentCode || '—'}</span></> : ' · پروندهٔ دانشجویی یافت نشد'}
          </p>
        </div>
        {/* کارت «وضعیت پیکربندی LMS/BBB» حذف شد — پیکربندی سرور کار مدیر
            است و دانشجو نه آن را تغییر می‌دهد و نه باید پیش از دیدن کلاس‌ها
            پیام پیکربندی را ببیند. */}
      </div>

      {!me && (
        <div className="card p-6 text-center text-sm text-slate-600">پروندهٔ دانشجویی شما یافت نشد؛ کلاس مجازی قابل نمایش نیست.</div>
      )}

      {demoTermBlocked && (
        <p className="print:hidden rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-2xs text-slate-600">
          {demoTermFilterNotice(selectedTerm!.title)}
        </p>
      )}

      <VirtualClassroomWidget
        user={{ id: user.id, name: user.name || 'دانشجو', role: 'STUDENT' }}
        initialSessions={shownSessions}
        recordings={demo ? DEMO_RECORDINGS : undefined}
      />
    </div>
  );
}