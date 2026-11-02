'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ENTRY_METHODS } from '@/lib/entry-methods';
import { bestSuggestion } from '@/lib/sanjesh/major-suggest';
import { simulateStudentId, validateFormula, degreeCodeFor, FORMULA_TOKENS } from '@/lib/student-id-formula';
import { ClientTh, useClientTable, type ColumnDef } from '@/components/DataTable';
import {
  assignStudentNumbersAction,
  finalRegisterStudentsAction,
  listExistingForStagingAction,
  setStagingDecisionAction,
  registerManualStudentAction,
  saveSanjeshMappingAction,
  saveStudentIdFormulaAction,
  saveFormulaModelAction,
  deleteFormulaModelAction,
  stageSanjeshDataAction,
  testIrandocCheckAction,
} from './actions';
import { revertImportedToResolvedAction, revertResolvedToPendingAction, revertNumberAssignedToResolvedAction, revertStagedToFieldsReadyAction, deleteSanjeshFileAction, cancelAdmissionAction } from './revert';
interface StagingItem {
  id: number;
  fileId: number | null;
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
    /** نام رشتهٔ سنجش — مبنای پیشنهاد هوشمند نگاشت */
    majorTitle?: string;
    universityCode?: string;
  };
  /** فیلدهای کامل فایل سنجش برای جدول «بازبینی و تأیید» */
  profile?: Record<string, string>;
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

interface FormulaModelItem {
  id: number;
  title: string;
  formula: string;
  note: string | null;
}

interface AdmissionsClientProps {
  stagingList: StagingItem[];
  mappings: SanjeshMappingItem[];
  majors: MajorOption[];
  degreeLevels: DegreeLevelOption[];
  formulas: FormulaItem[];
  formulaModels: FormulaModelItem[];
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
  formulaModels: initialModels,
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
  const [isAssigning, setIsAssigning] = useState(false);
  // شمارهٔ شروع سریال به‌ازای هر رشته (خالی = خودکار/ادامهٔ بیشینهٔ همان رشته)
  const [majorStarts, setMajorStarts] = useState<Record<number, string>>({});
  // «بازبینی و تأیید»: هیچ ردیفی بدون دیدنِ اطلاعاتِ کاملش صادر شماره نمی‌شود
  const [reviewed, setReviewed] = useState<Set<number>>(new Set());
  const toggleReviewed = (id: number) =>
    setReviewed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [importEntryMethod, setImportEntryMethod] = useState<string>('');
  const [existingItems, setExistingItems] = useState<any[]>([]);
  const [decisionBusy, setDecisionBusy] = useState<number | null>(null);

  const loadExisting = async () => {
    const res = await listExistingForStagingAction();
    if (res.ok) setExistingItems(res.items ?? []);
  };

  useEffect(() => { loadExisting(); }, [initialStaging]);

  const decide = async (stagingId: number, decision: 'ALLOW_DUPLICATE' | 'REJECT' | 'CLEAR' | 'REPLACE') => {
    setDecisionBusy(stagingId);
    const res = await setStagingDecisionAction(stagingId, decision);
    setDecisionBusy(null);
    if (!res.ok) {
      setFeedback({ text: res.error || 'ثبت تصمیم انجام نشد.', type: 'error' });
      return;
    }
    await loadExisting();
    router.refresh();
  };

  const [reverting, setReverting] = useState(false);
  const handleRevertImported = async (ids: number[]) => {
    if (!confirm(`برگشت ${ids.length} ردیف از IMPORTED به RESOLVED؟ (پرونده دانشجویی و ثبت‌نام‌ها دست‌نخورده می‌مانند)`)) return;
    setReverting(true);
    const res = await revertImportedToResolvedAction(ids);
    setReverting(false);
    setFeedback({ text: res.ok ? (res.message || 'انجام شد') : (res.error || 'خطا'), type: res.ok ? 'success' : 'error' });
    if (res.ok) { await loadExisting(); router.refresh(); }
  };
  const handleRevertNumberAssigned = async (ids: number[]) => {
    if (!confirm(`برگشت ${ids.length} ردیف از NUMBER_ASSIGNED به RESOLVED؟ (شمارهٔ صادرشده حفظ می‌شود)`)) return;
    setReverting(true);
    const res = await revertNumberAssignedToResolvedAction(ids);
    setReverting(false);
    setFeedback({ text: res.ok ? (res.message || 'انجام شد') : (res.error || 'خطا'), type: res.ok ? 'success' : 'error' });
    if (res.ok) { await loadExisting(); router.refresh(); }
  };
  // کنسل/حذف بعد از ثبت نهایی: دانشجوی ایجادشده حذف یا غیرفعال می‌شود
  const handleCancelAdmission = async (ids: number[], mode: 'cancel' | 'purge') => {
    if (ids.length === 0) return;
    const label = mode === 'purge'
      ? `حذف کامل و غیرقابل بازگشتِ ${ids.length} دانشجوی ثبت‌شده؟ (فقط دانشجوی بدون سابقه حذف می‌شود)`
      : `کنسل (غیرفعال‌سازی) ${ids.length} دانشجوی ثبت‌شده؟ (رکورد برای حسابرسی می‌ماند)`;
    if (!confirm(label)) return;
    setReverting(true);
    const res = await cancelAdmissionAction(ids, mode);
    setReverting(false);
    const extra = res.ok && (res as any).failures?.length ? ` — ${(res as any).failures.length} ردیف ناموفق` : '';
    setFeedback({ text: res.ok ? `${(res as any).message || 'انجام شد'}${extra}` : (res.error || 'خطا'), type: res.ok ? 'success' : 'error' });
    if (res.ok) { await loadExisting(); router.refresh(); }
  };
  const handleRevertResolved = async (ids: number[]) => {
    if (!confirm(`برگشت ${ids.length} ردیف از RESOLVED به PENDING_MAPPING؟ (نگاشت رشته و تصمیم پاک می‌شود)`)) return;
    setReverting(true);
    const res = await revertResolvedToPendingAction(ids);
    setReverting(false);
    setFeedback({ text: res.ok ? (res.message || 'انجام شد') : (res.error || 'خطا'), type: res.ok ? 'success' : 'error' });
    if (res.ok) { await loadExisting(); router.refresh(); }
  };
  const handleRevertStaged = async (fileId: number) => {
    if (!confirm(`برگشت فایل ${fileId} از STAGED به FIELDS_READY؟ (ردیف‌های پذیرش این فایل حذف می‌شوند)`)) return;
    setReverting(true);
    const res = await revertStagedToFieldsReadyAction(fileId);
    setReverting(false);
    setFeedback({ text: res.ok ? (res.message || 'انجام شد') : (res.error || 'خطا'), type: res.ok ? 'success' : 'error' });
    if (res.ok) { await loadExisting(); router.refresh(); }
  };
  const handleDeleteFile = async (fileId: number) => {
    if (!confirm(`حذف کامل فایل ${fileId} و تمام ردیف‌های آن؟ (غیرقابل بازگشت)`)) return;
    setReverting(true);
    const res = await deleteSanjeshFileAction(fileId);
    setReverting(false);
    setFeedback({ text: res.ok ? (res.message || 'انجام شد') : (res.error || 'خطا'), type: res.ok ? 'success' : 'error' });
    if (res.ok) { await loadExisting(); router.refresh(); }
  };

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
  // با تغییر مقطع، فرمولِ ذخیره‌شدهٔ همان مقطع بارگذاری می‌شود تا آنچه
  // می‌بینید همان چیزی باشد که ذخیره شده — نه یک الگوی نمونه در کد.
  const [selectedDegreeId, setSelectedDegreeId] = useState<number>(degreeLevels[0]?.id || 1);
  // فرمولِ ذخیره‌شدهٔ همان مقطع — نه یک الگوی از پیش‌تعیین‌شده در کد.
  const [formulaPattern, setFormulaPattern] = useState<string>(
    initialFormulas.find((f: FormulaItem) => f.degreeLevelId === (degreeLevels[0]?.id || 1))?.formula ?? '',
  );
  const [simYear, setSimYear] = useState<number>(1405);
  const [simMajorCode, setSimMajorCode] = useState<string>('412');
  const [simSeq, setSimSeq] = useState<number>(15);

