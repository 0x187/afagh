'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ENTRY_METHODS } from '@/lib/entry-methods';
import { ClientTh, useClientTable, type ColumnDef } from '@/components/DataTable';
import {
  importStagedStudentsAction,
  registerManualStudentAction,
  saveSanjeshMappingAction,
  saveStudentIdFormulaAction,
  stageSanjeshDataAction,
  testIrandocCheckAction,
} from './actions';

interface StagingItem {
  id: number;
  nationalCode: string;
  fullName: string | null;
  mappedMajorId: number | null;
  mappedMajorName: string | null;
  status: string | null;
  quotaType: string | null;
  studentId: number | null;
  mobile: string | null;
  rawSanjeshData: {
    firstName?: string;
    lastName?: string;
    sanjeshCode?: string;
    quota?: string;
    rank?: number;
    mobile?: string;
    examType?: string;
    degreeLevel?: string;
    majorGroup?: string;
    universityCode?: string;
  };
}

interface SanjeshMappingItem {
  id: number;
  sanjeshCode: string;
  internalMajorId: number | null;
  majorName?: string;
  sanjeshQuota: string | null;
}

interface MajorOption {
  id: number;
  name: string;
  majorCode: string | null;
  degreeLevelId: number | null;
}

interface DegreeLevelOption {
  id: number;
  title: string;
  code: string;
}

interface FormulaItem {
  degreeLevelId: number | null;
  degreeTitle?: string;
  formula: string;
  currentSequence: number | null;
}

interface ApiAuditItem {
  id: number;
  serviceName: string;
  requestUrl: string;
  responseStatus: number | null;
  durationMs: number | null;
  isSuccess: number | null;
  executedAt: string | null;
}

interface AdmissionsClientProps {
  stagingList: StagingItem[];
  mappings: SanjeshMappingItem[];
  majors: MajorOption[];
  degreeLevels: DegreeLevelOption[];
  formulas: FormulaItem[];
  apiLogs: ApiAuditItem[];
}

const SAMPLE_SANJESH_RAW = `0011223344, علیرضا, پیروزمند, 11204, منطقه ۱, 09121111111, 1420, کنکور, کارشناسی, مهندسی, 1
0022334455, نگین, شجاعی, 11205, منطقه ۲, 09122222222, 2150, کنکور, کارشناسی, مهندسی, 1
0033445566, سهراب, کیانی, 11301, منطقه ۱, 09123333333, 980, کنکور, کارشناسی, مهندسی, 1
0044556677, آناهیتا, کریمی, 99999, سهمیه ایثارگران, 09124444444, 4500, آزاد, کارشناسی ارشد, مدیریت, 2
0055667788, بابک, معتمدی, 11402, منطقه ۳, 09125555555, 3100, کنکور, کارشناسی, علوم پایه, 1`;

