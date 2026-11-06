import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db, withUserRls } from '@/db';
import {
  degree_level_configs,
  graduation_audits,
  irandoc_logs,
  process_definitions,
  staff,
  student_requests,
  thesis_progress,
  users,
} from '@/db/schema';
import { getStudentByUser, requireRole } from '@/lib/auth';
import { auditStudent, getThesisProgress } from '@/lib/graduation-engine';
import { maghtaGroup } from '@/lib/regulations-types';
import { getSetting } from '@/lib/settings';
import ThesisProposalClient from './ThesisProposalClient';

export const dynamic = 'force-dynamic';

const THESIS_REQUEST_CODES = ['PROPOSAL_TRACKING', 'THESIS_DEFENSE'];

async function isThesisDegree(code: string | null | undefined): Promise<boolean> {
  const raw = String(code ?? '').trim().toUpperCase();
  if (!raw) return false;
  const bare = raw.replace(/^HAMAVA-/i, '');
  const group = maghtaGroup(bare);
  if (group === 'MS' || group === 'PHD') return true;
  const configured = await getSetting('GRAD_THESIS_DEGREE_CODES')
    .then(v => v.split(',').map(c => c.trim().toUpperCase()).filter(Boolean))
    .catch(() => [] as string[]);
  return configured.includes(raw) || configured.includes(bare) || configured.some(c => maghtaGroup(c) === group);
}

