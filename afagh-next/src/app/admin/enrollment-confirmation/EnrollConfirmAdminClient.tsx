'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

type Msg = { text: string; kind: 'ok' | 'error' } | null;

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `خطا (${res.status})`);
  return data;
}

interface StudentHit { studentId: number; studentCode: string; name: string; entryYear: number | null; }
interface TermHit { id: number; title: string; isCurrent: number | null; }

export default function EnrollConfirmAdminClient() {
  const [studentQuery, setStudentQuery] = useState('');
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [picked, setPicked] = useState<StudentHit | null>(null);
  const [terms, setTerms] = useState<TermHit[]>([]);
  const [termId, setTermId] = useState<number | ''>('');
  const [result, setResult] = useState<{ verifyUrl: string; expiresAt: string } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, startTransition] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api('/api/admin/enrollment-confirmation?action=terms');
        const list: TermHit[] = data.terms || [];
        setTerms(list);
        const cur = list.find(t => (t.isCurrent ?? 0) === 1);
        if (cur) setTermId(cur.id);
      } catch (e: any) {
        setMsg({ text: e.message, kind: 'error' });
      }
    })();
  }, []);

  const searchStudents = (q: string) => {
    setStudentQuery(q);
    setPicked(null);
    setResult(null);
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) { setHits([]); return; }
    debounce.current = setTimeout(async () => {
      try {
        const data = await api(`/api/admin/enrollment-approvals?action=students&q=${encodeURIComponent(q.trim())}`);
        setHits(data.hits || []);
      } catch { setHits([]); }
    }, 300);
  };

  const issue = () => startTransition(async () => {
    setMsg(null);
    setResult(null);
    try {
      if (!picked) { setMsg({ text: 'دانشجو را از لیست جست‌وجو انتخاب کنید.', kind: 'error' }); return; }
      if (!termId) { setMsg({ text: 'نیمسال را انتخاب کنید.', kind: 'error' }); return; }
      const data = await api(`/api/admin/enrollment-confirmation?studentId=${picked.studentId}&termId=${termId}`);
      setResult({ verifyUrl: data.verifyUrl, expiresAt: data.expiresAt });
      setMsg({ text: 'تأییدیه صادر شد؛ با باز کردن پیوند، برگه قابل چاپ نمایش داده می‌شود.', kind: 'ok' });
    } catch (e: any) {
      setMsg({ text: e.message, kind: 'error' });
    }
  });

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4" dir="rtl">
      <div>
        <h1 className="text-xl font-bold text-slate-800">تأییدیه انتخاب واحد (کارشناس)</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          صدور برگهٔ تأییدیه با QR استعلام برخط برای هر دانشجو و نیمسال — کارشناس پیوند را باز کرده و چاپ می‌گیرد.
        </p>
      </div>

      {msg && (
        <div className={`px-3 py-2 rounded-lg text-sm border ${msg.kind === 'ok'
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
          {msg.text}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="space-y-1">
          <label className="text-xs text-slate-500">دانشجو</label>
          <input
            value={picked ? `${picked.name} (${picked.studentCode})` : studentQuery}
            onChange={(e) => searchStudents(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="نام یا شماره دانشجو… (حداقل ۲ حرف)"
          />
          {hits.length > 0 && !picked && (
            <div className="border border-slate-200 rounded-lg max-h-40 overflow-y-auto divide-y divide-slate-100">
              {hits.map((h) => (
                <button key={h.studentId} type="button"
                  onClick={() => { setPicked(h); setHits([]); setStudentQuery(h.name); }}
                  className="w-full text-right px-3 py-2 text-sm hover:bg-blue-50">
                  {h.name} <span className="text-xs text-slate-400 font-mono">{h.studentCode}</span>
                  {h.entryYear ? <span className="text-xs text-slate-400"> — ورود {h.entryYear}</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>

        <label className="block text-xs text-slate-500 space-y-1">
          <span className="block">نیمسال</span>
          <select
            value={termId}
            onChange={(e) => setTermId(e.target.value ? Number(e.target.value) : '')}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="">— انتخاب نیمسال —</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}{(t.isCurrent ?? 0) === 1 ? ' (جاری)' : ''}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={issue}
          disabled={busy}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? 'در حال صدور…' : 'صدور تأییدیه'}
        </button>
      </div>

      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2 text-sm">
          <div className="text-emerald-800 font-bold">تأییدیه صادر شد (معتبر تا {new Date(result.expiresAt).toLocaleDateString('fa-IR')})</div>
          <a
            href={result.verifyUrl}
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg bg-emerald-600 px-4 py-2 text-center text-white font-black hover:bg-emerald-500"
          >
            باز کردن برگهٔ قابل چاپ ←
          </a>
          <div className="text-2xs text-slate-500 break-all" dir="ltr">{result.verifyUrl}</div>
        </div>
      )}
    </div>
  );
}