export default function AdmissionsClient({
  stagingList: initialStaging,
  mappings: initialMappings,
  majors,
  degreeLevels,
  formulas: initialFormulas,
  apiLogs: initialApiLogs,
}: AdmissionsClientProps) {
  const [activeTab, setActiveTab] = useState<'SANJESH_STAGING' | 'ID_FORMULA' | 'MANUAL_ADMISSION' | 'IRANDOC_TEST'>('SANJESH_STAGING');
  
  // Tab 1: Sanjesh Staging — خالی شروع می‌شود (نمونه فقط به‌صورت «قالب» قابل مشاهده است)
  const [rawText, setRawText] = useState<string>('');
  const [stagingList, setStagingList] = useState<StagingItem[]>(initialStaging);

  // جدول داوطلبان: سورت + فیلتر هر ستون
  const STAGING_COLS: ColumnDef<StagingItem>[] = [
    { key: 'nationalCode', label: 'کد ملی', get: s => s.nationalCode },
    { key: 'fullName', label: 'نام و نام خانوادگی', get: s => s.fullName ?? '' },
    { key: 'sanjeshCode', label: 'کد رشته سنجش', get: s => s.rawSanjeshData?.sanjeshCode ?? '' },
    { key: 'examType', label: 'نوع آزمون', get: s => s.rawSanjeshData?.examType ?? '' },
    { key: 'degreeLevel', label: 'مقطع تحصیلی', get: s => s.rawSanjeshData?.degreeLevel ?? '' },
    { key: 'majorGroup', label: 'گروه رشته', get: s => s.rawSanjeshData?.majorGroup ?? '' },
    { key: 'major', label: 'رشته تطبیق‌یافته دانشگاه', get: s => s.mappedMajorName ?? '' },
    { key: 'quota', label: 'سهمیه پذیرش', get: s => s.rawSanjeshData?.quota ?? s.quotaType ?? '' },
    { key: 'universityCode', label: 'کد دانشگاه', get: s => s.rawSanjeshData?.universityCode ?? '' },
    { key: 'status', label: 'وضعیت تطبیق', get: s => s.status ?? '' },
  ];
  const stagingTable = useClientTable(stagingList, STAGING_COLS);
  const [mappingsList, setMappingsList] = useState<SanjeshMappingItem[]>(initialMappings);
  const [isStaging, setIsStaging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importEntryMethod, setImportEntryMethod] = useState<string>('');
  const [importAllowDuplicates, setImportAllowDuplicates] = useState(false);

  // ── نگاشت «کد رشتهٔ سنجش» → «رشتهٔ دانشگاه» ─────────────────────────────
  // هر ردیفِ «نیازمند نگاشت» یک کد رشتهٔ سنجش دارد؛ نگاشت یک کد، همهٔ
  // ردیف‌های همان کد را به RESOLVED می‌برد (اکشن خودش این کار را می‌کند).
  const router = useRouter();
  const [mapSel, setMapSel] = useState<Record<string, string>>({});
  const [mappingBusy, setMappingBusy] = useState<string | null>(null);

  /** کدهای رشتهٔ سنجشِ موجود در صف، با تعداد و عنوان گروه رشته */
  const sanjeshCodeGroups = useMemo(() => {
    const map = new Map<string, { code: string; group: string; degree: string; count: number }>();
    for (const st of stagingList) {
      const code = (st.rawSanjeshData?.sanjeshCode ?? '').trim();
      if (!code) continue;
      const cur = map.get(code);
      if (cur) cur.count++;
      else
        map.set(code, {
          code,
          group: st.rawSanjeshData?.majorGroup ?? '',
          degree: st.rawSanjeshData?.degreeLevel ?? '',
          count: 1,
        });
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  }, [stagingList]);

  /** رشته‌های متناسب با مقطعِ ردیف (اگر مقطع شناسا نبود، همهٔ رشته‌ها) */
  const majorsFor = (degreeTitle: string): MajorOption[] => {
    const dl = degreeLevels.find(d => d.title.trim() === degreeTitle.trim() || d.code === degreeTitle.trim());
    if (!dl) return majors;
    const filtered = majors.filter(m => m.degreeLevelId === dl.id);
    return filtered.length > 0 ? filtered : majors;
  };

  const handleMapMajor = async (sanjeshCode: string, majorIdRaw: string) => {
    const majorId = Number(majorIdRaw);
    if (!Number.isFinite(majorId) || majorId <= 0) return;
    const majorName = majors.find(m => m.id === majorId)?.name ?? '';
    setMappingBusy(sanjeshCode);
    const res = await saveSanjeshMappingAction(sanjeshCode, majorId);
    setMappingBusy(null);
    if (!res.ok) {
      setFeedback({ text: res.error || 'خطا در ذخیرهٔ نگاشت.', type: 'error' });
      return;
    }
    // بازخورد فوری + همگام‌سازی با دادهٔ سرور
    setStagingList(prev =>
      prev.map(s =>
        s.status === 'PENDING_MAPPING' && (s.rawSanjeshData?.sanjeshCode ?? '').trim() === sanjeshCode
          ? { ...s, status: 'RESOLVED', mappedMajorId: majorId, mappedMajorName: majorName }
          : s,
      ),
    );
    setMappingsList(prev => {
      const rest = prev.filter(m => m.sanjeshCode !== sanjeshCode);
      return [...rest, { id: prev.find(m => m.sanjeshCode === sanjeshCode)?.id ?? -1, sanjeshCode, internalMajorId: majorId, majorName, sanjeshQuota: 'سهمیه عادی' }];
    });
    setMapSel(p => ({ ...p, [sanjeshCode]: majorIdRaw }));
    setFeedback({ text: `نگاشت «${majorName}» برای کد رشتهٔ ${sanjeshCode} ثبت شد.`, type: 'success' });
    router.refresh();
  };

  // همگام‌سازی state با دادهٔ تازهٔ سرور (پس از router.refresh یا ناوبری)
  useEffect(() => {
    setStagingList(initialStaging);
    setMappingsList(initialMappings);
  }, [initialStaging, initialMappings]);

  // Tab 2: Formula Builder
  const [selectedDegreeId, setSelectedDegreeId] = useState<number>(degreeLevels[0]?.id || 1);
  const [formulaPattern, setFormulaPattern] = useState<string>('{Year:2}{DegreeCode:1}{MajorCode:3}{Seq:3}');
  const [simYear, setSimYear] = useState<number>(1405);
  const [simMajorCode, setSimMajorCode] = useState<string>('412');
  const [simSeq, setSimSeq] = useState<number>(15);

  // Tab 3: Manual Admission
  const [manualForm, setManualForm] = useState({
    nationalCode: '',
    firstName: '',
    lastName: '',
    mobile: '',
    majorId: majors[0]?.id || 1,
    degreeLevelId: degreeLevels[0]?.id || 1,
    admissionType: 'NORMAL' as const,
    quotaType: 'NORMAL',
  });
  const [isManualSubmitting, setIsManualSubmitting] = useState(false);

  // Tab 4: Irandoc Plagiarism Tester
  const [irandocForm, setIrandocForm] = useState({
    nationalCode: '1010101010',
    trackingCode: 'IRAN-1405-9921',
    thesisTitle: 'طراحی سیستم هوشمند تطبیق خودکار واحدهای دانشگاهی بر پایه هوش مصنوعی',
    threshold: 20,
  });
  const [irandocResult, setIrandocResult] = useState<any>(null);
  const [isTestingIrandoc, setIsTestingIrandoc] = useState(false);

  // پیام‌ها
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' | 'warning' } | null>(null);

  // پردازش فایل سنجش
  const handleStageRawText = async () => {
    setIsStaging(true);
    const res = await stageSanjeshDataAction(rawText, 1405);
    setIsStaging(false);
    if (res.ok) {
      setFeedback({ text: `${res.count} رکورد از فایل سازمان سنجش با موفقیت استخراج و در صف بررسی قرار گرفت.`, type: 'success' });
      setTimeout(() => setFeedback(null), 5000);
    } else {
      setFeedback({ text: res.error || 'خطا در پردازش', type: 'error' });
    }
  };

  // ثبت‌نام دسته‌جمعی پذیرفته‌شدگان
  const handleBatchImport = async () => {
    const resolvedIds = stagingList.filter(s => s.status === 'RESOLVED').map(s => s.id);
    if (resolvedIds.length === 0) {
      setFeedback({ text: 'هیچ رکورد تطبیق‌یافته‌ای (RESOLVED) جهت ثبت‌نام وجود ندارد.', type: 'error' });
      return;
    }

    if (!importEntryMethod) {
      setFeedback({ text: 'ابتدا «روش ورود» را برای این گروه انتخاب کنید.', type: 'error' });
      return;
    }

    setIsImporting(true);
    const res = await importStagedStudentsAction(resolvedIds, importEntryMethod, importAllowDuplicates);
    setIsImporting(false);
    if (res.ok) {
      const failNote = res.failures?.length ? ` — ${res.failures.length} رکورد ناموفق بود (به‌طور کامل برگشت داده شد؛ جزئیات در لاگ سرور).` : '';
      setFeedback({ text: `${res.count} دانشجو با موفقیت ثبت قطعی شدند و شماره دانشجویی یکتا برای آنان صادر گردید.${failNote}`, type: res.failures?.length ? 'warning' : 'success' });
      setTimeout(() => setFeedback(null), 5000);
    } else {
      setFeedback({ text: res.error || 'خطا در ثبت‌نام', type: 'error' });
    }
  };

  // ذخیره فرمول شماره دانشجویی
  const handleSaveFormula = async () => {
    const res = await saveStudentIdFormulaAction(selectedDegreeId, formulaPattern);
    if (res.ok) {
      setFeedback({ text: 'الگوی فرمول شماره دانشجویی با موفقیت ذخیره گردید.', type: 'success' });
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  // ثبت‌نام دستی
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsManualSubmitting(true);
    const res = await registerManualStudentAction(manualForm);
    setIsManualSubmitting(false);
    if (res.ok) {
      setFeedback({ text: `دانشجو ${res.student?.fullName} با شماره دانشجویی ${res.student?.studentCode} با موفقیت ثبت‌نام شد.`, type: 'success' });
      setManualForm({
        nationalCode: '',
        firstName: '',
        lastName: '',
        mobile: '',
        majorId: majors[0]?.id || 1,
        degreeLevelId: degreeLevels[0]?.id || 1,
        admissionType: 'NORMAL',
        quotaType: 'NORMAL',
      });
      setTimeout(() => setFeedback(null), 5000);
    } else {
      setFeedback({ text: res.error || 'خطا در ثبت‌نام', type: 'error' });
    }
  };

  // تست استعلام ایرانداک
  const handleTestIrandoc = async () => {
    setIsTestingIrandoc(true);
    const res = await testIrandocCheckAction({
      nationalCode: irandocForm.nationalCode,
      trackingCode: irandocForm.trackingCode,
      thesisTitle: irandocForm.thesisTitle,
      maxAllowedThreshold: Number(irandocForm.threshold),
    });
    setIsTestingIrandoc(false);
    if (res.ok) {
      setIrandocResult(res.result);
      setFeedback({ text: 'استعلام از سامانه همانندجوی ایرانداک با موفقیت انجام شد.', type: 'success' });
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  // شبیه‌سازی زنده فرمول
  const year2 = String(simYear).slice(-2);
  const degreeDigit = selectedDegreeId === 1 ? '1' : selectedDegreeId === 2 ? '2' : '3';
  const major3 = simMajorCode.padStart(3, '0').slice(-3);
  const seq3 = String(simSeq).padStart(3, '0');
  const simStudentId = formulaPattern
    .replace('{Year:2}', year2)
    .replace('{DegreeCode:1}', degreeDigit)
    .replace('{MajorCode:3}', major3)
    .replace('{Seq:3}', seq3)
    .replace('{QuotaCode:1}', '1');

  return (
    <div className="space-y-6" dir="rtl">
      {/* سربرگ صفحه */}
      <div className="bg-gradient-to-l from-slate-900 via-indigo-950 to-indigo-900 text-white rounded-3xl p-6 shadow-xl border border-indigo-700/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-400 text-slate-950">
            ماژول هسته هویتی و پذیرش (Core Admissions & Staging)
          </span>
          <h1 className="text-xl sm:text-2xl font-black mt-2">
            سامانه پذیرش سنجش، نگاشت کدها، فرمول‌ساز و وب‌سرویس‌ها
          </h1>
          <p className="text-xs text-indigo-200 mt-1">
            پردازش فایل متنی سازمان سنجش، ثبت‌نام دستی، فرمول شماره دانشجویی و استعلام همانندجویی ایرانداک
          </p>
        </div>

        {/* دکمه‌های ناوبری تب‌ها */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveTab('SANJESH_STAGING')}
            className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all shadow ${
              activeTab === 'SANJESH_STAGING'
                ? 'bg-white text-indigo-950 scale-105'
                : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
            }`}
          >
            📑 پذیرش سنجش و Staging
          </button>
          <button
            onClick={() => setActiveTab('ID_FORMULA')}
            className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all shadow ${
              activeTab === 'ID_FORMULA'
                ? 'bg-amber-400 text-slate-950 scale-105'
                : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
            }`}
          >
            🔢 فرمول‌ساز شماره دانشجویی
          </button>
          <button
            onClick={() => setActiveTab('MANUAL_ADMISSION')}
            className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all shadow ${
              activeTab === 'MANUAL_ADMISSION'
                ? 'bg-emerald-400 text-slate-950 scale-105'
                : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
            }`}
          >
            ➕ ثبت‌نام دستی و متفرقه
          </button>
          <button
            onClick={() => setActiveTab('IRANDOC_TEST')}
            className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all shadow ${
              activeTab === 'IRANDOC_TEST'
                ? 'bg-sky-400 text-slate-950 scale-105'
                : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
            }`}
          >
            🔍 استعلام همانندجویی ایرانداک
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-4 rounded-2xl border text-xs font-bold flex items-center justify-between animate-fadeIn ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
              : feedback.type === 'warning'
                ? 'bg-amber-50 border-amber-300 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
                : 'bg-red-50 border-red-300 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
          }`}
        >
          <span>✓ {feedback.text}</span>
          <button onClick={() => setFeedback(null)} className="font-black">✕</button>
        </div>
      )}

      {/* TAB 1: پردازش فایل متنی سنجش و Staging */}
      {activeTab === 'SANJESH_STAGING' && (
        <div className="space-y-6">
          <div className="card p-6 bg-white border border-slate-200 rounded-2xl space-y-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
              <div>
                <h2 className="text-sm font-black text-slate-900">
                  📥 بارگذاری و پردازش خطوط فایل متنی سنجش (TXT / CSV Data Staging)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  کد ملی، نام، نام خانوادگی، کد رشته سنجش، سهمیه و رتبه را در قالب متن وارد نمایید:
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleStageRawText}
                  disabled={isStaging}
                  className="px-4 py-2 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold text-xs shadow transition disabled:opacity-50"
                >
                  {isStaging ? 'در حال استخراج...' : '⚙️ پردازش و تطبیق خودکار کدها'}
                </button>
                <select
                  value={importEntryMethod}
                  onChange={e => setImportEntryMethod(e.target.value)}
                  className="px-2 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                >
                  <option value="">— روش ورود (الزامی) —</option>
                  {ENTRY_METHODS.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-[11px] text-amber-800">
                  <input
                    type="checkbox"
                    checked={importAllowDuplicates}
                    onChange={e => setImportAllowDuplicates(e.target.checked)}
                  />
                  اجازهٔ ثبت پرونده تکراری (با آگاهی)
                </label>
                <button
                  onClick={handleBatchImport}
                  disabled={isImporting}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow transition disabled:opacity-50"
                >
                  {isImporting ? 'در حال صدور شماره دانشجویی...' : '🚀 صدور شماره دانشجویی و ثبت قطعی'}
                </button>
              </div>
            </div>

            <textarea
              rows={5}
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              className="w-full p-3 font-mono text-xs rounded-xl border border-slate-300 bg-slate-50 focus:bg-white"
              placeholder="کدملی, نام, نام‌خانوادگی, کد_سنجش, سهمیه, موبایل, رتبه, نوع_آزمون, مقطع, گروه_رشته, کد_دانشگاه"
            />
            <details className="text-[11px] text-slate-500">
              <summary className="cursor-pointer font-bold text-indigo-800">مشاهدهٔ قالب نمونهٔ فایل (ساختار ستون‌ها)</summary>
              <pre className="mt-2 p-3 bg-slate-100 rounded-xl font-mono text-[10px] leading-5 overflow-x-auto whitespace-pre">{SAMPLE_SANJESH_RAW}</pre>
            </details>
          </div>

          {/* ── نگاشت رشته: کد رشتهٔ سنجش → رشتهٔ دانشگاه ── */}
          <div className="card p-6 bg-white border border-slate-200 rounded-2xl shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
              <div>
                <h2 className="text-sm font-black text-slate-900">
                  🧭 نگاشت رشته‌ها (کد رشتهٔ سنجش ← رشتهٔ دانشگاه)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  هر ردیفِ «نیازمند نگاشت» یک کد رشتهٔ سنجش دارد؛ نگاشت یک کد، همهٔ ردیف‌های همان کد را همزمان
                  «آماده ثبت‌نام» می‌کند. بعد از نگاشت، دکمهٔ «🚀 صدور شماره دانشجویی و ثبت قطعی» را بزنید.
                </p>
              </div>
              <span className="text-[11px] text-slate-500">
                {sanjeshCodeGroups.filter(g => !mappingsList.some(m => m.sanjeshCode === g.code)).length} کد بدون نگاشت
              </span>
            </div>

            {sanjeshCodeGroups.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400">هنوز رکوردی در صف نیست.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="p-2 font-bold">کد رشتهٔ سنجش</th>
                      <th className="p-2 font-bold">گروه رشته</th>
                      <th className="p-2 font-bold">مقطع</th>
                      <th className="p-2 font-bold">تعداد</th>
                      <th className="p-2 font-bold">رشتهٔ دانشگاه</th>
                      <th className="p-2 font-bold">وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sanjeshCodeGroups.map(g => {
                      const mapping = mappingsList.find(m => m.sanjeshCode === g.code);
                      const selected = mapSel[g.code] ?? (mapping?.internalMajorId ? String(mapping.internalMajorId) : '');
                      const options = majorsFor(g.degree);
                      return (
                        <tr key={g.code} className="border-t border-slate-100">
                          <td className="p-2 font-mono font-bold text-indigo-900" dir="ltr">{g.code}</td>
                          <td className="p-2 text-slate-700">{g.group || '—'}</td>
                          <td className="p-2 text-slate-600">{g.degree || '—'}</td>
                          <td className="p-2 tabular-nums text-slate-700">{g.count.toLocaleString('fa-IR')}</td>
                          <td className="p-2">
                            <select
                              value={selected}
                              onChange={e => {
                                const v = e.target.value;
                                setMapSel(p => ({ ...p, [g.code]: v }));
                                if (v) void handleMapMajor(g.code, v);
                              }}
                              className="w-full rounded-lg border border-slate-300 px-2 py-1 text-[11px] min-w-0"
                            >
                              <option value="">— انتخاب رشتهٔ دانشگاه —</option>
                              {options.map(m => (
                                <option key={m.id} value={m.id}>
                                  {m.name}{m.majorCode ? ` (${m.majorCode})` : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2">
                            {mapping?.majorName ? (
                              <span className="font-bold text-emerald-700">✓ {mapping.majorName}</span>
                            ) : mappingBusy === g.code ? (
                              <span className="text-slate-400">در حال ثبت…</span>
                            ) : (
                              <span className="text-red-600">نیازمند نگاشت</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* جدول رکوردهای در صف Staging */}
          <div className="card overflow-x-auto bg-white border border-slate-200 rounded-2xl shadow-sm">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xs font-black text-slate-800">
                جدول رکوردهای پردازش‌شده در صف بازبینی (Admissions Staging Grid)
              </h3>
              <span className="text-xs text-slate-400 font-mono">{stagingTable.visible.length} از {stagingList.length} رکورد</span>
            </div>

            <table className="w-full table-fixed text-right text-xs rt">
              <colgroup>
                <col style={{ width: 110 }} />
                <col style={{ width: 180 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 90 }} />
                <col />
                <col style={{ width: 120 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 130 }} />
              </colgroup>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold">
                  {STAGING_COLS.map(c => (
                    <ClientTh
                      key={c.key}
                      col={c}
                      sortKey={stagingTable.sortKey}
                      sortDir={stagingTable.sortDir}
                      filter={stagingTable.filters[c.key] ?? ''}
                      onSort={() => stagingTable.toggleSort(c.key)}
                      onFilter={v => stagingTable.setFilter(c.key, v)}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {stagingTable.visible.length === 0 && (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-slate-400">
                      هیچ رکوردی در صف Staging موجود نیست. بر روی «پردازش و تطبیق خودکار» کلیک کنید.
                    </td>
                  </tr>
                )}
                {stagingTable.visible.map(st => {
                  const isResolved = st.status === 'RESOLVED' || st.status === 'IMPORTED';
                  const isPending = st.status === 'PENDING_MAPPING';

                  return (
                    <tr key={st.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                      <td className="p-3 font-mono font-bold text-slate-800" dir="ltr">{st.nationalCode}</td>
                      <td className="p-3 font-semibold text-slate-900">{st.fullName}</td>
                      <td className="p-3 font-mono text-indigo-900 font-bold">{st.rawSanjeshData?.sanjeshCode || ''}</td>
                      <td className="p-3 text-slate-600 font-mono">{st.rawSanjeshData?.examType || ''}</td>
                      <td className="p-3 text-slate-600">{st.rawSanjeshData?.degreeLevel || ''}</td>
                      <td className="p-3 text-slate-600">{st.rawSanjeshData?.majorGroup || ''}</td>
                      <td className="p-3">
                        {isResolved ? (
                          <span className="font-bold text-emerald-800">{st.mappedMajorName || '—'}</span>
                        ) : (
                          <div className="flex items-center gap-1">
                            <select
                              value={mapSel[st.rawSanjeshData?.sanjeshCode ?? ''] ?? ''}
                              onChange={e => {
                                const v = e.target.value;
                                const code = (st.rawSanjeshData?.sanjeshCode ?? '').trim();
                                if (!code) return;
                                setMapSel(p => ({ ...p, [code]: v }));
                                if (v) void handleMapMajor(code, v);
                              }}
                              className="w-full rounded-lg border border-red-200 bg-red-50 px-1.5 py-1 text-[10px] min-w-0"
                            >
                              <option value="">⚠️ انتخاب رشته…</option>
                              {majorsFor(st.rawSanjeshData?.degreeLevel ?? '').map(m => (
                                <option key={m.id} value={m.id}>
                                  {m.name}{m.majorCode ? ` (${m.majorCode})` : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-slate-600">{st.rawSanjeshData?.quota || st.quotaType || 'سهمیه عادی'}</td>
                      <td className="p-3 text-slate-600 font-mono">{st.rawSanjeshData?.universityCode || ''}</td>
                      <td className="p-3">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            st.status === 'IMPORTED'
                              ? 'bg-emerald-100 text-emerald-900 border border-emerald-300 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                              : isResolved
                              ? 'bg-sky-100 text-sky-900 border border-sky-300 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200'
                              : 'bg-red-100 text-red-900 border border-red-300 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
                          }`}
                        >
                          {st.status === 'IMPORTED' ? '✓ ثبت‌نام قطعی شد' : isResolved ? 'آماده ثبت‌نام' : 'نیازمند نگاشت'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: فرمول‌ساز پویای شماره دانشجویی */}
      {activeTab === 'ID_FORMULA' && (
        <div className="card p-6 bg-white border border-slate-200 rounded-2xl space-y-6 shadow-sm">
          <div className="border-b pb-4">
            <h2 className="text-base font-black text-slate-900">
              🔢 موتور فرمول‌ساز پویای شماره دانشجویی (Dynamic Student ID Generator)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              تعریف الگو و فرمت شناسه یکتای دانشجو بدون هاردکد کردن در سیستم بر اساس متغیرهای استاندارد
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* ستون چپ: تنظیمات فرمول */}
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">مقطع تحصیلی:</label>
                <select
                  value={selectedDegreeId}
                  onChange={e => setSelectedDegreeId(Number(e.target.value))}
                  className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-slate-50 focus:bg-white"
                >
                  {degreeLevels.map(dl => (
                    <option key={dl.id} value={dl.id}>
                      {dl.title} ({dl.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">الگوی فرمول:</label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: 'سال ورود (۲ رقم)', token: '{Year:2}' },
                    { label: 'کد مقطع (۱ رقم)', token: '{DegreeCode:1}' },
                    { label: 'کد رشته (۳ رقم)', token: '{MajorCode:3}' },
                    { label: 'کد سهمیه (۱ رقم)', token: '{QuotaCode:1}' },
                    { label: 'شماره ترتیب (۳ رقم)', token: '{Seq:3}' },
                  ].map(p => (
                    <button
                      key={p.token}
                      type="button"
                      onClick={() => setFormulaPattern(v => v + p.token)}
                      className="px-2 py-1 rounded-lg border border-indigo-300 bg-white text-[11px] font-bold text-indigo-800 hover:bg-indigo-50"
                    >
                      + {p.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setFormulaPattern(v => v.replace(/\{[^}]*\}$/, ''))}
                    className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                  >
                    ↩ حذف آخرین بخش
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormulaPattern('')}
                    className="px-2 py-1 rounded-lg border border-rose-300 bg-white text-[11px] font-bold text-rose-700 hover:bg-rose-50"
                  >
                    پاک‌کردن همه
                  </button>
                </div>
                <input
                  type="text"
                  value={formulaPattern}
                  onChange={e => setFormulaPattern(e.target.value)}
                  className="w-full p-2.5 text-xs font-mono font-bold rounded-xl border border-indigo-300 bg-indigo-50/50 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-100"
                  dir="ltr"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  متغیرهای مجاز: <code className="bg-slate-100 p-0.5 rounded">{'{Year:2}'}</code>، <code className="bg-slate-100 p-0.5 rounded">{'{DegreeCode:1}'}</code>، <code className="bg-slate-100 p-0.5 rounded">{'{MajorCode:3}'}</code>، <code className="bg-slate-100 p-0.5 rounded">{'{Seq:3}'}</code>
                </p>
              </div>

              <button
                onClick={handleSaveFormula}
                className="px-5 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold text-xs shadow transition"
              >
                💾 ذخیره فرمول مقطع
              </button>
            </div>

            {/* ستون راست: شبیه‌ساز زنده خروجی فرمول */}
            <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-4 border border-slate-800">
              <h3 className="text-xs font-black text-amber-400">پیش‌نمایش خروجی زنده (Live Preview)</h3>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 block">سال ورود:</span>
                  <input
                    type="number"
                    value={simYear}
                    onChange={e => setSimYear(Number(e.target.value))}
                    className="w-full p-1.5 rounded bg-slate-800 border border-slate-700 text-xs font-mono"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">کد رشته (۳ رقم):</span>
                  <input
                    type="text"
                    value={simMajorCode}
                    onChange={e => setSimMajorCode(e.target.value)}
                    className="w-full p-1.5 rounded bg-slate-800 border border-slate-700 text-xs font-mono"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">شماره سریال:</span>
                  <input
                    type="number"
                    value={simSeq}
                    onChange={e => setSimSeq(Number(e.target.value))}
                    className="w-full p-1.5 rounded bg-slate-800 border border-slate-700 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 text-center space-y-1">
                <span className="text-[11px] text-slate-400">شماره دانشجویی تولیدشده:</span>
                <p className="text-3xl font-black font-mono tracking-widest text-emerald-400" dir="ltr">
                  {simStudentId}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">طول شناسه: {simStudentId.length} رقم یکتا</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ثبت‌نام دستی و متفرقه */}
      {activeTab === 'MANUAL_ADMISSION' && (
        <div className="card p-6 bg-white border border-slate-200 rounded-2xl space-y-6 shadow-sm">
          <div className="border-b pb-4">
            <h2 className="text-base font-black text-slate-900">
              ➕ درگاه ثبت‌نام دستی، انتقالی و اتباع خارجی (Manual & Alternative Admissions)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              ثبت مستقیم پرونده دانشجویی بدون نیاز به فایل سازمان سنجش با حفظ یکپارچگی هویتی (پلی‌مورفیسم)
            </p>
          </div>

          <form onSubmit={handleManualSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700">کد ملی / شناسه فراگیر اتباع: *</label>
              <input
                type="text"
                required
                value={manualForm.nationalCode}
                onChange={e => setManualForm({ ...manualForm, nationalCode: e.target.value })}
                className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-slate-50 font-mono"
                placeholder="۱۰۱۰۱۰۱۰۱۰"
                dir="ltr"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700">نام: *</label>
              <input
                type="text"
                required
                value={manualForm.firstName}
                onChange={e => setManualForm({ ...manualForm, firstName: e.target.value })}
                className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-slate-50"
                placeholder="احسان"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700">نام خانوادگی: *</label>
              <input
                type="text"
                required
                value={manualForm.lastName}
                onChange={e => setManualForm({ ...manualForm, lastName: e.target.value })}
                className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-slate-50"
                placeholder="صادقی"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700">شماره همراه: *</label>
              <input
                type="text"
                required
                value={manualForm.mobile}
                onChange={e => setManualForm({ ...manualForm, mobile: e.target.value })}
                className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-slate-50 font-mono"
                placeholder="09123456789"
                dir="ltr"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700">رشته تحصیلی: *</label>
              <select
                value={manualForm.majorId}
                onChange={e => setManualForm({ ...manualForm, majorId: Number(e.target.value) })}
                className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-slate-50"
              >
                {majors.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name} (کد: {m.majorCode})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700">مقطع تحصیلی: *</label>
              <select
                value={manualForm.degreeLevelId}
                onChange={e => setManualForm({ ...manualForm, degreeLevelId: Number(e.target.value) })}
                className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-slate-50"
              >
                {degreeLevels.map(dl => (
                  <option key={dl.id} value={dl.id}>
                    {dl.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-3 pt-3 border-t flex justify-end">
              <button
                type="submit"
                disabled={isManualSubmitting}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow transition disabled:opacity-50"
              >
                {isManualSubmitting ? 'در حال ثبت...' : '🚀 ثبت قطعی و ایجاد حساب یکپارچه'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 4: شبیه‌ساز و تست زنده اتصال به ایرانداک */}
      {activeTab === 'IRANDOC_TEST' && (
        <div className="space-y-6">
          <div className="card p-6 bg-white border border-slate-200 rounded-2xl space-y-4 shadow-sm">
            <div className="border-b pb-3">
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                <span>🔍 شبیه‌ساز فراخوانی وب‌سرویس همانندجویی ایرانداک (Irandoc Plagiarism Service Task)</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                تست زنده اتصال به API ایرانداک، محاسبه درصد مشابهت متون پایان‌نامه و تصمیم‌گیری خودکار گردش کار
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2 space-y-1">
                <label className="block text-xs font-bold text-slate-700">عنوان پایان‌نامه:</label>
                <input
                  type="text"
                  value={irandocForm.thesisTitle}
                  onChange={e => setIrandocForm({ ...irandocForm, thesisTitle: e.target.value })}
                  className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-slate-50"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">سقف مجاز مشابهت (درصد):</label>
                <input
                  type="number"
                  value={irandocForm.threshold}
                  onChange={e => setIrandocForm({ ...irandocForm, threshold: Number(e.target.value) })}
                  className="w-full p-2.5 text-xs font-mono font-bold rounded-xl border border-slate-300 bg-slate-50"
                />
              </div>
            </div>

            <button
              onClick={handleTestIrandoc}
              disabled={isTestingIrandoc}
              className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-extrabold text-xs shadow transition disabled:opacity-50"
            >
              {isTestingIrandoc ? 'در حال ارسال ریکوئست به ایرانداک...' : '⚡ اجرای استعلام زنده و ارزیابی شرط'}
            </button>
          </div>

          {/* نتیجه استعلام ایرانداک */}
          {irandocResult && (
            <div
              className={`card p-6 rounded-2xl border-2 space-y-4 animate-scaleUp ${
                irandocResult.decision === 'AUTO_APPROVE'
                  ? 'bg-emerald-50/80 border-emerald-400 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200'
                  : 'bg-red-50/80 border-red-400 text-red-950 dark:border-red-700 dark:bg-red-950 dark:text-red-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-black text-sm">
                  {irandocResult.decision === 'AUTO_APPROVE' ? '✓ تایید خودکار و صدور مجوز' : '⚠️ رد درخواست / نیاز به اصلاح متن'}
                </span>
                <span className="text-xs font-mono font-bold px-3 py-1 rounded-full bg-white border">
                  زمان پاسخگویی: {irandocResult.durationMs}ms
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-300/50 text-xs">
                <div>
                  <span className="text-slate-500 block">درصد مشابهت کشف‌شده:</span>
                  <p className="text-2xl font-black font-mono mt-1">
                    {irandocResult.similarityPercentage}٪
                  </p>
                </div>
                <div>
                  <span className="text-slate-500 block">سقف مجاز تحصیلات تکمیلی:</span>
                  <p className="text-2xl font-black font-mono mt-1">
                    {irandocResult.maxAllowedThreshold}٪
                  </p>
                </div>
                <div>
                  <span className="text-slate-500 block">تصمیم موتور فرآیند (Rule Engine):</span>
                  <p className="font-bold mt-2">
                    {irandocResult.decision === 'AUTO_APPROVE'
                      ? 'عبور خودکار به مرحله تایید استاد راهنما'
                      : 'توقف گردش کار و ابلاغ اصلاح به دانشجو'}
                  </p>
                </div>
              </div>

              <p className="text-xs">{irandocResult.message}</p>
            </div>
          )}

          {/* لاگ ممیزی APIها */}
          <div className="card overflow-x-auto bg-white border border-slate-200 rounded-2xl shadow-sm">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xs font-black text-slate-800">
                تاریخچه تراکنش‌ها و ممیزی وب‌سرویس‌ها (API Audit Trail)
              </h3>
              <span className="text-xs text-slate-400 font-mono">{initialApiLogs.length} فراخوانی اخیر</span>
            </div>

            <table className="w-full text-right text-xs rt">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold">
                  <th className="p-3">سرویس</th>
                  <th className="p-3">آدرس اندپوینت</th>
                  <th className="p-3">وضعیت HTTP</th>
                  <th className="p-3">زمان تاخیر</th>
                  <th className="p-3">نتیجه</th>
                </tr>
              </thead>
              <tbody>
                {initialApiLogs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-400">
                      هنوز فراخوانی در لاگ ممیزی ثبت نشده است.
                    </td>
                  </tr>
                )}
                {initialApiLogs.map(lg => (
                  <tr key={lg.id} className="border-b border-slate-100">
                    <td className="p-3 font-bold text-slate-900">{lg.serviceName}</td>
                    <td className="p-3 font-mono text-slate-600 truncate max-w-[200px]" dir="ltr">{lg.requestUrl}</td>
                    <td className="p-3 font-mono font-bold text-emerald-800">{lg.responseStatus || 200}</td>
                    <td className="p-3 font-mono text-slate-600">{lg.durationMs || 210}ms</td>
                    <td className="p-3">
                      <span className="text-emerald-700 font-bold">✓ موفق</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
