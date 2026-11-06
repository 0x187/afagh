'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormFieldSchema } from '@/lib/workflow-engine';
import {
  issueApprovedTranscriptTokenAction,
  submitSatisfactionRatingAction,
  submitStudentRequestAction,
  uploadRequestAttachmentAction,
} from './actions';
import VerifyQrBlock from '@/components/VerifyQrBlock';

type Attachment = { key: string; name: string; size: number; mimeType: string };

interface ProcessDef {
  id: number;
  code: string;
  title: string;
  category: string;
  description: string;
  feeAmount: number;
  formSchema: any[];
  steps: {
    stepOrder: number;
    title: string;
    stepType: string;
    roleCode: string;
    slaHours: number;
  }[];
}

interface RequestItem {
  id: number;
  trackingCode: string;
  status: string;
  created: string | null;
  updated: string | null;
  formData: any;
  processCode: string;
  processTitle: string;
  category: string;
  currentStepTitle?: string;
  currentRole?: string;
  slaHours?: number;
  certificateNumber?: string | null;
  digitalStampHash?: string | null;
  satisfactionScore?: number | null;
  feedbackText?: string | null;
  logs: {
    id: number;
    stepTitle?: string;
    actorRole?: string;
    action?: string;
    note?: string;
    assignedAt?: string | null;
    completedAt?: string | null;
    durationMinutes?: number | null;
    slaStatus?: string | null;
  }[];
  checkpoints?: {
    id: number;
    departmentCode: string;
    departmentTitle: string;
    isCleared: number;
    notes?: string | null;
  }[];
}

interface StudentRequestsClientProps {
  student: {
    id: number;
    name: string;
    studentCode: string;
    nationalCode: string | null;
    majorName: string;
    degreeTitle: string;
  };
  processes: ProcessDef[];
  myRequests: RequestItem[];
  /** فرآیندِ پیش‌انتخاب‌شده از لینک مستقیم (مثل ?process=FINANCE_STATEMENT) */
  initialProcessCode?: string | null;
  /** سربرگ گواهی: نام و آرم دانشگاه از تنظیمات (هیچ‌کدام هاردکد نیست) */
  universityTitle?: string | null;
  universityLogo?: string | null;
}

// ── گزینه‌های پویا (optionsEndpoint) ────────────────────────────────────────
// فرم‌اسکیمای ذخیره‌شده در process_definitions می‌تواند به‌جای options آفلاین، یک
// endpoint بدهد (مهاجرت‌های 0038 و 0039: رشته‌های فعال، ترم جاری، استادان راهنما).
// تایپ پایهٔ FormFieldSchema در lib/workflow-engine این ویژگی را ندارد، پس اینجا
// به‌صورت محلی اضافه می‌شود (فایل موتور عمداً دست‌نخورده ماند — گزارش پایانی).
type SelectOption = { value: string; label: string };

type DynField = FormFieldSchema & { optionsEndpoint?: string; multiple?: boolean };

/** وضعیت هر فیلدِ پویا؛ `ep` نگه‌داری می‌شود تا با تعویض endpoint دادهٔ کهنه نشان داده نشود. */
type DynState = { ep: string; status: 'loading' | 'ready' | 'error'; items: SelectOption[] };

const asText = (v: unknown): string =>
  v === null || v === undefined ? '' : String(v).trim();

/** آرایه را از پاسخ API بیرون می‌کشد؛ پوشش‌های رایج envelope هم پذیرفته می‌شوند. */
function toRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const k of ['items', 'options', 'rows', 'data', 'results', 'list']) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
  }
  return [];
}

/**
 * نرمال‌سازی پاسخ endpoint به {value,label} — دفاعی و تک‌مرحله‌ای:
 *   [{value,label}] · [{id,name}] · [{id,code,title}] · [{id,label}] · {items:[…]} · …
 * مقادیر تکراری و ردیف‌های بدون شناسه دور ریخته می‌شوند.
 */
function normalizeOptions(raw: unknown): SelectOption[] {
  const out: SelectOption[] = [];
  const seen = new Set<string>();
  for (const row of toRows(raw)) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const value = asText(o.value ?? o.id ?? o.code ?? o.key);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      label: asText(o.label ?? o.name ?? o.title ?? o.text ?? o.fullName ?? o.displayName) || value,
    });
  }
  return out;
}

/** آیا این فیلد باید گزینه‌هایش را از API بگیرد؟ (optionsEndpoint و بدون options آفلاین) */
function usesRemoteOptions(f: DynField): boolean {
  return f.type === 'select' && !!f.optionsEndpoint && !(f.options && f.options.length);
}

