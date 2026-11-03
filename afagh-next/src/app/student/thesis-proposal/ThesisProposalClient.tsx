'use client';

import { useRef, useState, useTransition } from 'react';
import {
  documentCategoryAction,
  finalIrandocCheckAction,
  requestDefenseAction,
  submitFinalThesisAction,
  submitProposalAction,
  submitTitleAndSupervisorAction,
  thesisProgressAction,
} from './actions';

type Progress = Extract<Awaited<ReturnType<typeof thesisProgressAction>>, { ok: true }>['progress'];
type Log = {
  id: number;
  checkType: string;
  trackingCode: string | null;
  similarityPercentage: number | null;
  decision: string | null;
  checkedAt: string | null;
};
type StaffOption = { id: number; name: string; rank: string };

const faNum = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const faDate = (v: Date | string | null | undefined) =>
  !v ? '—' : new Date(v).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' });

const PROPOSAL_FA: Record<string, string> = {
  NOT_STARTED: 'شروع نشده',
  SUBMITTED: 'ارسال شده',
  SIMILARITY_CHECK: 'در حال بررسی همانندجویی',
  SIMILARITY_PASSED: 'همانندجویی تأیید شد',
  SIMILARITY_HIGH: 'همانندجویی بالا',
  EXPERT_REVIEW: 'در دست کارشناس آموزش',
  APPROVED: 'تأیید شده ✅',
  REJECTED: 'رد شده ❌',
  PRIOR_REJECTED: 'پیشینهٔ عنوان رد شده',
};
const DEFENSE_FA: Record<string, string> = {
  NOT_REQUESTED: 'درخواست نشده',
  SUPERVISOR_REVIEW: 'در انتظار تأیید استاد راهنما',
  SUPERVISOR_REJECTED: 'ردشده توسط استاد راهنما',
  EXPERT_REVIEW: 'در انتظار تعیین وقت و هیأت داوران',
  SCHEDULED: 'زمان‌بندی شده',
  CONDUCTED: 'برگزار شده',
  PASSED: 'دفاع قبول ✅',
  FAILED: 'دفاع مردود ❌',
};
const PRIOR_FA: Record<string, string> = { PENDING: 'در انتظار', PASSED: 'قبول', REJECTED: 'رد', SKIPPED: 'انجام نشد' };
const FINAL_IRANDOC_FA: Record<string, string> = { PENDING: 'در انتظار استعلام', PASSED: 'قبول ✅', REJECTED: 'رد ❌' };
const CHECK_TYPE_FA: Record<string, string> = { PRIOR: 'پیشینهٔ عنوان', PROPOSAL: 'پروپوزال', FINAL: 'پایان‌نامهٔ نهایی' };

type Phase = 'TITLE' | 'PROPOSAL' | 'WAIT_APPROVAL' | 'DEFENSE_REQUEST' | 'WAIT_DEFENSE' | 'FINAL_UPLOAD' | 'FINAL_IRANDOC' | 'DONE';

const PHASE_FA: Record<Phase, string> = {
  TITLE: 'فاز ۱ — عنوان و استاد راهنما',
  PROPOSAL: 'فاز ۲ — بارگذاری پروپوزال',
  WAIT_APPROVAL: 'فاز ۲ — بررسی پروپوزال توسط کارشناس',
  DEFENSE_REQUEST: 'فاز ۳ — درخواست دفاع',
  WAIT_DEFENSE: 'فاز ۳ — تعیین وقت دفاع توسط کارشناس',
  FINAL_UPLOAD: 'فاز ۳ — تحویل پایان‌نامهٔ نهایی',
  FINAL_IRANDOC: 'فاز ۳ — استعلام نهایی ایرانداک',
  DONE: 'پایان‌نامه تحویل و تأیید شد',
};

