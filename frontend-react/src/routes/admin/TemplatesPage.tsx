import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Play, Plus, Save, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { listTemplates, saveTemplate, sendTemplateTest, type SavedTemplateRow } from '@/lib/templates-api';

// ═══ Notification templates and channel testing — port of admin/templates ═══

const CHANNELS = ['SMS', 'BALE', 'EITAA', 'TELEGRAM', 'SOROUSH', 'IGAP'];
const CHANNEL_FA: Record<string, string> = {
  SMS: 'پیامک', BALE: 'بله', EITAA: 'ایتا', TELEGRAM: 'تلگرام', SOROUSH: 'سروش', IGAP: 'ای‌گپ',
};

const emptyTemplate = (): SavedTemplateRow => ({
  eventCode: '', title: '', templateText: '', variables: [], channels: 'SMS', isActive: true,
});

export function AdminTemplatesPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['templates'], queryFn: listTemplates, staleTime: 15_000 });
  const [rows, setRows] = useState<SavedTemplateRow[]>([]);
  const [editing, setEditing] = useState<SavedTemplateRow | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [testChannel, setTestChannel] = useState('SMS');
  const [testId, setTestId] = useState('');

  useEffect(() => {
    if (data) setRows(data);
  }, [data]);

  const saveMut = useMutation({
    mutationFn: (t: SavedTemplateRow) => saveTemplate(t),
    onSuccess: async () => { setMsg({ kind: 'ok', text: 'قالب ذخیره شد.' }); setEditing(null); await qc.invalidateQueries({ queryKey: ['templates'] }); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });
  const testMut = useMutation({
    mutationFn: () => sendTemplateTest(testChannel, testId.trim()),
    onSuccess: (m) => setMsg({ kind: 'ok', text: m }),
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-indigo-900 via-violet-900 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-lg font-black"><BellRing className="size-5" aria-hidden /> قالب‌های اعلان و تست کانال‌ها</h1>
          <p className="mt-1 text-xs text-indigo-200">متن رویدادها به‌تفکیک کانال + پیام آزمایشی از مسیر واقعی (با ثبت لاگ تحویل)</p>
        </CardContent>
      </Card>

      {msg ? (
        <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>{msg.text}</div>
      ) : null}

      <Card>
        <CardContent className="space-y-3 pt-4">
          <h2 className="text-sm font-black">پیام آزمایشی (ADMIN)</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select value={testChannel} onChange={(e) => setTestChannel(e.target.value)} className="h-8 rounded-lg border border-input bg-card px-2 text-[11px] font-bold">
              {CHANNELS.map((ch) => <option key={ch} value={ch}>{CHANNEL_FA[ch]} ({ch})</option>)}
            </select>
            <Input value={testId} onChange={(e) => setTestId(e.target.value)} placeholder="کد پرسنلی / دانشجویی / موبایل / کد ملی / chatId" className="h-8 max-w-xs text-[11px]" />
            <Button size="sm" disabled={testMut.isPending || !testId.trim()} onClick={() => testMut.mutate()}><Play className="size-4" aria-hidden /> {testMut.isPending ? 'در حال ارسال…' : 'ارسال تست'}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black">قالب‌های ذخیره‌شده ({rows.length})</h2>
            <Button size="sm" onClick={() => setEditing(emptyTemplate())}><Plus className="size-4" aria-hidden /> قالب جدید</Button>
          </div>
          {isLoading ? <Skeleton className="h-32 w-full" /> : null}
          {isError ? <p className="text-xs font-bold text-rose-700">دریافت قالب‌ها ناموفق بود.</p> : null}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-[11px]">
              <thead className="bg-muted/60 text-muted-foreground"><tr>{['کد رویداد', 'عنوان', 'کانال‌ها', 'متغیرها', 'فعال', ''].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.eventCode} className="border-t border-border/50">
                    <td className="p-2 font-mono" dir="ltr">{t.eventCode}</td>
                    <td className="p-2 font-bold">{t.title}</td>
                    <td className="p-2">{t.channels}</td>
                    <td className="p-2 font-mono text-[10px]">{t.variables.map((v) => v.tag).join('، ') || '—'}</td>
                    <td className="p-2">{t.isActive ? <Badge variant="success" className="text-[9px]">فعال</Badge> : <Badge variant="secondary" className="text-[9px]">خاموش</Badge>}</td>
                    <td className="p-2"><Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setEditing(t)}>ویرایش</Button></td>
                  </tr>
                ))}
                {!isLoading && rows.length === 0 ? <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">قالبی ذخیره نشده است.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {editing ? <EditModal t={editing} onClose={() => setEditing(null)} onSaved={(t) => saveMut.mutate(t)} /> : null}
    </div>
  );
}