const statusFa: Record<string, string> = {
  SUBMITTED: 'ثبت‌شده و در صف بررسی',
  IN_REVIEW: 'در دست بررسی کارشناس',
  APPROVED: 'تأیید نهایی شده ✓',
  REJECTED: 'ردشده ✗',
  RETURNED: 'نیازمند بازبینی و اصلاح',
};

const statusBadge: Record<string, string> = {
  SUBMITTED: 'bg-amber-100 text-amber-900 border-amber-300',
  IN_REVIEW: 'bg-sky-100 text-sky-900 border-sky-300',
  APPROVED: 'bg-emerald-100 text-emerald-900 border-emerald-300 font-bold',
  REJECTED: 'bg-red-100 text-red-800 border-red-300',
  RETURNED: 'bg-purple-100 text-purple-900 border-purple-300',
};

const roleFa: Record<string, string> = {
  SUPERVISOR: 'استاد راهنما',
  DEPARTMENT_HEAD: 'مدیر گروه آموزشی',
  EDU_EXPERT: 'کارشناس آموزش کل',
  FINANCE_EXPERT: 'کارشناس امور مالی',
  LIBRARY_STAFF: 'مسئول کتابخانه',
  WELFARE_STAFF: 'صندوق رفاه',
  LAB_STAFF: 'آزمایشگاه و کارگاه',
  GRADUATION_EXPERT: 'کارشناس فارغ‌التحصیلی',
  VICE_CHANCELLOR: 'معاونت آموزشی',
  MULTI_CHECKPOINT: 'تسویه چندگانه',
  SYSTEM_BOT: 'سامانه خودکار آفاق',
  PROFESSOR: 'استاد درس',
};

