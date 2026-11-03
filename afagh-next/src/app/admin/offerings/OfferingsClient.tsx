'use client';

type Row = { id: number; code: string; title: string; group: number; cap: number; enr: number; deg: number | null; major: number | null; ys: number | null; ye: number | null; typ: string | null; label: string };

const TYPE_FA: Record<string, string> = { NORMAL: 'عادی', SUMMER: 'تابستانه', DIRECTED_READING: 'معرفی به استاد' };

export default function OfferingsClient(props: {
  saveTargeting: (fd: FormData) => Promise<void>;
  saveType: (fd: FormData) => Promise<void>;
  rows: Row[];
  degrees: { id: number; title: string }[];
  majors: { id: number; name: string }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right text-xs rt">
        <thead><tr className="text-slate-500"><th className="p-2">درس</th><th className="p-2">گروه</th><th className="p-2">ظرفیت</th><th className="p-2">نوع ارائه</th><th className="p-2">مقطع هدف</th><th className="p-2">رشتهٔ هدف</th><th className="p-2">ورودی از</th><th className="p-2">تا</th><th className="p-2"></th></tr></thead>
        <tbody>
          {props.rows.map(r => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="p-2"><span className="font-medium">{r.title}</span><span className="block font-mono text-3xs text-slate-400" dir="ltr">{r.code} · اکنون: {r.label}</span></td>
              <td className="p-2">{r.group}</td>
              <td className="p-2">{r.enr}/{r.cap}</td>
              <td className="p-2">
                <form id={`ft${r.id}`} action={props.saveType} className="flex items-center gap-1">
                  <input type="hidden" name="offeringId" value={r.id} />
                  <select name="otype" defaultValue={r.typ ?? 'NORMAL'} className="input !py-1 !px-2">
                    {Object.entries(TYPE_FA).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                  <button className="btn-ghost !py-1 !px-2" title="ذخیرهٔ نوع ارائه">✓</button>
                </form>
              </td>
              <td className="p-2"><select name="degree" form={`f${r.id}`} defaultValue={r.deg ?? ''} className="input !py-1 !px-2"><option value="">همه</option>{props.degrees.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></td>
              <td className="p-2"><select name="major" form={`f${r.id}`} defaultValue={r.major ?? ''} className="input !py-1 !px-2"><option value="">همه</option>{props.majors.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></td>
              <td className="p-2"><input name="ys" form={`f${r.id}`} type="number" defaultValue={r.ys ?? ''} placeholder="—"
                className="input !py-1 !px-2 w-20" dir="ltr" /></td>
              <td className="p-2"><input name="ye" form={`f${r.id}`} type="number" defaultValue={r.ye ?? ''} placeholder="∞"
                className="input !py-1 !px-2 w-20" dir="ltr" /></td>
              <td className="p-2">
                <form id={`f${r.id}`} action={props.saveTargeting}>
                  <input type="hidden" name="offeringId" value={r.id} />
                  <button className="btn-ghost !py-1 !px-2">ذخیره</button>
                </form>
              </td>
            </tr>
          ))}
          {props.rows.length === 0 && <tr><td colSpan={9} className="p-3 text-center text-slate-400">ارائه‌ای برای ترم جاری نیست.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