  // فرمول‌ساز: انتخاب متغیر + تعداد رقم + مقدار ثابت (همان الگوی ساما)
  const [tokenKey, setTokenKey] = useState<string>('Seq');
  const [tokenWidth, setTokenWidth] = useState<number>(3);
  const [constText, setConstText] = useState<string>('');

  // کتابخانهٔ مدل‌های فرمول
  const [models, setModels] = useState<FormulaModelItem[]>(initialModels);
  const [modelTitle, setModelTitle] = useState<string>('');
  const [modelFormula, setModelFormula] = useState<string>('');
  const [modelNote, setModelNote] = useState<string>('');
  const [modelBusy, setModelBusy] = useState<boolean>(false);

  const handleAddModel = async () => {
    setModelBusy(true);
    const res = await saveFormulaModelAction(modelTitle, modelFormula.trim() || formulaPattern, modelNote);
    setModelBusy(false);
    if (!res.ok) {
      setFeedback({ text: res.error || 'ذخیرهٔ مدل انجام نشد.', type: 'error' });
      return;
    }
    setModelTitle('');
    setModelFormula('');
    setModelNote('');
    setFeedback({ text: 'مدل فرمول به کتابخانه اضافه شد.', type: 'success' });
    setTimeout(() => setFeedback(null), 4000);
    router.refresh();
  };

  const handleDeleteModel = async (id: number, title: string) => {
    if (!confirm(`مدل «${title}» حذف شود؟\n(فرمول فعالِ مقاطع دست‌نخورده می‌ماند)`)) return;
    const res = await deleteFormulaModelAction(id);
    if (!res.ok) {
      setFeedback({ text: res.error || 'حذف انجام نشد.', type: 'error' });
      return;
    }
    setModels(prev => prev.filter(m => m.id !== id));
    setFeedback({ text: `مدل «${title}» حذف شد.`, type: 'success' });
    setTimeout(() => setFeedback(null), 4000);
    router.refresh();
  };

  // بارگذاری فرمولِ ذخیره‌شدهٔ مقطع انتخاب‌شده (یا خالی، اگر تعریف نشده)
  useEffect(() => {
    const saved = initialFormulas.find((f: FormulaItem) => f.degreeLevelId === selectedDegreeId);
    setFormulaPattern(saved?.formula ?? '');
  }, [selectedDegreeId, initialFormulas]);

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

  // مرحله ۱: صدور شماره دانشجویی
  const handleAssignNumbers = async () => {
    const resolvedIds = stagingList.filter(s => s.status === 'RESOLVED').map(s => s.id);
    if (resolvedIds.length === 0) {
      setFeedback({ text: 'هیچ رکورد تطبیق‌یافته‌ای (RESOLVED) جهت صدور شماره وجود ندارد.', type: 'error' });
      return;
    }

    if (!importEntryMethod) {
      setFeedback({ text: 'ابتدا «روش ورود» را برای این گروه انتخاب کنید.', type: 'error' });
      return;
    }

    // شمارهٔ شروع هر رشته (خالی = خودکار)
    const starts: Record<number, number> = {};
    for (const [mid, val] of Object.entries(majorStarts)) {
      const n = parseInt(String(val), 10);
      if (Number.isFinite(n) && n > 0) starts[Number(mid)] = n;
    }

    setIsAssigning(true);
    const res = await assignStudentNumbersAction(resolvedIds, importEntryMethod, starts);
    setIsAssigning(false);
    if (res.ok) {
      const linked = (res.items ?? []).filter((i: any) => i.linked).length;
      const created = Math.max(0, (res.count ?? 0) - linked);
      const parts: string[] = [];
      if (created > 0) parts.push(`${created} شمارهٔ دانشجویی جدید صادر شد`);
      if (linked > 0) parts.push(`${linked} ردیف به پروندهٔ از قبل موجود وصل شد`);
      const head = parts.length > 0 ? parts.join(' و ') : 'موردی برای پردازش نبود';
      const failNote = res.failures?.length ? ` — ${res.failures.length} رکورد ناموفق بود.` : '';
      setFeedback({ text: `${head}.${failNote}`, type: res.failures?.length ? 'warning' : 'success' });
      setTimeout(() => setFeedback(null), 5000);
      await loadExisting();
      router.refresh();
    } else {
      setFeedback({ text: res.error || 'خطا در صدور شماره', type: 'error' });
    }
  };