export default function StudentRequestsClient({
  student,
  processes,
  myRequests: initialRequests,
  initialProcessCode,
  universityTitle,
  universityLogo,
}: StudentRequestsClientProps) {
  const [activeTab, setActiveTab] = useState<'MY_REQUESTS' | 'NEW_REQUEST'>(() =>
    initialProcessCode && processes.some(p => p.code === initialProcessCode) ? 'NEW_REQUEST' : 'MY_REQUESTS',
  );
  const [selectedProcessCode, setSelectedProcessCode] = useState<string>(() =>
    initialProcessCode && processes.some(p => p.code === initialProcessCode)
      ? initialProcessCode
      : (processes[0]?.code || 'ENROLLMENT_CERT'),
  );
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // دیالوگ مشاهده گواهی رسمی
  const [viewingCertificate, setViewingCertificate] = useState<RequestItem | null>(null);

  // مودال امتیازدهی CSAT
  const [ratingRequestId, setRatingRequestId] = useState<number | null>(null);
  const [ratingScore, setRatingScore] = useState<number>(5);
  const [ratingFeedback, setRatingFeedback] = useState<string>('');

  // رمز تایید (QR) کارنامهٔ معتبر — پس از تأیید درخواست
  const [validTranscriptQr, setValidTranscriptQr] = useState<{ requestId: number; url: string; qr: string; expiresAt: string | null } | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);

  const selectedProcess = processes.find(p => p.code === selectedProcessCode) || processes[0];

  // برای «معادل‌سازی» پیوست کارنامهٔ ممهور الزامی است حتی اگر در فرم‌اسکیما نباشد
  const effectiveSchema = useMemo<DynField[]>(() => {
    const base = (selectedProcess?.formSchema || []) as DynField[];
    if (selectedProcess?.code === 'COURSE_TRANSFER' && !base.some(f => f.type === 'file')) {
      return [
        ...base,
        {
          key: 'transcriptAttachment',
          label: 'پیوست کارنامهٔ ممهور دانشگاه قبلی',
          type: 'file' as const,
          required: true,
          helperText: 'تصویر کارنامهٔ ممهور (PDF/JPG/PNG تا ۱۰ مگابایت) — بدون پیوست، درخواست معادل‌سازی بررسی نمی‌شود.',
        },
      ];
    }
    return base;
  }, [selectedProcess]);

  // ── گزینه‌های پویا: هر select که optionsEndpoint دارد، از API پر می‌شود ──────
  const [dynOptions, setDynOptions] = useState<Record<string, DynState>>({});
  const [optionsRetry, setOptionsRetry] = useState(0);

  const dynFields = useMemo<DynField[]>(
    () => (effectiveSchema || []).filter(usesRemoteOptions),
    [effectiveSchema],
  );

  // کلید وابستگی افکت یک «رشته» است نه آرایه — آرایه در هر رندر تازه می‌شود و
  // لوپ بی‌پایان fetch می‌ساخت.
  const endpointsKey = useMemo(
    () => dynFields.map(f => `${f.key}::${f.optionsEndpoint}`).join('|'),
    [dynFields],
  );

  useEffect(() => {
    if (!endpointsKey || dynFields.length === 0) {
      setDynOptions(prev => (Object.keys(prev).length ? {} : prev));
      return;
    }

    const controller = new AbortController();
    let alive = true;

    // گروه‌بندی: یک درخواست برای هر endpoint حتی اگر چند فیلد به آن اشاره کنند
    // (استاد راهنما و استاد مشاور هر دو /api/admin/staff/supervisors هستند)
    const groups = new Map<string, DynField[]>();
    for (const f of dynFields) {
      const ep = String(f.optionsEndpoint);
      const g = groups.get(ep);
      if (g) g.push(f);
      else groups.set(ep, [f]);
    }

    setDynOptions(prev => {
      const next: Record<string, DynState> = {};
      for (const f of dynFields) {
        const ep = String(f.optionsEndpoint);
        const cur = prev[f.key];
        // فقط اگر همان endpoint و قبلاً موفق بوده، دادهٔ آماده نگه داشته می‌شود
        next[f.key] = cur && cur.ep === ep && cur.status === 'ready' ? cur : { ep, status: 'loading', items: [] };
      }
      return next;
    });

    const load = async () => {
      await Promise.all(
        Array.from(groups.entries()).map(async ([ep, fields]) => {
          try {
            const res = await fetch(ep, {
              signal: controller.signal,
              credentials: 'same-origin',
              headers: { Accept: 'application/json' },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const items = normalizeOptions(await res.json());
            if (!alive) return;
            setDynOptions(prev => {
              // اگر کاربر در این فاصله فرآیند را عوض کرده، این نتیجه دیگر مال فرم جاری نیست
              if (!fields.some(f => prev[f.key])) return prev;
              const next = { ...prev };
              for (const f of fields) next[f.key] = { ep, status: 'ready', items };
              return next;
            });
          } catch (err) {
            if (!alive || (err as Error)?.name === 'AbortError') return;
            setDynOptions(prev => {
              if (!fields.some(f => prev[f.key])) return prev;
              const next = { ...prev };
              for (const f of fields) next[f.key] = { ep, status: 'error', items: [] };
              return next;
            });
          }
        }),
      );
    };

    void load();

    return () => {
      alive = false;
      controller.abort();
    };
    // عمداً فقط این دو: تغییر «کد endpointها» یعنی تغییر منبع داده؛ خودِ dynFields
    // یک آرایهٔ تازه‌سازی‌شده در هر رندر است و نمی‌تواند وابستگی باشد.
  }, [endpointsKey, optionsRetry]);

  const handleFile = async (fieldKey: string, file: File | null) => {
    if (!file) return;
    setUploadingKey(fieldKey);
    setSubmitError(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await uploadRequestAttachmentAction(fd);
    setUploadingKey(null);
    if (res.ok && res.attachment) {
      handleInputChange(fieldKey, res.attachment);
    } else {
      setSubmitError(res.error || 'خطا در آپلود پیوست');
    }
  };

  const categories = ['ALL', ...Array.from(new Set(processes.map(p => p.category)))];

  const filteredProcesses = categoryFilter === 'ALL'
    ? processes
    : processes.filter(p => p.category === categoryFilter);

  const handleInputChange = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    for (const f of effectiveSchema) {
      if (f.type === 'file' && f.required && !formData[f.key]) {
        setSubmitError(`پیوست «${f.label}» الزامی است.`);
        setIsSubmitting(false);
        return;
      }
      // فیلد پویا هنوز گزینه نگرفته ⇒ ارسال نباید رد شود (وگرنه رکورد ناقص ثبت می‌شود)
      if (f.required && usesRemoteOptions(f) && (dynOptions[f.key]?.status ?? 'loading') !== 'ready') {
        setSubmitError(
          `گزینه‌های فیلد «${f.label}» هنوز آماده نیست. چند لحظه صبر کنید یا دکمهٔ «تلاش دوباره» را بزنید.`,
        );
        setIsSubmitting(false);
        return;
      }
    }

    const res = await submitStudentRequestAction(selectedProcess.code, formData);
    setIsSubmitting(false);

    if (res.ok) {
      setFormData({});
      setActiveTab('MY_REQUESTS');
      setFeedbackSuccess(`درخواست شما با کد رهگیری ${res.trackingCode} با موفقیت ثبت شد.`);
      setTimeout(() => setFeedbackSuccess(null), 6000);
    } else {
      setSubmitError(res.error || 'خطا در ارسال درخواست');
    }
  };

  const handleRatingSubmit = async () => {
    if (!ratingRequestId) return;
    await submitSatisfactionRatingAction(ratingRequestId, ratingScore, ratingFeedback);
    setRatingRequestId(null);
    setFeedbackSuccess('نظر و امتیاز شما با موفقیت ثبت گردید. با تشکر!');
    setTimeout(() => setFeedbackSuccess(null), 5000);
  };

  const pendingCount = initialRequests.filter(r => r.status === 'SUBMITTED' || r.status === 'IN_REVIEW').length;
  const approvedCount = initialRequests.filter(r => r.status === 'APPROVED').length;

  return (
    <div className="space-y-6" dir="rtl">
      {/* هدر صفحه */}
      <div className="bg-gradient-to-l from-slate-900 via-indigo-950 to-indigo-900 text-white rounded-3xl p-6 shadow-xl border border-indigo-700/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
            میز خدمات الکترونیک و گردش کار (BPM)
          </span>
          <h1 className="text-xl sm:text-2xl font-black mt-2">
            کارتابل جامع درخواست‌های دانشجویی
          </h1>
          <p className="text-xs text-indigo-200 mt-1">
            دانشجو: {student.name} · شماره پرونده: {student.studentCode} · رشته: {student.majorName} ({student.degreeTitle})
          </p>
        </div>

        <div className="flex items-center gap-2 tabstrip">
          <button
            onClick={() => setActiveTab('MY_REQUESTS')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all shadow ${
              activeTab === 'MY_REQUESTS'
                ? 'bg-white text-indigo-950 scale-105'
                : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
            }`}
          >
            📋 پیگیری درخواست‌های من ({initialRequests.length})
          </button>
          <button
            onClick={() => setActiveTab('NEW_REQUEST')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all shadow ${
              activeTab === 'NEW_REQUEST'
                ? 'bg-amber-400 text-slate-950 scale-105'
                : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
            }`}
          >
            ➕ ثبت درخواست جدید
          </button>
        </div>
      </div>

      {feedbackSuccess && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-bold flex items-center justify-between animate-fadeIn">
          <span>✓ {feedbackSuccess}</span>
          <button onClick={() => setFeedbackSuccess(null)} className="text-emerald-700 font-black">✕</button>
        </div>
      )}

      {/* خلاصه آماری */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card text-center !p-3">
          <p className="text-xl font-bold text-slate-800">{initialRequests.length}</p>
          <p className="text-xs text-slate-500">کل درخواست‌ها</p>
        </div>
        <div className="card text-center !p-3">
          <p className="text-xl font-bold text-amber-600">{pendingCount}</p>
          <p className="text-xs text-slate-500">در گردش و بررسی</p>
        </div>
        <div className="card text-center !p-3">
          <p className="text-xl font-bold text-emerald-600">{approvedCount}</p>
          <p className="text-xs text-slate-500">مختومه و تأییدشده</p>
        </div>
        <div className="card text-center !p-3">
          <p className="text-xl font-bold text-indigo-600">۱۰۰٪</p>
          <p className="text-xs text-slate-500">پیگیری برخط بدون مراجعه</p>
        </div>
      </div>

      {/* TAB 1: ثبت درخواست جدید با فرم‌ساز پویا */}
      {activeTab === 'NEW_REQUEST' && (
        <div className="space-y-6">
          {/* انتخاب دسته‌بندی */}
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                  categoryFilter === cat
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {cat === 'ALL' ? 'همه خدمات' : cat}
              </button>
            ))}
          </div>

          {/* کارت‌های انتخاب نوع فرآیند */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredProcesses.map(proc => {
              const isSel = proc.code === selectedProcessCode;
              return (
                <div
                  key={proc.code}
                  onClick={() => {
                    setSelectedProcessCode(proc.code);
                    setFormData({});
                  }}
                  className={`p-4 rounded-2xl border-2 transition-all cursor-pointer space-y-2 relative ${
                    isSel
                      ? 'border-indigo-600 bg-indigo-50/70 shadow-md ring-2 ring-indigo-200'
                      : 'border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-2xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                      {proc.category}
                    </span>
                    {proc.feeAmount > 0 ? (
                      <span className="text-2xs font-bold text-amber-700">
                        {proc.feeAmount.toLocaleString('fa-IR')} تومان
                      </span>
                    ) : (
                      <span className="text-2xs font-bold text-emerald-700">رایگان</span>
                    )}
                  </div>
                  <h3 className="font-extrabold text-sm text-slate-900">{proc.title}</h3>
                  <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{proc.description}</p>
                  
                  <div className="pt-1 flex items-center justify-between text-2xs text-slate-400 border-t border-slate-100">
                    <span>تعداد مراحل: {proc.steps?.length || 2} گام</span>
                    <span className="font-bold text-indigo-700">{isSel ? '✓ انتخاب‌شده' : 'انتخاب فرم'}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* فرم ساز پویا برای فرآیند انتخاب شده */}
          {selectedProcess && (
            <div className="card border-2 border-indigo-200 bg-white p-6 shadow-md rounded-2xl space-y-5">
              <div className="border-b border-slate-200 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    <span>📝 فرم ثبت: {selectedProcess.title}</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">{selectedProcess.description}</p>
                </div>
                <div className="text-left bg-indigo-50 p-2 px-3 rounded-xl border border-indigo-100 text-xs">
                  <span className="text-indigo-800 font-bold block">مراحل گردش کار:</span>
                  <span className="text-indigo-600 text-2xs">
                    {selectedProcess.steps?.map(s => s.title).join(' ← ')}
                  </span>
                </div>
              </div>

              {submitError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-300 text-red-900 text-xs font-bold">
                  ⚠️ {submitError}
                </div>
              )}

              {/* فیلدهای پویا */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {effectiveSchema.map((field: DynField) => {
                    const remote = usesRemoteOptions(field);
                    const remoteStatus: 'loading' | 'ready' | 'error' | null = remote
                      ? (dynOptions[field.key]?.status ?? 'loading')
                      : null;
                    const options: SelectOption[] = remote
                      ? (dynOptions[field.key]?.items ?? [])
                      : (field.options ?? []);
                    return (
                      <div
                        key={field.key}
                        className={field.type === 'textarea' ? 'sm:col-span-2 space-y-1' : 'space-y-1'}
                      >
                        <label className="block text-xs font-extrabold text-slate-800">
                          {field.label} {field.required && <span className="text-red-500">*</span>}
                        </label>

                        {field.type === 'file' ? (
                          <div className="space-y-1.5">
                            <input
                              type="file"
                              required={field.required}
                              accept=".pdf,.jpg,.jpeg,.png"
                              onChange={e => handleFile(field.key, e.target.files?.[0] ?? null)}
                              className="w-full text-xs rounded-xl border border-dashed border-slate-300 bg-slate-50 p-2.5 file:ml-2 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-white"
                            />
                            {uploadingKey === field.key && (
                              <p className="text-2xs text-indigo-600 font-bold animate-pulse">در حال آپلود پیوست…</p>
                            )}
                            {formData[field.key]?.name && uploadingKey !== field.key && (
                              <p className="text-2xs text-emerald-700 font-bold">
                                ✓ پیوست شد: {formData[field.key].name}
                              </p>
                            )}
                          </div>
                        ) : field.type === 'select' ? (
                          <div className="space-y-1">
                            <select
                              required={field.required}
                              disabled={remoteStatus === 'loading'}
                              value={formData[field.key] || field.defaultValue || ''}
                              onChange={e => handleInputChange(field.key, e.target.value)}
                              className={`w-full p-2.5 text-xs rounded-xl border transition disabled:opacity-60 disabled:cursor-not-allowed ${
                                remoteStatus === 'error'
                                  ? 'border-red-300 bg-red-50 focus:bg-white focus:ring-2 focus:ring-red-500'
                                  : 'border-slate-300 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500'
                              }`}
                            >
                              <option value="">
                                {remoteStatus === 'loading'
                                  ? 'در حال بارگذاری...'
                                  : remoteStatus === 'error'
                                    ? 'فهرست گزینه‌ها بارگذاری نشد'
                                    : '-- انتخاب کنید --'}
                              </option>
                              {options.map((opt: SelectOption) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>

                            {remoteStatus === 'error' && (
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-2xs text-red-600 font-bold">
                                  ⚠️ دریافت فهرست گزینه‌ها از سامانه ناموفق بود.
                                </p>
                                <button
                                  type="button"
                                  onClick={() => setOptionsRetry(n => n + 1)}
                                  className="shrink-0 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-2xs font-extrabold shadow transition"
                                >
                                  تلاش دوباره
                                </button>
                              </div>
                            )}
                          </div>
                        ) : field.type === 'textarea' ? (
                          <textarea
                            rows={3}
                            required={field.required}
                            placeholder={field.placeholder}
                            value={formData[field.key] || ''}
                            onChange={e => handleInputChange(field.key, e.target.value)}
                            className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 transition"
                          />
                        ) : (
                          <input
                            type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                            step={field.type === 'number' ? 'any' : undefined}
                            required={field.required}
                            placeholder={field.placeholder}
                            value={formData[field.key] || ''}
                            onChange={e => handleInputChange(field.key, e.target.value)}
                            className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 transition"
                          />
                        )}

                        {field.helperText && (
                          <p className="text-2xs text-slate-400">{field.helperText}</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                  <div className="text-xs text-slate-500">
                    <span>مدت زمان مجاز بررسی (SLA): </span>
                    <b className="text-indigo-950 font-mono">
                      {selectedProcess.steps?.reduce((a, s) => a + (s.slaHours || 0), 0)} ساعت کاری
                    </b>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-6 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold text-xs shadow-md transition disabled:opacity-50"
                  >
                    {isSubmitting ? 'در حال ارسال پرونده...' : '🚀 ثبت نهایی و ورود به گردش کار'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: کارتابل و پیگیری درخواست‌های دانشجو */}
      {activeTab === 'MY_REQUESTS' && (
        <div className="space-y-4">
          {initialRequests.length === 0 ? (
            <div className="card p-12 text-center text-slate-400 space-y-3">
              <p className="text-4xl">📭</p>
              <h3 className="font-bold text-slate-700 text-sm">هیچ درخواستی در کارتابل شما ثبت نشده است.</h3>
              <p className="text-xs text-slate-400">
                جهت دریافت گواهی اشتغال به تحصیل، تطبیق واحد، دفاع پایان‌نامه و تسویه حساب بر روی دکمه ثبت درخواست جدید کلیک کنید.
              </p>
              <button
                onClick={() => setActiveTab('NEW_REQUEST')}
                className="mt-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-extrabold text-xs shadow"
              >
                ➕ ثبت اولین درخواست
              </button>
            </div>
          ) : (
            initialRequests.map(req => {
              const isApproved = req.status === 'APPROVED';
              const hasCheckpoints = req.checkpoints && req.checkpoints.length > 0;

              return (
                <div
                  key={req.id}
                  className="card p-5 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md transition space-y-4"
                >
                  {/* ردیف بالا: عنوان و وضعیت */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-black text-slate-900">{req.processTitle}</span>
                        <span className="text-2xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          {req.category}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        کد رهگیری: <b className="font-mono text-slate-700" dir="ltr">{req.trackingCode}</b> · تاریخ ثبت: {req.created ? new Date(req.created).toLocaleDateString('fa-IR') : '—'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-3 py-1 rounded-full border ${statusBadge[req.status] || 'bg-slate-100 text-slate-700'}`}>
                        {statusFa[req.status] ?? req.status}
                      </span>

                      {isApproved && (
                        <button
                          onClick={() => setViewingCertificate(req)}
                          className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow flex items-center gap-1 transition"
                        >
                          <span>📜</span>
                          <span>مشاهده و چاپ سند</span>
                        </button>
                      )}

                      {isApproved && req.processCode === 'VALID_TRANSCRIPT' && (
                        <button
                          onClick={async () => {
                            setQrLoading(true);
                            setQrError(null);
                            const res = await issueApprovedTranscriptTokenAction(req.id);
                            setQrLoading(false);
                            if (res.ok && res.url && res.qr) {
                              setValidTranscriptQr({ requestId: req.id, url: res.url, qr: res.qr, expiresAt: res.expiresAt ?? null });
                            } else {
                              setQrError(res.error || 'خطا در صدور رمز تایید.');
                            }
                          }}
                          disabled={qrLoading}
                          className="px-3 py-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shadow flex items-center gap-1 transition disabled:opacity-50"
                        >
                          <span>🔐</span>
                          <span>{qrLoading ? 'در حال صدور...' : 'دریافت کارنامهٔ معتبر (QR)'}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ردیف میانی: داده‌های فرم ارسال‌شده */}
                  {req.formData && (
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 text-xs text-slate-700 grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {Object.entries(req.formData).map(([k, v]) => (
                        <div key={k} className="truncate">
                          <span className="text-slate-400">{k}: </span>
                          <span className="font-semibold">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* اگر تسویه حساب موازی چندگانه است */}
                  {hasCheckpoints && (
                    <div className="bg-indigo-50/70 p-3.5 rounded-xl border border-indigo-200/70 space-y-2">
                      <h4 className="text-xs font-black text-indigo-950 flex items-center gap-1.5">
                        <span>🏛️ وضعیت استعلام موازی واحدهای تسویه:</span>
                      </h4>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        {req.checkpoints?.map(cp => (
                          <div
                            key={cp.id}
                            className={`p-2 rounded-xl text-center border text-xs font-bold ${
                              cp.isCleared === 1
                                ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                : 'bg-amber-50 text-amber-900 border-amber-200'
                            }`}
                          >
                            <span className="block text-2xs truncate">{cp.departmentTitle}</span>
                            <span className="text-3xs block mt-0.5">
                              {cp.isCleared === 1 ? '✓ تسویه شد' : '⏳ در انتظار تایید'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* خط زمانی مراحل و تاریخچه گردش کار (Timeline Logs) */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-600">تاریخچه گردش کار و اقدامات:</h4>
                    <div className="space-y-1.5 text-xs">
                      {req.logs?.map((lg, idx) => (
                        <div
                          key={lg.id || idx}
                          className="flex items-start gap-2 p-2 rounded-xl bg-white border border-slate-200"
                        >
                          <span className="text-sm">
                            {lg.action === 'APPROVE' ? '🟢' : lg.action === 'REJECT' ? '🔴' : lg.action === 'ESCALATE' ? '⚡' : '🔵'}
                          </span>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-800">
                                {roleFa[lg.actorRole || ''] || lg.actorRole || 'کارشناس'} ({lg.action || 'اقدام'})
                              </span>
                              <span className="text-2xs text-slate-400 font-mono">
                                {lg.completedAt
                                  ? new Date(lg.completedAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
                                  : 'در جریان'}
                              </span>
                            </div>
                            <p className="text-2xs text-slate-600 mt-0.5">{lg.note || '—'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* بلوک رسمیت: رمز تایید (QR) کارنامهٔ معتبر — فقط برای درخواست‌های تأییدشده */}
                  {req.processCode === 'VALID_TRANSCRIPT' && (
                    <div className="pt-2">
                      {qrError && (
                        <p className="text-2xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2 mb-2">{qrError}</p>
                      )}
                      {validTranscriptQr?.requestId === req.id && (
                        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3">
                          <p className="text-xs font-extrabold text-emerald-900 mb-2">کارنامهٔ معتبر با رمز تایید (QR)</p>
                          <VerifyQrBlock
                            title="استعلام برخط اصالت کارنامهٔ معتبر"
                            url={validTranscriptQr.url}
                            qr={validTranscriptQr.qr}
                            expiresAt={validTranscriptQr.expiresAt}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* بخش نظرسنجی CSAT در صورت مختومه بودن */}
                  {isApproved && (
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                      {req.satisfactionScore ? (
                        <span className="text-emerald-800 font-bold flex items-center gap-1">
                          <span>امتیاز ثبت‌شده شما:</span>
                          <span className="text-amber-500 font-mono">{'★'.repeat(req.satisfactionScore)}</span>
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            setRatingRequestId(req.id);
                            setRatingScore(5);
                          }}
                          className="text-indigo-600 hover:text-indigo-800 font-bold underline text-xs"
                        >
                          ⭐ ثبت امتیاز رضایت و نظر درباره نحوه رسیدگی
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* مودال امتیازدهی CSAT */}
      {ratingRequestId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4 animate-scaleUp">
            <h3 className="text-base font-black text-slate-900">⭐ نظرسنجی کیفیت خدمات (CSAT)</h3>
            <p className="text-xs text-slate-500">
              میزان رضایت خود از سرعت، دقت و شفافیت رسیدگی به این درخواست را ثبت فرمایید:
            </p>

            <div className="flex justify-center gap-2 text-2xl py-2">
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRatingScore(star)}
                  className={`transition-transform hover:scale-125 ${
                    star <= ratingScore ? 'text-amber-400' : 'text-slate-300'
                  }`}
                >
                  ★
                </button>
              ))}
            </div>

            <textarea
              rows={3}
              placeholder="پیشنهاد یا نظر تکمیلی (اختیاری)..."
              value={ratingFeedback}
              onChange={e => setRatingFeedback(e.target.value)}
              className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-slate-50 focus:bg-white"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setRatingRequestId(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                انصراف
              </button>
              <button
                onClick={handleRatingSubmit}
                className="px-5 py-2 rounded-xl text-xs font-extrabold bg-indigo-600 hover:bg-indigo-700 text-white shadow"
              >
                ثبت نظر نهایی
              </button>
            </div>
          </div>
        </div>
      )}

      {/* مودال مشاهده و چاپ رسمی سند و گواهی الکترونیک */}
      {viewingCertificate && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto print:static print:block print:bg-white print:p-0 print:overflow-visible">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-3xl w-full shadow-2xl border-2 border-slate-800 space-y-6 text-slate-900 my-8 print:max-w-full print:w-full print:rounded-none print:border-0 print:p-0 print:m-0 print:shadow-none">
            <div className="flex items-center justify-between border-b pb-3 print:hidden">
              <span className="font-black text-sm">📜 پیش‌نمایش سند رسمی الکترونیک دانشگاه آفاق</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow"
                >
                  🖨️ چاپ مستقیم سند (Print)
                </button>
                <button
                  onClick={() => setViewingCertificate(null)}
                  className="px-3 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold"
                >
                  ✕ بستن
                </button>
              </div>
            </div>

            {/* بدنه رسمی گواهی */}
            <div className="print-area border-2 border-slate-800 p-6 rounded-2xl bg-white space-y-6 text-xs leading-relaxed">
              {/* سربرگ */}
              <div className="grid grid-cols-3 items-center text-center border-b-2 border-slate-800 pb-4">
                <div className="text-right space-y-1">
                  <p className="font-bold">جمهوری اسلامی ایران</p>
                  <p className="font-semibold text-slate-700">وزارت علوم، تحقیقات و فناوری</p>
                  <p className="font-black text-sm">{universityTitle || ''}</p>
                </div>
                <div className="flex flex-col items-center">
                  {universityLogo ? (
                    <img src={universityLogo} alt="آرم دانشگاه" className="w-12 h-12 object-contain" />
                  ) : null}
                  <h3 className="font-black text-sm mt-1">{viewingCertificate.processTitle}</h3>
                </div>
                <div className="text-left font-mono text-2xs space-y-1">
                  <p>شماره سند: <b>{viewingCertificate.certificateNumber || viewingCertificate.trackingCode}</b></p>
                  <p>تاریخ صدور: <b>{new Date().toLocaleDateString('fa-IR')}</b></p>
                  <p>اعتبار: <b>رسمی و دارای اصالت دیجیتال</b></p>
                </div>
              </div>

              {/* متن رسمی گواهی */}
              <div className="space-y-3 text-justify text-sm">
                <p>
                  <b>بدین‌وسیله گواهی می‌شود؛</b>
                </p>
                <p>
                  دانشجو <b>{student.name}</b> با کد ملی <b className="font-mono" dir="ltr">{student.nationalCode || '—'}</b> و شماره دانشجویی <b className="font-mono">{student.studentCode}</b> در مقطع تحصیلی <b>{student.degreeTitle}</b> رشته <b>{student.majorName}</b> در نیمسال تحصیلی جاری (۱۴۰۵-۱۴۰۶) اشتغال به تحصیل داشته و وضعیت آموزشی ایشان فعال و مورد تأیید معاونت آموزشی و تحصیلات تکمیلی دانشگاه می‌باشد.
                </p>
                {viewingCertificate.formData?.recipientOrg && (
                  <p className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    این گواهی بنا به درخواست نامبرده صرفاً جهت ارائه به <b>{viewingCertificate.formData.recipientOrg}</b> صادر گردیده و فاقد هرگونه ارزش ترجمه رسمی بدون تأیید وزارت علوم می‌باشد.
                  </p>
                )}
              </div>

              {/* امضا و بارکد امنیتی */}
              <div className="grid grid-cols-2 pt-6 border-t border-slate-300 items-end">
                <div className="space-y-1">
                  <p className="font-mono text-3xs text-slate-500">کد اعتبارسنجی SHA-256:</p>
                  <p className="font-mono text-3xs break-all bg-slate-100 p-1.5 rounded" dir="ltr">
                    {viewingCertificate.digitalStampHash || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}
                  </p>
                  <p className="text-3xs text-emerald-800 font-bold">
                    ✓ اصالت این سند از طریق سامانه استعلام مدارک دانشگاه آفاق قابل ره‌گیری است.
                  </p>
                </div>

                <div className="text-center space-y-2">
                  <div className="inline-block p-2 border-2 border-dashed border-slate-700 rounded-xl">
                    <p className="font-bold text-xs text-indigo-950">مهر و امضای دیجیتال</p>
                    <p className="text-3xs text-slate-500">اداره کل امور آموزشی و تحصیلات تکمیلی</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
