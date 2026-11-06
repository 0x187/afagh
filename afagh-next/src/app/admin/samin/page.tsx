import { db } from '@/db';
import { samin_staging, samin_sync_logs, universities } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { desc, eq, sql } from 'drizzle-orm';
import SaminClient from './SaminClient';

export const dynamic = 'force-dynamic';

export default async function SaminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(['ADMIN']);
  const params = await searchParams;
  const cookieUni = await getCurrentUniversity().catch(() => null);
  const uniCode = params.uni || cookieUni?.code || 'AFAGH';

  const unis = await db.select().from(universities).orderBy(universities.code);
  const activeUni = unis.find(u => u.code === uniCode) || unis[0];

  const perUni = await db.select({ universityId: samin_staging.universityId, n: sql<number>`count(*)::int` })
    .from(samin_staging)
    .groupBy(samin_staging.universityId);
  const queueByUni = new Map(perUni.map(r => [r.universityId, Number(r.n)]));

  const staging = activeUni ? await db.select().from(samin_staging).where(eq(samin_staging.universityId, activeUni.id)).orderBy(desc(samin_staging.createdAt)).limit(50) : [];
  const logs = activeUni ? await db.select().from(samin_sync_logs).where(eq(samin_sync_logs.universityId, activeUni.id)).orderBy(desc(samin_sync_logs.createdAt)).limit(20) : [];

  const totalStaging = activeUni ? queueByUni.get(activeUni.id) ?? 0 : 0;
  const otherQueues = activeUni ? unis.filter(u => u.id !== activeUni.id && (queueByUni.get(u.id) ?? 0) > 0) : [];

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="font-bold text-sm">هاب ثمین — ارسال به سازمان امور دانشجویان</h2>
        <p className="mt-1 text-xs leading-6 text-slate-500">
          هر دانشگاه با کلید خودش ارسال می‌شود. ابتدا داده آن دانشگاه را در <b>انتقال داده</b> تبدیل کنید، سپس اینجا با
          <b> entity_code=1000 (دانشجو)</b> به ثمین بفرستید. رهگیری با <code>trace_id</code>.
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {unis.map(u => (
            <a
              key={u.id}
              href={`/admin/samin?uni=${u.code}`}
              className={`text-xs px-3 py-1 rounded border flex items-center gap-1 ${u.code === activeUni?.code ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white hover:bg-slate-50'}`}
            >
              {u.title} ({u.code})
              <span className={`px-1 rounded text-3xs tabular-nums ${u.code === activeUni?.code ? 'bg-white/25' : (queueByUni.get(u.id) ?? 0) > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>
                {(queueByUni.get(u.id) ?? 0).toLocaleString('fa-IR')}
              </span>
            </a>
          ))}
        </div>
        {activeUni && totalStaging === 0 && otherQueues.length > 0 && (
          <div className="mt-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs p-2 rounded leading-6">
            صف دانشگاه «{activeUni.title}» خالی است. صف آمادهٔ ارسال برای{' '}
            {otherQueues.map((u, i) => (
              <span key={u.id}>
                {i > 0 && '، '}
                <a href={`/admin/samin?uni=${u.code}`} className="underline font-bold">
                  {u.title} ({(queueByUni.get(u.id) ?? 0).toLocaleString('fa-IR')})
                </a>
              </span>
            ))}
            {' '}را باز کنید.
          </div>
        )}
      </div>

      {activeUni && (
        <SaminClient
          university={activeUni}
          universities={unis.map(u => ({ id: u.id, code: u.code, title: u.title }))}
          staging={staging.map(s => ({ id: s.id, entityCode: s.entityCode, personPkInSource: s.personPkInSource, status: s.status, traceId: s.traceId, errorMessage: s.errorMessage, createdAt: s.createdAt ? s.createdAt.toISOString() : null }))}
          logs={logs.map(l => ({ id: l.id, entityCode: l.entityCode, traceId: l.traceId, status: l.status, summaryResult: l.summaryResult as any, createdAt: l.createdAt ? l.createdAt.toISOString() : null }))}
          totalStaging={totalStaging}
        />
      )}
    </div>
  );
}
