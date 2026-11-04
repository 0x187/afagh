import { requireRole } from '@/lib/auth';
import { listSourceMetas } from '../catalog';
import { getCatalogOptions } from '../saved/actions';
import { getSavedReport } from '../saved/actions';
import BuilderClient from './BuilderClient';

export const dynamic = 'force-dynamic';

const BUILDER_ROLES = ['ADMIN', 'EDU_EXPERT', 'FINANCE_EXPERT', 'FINANCE'];

export default async function ReportBuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  await requireRole(BUILDER_ROLES);

  const sp = await searchParams;
  const editId = Number(sp?.edit ?? '');
  const initial = Number.isFinite(editId) && editId > 0 ? await getSavedReport(editId) : null;

  const sources = listSourceMetas();
  const options = await getCatalogOptions();

  return (
    <div className="space-y-4">
      <div className="card !p-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-extrabold text-slate-900">🛠️ گزارش‌ساز</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            منبع را انتخاب کن، ستون‌ها و شرط‌ها را بچین، به گزارش نام بده و ذخیره کن — بعد هرکس مجاز باشد می‌تواند اجرایش کند.
          </p>
        </div>
      </div>

      <BuilderClient sources={sources} options={options} initial={initial} />
    </div>
  );
}
