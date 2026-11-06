import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { document_signatures, electronic_documents } from '@/db/schema';
import { getStaffByUser, requireRole } from '@/lib/auth';
import ElectronicSignature from '@/components/ElectronicSignature';

export const dynamic = 'force-dynamic';

const DOC_TYPE_LABEL: Record<string, string> = {
  TEACHING_CONTRACT: 'قرارداد تدریس ترمی',
  CONTRACT: 'قرارداد',
  SUMMONS: 'احضاریه',
};

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(['PROFESSOR']);
  const me = await getStaffByUser(user.id);
  const { id: rawId } = await params;
  const id = Number(rawId);
  const [doc] = await db.select().from(electronic_documents).where(eq(electronic_documents.id, id));
  if (!doc || !me || doc.staffId !== me.id) notFound(); // ایزولاسیون: سند دیگران دیده نمی‌شود
  const [sig] = await db.select().from(document_signatures).where(eq(document_signatures.documentId, id));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card">
        <h2 className="font-bold">{doc.title}</h2>
        <p className="mt-1 text-xs text-slate-500">{doc.docType ? DOC_TYPE_LABEL[doc.docType] ?? doc.docType : 'سند'}</p>
        <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-700">{doc.documentSnapshot}</pre>
        <p className="mt-2 break-all font-mono text-3xs text-slate-400" dir="ltr">hash: {doc.documentHash}</p>
      </div>
      <ElectronicSignature documentId={doc.id} initialStatus={doc.signatureStatus ?? 'PENDING'} documentHash={doc.documentHash} signedAt={sig?.signedAt?.toISOString() ?? null} />
    </div>
  );
}