function phaseOf(p: Progress): Phase {
  if (!p.titleFa || p.proposalStatus === 'PRIOR_REJECTED') return 'TITLE';
  if (!p.proposalFileId || p.proposalStatus === 'SIMILARITY_HIGH') return 'PROPOSAL';
  if (p.proposalStatus !== 'APPROVED') return 'WAIT_APPROVAL';
  if (p.defenseRequestStatus === 'NOT_REQUESTED' || p.defenseRequestStatus === 'SUPERVISOR_REJECTED') return 'DEFENSE_REQUEST';
  if (p.defenseRequestStatus !== 'PASSED') return 'WAIT_DEFENSE';
  if (!p.finalThesisFileId) return 'FINAL_UPLOAD';
  if (p.finalIrandocStatus === 'PENDING') return 'FINAL_IRANDOC';
  return 'DONE';
}

export default function ThesisProposalClient({
  student,
  userId,
  workflowStatus,
  progress: initial,
  logs,
  staffList,
}: {
  student: { name: string; studentCode: string };
  userId: number;
  workflowStatus: string;
  progress: Progress;
  logs: Log[];
  staffList: StaffOption[];
}) {
  const [p, setP] = useState<Progress>(initial);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const [supervisorId, setSupervisorId] = useState('');
  const [advisorId, setAdvisorId] = useState('');
  const [titleFa, setTitleFa] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [keywords, setKeywords] = useState('');
  const [abstract, setAbstract] = useState('');
  const [irandocCode, setIrandocCode] = useState('');

  const proposalRef = useRef<HTMLInputElement>(null);
  const finalRef = useRef<HTMLInputElement>(null);

  const phase = phaseOf(p);

  const failMsg = (text: string) => setMsg({ kind: 'err', text });

  const refresh = () => start(async () => {
    const r = await thesisProgressAction();
    if (!r.ok) return failMsg(r.error);
    setP(r.progress);
    setMsg({ kind: 'ok', text: 'وضعیت به‌روزرسانی شد.' });
  });

  const saveTitle = () => start(async () => {
    const r = await submitTitleAndSupervisorAction({
      supervisorId: Number(supervisorId),
      advisorId: advisorId ? Number(advisorId) : null,
      titleFa, titleEn, keywords, abstract,
    });
    if (!r.ok) return failMsg(r.error);
    setP(r.progress);
    setMsg({
      kind: r.priorStatus === 'REJECTED' ? 'err' : 'ok',
      text: r.priorStatus === 'REJECTED'
        ? 'پیشینهٔ ایرانداک برای این عنوان رد شد؛ عنوان را اصلاح و دوباره ثبت کنید.'
        : `عنوان و استاد راهنما ثبت شد (استعلام پیشینهٔ ایرانداک: ${faNum(r.priorSimilarity)}٪).`,
    });
  });

  /** بارگذاری در بایگانی الکترونیکی (همان مسیر موجودِ عکس پرسنلی) → شناسهٔ سند */
  const upload = async (file: File, categoryTitle: string): Promise<{ docId: number } | { error: string }> => {
    const cat = await documentCategoryAction(categoryTitle);
    if (!cat.ok) return { error: cat.error };
    const fd = new FormData();
    fd.append('file', file);
    fd.append('studentUserId', String(userId));
    fd.append('categoryId', String(cat.categoryId));
    const resp = await fetch('/api/admin/archive/upload', { method: 'POST', body: fd });
    const j = (await resp.json()) as { ok?: boolean; docId?: number; error?: string };
    if (!j.ok || !j.docId) return { error: j.error || 'بارگذاری فایل ناموفق بود.' };
    return { docId: j.docId };
  };

  const sendProposal = () => start(async () => {
    const f = proposalRef.current?.files?.[0];
    if (!f) return failMsg('ابتدا فایل پروپوزال را انتخاب کنید.');
    const up = await upload(f, 'فایل پروپوزال پایان‌نامه');
    if ('error' in up) return failMsg(up.error);
    const r = await submitProposalAction(up.docId);
    if (!r.ok) return failMsg(r.error);
    setP(r.progress);
    setMsg({ kind: 'ok', text: `پروپوزال ثبت شد؛ درصد همانندجویی: ${faNum(r.similarity)}٪.` });
  });

  const sendFinalThesis = () => start(async () => {
    const f = finalRef.current?.files?.[0];
    if (!f) return failMsg('ابتدا فایل پایان‌نامهٔ نهایی را انتخاب کنید.');
    const up = await upload(f, 'فایل پایان‌نامهٔ نهایی');
    if ('error' in up) return failMsg(up.error);
    const r = await submitFinalThesisAction(up.docId);
    if (!r.ok) return failMsg(r.error);
    setP(r.progress);
    setMsg({ kind: 'ok', text: 'پایان‌نامهٔ نهایی ثبت شد.' });
  });

  const askDefense = () => start(async () => {
    const r = await requestDefenseAction();
    if (!r.ok) return failMsg(r.error);
    setP(r.progress);
    setMsg({ kind: 'ok', text: 'درخواست دفاع ثبت شد و به استاد راهنما ارجاع گرفت.' });
  });

  const runFinalIrandoc = () => start(async () => {
    const r = await finalIrandocCheckAction(irandocCode);
    if (!r.ok) return failMsg(r.error);
    setP(r.progress);
    setIrandocCode('');
    setMsg({
      kind: r.passed ? 'ok' : 'err',
      text: r.passed
        ? `استعلام نهایی ایرانداک قبول شد (${faNum(r.similarity)}٪).`
        : `درصد همانندجویی (${faNum(r.similarity)}٪) بیش از سقف مجاز است.`,
    });
  });

  return (
    <div className="space-y-4" dir="rtl">
      <header className="card p-4 bg-gradient-to-l from-emerald-700 to-teal-800 text-white">
        <h1 className="text-base sm:text-lg font-black">پایان‌نامه و پروپوزال من</h1>
        <p className="text-2xs text-emerald-100 mt-1 leading-6">
          سه فاز پیش‌بینی شده است: فاز ۱ عنوان و استاد راهنما، فاز ۲ پروپوزال و تأیید همانندجویی،
          فاز ۳ درخواست دفاع، برگزاری و تحویل پایان‌نامهٔ نهایی. در هر لحظه فقط کاری که از شما مانده نمایش داده می‌شود.
        </p>
      </header>

      <div className="card p-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-3xs text-slate-500 font-bold">مرحلهٔ جاری شما — {student.name} · {student.studentCode}</div>
          <div className="text-sm font-black text-slate-800">{PHASE_FA[phase]}</div>
          <div className="text-2xs text-slate-500 mt-0.5">
            وضعیت پروندهٔ فارغ‌التحصیلی: <span className="font-mono">{workflowStatus}</span>
          </div>
        </div>
        <button onClick={refresh} disabled={pending}
          className="px-3 py-1.5 rounded-lg bg-slate-100 text-xs font-black disabled:opacity-50">به‌روزرسانی وضعیت</button>
      </div>

      {msg && (
        <div className={`card p-3 text-xs font-bold ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {msg.text} <button className="float-left text-slate-400" onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      {phase === 'TITLE' && (
        <section className="card p-4 border-2 border-emerald-300 bg-emerald-50/60 space-y-3">
          <h2 className="text-sm font-black text-emerald-900">فاز ۱ — ثبت استاد راهنما و عنوان اولیه</h2>
          <p className="text-xs text-emerald-900 leading-6">
            پس از ثبت عنوان، سامانه پیشینهٔ همانندجویی آن را در ایرانداک استعلام می‌گیرد. اگر عنوان قبلاً استفاده شده باشد،
            رد می‌شود و می‌توانید عنوان اصلاح‌شده را دوباره ثبت کنید.
          </p>
          {p.proposalStatus === 'PRIOR_REJECTED' && (
            <div className="text-xs font-black text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
              ⛔ پیشینهٔ عنوان قبلی رد شد (همانندجویی {faNum(p.irandocPriorSimilarity)}٪). عنوان دیگری ثبت کنید.
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-2">
            <Select label="استاد راهنما" value={supervisorId} onChange={setSupervisorId}
              options={staffList} empty="استاد راهنما را انتخاب کنید" />
            <Select label="استاد مشاور (اختیاری)" value={advisorId} onChange={setAdvisorId}
              options={staffList} empty="بدون مشاور" />
          </div>
          <Input label="عنوان فارسی پایان‌نامه" value={titleFa} onChange={setTitleFa}
            placeholder="مثال: طراحی و پیاده‌سازی سامانهٔ هشدار زودهنگام…" />
          <Input label="عنوان انگلیسی (اختیاری)" value={titleEn} onChange={setTitleEn} dir="ltr"
            placeholder="Thesis title in English" />
          <Input label="کلیدواژه‌ها (اختیاری)" value={keywords} onChange={setKeywords}
            placeholder="کلیدواژه اول، کلیدواژه دوم" />
          <label className="block">
            <span className="text-2xs font-bold text-slate-700">چکیده (اختیاری)</span>
            <textarea value={abstract} onChange={e => setAbstract(e.target.value)} rows={3}
              className="mt-1 w-full rounded-xl border border-emerald-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </label>
          <button onClick={saveTitle} disabled={pending}
            className="px-3 py-2 rounded-lg bg-emerald-700 text-white text-xs font-black disabled:opacity-50">
            ثبت عنوان و استاد راهنما
          </button>
        </section>
      )}

      {phase === 'PROPOSAL' && (
        <section className="card p-4 border-2 border-sky-300 bg-sky-50/60 space-y-3">
          <h2 className="text-sm font-black text-sky-900">فاز ۲ — بارگذاری فایل پروپوزال</h2>
          <p className="text-xs text-sky-900 leading-6">
            فایل پروپوزال (PDF، حداکثر ۱۰ مگابایت) بارگذاری می‌شود؛ همانندجویی آن محاسبه و سپس به کارشناس آموزش ارجاع می‌گردد.
          </p>
          {p.proposalStatus === 'SIMILARITY_HIGH' && (
            <div className="text-xs font-black text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
              ⚠️ همانندجویی نسخهٔ قبلی {faNum(p.proposalSimilarity)}٪ و بالاتر از سقف مجاز بود؛ نسخهٔ اصلاح‌شده را بارگذاری کنید.
            </div>
          )}
          {p.titleFa && (
            <div className="text-2xs text-slate-700 bg-white border border-sky-200 rounded-xl p-3">
              <b>عنوان ثبت‌شده:</b> {p.titleFa}
              {p.supervisor && <span className="text-slate-500"> — راهنما: {p.supervisor}</span>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input ref={proposalRef} type="file" accept="application/pdf" className="text-2xs" />
            <button onClick={sendProposal} disabled={pending}
              className="px-3 py-2 rounded-lg bg-sky-800 text-white text-xs font-black disabled:opacity-50">بارگذاری و ارسال پروپوزال</button>
          </div>
        </section>
      )}

      {phase === 'WAIT_APPROVAL' && (
        <section className="card p-4 border-2 border-amber-300 bg-amber-50/60 space-y-2">
          <h2 className="text-sm font-black text-amber-900">پروپوزال شما ثبت شد و در انتظار بررسی است</h2>
          <p className="text-xs text-amber-900 leading-6">
            همانندجویی محاسبه شده و کارشناس آموزش پس از تأیید، کد رهگیری بارگذاری در ایرانداک را ثبت می‌کند.
            تا آن زمان اقدام دیگری از شما لازم نیست.
          </p>
          <div className="text-2xs text-slate-700">
            درصد همانندجویی: <span className="font-black">{faNum(p.proposalSimilarity)}٪</span> — وضعیت:{' '}
            <span className="font-black">{PROPOSAL_FA[p.proposalStatus ?? 'NOT_STARTED'] ?? p.proposalStatus}</span>
          </div>
          {p.proposalStatus === 'REJECTED' && (
            <div className="text-xs font-black text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
              ⛔ پروپوزال شما توسط کارشناس آموزش رد شد. برای اصلح و ارسال مجدد به کارشناس فارغ‌التحصیلی رشتهٔ خود مراجعه کنید.
            </div>
          )}
        </section>
      )}

      {phase === 'DEFENSE_REQUEST' && (
        <section className="card p-4 border-2 border-indigo-300 bg-indigo-50/60 space-y-3">
          <h2 className="text-sm font-black text-indigo-900">فاز ۳ — درخواست دفاع</h2>
          <p className="text-xs text-indigo-900 leading-6">
            پس از تأیید پروپوزال و بارگذاری آن در ایرانداک، درخواست دفاع خود را ثبت کنید. درخواست ابتدا به استاد راهنما و
            سپس به کارشناس آموزش می‌رسد و زمان و هیأت داوران به‌صورت خودکار از استخر داوران همان رشته تخصیص می‌یابد.
          </p>
          {p.defenseRequestStatus === 'SUPERVISOR_REJECTED' && (
            <div className="text-xs font-black text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
              ⛔ استاد راهنما درخواست دفاع را نپذیرفت؛ پس از اصلاح، می‌توانید دوباره ثبت کنید.
            </div>
          )}
          <button onClick={askDefense} disabled={pending}
            className="px-3 py-2 rounded-lg bg-indigo-700 text-white text-xs font-black disabled:opacity-50">
            ثبت درخواست دفاع
          </button>
        </section>
      )}

      {phase === 'WAIT_DEFENSE' && (
        <section className="card p-4 border-2 border-amber-300 bg-amber-50/60 space-y-2">
          <h2 className="text-sm font-black text-amber-900">درخواست دفاع شما در جریان است</h2>
          <p className="text-xs text-amber-900 leading-6">
            وضعیت فعلی: <b>{DEFENSE_FA[p.defenseRequestStatus ?? 'NOT_REQUESTED'] ?? p.defenseRequestStatus}</b>
            {p.defenseScheduledAt && <> — زمان دفاع: <b>{faDate(p.defenseScheduledAt)}</b></>}
            {p.defenseRoom && <> — اتاق: <b>{p.defenseRoom}</b></>}
          </p>
          {p.nextProgressReportDue && (
            <p className="text-2xs text-slate-700">مهلت ارسال گزارش پیشرفت بعدی: {faDate(p.nextProgressReportDue)}</p>
          )}
        </section>
      )}

      {phase === 'FINAL_UPLOAD' && (
        <section className="card p-4 border-2 border-emerald-300 bg-emerald-50/60 space-y-3">
          <h2 className="text-sm font-black text-emerald-900">دفاع شما قبول شد — تحویل پایان‌نامهٔ نهایی</h2>
          <p className="text-xs text-emerald-900 leading-6">
            نسخهٔ نهایی و مصوب هیأت داوران را بارگذاری کنید (PDF، حداکثر ۱۰ مگابایت).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={finalRef} type="file" accept="application/pdf" className="text-2xs" />
            <button onClick={sendFinalThesis} disabled={pending}
              className="px-3 py-2 rounded-lg bg-emerald-700 text-white text-xs font-black disabled:opacity-50">بارگذاری پایان‌نامهٔ نهایی</button>
          </div>
        </section>
      )}

      {phase === 'FINAL_IRANDOC' && (
        <section className="card p-4 border-2 border-indigo-300 bg-indigo-50/60 space-y-3">
          <h2 className="text-sm font-black text-indigo-900">استعلام نهایی همانندجویی ایرانداک</h2>
          <p className="text-xs text-indigo-900 leading-6">
            نسخهٔ نهایی را در سامانهٔ ایرانداک بارگذاری کرده‌اید؛ کد رهگیری دریافتی را اینجا وارد کنید تا استعلام نهایی اجرا شود.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <input value={irandocCode} onChange={e => setIrandocCode(e.target.value)} dir="ltr"
              placeholder="کد رهگیری ایرانداک"
              className="border border-indigo-200 rounded-lg px-3 py-2 text-xs min-w-56 font-mono" />
            <button onClick={runFinalIrandoc} disabled={pending}
              className="px-3 py-2 rounded-lg bg-indigo-700 text-white text-xs font-black disabled:opacity-50">اجرای استعلام نهایی</button>
          </div>
        </section>
      )}

      {phase === 'DONE' && (
        <section className="card p-4 border-2 border-emerald-300 bg-emerald-50/60 space-y-2">
          <h2 className="text-sm font-black text-emerald-900">پایان‌نامهٔ نهایی تحویل و تأیید شد ✅</h2>
          <p className="text-xs text-emerald-900 leading-6">
            استعلام نهایی ایرانداک با درصد همانندجویی {faNum(p.finalIrandocSimilarity)}٪ قبول شده و پروندهٔ شما به مرحلهٔ صدور مدرک ارجاع گرفت.
          </p>
        </section>
      )}

      <Timeline p={p} />
      <IrandocLogs logs={logs} />

      <div className="card p-3 text-2xs text-slate-500 leading-5">
        فایل‌های بارگذاری‌شده در بایگانی الکترونیکی سامانه نگهداری می‌شوند و از بخش «مدارک و بایگانی» قابل مشاهده‌اند.
      </div>
    </div>
  );
}

function Timeline({ p }: { p: Progress }) {
  const items: { key: string; title: string; status: string; at: Date | string | null; tone: string }[] = [
    {
      key: 'prior',
      title: 'استعلام پیشینهٔ عنوان (ایرانداک)',
      status: PRIOR_FA[p.irandocPriorStatus ?? 'PENDING'] ?? p.irandocPriorStatus ?? '',
      at: p.irandocPriorCheckedAt,
      tone: p.irandocPriorStatus === 'REJECTED' ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200',
    },
    {
      key: 'proposal',
      title: 'ارسال پروپوزال',
      status: PROPOSAL_FA[p.proposalStatus ?? 'NOT_STARTED'] ?? p.proposalStatus ?? '',
      at: p.proposalSubmittedAt,
      tone: p.proposalSubmittedAt ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200',
    },
    {
      key: 'approve',
      title: 'تأیید پروپوزال توسط کارشناس آموزش',
      status: p.proposalApprovedAt ? 'تأیید شده' : 'در انتظار',
      at: p.proposalApprovedAt,
      tone: p.proposalApprovedAt ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200',
    },
    {
      key: 'irandoc',
      title: 'بارگذاری پروپوزال در ایرانداک',
      status: p.irandocUploadStatus === 'UPLOADED' ? 'بارگذاری شده' : p.irandocUploadStatus === 'CERTIFICATE_ISSUED' ? 'گواهی صادر شد' : 'در انتظار',
      at: p.irandocUploadedAt,
      tone: p.irandocUploadedAt ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200',
    },
    {
      key: 'request',
      title: 'ثبت درخواست دفاع',
      status: DEFENSE_FA[p.defenseRequestStatus ?? 'NOT_REQUESTED'] ?? p.defenseRequestStatus ?? '',
      at: p.defenseRequestedAt,
      tone: p.defenseRequestedAt ? 'bg-sky-50 border-sky-200' : 'bg-white border-slate-200',
    },
    {
      key: 'schedule',
      title: 'تعیین وقت و هیأت داوران',
      status: p.defenseScheduledAt ? 'زمان‌بندی شد' : 'در انتظار',
      at: p.defenseScheduledAt,
      tone: p.defenseScheduledAt ? 'bg-sky-50 border-sky-200' : 'bg-white border-slate-200',
    },
    {
      key: 'result',
      title: 'نتیجهٔ دفاع',
      status: p.defenseResult === 'PASSED' ? 'قبول ✅' : p.defenseResult === 'FAILED' ? 'مردود ❌' : p.defenseResult === 'CONDITIONAL' ? 'قبول مشروط' : 'برگزار نشده',
      at: p.defenseConductedAt,
      tone: p.defenseResult === 'PASSED' ? 'bg-emerald-50 border-emerald-200' : p.defenseResult ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200',
    },
    {
      key: 'final',
      title: 'تحویل پایان‌نامهٔ نهایی',
      status: p.finalThesisSubmittedAt ? 'تحویل شد' : 'در انتظار',
      at: p.finalThesisSubmittedAt,
      tone: p.finalThesisSubmittedAt ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200',
    },
    {
      key: 'final-irandoc',
      title: 'استعلام نهایی ایرانداک',
      status: FINAL_IRANDOC_FA[p.finalIrandocStatus ?? 'PENDING'] ?? p.finalIrandocStatus ?? '',
      at: p.finalIrandocCheckedAt,
      tone: p.finalIrandocStatus === 'REJECTED' ? 'bg-rose-50 border-rose-200' : p.finalIrandocCheckedAt ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200',
    },
  ];

  return (
    <section className="card p-4">
      <h2 className="text-sm font-black text-slate-800 mb-2">خط زمانی وضعیت (فقط خواندنی)</h2>
      <ol className="space-y-2">
        {items.map(it => (
          <li key={it.key} className={`flex items-start justify-between gap-3 rounded-xl border p-2 ${it.tone}`}>
            <div>
              <div className="text-xs font-black text-slate-800">{it.title}</div>
              <div className="text-3xs text-slate-500">{it.status || '—'}</div>
            </div>
            <div className="text-3xs text-slate-500 font-mono whitespace-nowrap">{faDate(it.at)}</div>
          </li>
        ))}
      </ol>
      {p.nextProgressReportDue && (
        <p className="text-2xs text-slate-500 mt-2">مهلت گزارش پیشرفت بعدی: {faDate(p.nextProgressReportDue)}</p>
      )}
    </section>
  );
}

function IrandocLogs({ logs }: { logs: Log[] }) {
  if (!logs.length) return null;
  return (
    <section className="card p-4">
      <h2 className="text-sm font-black text-slate-800 mb-2">سابقهٔ استعلام‌های ایرانداک</h2>
      <div className="space-y-2">
        {logs.map(l => (
          <div key={l.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2 text-xs">
            <div>
              <span className="font-black text-slate-800">{CHECK_TYPE_FA[l.checkType] ?? l.checkType}</span>
              {l.trackingCode && <span className="font-mono text-3xs text-slate-500"> — {l.trackingCode}</span>}
              <span className="text-3xs text-slate-500"> — {l.decision ?? '—'}</span>
            </div>
            <div className="text-3xs text-slate-600">
              {faNum(l.similarityPercentage)}٪ · {faDate(l.checkedAt)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Select({
  label, value, onChange, options, empty,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: StaffOption[];
  empty: string;
}) {
  return (
    <label className="block">
      <span className="text-2xs font-bold text-slate-700">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-emerald-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
        <option value="">{empty}</option>
        {options.map(o => (
          <option key={o.id} value={o.id}>{o.name}{o.rank ? ` — ${o.rank}` : ''}</option>
        ))}
      </select>
    </label>
  );
}

function Input({
  label, value, onChange, placeholder, dir,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  dir?: 'ltr';
}) {
  return (
    <label className="block">
      <span className="text-2xs font-bold text-slate-700">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} dir={dir}
        className="mt-1 w-full rounded-xl border border-emerald-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500" />
    </label>
  );
}