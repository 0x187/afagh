import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { electronic_documents } from '@/db/schema';
import { getStaffByUser, requireRole } from '@/lib/auth';
import { professorTermFilter } from '@/lib/professor-term-filter';
import ProfessorTermFilterBanner from '../term-filter-banner';

export const dynamic = 'force-dynamic';

const DOC_TYPE_LABEL: Record<string, string> = {
  TEACHING_CONTRACT: 'قرارداد تدریس ترمی',
  CONTRACT: 'قرارداد',
  SUMMONS: 'احضاریه',
};

export default async function DocumentsPage() {
  const user = await requireRole(['PROFESSOR']);
  const me = await getStaffByUser(user.id);
  const universityId = me?.universityId ?? user.universityId ?? null;
  const { selectedTerm } = await professorTermFilter(universityId);
  const docs = me
    ? await db
        .select()
        .from(electronic_documents)
        .where(
          and(
            eq(electronic_documents.staffId, me.id),
            selectedTerm ? eq(electronic_documents.termId, selectedTerm.id) : undefined,
          ),
        )
        .orderBy(desc(electronic_documents.id))
    : [];

  return (
    <div className="card space-y-2">
      <ProfessorTermFilterBanner selectedTerm={selectedTerm} universityId={universityId} />
      <h2 className="font-bold">اسناد الکترونیک (قرارداد / احضاریه)</h2>
      {docs.length === 0 && (
        <p className="text-sm text-slate-500">
          {selectedTerm
            ? `برای نیمسال «${selectedTerm.title}» سندی برای شما صادر نشده است.`
            : 'هنوز داده‌ای ثبت نشده است؛ سندی برای شما صادر نشده است.'}
        </p>
      )}
      {docs.map(d => (
        <Link prefetch={false} key={d.id} href={'/professor/documents/' + d.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm hover:bg-slate-100">
          <div>
            <p className="font-medium">{d.title}</p>
            <p className="text-xs text-slate-500">
              {(d.docType ? DOC_TYPE_LABEL[d.docType] ?? d.docType : 'سند')}
              {d.createdAt ? ` · ${new Date(d.createdAt).toLocaleDateString('fa-IR')}` : ''}
            </p>
          </div>
          <span className={'badge ' + (d.signatureStatus === 'SIGNED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800')}>
            {d.signatureStatus === 'SIGNED' ? 'امضا شده' : 'در انتظار امضا'}
          </span>
        </Link>
      ))}
    </div>
  );
}