function EditModal({ t, onClose, onSaved }: { t: SavedTemplateRow; onClose: () => void; onSaved: (t: SavedTemplateRow) => void }) {
  const [form, setForm] = useState<SavedTemplateRow>(t);
  const set = <K extends keyof SavedTemplateRow>(k: K, v: SavedTemplateRow[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} dir="rtl">
      <div className="max-h-[92vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="font-bold">{form.eventCode ? `ویرایش ${form.eventCode}` : 'قالب جدید'}</h2><button type="button" onClick={onClose}><X className="size-5" aria-hidden /></button></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-[10px] text-muted-foreground"><span>کد رویداد *</span><Input value={form.eventCode} onChange={(e) => set('eventCode', e.target.value.toUpperCase())} className="h-8 font-mono text-[11px]" dir="ltr" /></label>
          <label className="space-y-1 text-[10px] text-muted-foreground"><span>عنوان</span><Input value={form.title} onChange={(e) => set('title', e.target.value)} className="h-8 text-[11px]" /></label>
        </div>
        <label className="block space-y-1 text-[10px] text-muted-foreground">
          <span>متن قالب * (متغیرها: {'{tag}'})</span>
          <textarea value={form.templateText} onChange={(e) => set('templateText', e.target.value)} rows={6} className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-[11px]" />
        </label>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((ch) => (
            <label key={ch} className="flex items-center gap-1 text-[10px] font-bold">
              <input type="checkbox" className="size-3.5 accent-violet-600" checked={form.channels.includes(ch)} onChange={(e) => {
                const chSet = new Set(form.channels.split(',').map((x) => x.trim()).filter(Boolean));
                if (e.target.checked) chSet.add(ch); else chSet.delete(ch);
                set('channels', [...chSet].join(',') || 'SMS');
              }} />{CHANNEL_FA[ch]}
            </label>
          ))}
          <label className="flex items-center gap-1 text-[10px] font-bold"><input type="checkbox" className="size-3.5 accent-emerald-600" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />فعال</label>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-[11px] font-black">متغیرها</h3>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => set('variables', [...form.variables, { tag: '', label: '', sampleValue: '' }])}><Plus className="size-3" aria-hidden /> متغیر</Button>
          </div>
          <div className="space-y-1">
            {form.variables.map((v, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1">
                <Input value={v.tag} onChange={(e) => { const n = [...form.variables]; n[i] = { ...v, tag: e.target.value }; set('variables', n); }} placeholder="tag" className="h-7 w-28 font-mono text-[10px]" dir="ltr" />
                <Input value={v.label} onChange={(e) => { const n = [...form.variables]; n[i] = { ...v, label: e.target.value }; set('variables', n); }} placeholder="برچسب" className="h-7 w-36 text-[10px]" />
                <Input value={v.sampleValue} onChange={(e) => { const n = [...form.variables]; n[i] = { ...v, sampleValue: e.target.value }; set('variables', n); }} placeholder="نمونه" className="h-7 w-36 text-[10px]" />
                <button type="button" className="text-rose-600" onClick={() => set('variables', form.variables.filter((_, idx) => idx !== i))}><Trash2 className="size-3.5" aria-hidden /></button>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
          <Button size="sm" variant="outline" onClick={onClose}>انصراف</Button>
          <Button size="sm" disabled={!form.eventCode.trim() || !form.templateText.trim()} onClick={() => onSaved(form)}><Save className="size-4" aria-hidden /> ذخیره</Button>
        </div>
      </div>
    </div>
  );
}
