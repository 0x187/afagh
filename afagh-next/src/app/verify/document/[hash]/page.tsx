import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { document_types, student_documents, students, users } from '@/db/schema';
import { toShamsi } from '@/lib/shamsi';

export const dynamic = 'force-dynamic';

const faNum = (v: unknown) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

// استعلام عمومی اصالت سند ممهور — بدون نیاز به ورود؛ مقصد QR روی فرم رسمی
export default async function VerifyDocumentPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash: rawHash } = await params;
  const hash = decodeURIComponent(rawHash || '').trim();

  const [doc] = hash
    ? await db
        .select({
          id: student_documents.id,
          fileName: student_documents.fileName,
          contentHash: student_documents.contentHash,
          verificationStatus: student_documents.verificationStatus,
          uploadedAt: student_documents.uploadedAt,
          typeTitle: document_types.title,
          firstName: users.firstName,
          lastName: users.lastName,
          studentCode: students.studentCode,
        })
        .from(student_documents)
        .leftJoin(document_types, eq(document_types.id, student_documents.typeId))
        .leftJoin(users, eq(users.id, student_documents.personUserId))
        .leftJoin(students, eq(students.userId, student_documents.personUserId))
        .where(eq(student_documents.contentHash, hash))
        .limit(1)
    : [];

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full p-6 space-y-4 border border-slate-200">
        <div className="text-center">
          <div className="text-2xl font-black text-slate-900">استعلام اصالت سند</div>
          <div className="text-xs text-slate-500 mt-1">دانشگاه آفاق — سامانهٔ جامع آموزشی</div>
        </div>

        {!doc ? (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-5 text-center">
            <div className="text-4xl">⛔</div>
            <div className="font-black text-rose-700 mt-2">سند یافت نشد</div>
            <p className="text-xs text-rose-600 mt-1">
              هیچ سندی با این امضای دیجیتال در سامانه ثبت نشده است. این سند معتبر نیست.
            </p>
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-center">
            <div className="text-4xl">✅</div>
            <div className="font-black text-emerald-700 mt-2">سند معتبر است</div>
            <p className="text-xs text-emerald-600 mt-1">این سند در بایگانی الکترونیک دانشگاه ثبت و تأیید شده است.</p>
          </div>
        )}

        {doc && (
          <table className="w-full text-sm border-collapse rt">
            <tbody>
              {[
                ['نوع سند', doc.typeTitle ?? '—'],
                ['نام سند', doc.fileName],
                ['صاحب سند', `${doc.firstName ?? ''} ${doc.lastName ?? ''}`.trim() || '—'],
                ['شمارهٔ دانشجویی', faNum(doc.studentCode)],
                ['وضعیت تأیید', doc.verificationStatus === 'VERIFIED' ? 'تأییدشده' : (doc.verificationStatus ?? '—')],
                ['تاریخ ثبت', faNum(doc.uploadedAt ? toShamsi(doc.uploadedAt.toISOString()) : '—')],
              ].map(([k, v]) => (
                <tr key={k as string} className="border-b border-slate-100">
                  <td className="py-2 pl-3 font-bold text-slate-500 whitespace-nowrap">{k}</td>
                  <td className="py-2 text-slate-800">{v}</td>
                </tr>
              ))}
              <tr>
                <td className="py-2 pl-3 font-bold text-slate-500 align-top">امضای دیجیتال</td>
                <td className="py-2 font-mono text-3xs text-slate-500 break-all" dir="ltr">{doc.contentHash}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