  // مرحله ۲: ثبت قطعی
  const handleFinalRegister = async () => {
    const numberAssignedIds = stagingList.filter(s => s.status === 'NUMBER_ASSIGNED').map(s => s.id);
    if (numberAssignedIds.length === 0) {
      setFeedback({ text: 'هیچ رکوردی با شماره صادرشده (NUMBER_ASSIGNED) جهت ثبت قطعی وجود ندارد.', type: 'error' });
      return;
    }

    setIsFinalizing(true);
    const res = await finalRegisterStudentsAction(numberAssignedIds);
    setIsFinalizing(false);
    if (res.ok) {
      const failNote = res.failures?.length ? ` — ${res.failures.length} رکورد ناموفق بود.` : '';
      setFeedback({ text: `${res.count} دانشجو با موفقیت ثبت قطعی شدند.${failNote}`, type: res.failures?.length ? 'warning' : 'success' });
      setTimeout(() => setFeedback(null), 5000);
      await loadExisting();
      router.refresh();
    } else {
      setFeedback({ text: res.error || 'خطا در ثبت قطعی', type: 'error' });
    }
  };

  // خروجی اکسل (CSV با BOM — اکسل فارسی را درست نشان می‌دهد)
  const handleExportExcel = () => {
    if (stagingList.length === 0) {
      setFeedback({ text: 'ردیفی برای خروجی گرفتن وجود ندارد.', type: 'error' });
      return;
    }
    const headers = [
      'کد ملی', 'نام و نام خانوادگی', 'کد رشته سنجش', 'نوع آزمون', 'مقطع',
      'گروه رشته', 'رشتهٔ دانشگاه', 'سهمیه', 'کد دانشگاه', 'وضعیت',
    ];
    const statusFa: Record<string, string> = {
      PENDING_MAPPING: 'نیازمند نگاشت',
      RESOLVED: 'آماده ثبت‌نام',
      NUMBER_ASSIGNED: 'شماره صادر شد',
      IMPORTED: 'ثبت قطعی شد',
    };
    const rows = stagingList.map(s => [
      s.nationalCode,
      s.fullName ?? '',
      s.rawSanjeshData?.sanjeshCode ?? '',
      s.rawSanjeshData?.examType ?? '',
      s.rawSanjeshData?.degreeLevel ?? '',
      s.rawSanjeshData?.majorGroup ?? '',
      s.mappedMajorName ?? '',
      s.rawSanjeshData?.quota ?? s.quotaType ?? '',
      s.rawSanjeshData?.universityCode ?? '',
      statusFa[s.status ?? ''] ?? (s.status ?? ''),
    ]);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '\uFEFF' + [headers, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `admissions-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setFeedback({ text: `${rows.length} ردیف به‌صورت اکسل (CSV) ذخیره شد.`, type: 'success' });
    setTimeout(() => setFeedback(null), 4000);
  };

  // ذخیره فرمول شماره دانشجویی
  const handleSaveFormula = async () => {
    const res = await saveStudentIdFormulaAction(selectedDegreeId, formulaPattern);
    if (res.ok) {
      setFeedback({ text: 'الگوی فرمول شماره دانشجویی با موفقیت ذخیره گردید.', type: 'success' });
      setTimeout(() => setFeedback(null), 4000);
    } else {
      setFeedback({ text: res.error || 'ذخیرهٔ فرمول انجام نشد.', type: 'error' });
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

  // شبیه‌سازی زنده فرمول — با همان موتور سرور، پس هر عرضی که بنویسید
  // (۲، ۳، ۴، …) دقیقاً همان‌طور رندر می‌شود که در تولید واقعی می‌شود.
  const selectedDegree = degreeLevels.find(d => d.id === selectedDegreeId);
  const simResult = simulateStudentId(formulaPattern, {
    entryYear: simYear,
    degreeCode: degreeCodeFor(selectedDegree?.code),
    majorCode: simMajorCode,
    seq: simSeq,
  });
  const simStudentId = simResult.result;
  const formulaErrors = [...validateFormula(formulaPattern), ...simResult.errors];

  // دروازهٔ بازبینی: تا همهٔ ردیف‌های آماده تأیید نشوند، شماره صادر نمی‌شود
  const readyRows = stagingList.filter(s => s.status === 'RESOLVED' && s.mappedMajorId);
  const unreviewedCount = readyRows.filter(s => !reviewed.has(s.id)).length;

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
          {existingItems.length > 0 && (() => {
            const autoLinked = existingItems.filter((it: any) => it.autoLink && !it.decision);
            const needsDecision = existingItems.filter((it: any) => !it.autoLink || !!it.decision);
            return (
            <div className="card p-6 bg-amber-50 border border-amber-300 rounded-2xl space-y-4 shadow-sm dark:bg-amber-950 dark:border-amber-800">
              <div className="border-b pb-3 border-amber-200">
                <h2 className="text-sm font-black text-amber-900 dark:text-amber-200">
                  ⚠️ داوطلبان با پرونده دانشجویی موجود ({existingItems.length.toLocaleString('fa-IR')} نفر)
                </h2>
                <p className="text-xs text-amber-800 mt-0.5 dark:text-amber-300">
                  {autoLinked.length > 0 && (
                    <>
                      <span className="font-bold text-emerald-800 dark:text-emerald-300">
                        {autoLinked.length.toLocaleString('fa-IR')} نفر قبلاً همین پذیرش را دارند و هنگام انتقال
                        <span className="mx-1">خودکار به همان پرونده وصل می‌شوند</span>
                        (شمارهٔ تکراری ساخته نمی‌شود).
                      </span>
                      {needsDecision.length > 0 && <br />}
                    </>
                  )}
                  {needsDecision.length > 0 && (
                    <>
                      فقط{' '}
                      <span className="font-bold text-red-800 dark:text-red-300">
                        {needsDecision.length.toLocaleString('fa-IR')} نفر
                      </span>{' '}
                      نیاز به تصمیم دارند: «ثبت پرونده جدید» یا «رد». پرونده‌های قبلی هیچ تغییری نمی‌کنند.
                    </>
                  )}
                  {needsDecision.length === 0 && autoLinked.length > 0 && (
                    <> نیازی به تصمیم‌گیری نیست — دکمهٔ «صدور شماره دانشجویی» را بزنید.</>
                  )}
                </p>
              </div>

              {/* گروه ۱: همان پذیرش، خودکار وصل می‌شود */}
              {autoLinked.length > 0 && (
                <div className="rounded-xl border border-emerald-300 bg-white dark:bg-slate-900 dark:border-emerald-800">
                  <div className="px-3 py-2 border-b border-emerald-200 dark:border-emerald-800 flex items-center justify-between">
                    <span className="text-[11px] font-black text-emerald-800 dark:text-emerald-300">
                      ✓ قبلاً ثبت شده — خودکار وصل می‌شود ({autoLinked.length.toLocaleString('fa-IR')} نفر)
                    </span>
                    <span className="text-[10px] text-slate-500">شمارهٔ جدید ساخته نمی‌شود</span>
                  </div>
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-right text-[11px]">
                      <thead className="text-slate-500 sticky top-0 bg-white dark:bg-slate-900">
                        <tr>
                          <th className="p-1.5 font-medium">نام</th>
                          <th className="p-1.5 font-medium">کد ملی</th>
                          <th className="p-1.5 font-medium">شمارهٔ موجود</th>
                          <th className="p-1.5 font-medium">رشته</th>
                          <th className="p-1.5 font-medium">اقدام</th>
                        </tr>
                      </thead>
                      <tbody>
                        {autoLinked.map((it: any) => (
                          <tr key={it.stagingId} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="p-1.5 font-bold text-slate-900 dark:text-slate-100">{it.fullName}</td>
                            <td className="p-1.5 tabular-nums text-slate-500" dir="ltr">{it.nationalCode}</td>
                            <td className="p-1.5 font-mono tabular-nums text-emerald-700 dark:text-emerald-400" dir="ltr">
                              {it.autoLink.studentCode ?? '—'}
                            </td>
                            <td className="p-1.5 text-slate-600 dark:text-slate-300">{it.autoLink.majorName ?? '—'}</td>
                            <td className="p-1.5">
                              <button
                                onClick={() => decide(it.stagingId, 'ALLOW_DUPLICATE')}
                                disabled={decisionBusy === it.stagingId}
                                title="اگر واقعاً پذیرش دومی است، پروندهٔ تازه بساز"
                                className="px-1.5 py-0.5 rounded border border-slate-300 bg-white text-[10px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600"
                              >
                                ثبت پروندهٔ جدید
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* گروه ۲: نیازمند تصمیم */}
              {needsDecision.length > 0 && (
              <div className="space-y-3 max-h-[60vh] overflow-auto">
                {needsDecision.map((it: any) => (
                  <div key={it.stagingId} className={`rounded-xl border p-3 bg-white dark:bg-slate-900 ${it.sameMajorYearActive ? 'border-red-400' : 'border-amber-200'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs">
                        <span className="font-black text-slate-900">{it.fullName}</span>
                        <span className="text-slate-500 mr-2 tabular-nums" dir="ltr">{it.nationalCode}</span>
                        {it.sameMajorYearActive && (
                          <span className="mr-2 px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-bold text-[10px]">احتمال تکرار: پرونده فعال با همین رشته و ورودی</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {it.decision === 'REJECT' && (
                          <span className="px-2 py-1 rounded-lg bg-rose-100 text-rose-800 text-[11px] font-bold">✗ رد شد</span>
                        )}
                        {it.decision === 'ALLOW_DUPLICATE' ? (
                          <span className="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-800 text-[11px] font-bold">✓ ثبت پرونده جدید</span>
                        ) : (
                          <button
                            onClick={() => decide(it.stagingId, 'ALLOW_DUPLICATE')}
                            disabled={decisionBusy === it.stagingId}
                            className="px-2 py-1 rounded-lg border border-emerald-300 bg-white text-[11px] font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                          >
                            ثبت پرونده جدید
                          </button>
                        )}
                        {it.decision === 'REPLACED' ? (
                          <span className="px-2 py-1 rounded-lg bg-violet-100 text-violet-800 text-[11px] font-bold">↻ جایگزین شد</span>
                        ) : (
                          <button
                            onClick={() => decide(it.stagingId, 'REPLACE')}
                            disabled={decisionBusy === it.stagingId}
                            className="px-2 py-1 rounded-lg border border-violet-300 bg-white text-[11px] font-bold text-violet-800 hover:bg-violet-50 disabled:opacity-50"
                          >
                            جایگزین (قدیمی غیرفعال)
                          </button>
                        )}
                        {it.decision !== 'REJECT' && (
                          <button
                            onClick={() => decide(it.stagingId, 'REJECT')}
                            disabled={decisionBusy === it.stagingId}
                            className="px-2 py-1 rounded-lg border border-rose-300 bg-white text-[11px] font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                          >
                            رد
                          </button>
                        )}
                        {it.decision && (
                          <button
                            onClick={() => decide(it.stagingId, 'CLEAR')}
                            disabled={decisionBusy === it.stagingId}
                            className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          >
                            لغو تصمیم
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                      <span className="font-bold">پذیرش جدید:</span> ورودی {it.newEntryYear}
                      <span className="mx-2 text-slate-400">|</span>
                      <span className="font-bold">پرونده‌های موجود:</span>
                    </div>
                    <table className="w-full mt-1 text-right text-[11px]">
                      <thead className="text-slate-500">
                        <tr>
                          <th className="p-1 font-medium">شماره</th>
                          <th className="p-1 font-medium">رشته</th>
                          <th className="p-1 font-medium">ورودی/ترم</th>
                          <th className="p-1 font-medium">وضعیت</th>
                          <th className="p-1 font-medium">منبع</th>
                          <th className="p-1 font-medium">روش ورود</th>
                        </tr>
                      </thead>
                      <tbody>
                        {it.existing.map((e: any) => (
                          <tr key={e.studentCode} className="border-t border-slate-100">
                            <td className="p-1 font-mono tabular-nums" dir="ltr">{e.studentCode}</td>
                            <td className="p-1">{e.majorName ?? '—'}</td>
                            <td className="p-1 tabular-nums">{e.entryYear} / {e.entryTerm ?? '—'}</td>
                            <td className="p-1">{e.status}</td>
                            <td className="p-1">{e.admissionSource ?? 'LEGACY'}</td>
                            <td className="p-1">{e.acceptanceType ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
              )}
            </div>
            );
          })()}

          <div className="card p-6 bg-white border border-slate-200 rounded-2xl space-y-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
              <div>
                <h2 className="text-sm font-black text-slate-900">
                  📥 بارگذاری و پردازش خطوط فایل متنی سنجش (TXT / CSV Data Staging)
                </h2>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-xs font-bold text-slate-600">برگشت مرحله:</span>
              <button
                onClick={() => handleRevertImported(stagingList.filter(s => s.status === 'IMPORTED').map(s => s.id))}
                disabled={reverting || stagingList.filter(s => s.status === 'IMPORTED').length === 0}
                className="px-3 py-1.5 rounded-xl border border-sky-300 bg-sky-50 text-sky-800 font-bold text-[11px] hover:bg-sky-100 disabled:opacity-50"
              >
                ↩ IMPORTED → RESOLVED
              </button>
              <button
                onClick={() => handleRevertNumberAssigned(stagingList.filter(s => s.status === 'NUMBER_ASSIGNED').map(s => s.id))}
                disabled={reverting || stagingList.filter(s => s.status === 'NUMBER_ASSIGNED').length === 0}
                className="px-3 py-1.5 rounded-xl border border-cyan-300 bg-cyan-50 text-cyan-800 font-bold text-[11px] hover:bg-cyan-100 disabled:opacity-50"
              >
                ↩ NUMBER_ASSIGNED → RESOLVED
              </button>
              <button
                onClick={() => handleRevertResolved(stagingList.filter(s => s.status === 'RESOLVED').map(s => s.id))}
                disabled={reverting || stagingList.filter(s => s.status === 'RESOLVED').length === 0}
                className="px-3 py-1.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 font-bold text-[11px] hover:bg-amber-100 disabled:opacity-50"
              >
                ↩ RESOLVED → PENDING_MAPPING
              </button>
              <button
                onClick={() => handleRevertStaged(stagingList[0]?.fileId || 5)}
                disabled={reverting || stagingList.length === 0}
                className="px-3 py-1.5 rounded-xl border border-rose-300 bg-rose-50 text-rose-800 font-bold text-[11px] hover:bg-rose-100 disabled:opacity-50"
              >
                ↩ STAGED → FIELDS_READY
              </button>
              <button
                onClick={() => handleDeleteFile(stagingList[0]?.fileId || 5)}
                disabled={reverting || stagingList.length === 0}
                className="px-3 py-1.5 rounded-xl border border-red-300 bg-red-50 text-red-800 font-bold text-[11px] hover:bg-red-100 disabled:opacity-50"
              >
                🗑 حذف کامل فایل
              </button>
              <span className="mx-1 h-4 w-px bg-slate-300" aria-hidden />
              <button
                onClick={() => handleCancelAdmission(
                  stagingList.filter(s => s.status === 'IMPORTED' || s.status === 'NUMBER_ASSIGNED').map(s => s.id),
                  'cancel')}
                disabled={reverting || stagingList.filter(s => s.status === 'IMPORTED' || s.status === 'NUMBER_ASSIGNED').length === 0}
                className="px-3 py-1.5 rounded-xl border border-orange-300 bg-orange-50 text-orange-800 font-bold text-[11px] hover:bg-orange-100 disabled:opacity-50"
              >
                ⛔ کنسل ثبت‌شده‌ها (غیرفعال)
              </button>
              <button
                onClick={() => handleCancelAdmission(
                  stagingList.filter(s => s.status === 'IMPORTED' || s.status === 'NUMBER_ASSIGNED').map(s => s.id),
                  'purge')}
                disabled={reverting || stagingList.filter(s => s.status === 'IMPORTED' || s.status === 'NUMBER_ASSIGNED').length === 0}
                className="px-3 py-1.5 rounded-xl border border-red-400 bg-red-50 text-red-800 font-bold text-[11px] hover:bg-red-100 disabled:opacity-50"
              >
                🗑 حذف کامل دانشجویان
              </button>
            </div>

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
                <button
                  onClick={handleAssignNumbers}
                  disabled={isAssigning || unreviewedCount > 0}
                  title={unreviewedCount > 0 ? `${unreviewedCount} ردیف هنوز در جدول «بازبینی و تأیید» تأیید نشده است.` : undefined}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs shadow transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isAssigning ? 'در حال صدور شماره...' : '1️⃣ صدور شماره دانشجویی'}
                </button>
                <button
                  onClick={handleFinalRegister}
                  disabled={isFinalizing}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow transition disabled:opacity-50"
                >
                  {isFinalizing ? 'در حال ثبت قطعی...' : '2️⃣ ثبت قطعی'}
                </button>
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-extrabold text-xs shadow-sm transition"
                >
                  📥 خروجی اکسل
                </button>
              </div>
            </div>

            {(() => {
              const resolvedRows = stagingList.filter(s => s.status === 'RESOLVED' && s.mappedMajorId);
              const byMajor = new Map<number, { name: string; count: number }>();
              for (const r of resolvedRows) {
                const mid = r.mappedMajorId as number;
                const name = majors.find(m => m.id === mid)?.name || `رشته ${mid}`;
                const prev = byMajor.get(mid);
                byMajor.set(mid, { name, count: (prev?.count ?? 0) + 1 });
              }
              if (byMajor.size === 0) return null;
              return (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2">
                  <div className="text-xs font-black text-amber-900">🔢 شمارهٔ شروع هر رشته (اختیاری)</div>
                  <p className="text-[11px] leading-5 text-amber-800">
                    برای هر رشته شمارهٔ شروع سریال را وارد کن (مثلاً <b>1</b> یا <b>601</b>).
                    خالی بگذاری = ادامه از بیشینهٔ موجودِ همان رشته.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {[...byMajor.entries()].map(([mid, info]) => (
                      <div key={mid} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-2 py-1.5">
                        <span className="flex-1 truncate text-[11px] font-bold text-slate-700" title={info.name}>
                          {info.name} <span className="text-slate-400">({info.count})</span>
                        </span>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          placeholder="خودکار"
                          value={majorStarts[mid] ?? ''}
                          onChange={e => setMajorStarts(prev => ({ ...prev, [mid]: e.target.value }))}
                          className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-center font-mono text-xs"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

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
              {(() => {
                // پیشنهادها فقط «پیشنهاد»اند؛ تا این دکمه زده نشود چیزی ذخیره نمی‌شود.
                const pending = sanjeshCodeGroups.filter(g => !mappingsList.some(m => m.sanjeshCode === g.code));
                const withSug: { code: string; majorId: number; majorName: string }[] = [];
                for (const g of pending) {
                  if (!g.group) continue;
                  const s = bestSuggestion(g.group, majorsFor(g.degree), 0.55);
                  if (s) withSug.push({ code: g.code, majorId: s.major.id, majorName: s.major.name });
                }
                if (withSug.length === 0) return null;
                return (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm(`نگاشت ${withSug.length} کد رشته با پیشنهاد هوشمند ثبت شود؟\n\n${withSug.map(x => `• ${x.code} ← ${x.majorName}`).join('\n')}`)) return;
                      for (const x of withSug) await handleMapMajor(x.code, String(x.majorId));
                    }}
                    className="px-3 py-1.5 rounded-xl border border-amber-400 bg-amber-50 text-amber-900 font-bold text-[11px] hover:bg-amber-100"
                  >
                    🪄 تأیید {withSug.length} پیشنهاد
                  </button>
                );
              })()}
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
                            {(() => {
                              const sug = g.group ? bestSuggestion(g.group, options, 0.55) : null;
                              return (
                                <div className="space-y-1">
                                  {sug && !mapping?.majorName && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setMapSel(p => ({ ...p, [g.code]: String(sug.major.id) }));
                                        void handleMapMajor(g.code, String(sug.major.id));
                                      }}
                                      className="text-right text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-1.5 py-0.5 hover:bg-amber-100 w-full"
                                    >
                                      🪄 پیشنهاد: {sug.major.name} ({sug.percent.toLocaleString('fa-IR')}٪)
                                    </button>
                                  )}
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
                                </div>
                              );
                            })()}
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

          {/* ── بازبینی و تأیید نهایی: همهٔ اطلاعات هر داوطلب در یک جدول ── */}
          {(() => {
            if (stagingList.length === 0) return null;
            const ready = stagingList.filter(s => s.status === 'RESOLVED' && s.mappedMajorId);
            const unreviewed = ready.filter(s => !reviewed.has(s.id));
            const genderFa = (g?: string) => (g === '1' ? 'مرد' : g === '2' ? 'زن' : '—');
            return (
              <div className="card p-6 bg-white border border-slate-200 rounded-2xl shadow-sm space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
                  <div>
                    <h2 className="text-sm font-black text-slate-900">
                      🔍 بازبینی و تأیید نهایی (همهٔ اطلاعات، نه فقط رشته)
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      قبل از صدور شماره دانشجویی، تک‌تک ردیف‌ها را ببینید و تأیید کنید.
                      تا ردیفی تأیید نشود، دکمهٔ «صدور شماره دانشجویی» فعال نمی‌شود.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold ${unreviewed.length ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {reviewed.size.toLocaleString('fa-IR')} از {ready.length.toLocaleString('fa-IR')} تأیید شده
                      {unreviewed.length ? ` — ${unreviewed.length.toLocaleString('fa-IR')} باقی مانده` : ' ✓'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setReviewed(new Set(ready.map(s => s.id)))}
                      className="px-2.5 py-1 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 text-[11px] font-bold hover:bg-emerald-100"
                    >
                      تأیید همه
                    </button>
                    <button
                      type="button"
                      onClick={() => setReviewed(new Set())}
                      className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-600 text-[11px] font-bold hover:bg-slate-50"
                    >
                      لغو همه
                    </button>
                  </div>
                </div>

                <div className="overflow-auto max-h-[28rem] rounded-xl border border-slate-200">
                  <table className="w-full text-right text-[11px]">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                      <tr>
                        <th className="p-2 font-bold whitespace-nowrap">تأیید</th>
                        <th className="p-2 font-bold whitespace-nowrap">#</th>
                        <th className="p-2 font-bold whitespace-nowrap">کد ملی</th>
                        <th className="p-2 font-bold whitespace-nowrap">نام</th>
                        <th className="p-2 font-bold whitespace-nowrap">نام خانوادگی</th>
                        <th className="p-2 font-bold whitespace-nowrap">نام پدر</th>
                        <th className="p-2 font-bold whitespace-nowrap">جنسیت</th>
                        <th className="p-2 font-bold whitespace-nowrap">مقطع</th>
                        <th className="p-2 font-bold whitespace-nowrap">رشتهٔ سنجش</th>
                        <th className="p-2 font-bold whitespace-nowrap">رشتهٔ دانشگاه</th>
                        <th className="p-2 font-bold whitespace-nowrap">سهمیه</th>
                        <th className="p-2 font-bold whitespace-nowrap">کد دانشگاه</th>
                        <th className="p-2 font-bold whitespace-nowrap">موبایل</th>
                        <th className="p-2 font-bold whitespace-nowrap">وضعیت</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stagingList.map((s, i) => {
                        const p = s.profile ?? {};
                        const isReady = s.status === 'RESOLVED' && !!s.mappedMajorId;
                        const isDone = reviewed.has(s.id);
                        return (
                          <tr
                            key={s.id}
                            className={`border-t border-slate-100 ${isDone ? 'bg-emerald-50/50' : isReady ? 'bg-amber-50/30' : ''}`}
                          >
                            <td className="p-2">
                              <input
                                type="checkbox"
                                checked={isDone}
                                disabled={!isReady}
                                onChange={() => toggleReviewed(s.id)}
                                title={isReady ? 'تأیید این ردیف' : 'اول رشته را نگاشت کنید'}
                                className="h-4 w-4 accent-emerald-600 disabled:opacity-30"
                              />
                            </td>
                            <td className="p-2 text-slate-400 tabular-nums">{(i + 1).toLocaleString('fa-IR')}</td>
                            <td className="p-2 font-mono font-bold text-slate-800" dir="ltr">{s.nationalCode}</td>
                            <td className="p-2 text-slate-800 whitespace-nowrap">{p.firstName || '—'}</td>
                            <td className="p-2 text-slate-800 whitespace-nowrap">{p.lastName || s.fullName || '—'}</td>
                            <td className="p-2 text-slate-600 whitespace-nowrap">{p.fatherName || '—'}</td>
                            <td className="p-2 text-slate-600">{genderFa(p.gender)}</td>
                            <td className="p-2 text-slate-600 whitespace-nowrap">{p.degreeLevelTitle || s.rawSanjeshData?.degreeLevel || '—'}</td>
                            <td className="p-2 text-slate-600 whitespace-nowrap">
                              {p.fieldPlaceTitle || p.fieldTitle || s.rawSanjeshData?.majorTitle || '—'}
                            </td>
                            <td className="p-2 whitespace-nowrap">
                              {s.mappedMajorName
                                ? <span className="font-bold text-emerald-700">{s.mappedMajorName}</span>
                                : <span className="text-rose-600">نگاشت نشده</span>}
                            </td>
                            <td className="p-2 text-slate-600 whitespace-nowrap">
                              {p.quotaAdmitTitle || p.quotaFinalTitle || s.rawSanjeshData?.quota || '—'}
                            </td>
                            <td className="p-2 font-mono text-slate-600" dir="ltr">
                              {p.universityCode || s.rawSanjeshData?.universityCode || '—'}
                            </td>
                            <td className="p-2 font-mono text-slate-600" dir="ltr">{p.mobile || s.mobile || '—'}</td>
                            <td className="p-2 whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  s.status === 'IMPORTED'
                                    ? 'bg-emerald-100 text-emerald-900'
                                    : isReady
                                    ? 'bg-sky-100 text-sky-900'
                                    : 'bg-rose-100 text-rose-900'
                                }`}
                              >
                                {s.status === 'IMPORTED'
                                  ? 'ثبت قطعی'
                                  : s.status === 'NUMBER_ASSIGNED'
                                  ? 'شماره صادر شد'
                                  : isReady
                                  ? 'آماده'
                                  : 'نیازمند نگاشت'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

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
                  const isResolved = st.status === 'RESOLVED' || st.status === 'IMPORTED' || st.status === 'NUMBER_ASSIGNED';
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
                        ) : (() => {
                          // «پیشنهاد هوشمند» — فقط پیشنهاد؛ تا کارشناس کلیک نکند
                          // هیچ نگاشتی نوشته نمی‌شود.
                          const rowCode = (st.rawSanjeshData?.sanjeshCode ?? '').trim();
                          const rowTitle = st.rawSanjeshData?.majorTitle || st.rawSanjeshData?.majorGroup || '';
                          const candidates = majorsFor(st.rawSanjeshData?.degreeLevel ?? '');
                          const sug = rowTitle ? bestSuggestion(rowTitle, candidates, 0.55) : null;
                          // اگر برای این کد از قبل نگاشتی ثبت شده، همان را نشان بده
                          // (وگرنه کاربر فکر می‌کند نگاشتش گم شده).
                          const known = mappingsList.find(m => m.sanjeshCode === rowCode);
                          const selValue = mapSel[rowCode] ?? (known?.internalMajorId ? String(known.internalMajorId) : '');
                          return (
                            <div className="flex flex-col gap-1">
                              <select
                                value={selValue}
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
                                {candidates.map(m => (
                                  <option key={m.id} value={m.id}>
                                    {m.name}{m.majorCode ? ` (${m.majorCode})` : ''}
                                  </option>
                                ))}
                              </select>
                              {sug && rowCode && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMapSel(p => ({ ...p, [rowCode]: String(sug.major.id) }));
                                    void handleMapMajor(rowCode, String(sug.major.id));
                                  }}
                                  title={`از نام رشتهٔ سنجش «${rowTitle}» حدس زده شد`}
                                  className="text-right text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-1.5 py-1 hover:bg-amber-100"
                                >
                                  🪄 پیشنهاد: {sug.major.name} ({sug.percent.toLocaleString('fa-IR')}٪)
                                </button>
                              )}
                              {!rowCode && (
                                <span className="text-[10px] text-slate-400">
                                  کد رشتهٔ سنجش در این ردیف نیست — فایل را دوباره پردازش کنید.
                                </span>
                              )}
                            </div>
                          );
                        })()}
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
                          {st.status === 'IMPORTED' ? '✓ ثبت‌نام قطعی شد' : st.status === 'NUMBER_ASSIGNED' ? '🔢 شماره صادر شد' : isResolved ? 'آماده ثبت‌نام' : 'نیازمند نگاشت'}
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

              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700">الگوی فرمول (آزاد — هر عرضی که بخواهید):</label>

                {/* مقدار ثابت — مثل «4051» یا جداکننده */}
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-8 min-w-0">
                    <label className="block text-[10px] text-slate-500 mb-1">مقدار ثابت</label>
                    <input
                      type="text"
                      value={constText}
                      onChange={e => setConstText(e.target.value)}
                      placeholder="مثلاً 4051"
                      dir="ltr"
                      className="w-full p-2 text-xs font-mono rounded-lg border border-slate-300 bg-white"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => { if (constText) { setFormulaPattern(v => v + constText); setConstText(''); } }}
                    className="col-span-4 px-3 py-2 rounded-lg border border-indigo-300 bg-white text-xs font-bold text-indigo-800 hover:bg-indigo-50"
                  >
                    + افزودن ثابت
                  </button>
                </div>

                {/* متغیر + تعداد رقم */}
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-6 min-w-0">
                    <label className="block text-[10px] text-slate-500 mb-1">متغیر</label>
                    <select
                      value={tokenKey}
                      onChange={e => {
                        const k = e.target.value;
                        setTokenKey(k);
                        const d = FORMULA_TOKENS.find(t => t.key === k);
                        setTokenWidth(d?.key === 'Seq' ? 3 : d?.key === 'Year' ? 2 : d?.key === 'DegreeCode' ? 1 : 3);
                      }}
                      className="w-full p-2 text-xs rounded-lg border border-slate-300 bg-white"
                    >
                      {FORMULA_TOKENS.map(t => (
                        <option key={t.key} value={t.key}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3 min-w-0">
                    <label className="block text-[10px] text-slate-500 mb-1">تعداد رقم</label>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={tokenWidth}
                      onChange={e => setTokenWidth(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
                      className="w-full p-2 text-xs font-mono rounded-lg border border-slate-300 bg-white"
                      dir="ltr"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormulaPattern(v => v + `{${tokenKey}:${tokenWidth}}`)}
                    className="col-span-3 px-3 py-2 rounded-lg border border-indigo-300 bg-white text-xs font-bold text-indigo-800 hover:bg-indigo-50"
                  >
                    + افزودن
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setFormulaPattern(v => v.replace(/\{[^}]*\}$|[^\s{}]+$/, ''))}
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
                  placeholder="{Year:2}{MajorCode:3}{Seq:3}"
                  className="w-full p-2.5 text-xs font-mono font-bold rounded-xl border border-indigo-300 bg-indigo-50/50 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-100"
                  dir="ltr"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  متغیرهای مجاز: {FORMULA_TOKENS.map(t => t.key).join(' · ')} — شکل هر کدام <code className="bg-slate-100 p-0.5 rounded">{'{نام:تعداد‌رقم}'}</code>
                </p>
                {formulaErrors.length > 0 && (
                  <ul className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2 space-y-0.5">
                    {formulaErrors.map((e, i) => <li key={i}>• {e}</li>)}
                  </ul>
                )}
              </div>

              <button
                onClick={handleSaveFormula}
                disabled={formulaErrors.length > 0}
                className="px-5 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold text-xs shadow transition"
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
                    className="w-full p-1.5 rounded bg-slate-800 border border-slate-600 text-xs font-mono text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/60"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">کد رشته (۳ رقم):</span>
                  <input
                    type="text"
                    value={simMajorCode}
                    onChange={e => setSimMajorCode(e.target.value)}
                    className="w-full p-1.5 rounded bg-slate-800 border border-slate-600 text-xs font-mono text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/60"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">شماره سریال:</span>
                  <input
                    type="number"
                    value={simSeq}
                    onChange={e => setSimSeq(Number(e.target.value))}
                    className="w-full p-1.5 rounded bg-slate-800 border border-slate-600 text-xs font-mono text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/60"
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

      {/* کتابخانهٔ مدل‌های فرمول */}
      {activeTab === 'ID_FORMULA' && (
        <div className="card p-6 bg-white border border-slate-200 rounded-2xl space-y-4 shadow-sm">
          <div className="border-b pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-black text-slate-900">📚 مدل‌های فرمول شمارهٔ دانشجویی</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                چند الگو بسازید و هنگام تعریف فرمول هر مقطع از بین آن‌ها انتخاب کنید.
                دکمهٔ «استفاده» فقط فرمول را در کادر بالا می‌گذارد — تا «ذخیره فرمول مقطع» را نزنید هیچ چیز عوض نمی‌شود.
              </p>
            </div>
            <span className="text-[11px] text-slate-500">{models.length.toLocaleString('fa-IR')} مدل</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-2 font-bold w-8">#</th>
                  <th className="p-2 font-bold">عنوان</th>
                  <th className="p-2 font-bold">فرمول</th>
                  <th className="p-2 font-bold">توضیح</th>
                  <th className="p-2 font-bold w-32">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {models.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-slate-400">
                      هنوز مدلی ثبت نشده — از فرم پایین اضافه کنید.
                    </td>
                  </tr>
                )}
                {models.map((m, i) => (
                  <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-2 text-slate-400 tabular-nums">{(i + 1).toLocaleString('fa-IR')}</td>
                    <td className="p-2 font-bold text-slate-800">{m.title}</td>
                    <td className="p-2 font-mono text-indigo-900" dir="ltr">{m.formula}</td>
                    <td className="p-2 text-slate-500">{m.note || '—'}</td>
                    <td className="p-2">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setFormulaPattern(m.formula)}
                          className="px-2 py-1 rounded-lg border border-indigo-300 bg-white text-[10px] font-bold text-indigo-800 hover:bg-indigo-50"
                        >
                          استفاده
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteModel(m.id, m.title)}
                          className="px-2 py-1 rounded-lg border border-rose-300 bg-white text-[10px] font-bold text-rose-700 hover:bg-rose-50"
                        >
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-12 gap-2 items-end border-t pt-3">
            <div className="col-span-12 sm:col-span-3 min-w-0">
              <label className="block text-[10px] text-slate-500 mb-1">عنوان مدل *</label>
              <input
                type="text"
                value={modelTitle}
                onChange={e => setModelTitle(e.target.value)}
                placeholder="مثلاً سال + رشته + سریال"
                className="w-full p-2 text-xs rounded-lg border border-slate-300 bg-white"
              />
            </div>
            <div className="col-span-12 sm:col-span-4 min-w-0">
              <label className="block text-[10px] text-slate-500 mb-1">فرمول *</label>
              <input
                type="text"
                value={modelFormula}
                onChange={e => setModelFormula(e.target.value)}
                placeholder={formulaPattern || '{Year:2}{MajorCode:3}{Seq:3}'}
                dir="ltr"
                className="w-full p-2 text-xs font-mono rounded-lg border border-slate-300 bg-white"
              />
            </div>
            <div className="col-span-12 sm:col-span-3 min-w-0">
              <label className="block text-[10px] text-slate-500 mb-1">توضیح</label>
              <input
                type="text"
                value={modelNote}
                onChange={e => setModelNote(e.target.value)}
                placeholder="اختیاری"
                className="w-full p-2 text-xs rounded-lg border border-slate-300 bg-white"
              />
            </div>
            <button
              type="button"
              onClick={handleAddModel}
              disabled={modelBusy || !modelTitle.trim() || (!modelFormula.trim() && !formulaPattern)}
              className="col-span-12 sm:col-span-2 px-3 py-2 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-extrabold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {modelBusy ? 'در حال ذخیره…' : '+ افزودن مدل'}
            </button>
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
                onChange={e => {
                  const majorId = Number(e.target.value);
                  const major = majors.find(m => m.id === majorId);
                  setManualForm({ ...manualForm, majorId, degreeLevelId: major?.degreeLevelId ?? manualForm.degreeLevelId });
                }}
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
