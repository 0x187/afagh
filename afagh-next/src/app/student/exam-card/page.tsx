import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { universities } from '@/db/schema';
import { getSetting } from '@/lib/settings';
import { getSessionUser, getStudentByUser } from '@/lib/auth';
import { getPublicBaseUrl } from '@/lib/settings';
import { getExamCardData, issueExamTicketToken } from '@/lib/verification';
import { getEvaluationWindow } from '@/lib/evaluation-window';
import { getTermScope } from '@/lib/term-scope';
import { isDemoStudentUser } from '@/lib/demo-accounts';
import { demoExamCardData, demoTermFilterNotice } from '@/lib/demo-student-data';
import { qrSvg } from '@/lib/qr';
import ExamCardClient from './ExamCardClient';
import { getExamCardDataForTerm } from './exam-card-term-data';

export const dynamic = 'force-dynamic';

export default async function StudentExamCardPage() {
  const user = await getSessionUser();
  if (!user) return null;

  const me = await getStudentByUser(user.id);
  const { terms, selectedId } = await getTermScope(me?.universityId ?? user.universityId);
  const selectedTerm = selectedId ? terms.find(t => t.id === selectedId) ?? null : null;

  const demo = await isDemoStudentUser(user.id);
  const universityId = me?.universityId ?? user.universityId ?? null;
  const [uniLogoRow] = universityId
    ? await db.select({ logoUrl: universities.logoUrl }).from(universities).where(eq(universities.id, universityId)).limit(1)
    : [];
  const universityLogoUrl = uniLogoRow?.logoUrl || (await getSetting('UNIVERSITY_LOGO').catch(() => '')) || null;

  if (demo) {
    return (
      <div className="space-y-3">
        {selectedTerm ? (
          <p className="print:hidden rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-2xs text-slate-600">
            {demoTermFilterNotice(selectedTerm.title)}
          </p>
        ) : (
          <ExamCardClient
            user={user}
            publicBaseUrl={await getPublicBaseUrl()}
            examTicket={null}
            examTicketBlocked={null}
            card={demoExamCardData(me?.id ?? user.id)}
            ticketQr=""
            demo
            universityLogoUrl={null}
          />
        )}
      </div>
    );
  }

  /**
   * توکن امضاشدهٔ کارت ورود به جلسه — از پایگاه داده ساخته می‌شود، نه از
   * شناسهٔ کاربر (توکن حدس‌زدنی یعنی هر کسی می‌تواند کارت دیگری را باز کند).
   * در صورت بدهی مالی یا نبود رکورد دانشجو، توکن صادر نمی‌شود و صفحه وضعیت
   * مسدود را نشان می‌دهد.
   */
  const card = selectedTerm
    ? await getExamCardDataForTerm(user.id, selectedTerm)
    : await getExamCardData(user.id);
  const publicBaseUrl = await getPublicBaseUrl();

  let examTicket: { token: string; expiresAt: string } | null = null;
  let examTicketBlocked: string | null = null;
  if (!card) {
    examTicketBlocked = 'رکورد دانشجویی شما در سامانه یافت نشد؛ به امور آموزش مراجعه کنید.';
  } else {
    try {
      examTicket = await issueExamTicketToken(user.id);
    } catch (err) {
      examTicketBlocked = (err as Error)?.message || 'صدور کارت ورود به جلسه ممکن نشد.';
    }
  }

  // QR واقعی و قابل اسکن برای احراز هویت در ورودی جلسه
  let ticketQr = '';
  if (examTicket) {
    try {
      ticketQr = await qrSvg(`${publicBaseUrl}/exam-ticket/${encodeURIComponent(examTicket.token)}`, {
        // سطح تصحیح خطای بالا + حاشیهٔ سکوت استاندارد: اسکنر دستی مراقب در ورودی سالن
        errorCorrectionLevel: 'Q',
        size: 160,
        margin: 4,
      });
    } catch (err) {
      console.error('[exam-card] qr failed', err);
      ticketQr = '';
    }
  }

  const noCourses = !!card && card.courses.length === 0;

  // وضعیت پنجرهٔ ارزشیابی (باز/بسته + بازهٔ تاریخ) — برای نمایش به دانشجو
  const evalWindow = await getEvaluationWindow(universityId, selectedTerm?.id ?? null);

  return (
    <div className="space-y-3">

      {noCourses && (
        <p className="print:hidden rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-2xs text-slate-600">
          {selectedTerm
            ? `برای نیمسال «${selectedTerm.title}» هیچ ثبت‌نامی برای شما ثبت نشده است؛ بنابراین برنامهٔ امتحان یا صندلیی نیز وجود ندارد.`
            : 'برای نیمسال جاری هیچ ثبت‌نامی برای شما ثبت نشده است؛ بنابراین برنامهٔ امتحان یا صندلیی نیز وجود ندارد.'}
        </p>
      )}

      <ExamCardClient
        user={user}
        publicBaseUrl={publicBaseUrl}
        examTicket={examTicket}
        examTicketBlocked={examTicketBlocked}
        card={card}
        ticketQr={ticketQr}
        universityLogoUrl={universityLogoUrl}
        evaluationWindow={{
          open: evalWindow.open,
          message: evalWindow.message,
          title: evalWindow.title,
        }}
      />
    </div>
  );
}