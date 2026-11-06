import { getSessionUser, getStudentByUser } from '@/lib/auth';
import { getTermScope } from '@/lib/term-scope';
import { getPublicBaseUrl } from '@/lib/settings';
import { issueEnrollConfirmToken, verifyEnrollConfirm } from '@/lib/verification';
import { qrSvg } from '@/lib/qr';
import EnrollConfirmClient from './EnrollConfirmClient';

export const dynamic = 'force-dynamic';

/**
 * تأییدیهٔ انتخاب واحد دانشجو — گزارش چاپی با QR استعلام برخط.
 * پس از نهایی شدن انتخاب واحد، دانشجو از اینجا برگه را چاپ می‌کند؛
 * نگهبان/کارشناس با اسکن QR به صفحهٔ عمومی /verify-enrollment می‌رسد.
 */
export default async function StudentEnrollConfirmPage() {
  const user = await getSessionUser();
  if (!user) return null;

  const me = await getStudentByUser(user.id);
  const { terms, selectedId } = await getTermScope(me?.universityId ?? user.universityId);
  const selectedTerm = selectedId ? terms.find(t => t.id === selectedId) ?? null : null;
  const publicBaseUrl = await getPublicBaseUrl();

  if (!selectedTerm) {
    return (
      <div className="space-y-3">
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-2xs text-slate-600">
          نیمسالی انتخاب نشده است؛ از فیلتر نیمسال یک نیمسال را انتخاب کنید.
        </p>
      </div>
    );
  }

  // صدور توکن امضاشده برای همین نیمسال + خواندن زندهٔ دروس (تک‌منبع: verifyEnrollConfirm)
  let token: string | null = null;
  let expiresAt: string | null = null;
  let blocked: string | null = null;
  try {
    const issued = await issueEnrollConfirmToken(user.id, selectedTerm.id, me ? { id: me.id, code: me.studentCode, universityId: me.universityId } : null);
    token = issued.token;
    expiresAt = issued.expiresAt;
  } catch (err) {
    blocked = (err as Error)?.message || 'صدور تأییدیه ممکن نشد.';
  }

  const data = token ? await verifyEnrollConfirm(token) : null;

  let qr = '';
  if (token) {
    try {
      qr = await qrSvg(`${publicBaseUrl}/verify-enrollment/${encodeURIComponent(token)}`, {
        errorCorrectionLevel: 'M',
      });
    } catch (err) {
      console.error('[enroll-confirm] qr failed', err);
      qr = '';
    }
  }

  return (
    <div className="space-y-3">
      <EnrollConfirmClient
        termTitle={selectedTerm.title}
        blocked={blocked}
        verifyUrl={token ? `${publicBaseUrl}/verify-enrollment/${encodeURIComponent(token)}` : null}
        expiresAt={expiresAt}
        qrSvg={qr}
        data={data && data.ok ? data : null}
        emptyMessage={!data || data.ok === false ? (data && !data.ok ? data.message : blocked) : null}
      />
    </div>
  );
}
