import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { document_categories, document_types, student_documents } from '@/db/schema';
import { getStudentByUser, requireRole } from '@/lib/auth';
import { getTermScope } from '@/lib/term-scope';

export const dynamic = 'force-dynamic';

const stFa: Record<string, string> = { PENDING: 'در انتظار بررسی', VERIFIED: 'تاییدشده', REJECTED: 'ردشده' };
const stColor: Record<string, string> = { PENDING: 'bg-slate-100 text-slate-700', VERIFIED: 'bg-emerald-100 text-emerald-800', REJECTED: 'bg-red-100 text-red-700' };

export default async function MyDocuments() {
  const user = await requireRole(['STUDENT']);
  const me = await getStudentByUser(user.id);
  const [rows, scope] = await Promise.all([
    db
      .select({
        id: student_documents.id, fileName: student_documents.fileName,
        status: student_documents.verificationStatus, reason: student_documents.rejectionReason,
        uploadedAt: student_documents.uploadedAt,
        category: document_categories.title, type: document_types.title,
      })
      .from(student_documents)
      .leftJoin(document_categories, eq(document_categories.id, student_documents.categoryId))
      .leftJoin(document_types, eq(document_types.id, student_documents.typeId))
      .where(eq(student_documents.personUserId, user.id))   // فقط مدارک خودم
      .orderBy(desc(student_documents.id)),
    getTermScope(me?.universityId ?? user.universityId),
  ]);
  const selectedTerm = scope.selectedId
    ? scope.terms.find(t => t.id === scope.selectedId) ?? null
    : null;

  return (
    <div className="space-y-3">
      <div className="card">
        <h2 className="font-bold">مدارک من</h2>
        <p className="mt-1 text-xs text-slate-500">مشاهدهٔ فایل از طریق لینک امضاشدهٔ موقت؛ خود فایل در Object Storage نگهداری می‌شود.</p>
      </div>
      <div className="card space-y-2">
        {rows.length === 0 && <p className="text-sm text-slate-500">مدرکی بارگذاری نکرده‌اید.</p>}
        {rows.map(d => (
          <div key={d.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm">
            <div>
              <p className="font-medium">{d.type ?? d.category ?? 'مدرک'}</p>
              <p className="text-xs text-slate-500">{d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString('fa-IR') : ''}</p>
              {d.status === 'REJECTED' && d.reason && <p className="text-2xs text-red-600">دلیل رد: {d.reason}</p>}
            </div>
            <div className="flex items-center gap-2">
              <span className={'badge ' + (stColor[d.status ?? 'PENDING'] ?? '')}>{stFa[d.status ?? 'PENDING'] ?? d.status}</span>
              <a className="btn-ghost !py-1 text-xs" href={'/api/archive/' + d.id} target="_blank" rel="noreferrer">مشاهده</a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