export default async function StudentThesisProposalPage() {
  const user = await requireRole(['STUDENT']);
  const me = await getStudentByUser(user.id);
  if (!me) return <div className="card p-6 text-center text-slate-600 font-bold">پروندهٔ دانشجویی یافت نشد.</div>;

  const [level] = await db
    .select({ code: degree_level_configs.code, title: degree_level_configs.title })
    .from(degree_level_configs)
    .where(eq(degree_level_configs.id, me.degreeLevelId))
    .limit(1);

  const [audit] = await withUserRls(user.id, tx =>
    tx
      .select({ id: graduation_audits.id, workflowStatus: graduation_audits.workflowStatus })
      .from(graduation_audits)
      .where(eq(graduation_audits.studentId, me.id))
      .limit(1));

  const [progressRow] = await db
    .select({ id: thesis_progress.id, auditId: thesis_progress.auditId })
    .from(thesis_progress)
    .where(eq(thesis_progress.studentId, me.id))
    .limit(1);
  const [proposalRequest] = await withUserRls(user.id, tx =>
    tx
      .select({ id: student_requests.id })
      .from(student_requests)
      .innerJoin(process_definitions, eq(process_definitions.id, student_requests.processId))
      .where(
        and(
          eq(student_requests.studentId, me.id),
          or(...THESIS_REQUEST_CODES.map(code => eq(process_definitions.code, code))),
        ),
      )
      .limit(1));

  const auditId = audit?.id ?? progressRow?.auditId ?? null;
  const thesisDegree = await isThesisDegree(level?.code);

  if (!auditId) {
    const inThesisTrack = thesisDegree || !!progressRow || !!proposalRequest;

    if (!inThesisTrack) {
      return (
        <div className="space-y-3" dir="rtl">
          <div className="card p-4 bg-gradient-to-l from-emerald-700 to-teal-800 text-white">
            <h1 className="text-base sm:text-lg font-black">پایان‌نامه و پروپوزال من</h1>
            <p className="text-2xs text-emerald-100 mt-1 leading-6">
              این بخش برای دانشجویانی است که در مقطع تحصیلی خود پایان‌نامه دارند.
            </p>
          </div>
          <div className="card p-5 text-xs text-slate-600 leading-6">
            در مقطع تحصیلی شما (<b>{level?.title || '—'}</b>) پایان‌نامه و پروپوزال وجود ندارد؛
            بنابراین چرخهٔ عنوان، پروپوزال و دفاع برای شما فعال نیست.
            پیگیری وضعیت تحصیلی و تسویه‌حساب از بخش <span className="font-bold">«فارغ‌التحصیلی من»</span> انجام می‌شود.
          </div>
        </div>
      );
    }

    const result = await auditStudent(me.id).catch(() => null);
    const passedUnits = Number(result?.passedUnits ?? 0);
    const requiredUnits = Number(result?.requiredUnits ?? 0);
    const remainingUnits = Math.max(0, requiredUnits - passedUnits);
    const ratio = requiredUnits > 0 ? Math.min(100, Math.round((passedUnits / requiredUnits) * 100)) : 0;
    const repairNeeded = !!result?.catalogOk;

    return (
      <div className="space-y-3" dir="rtl">
        <div className="card p-4 bg-gradient-to-l from-emerald-700 to-teal-800 text-white">
          <h1 className="text-base sm:text-lg font-black">پایان‌نامه و پروپوزال من</h1>
          <p className="text-2xs text-emerald-100 mt-1 leading-6">
            شما در مقطع <b>{level?.title || 'تحصیلات تکمیلی'}</b> تحصیل می‌کنید و پایان‌نامه برای شما الزامی است.
          </p>
        </div>

        {repairNeeded ? (
          <div className="card p-5 text-xs text-amber-900 bg-amber-50 border-amber-300 leading-6">
            <b className="block mb-1">هشدار: پروندهٔ فارغ‌التحصیلی شما هنوز باز نشده است</b>
            طبق کارنامهٔ شما، واحدهای سرفصل کامل شده و پرونده باید باز باشد؛ لطفاً به
            کارشناس آموزشی دانشکده مراجعه کنید تا پروندهٔ فارغ‌التحصیلی و چرخهٔ
            پایان‌نامه شما فعال شود.
          </div>
        ) : (
          <div className="card p-5 text-xs text-slate-700 leading-6 space-y-3">
            <p>
              چرخهٔ پایان‌نامه سه فاز دارد: فاز ۱ ثبت عنوان و استاد راهنما، فاز ۲ بارگذاری
              پروپوزال و تأیید همانندجویی، و فاز ۳ درخواست دفاع، برگزاری دفاع و تحویل
              پایان‌نامهٔ نهایی. این چرخه از زمانی فعال می‌شود که پروندهٔ فارغ‌التحصیلی
              شما باز شود.
            </p>
            <div>
              <div className="flex items-center justify-between">
                <span className="font-bold">پیشرفت سرفصل</span>
                <span className="font-mono">{passedUnits} از {requiredUnits} واحد</span>
              </div>
              <div className="h-2 mt-1.5 rounded-full bg-slate-200 overflow-hidden">
                <div className="h-full bg-emerald-600" style={{ width: `${ratio}%` }} />
              </div>
              <p className="text-2xs text-slate-500 mt-1.5">
                {remainingUnits > 0
                  ? `${remainingUnits} واحد تا تکمیل سرفصل باقی مانده است؛ تا آن زمان عنوان و پروپوزال ثبت نمی‌شود.`
                  : 'واحدهای سرفصل تکمیل شده و پروندهٔ شما در صف بررسی کارشناس آموزشی است.'}
              </p>
            </div>
            <p>
              پیگیری لحظه‌ای وضعیت فارغ‌التحصیلی از بخش{' '}
              <span className="font-bold">«فارغ‌التحصیلی من»</span>.
            </p>
          </div>
        )}
      </div>
    );
  }

  const progress = await getThesisProgress(auditId);

  const logs = await withUserRls(user.id, tx =>
    tx
      .select({
        id: irandoc_logs.id,
        checkType: irandoc_logs.checkType,
        trackingCode: irandoc_logs.trackingCode,
        similarityPercentage: irandoc_logs.similarityPercentage,
        decision: irandoc_logs.decision,
        checkedAt: irandoc_logs.checkedAt,
      })
      .from(irandoc_logs)
      .where(eq(irandoc_logs.studentId, me.id))
      .orderBy(desc(irandoc_logs.id))
      .limit(20));

  const staffList = await db
    .select({
      id: staff.id,
      firstName: users.firstName,
      lastName: users.lastName,
      academicRank: staff.academicRank,
      staffType: staff.staffType,
    })
    .from(staff)
    .innerJoin(users, eq(users.id, staff.userId))
    .where(or(eq(staff.isActive, 1), isNull(staff.isActive)))
    .orderBy(users.lastName)
    .limit(500);

  return (
    <ThesisProposalClient
      student={{ name: user.name, studentCode: me.studentCode }}
      userId={user.id}
      workflowStatus={audit?.workflowStatus ?? 'HEAD_APPROVAL'}
      progress={progress}
      logs={logs.map(l => ({
        id: l.id,
        checkType: l.checkType ?? '—',
        trackingCode: l.trackingCode,
        similarityPercentage: l.similarityPercentage == null ? null : Number(l.similarityPercentage),
        decision: l.decision,
        checkedAt: l.checkedAt ? l.checkedAt.toISOString() : null,
      }))}
      staffList={staffList.map(s => ({
        id: s.id,
        name: `${s.firstName} ${s.lastName}`,
        rank: s.academicRank ?? s.staffType ?? '',
      }))}
    />
  );
}
