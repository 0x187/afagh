'use client';

/**
 * CoefficientsRulesTab — مدیریت ضرایب تدریس و قوانین محاسبه حق‌التدریس
 *
 * این تب به مدیران مالی امکان ویرایش ضرایب (teaching_coefficients) و
 * قوانین فرمول‌ساز (payroll_calculation_rules) را می‌دهد.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { faNum } from '../payrollData';
import type { PayrollState, PayrollApi } from '../payrollReducer';
import { FORMULA_VAR_HELP, evalFormula, validateFormula, type FormulaVars } from '@/lib/payroll-formula';

interface Props {
  state: PayrollState;
  api: PayrollApi;
}

interface CoefficientItem {
  id: number;
  ruleName: string;
  multiplier: string;
}

/** شکل ردیف قوانین مطابق payroll_calculation_rules (پس از مهاجرت ۰۰۹۲) */
interface CalculationRuleItem {
  id: number;
  offeringType: string | null;
  professorRole: string | null;
  academicRank: string | null;
  expression: string | null;
  departmentId: number | null;
  courseType: string | null;
  repeatNumber: number | null;
  flatBase: string | null;
  classMode: string | null;
  minStudents: number | null;
  maxStudents: number | null;
  perStudentHours: string | null;
  title: string | null;
  isActive: number;
  updatedAt: string | null;
}

const COEF_LABELS: Record<string, string> = {
  'PAYROLL_COEF_PRACTICAL': 'ضریب درس عملی',
  'PAYROLL_COEF_MS_LEVEL': 'ضریب مقطع کارشناسی ارشد',
  'PAYROLL_COEF_CROWDED': 'ضریب کلاس جمعی (بیش از آستانه)',
};

const OFFERING_TYPES = ['', 'THEORY', 'PRACTICAL', 'THESIS', 'DIRECTED_READING', 'INTERNSHIP', 'NORMAL', 'TRANSFER', 'WORKSHOP'];
const PROFESSOR_ROLES = ['', 'MAIN_LECTURER', 'SUPERVISOR', 'ADVISOR', 'REVIEWER', 'EXAMINER', 'ASSISTANT', 'SELF_TAUGHT'];
const ACADEMIC_RANKS = ['', 'مربی', 'استادیار', 'دانشیار', 'استاد تمام'];
const CLASS_MODES: { v: string; fa: string }[] = [
  { v: 'ANY', fa: 'مهم نیست' },
  { v: 'WITH_CLASS', fa: 'دارای کلادار/شیفت' },
  { v: 'NO_CLASS', fa: 'بدون کلادار/شیفت' },
];

/** گروه‌بندی پالت متغیرها برای نمایش خوانا */
const VAR_GROUPS: { title: string; vars: string[] }[] = [
  { title: 'ساعات', vars: ['TH', 'PH', 'WH', 'HR'] },
  { title: 'واحدها', vars: ['UN'] },
  { title: 'دانشجو', vars: ['ST'] },
  { title: 'نرخ و مبنا', vars: ['RT', 'CF', 'BS'] },
];

/** مقادیر پیش‌فرض پیشنهادی برای آزمون زنده (مطابق validateFormula) */
const TEST_DEFAULTS: FormulaVars = {
  TH: 2, PH: 2, WH: 0, UN: 3, ST: 20, RT: 100000, CF: 1, BS: 500000, HR: 2,
};

const faVarHelp = (code: string) => FORMULA_VAR_HELP.find(h => h.v === code);

/** جای‌گذاری متغیر در محل نشانگر */
function insertAtCursor(input: HTMLTextAreaElement | HTMLInputElement, text: string): string {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const needsSpace = before.length > 0 && !/[+\-*/(\s]$/.test(before);
  const insert = `${needsSpace ? ' ' : ''}${text}`;
  // برای حفظ انتخاب نشانگر، از setter استفاده می‌کنیم و در onChange برمی‌گردانیم
  const next = `${before}${insert}${after}`;
  return next;
}

/** ویرایشگر عبارت فرمول: پالت متغیرها + اعتبارسنجی زنده + آزمون محاسبه */
function ExpressionEditor({
  value,
  onChange,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [testVars, setTestVars] = useState<FormulaVars>({ ...TEST_DEFAULTS });
  const [testResult, setTestResult] = useState<string | null>(null);
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 300);
    return () => clearTimeout(t);
  }, [value]);

  const validationError = useMemo(
    () => (debounced.trim() ? validateFormula(debounced) : null),
    [debounced],
  );

  const pickVar = (code: string) => {
    const el = inputRef.current;
    if (!el) { onChange(`${value}${value && !/[+\-*/(\s]$/.test(value) ? ' ' : ''}${code}`); return; }
    const next = insertAtCursor(el, code);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = next.length;
      try { el.setSelectionRange(pos, pos); } catch { /* ignore */ }
    });
  };

  const runTest = () => {
    try {
      const v = evalFormula(value, testVars);
      setTestResult(`نتیجه: ${Number(v).toLocaleString('fa-IR')} ریال`);
    } catch (e) {
      setTestResult(`خطا: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-3">
      <textarea
        ref={inputRef}
        value={value}
        onChange={e => { onChange(e.target.value); setTestResult(null); }}
        dir="ltr"
        placeholder="مثال: TH * RT * CF + BS"
        rows={2}
        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm font-mono text-left"
      />
      {/* پالت متغیرها */}
      <div className="space-y-2">
        {VAR_GROUPS.map(g => (
          <div key={g.title} className="flex flex-wrap items-center gap-1.5">
            <span className="text-2xs font-bold text-slate-500 w-16">{g.title}:</span>
            {g.vars.map(code => {
              const h = faVarHelp(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => pickVar(code)}
                  title={`${h?.fa ?? code}${h?.old ? ` (قدیمی: ${h.old})` : ''} — کلیک برای درج`}
                  className="px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-2xs font-mono font-bold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                >
                  {code} <span className="font-sans font-normal text-emerald-700 dark:text-emerald-300">· {h?.fa}</span>
                </button>
              );
            })}
          </div>
        ))}
        <details className="text-2xs text-slate-500">
          <summary className="cursor-pointer hover:text-slate-700">متغیرهای قدیمی (سازگار با سما)</summary>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {FORMULA_VAR_HELP.map(h => (
              <button
                key={h.old}
                type="button"
                onClick={() => h.old && pickVar(h.old)}
                title={`${h.fa} — معادل ${h.v}`}
                className="px-2 py-0.5 rounded-lg bg-slate-100 border border-slate-200 font-mono text-slate-600 hover:bg-slate-200"
              >
                {h.old} ← {h.v}
              </button>
            ))}
          </div>
        </details>
      </div>
      {/* وضعیت اعتبارسنجی زنده */}
      {debounced.trim() !== '' && (
        validationError ? (
          <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">⚠ {validationError}</div>
        ) : (
          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">✔ فرمول معتبر است</div>
        )
      )}
      {/* آزمون زندهٔ محاسبه */}
      <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
        <summary className="cursor-pointer text-xs font-bold text-slate-700 dark:text-slate-200">🧪 آزمون زندهٔ فرمول</summary>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2 mt-3">
          {FORMULA_VAR_HELP.map(h => (
            <label key={h.v} className="text-3xs text-slate-600">
              <span className="font-mono font-bold">{h.v}</span> · {h.fa}
              <input
                type="number"
                value={testVars[h.v as keyof FormulaVars] ?? 0}
                onChange={e => setTestVars(v => ({ ...v, [h.v]: Number(e.target.value) || 0 }))}
                className="mt-0.5 w-full border border-slate-300 rounded px-1.5 py-1 text-xs font-mono"
              />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={runTest}
            disabled={!value.trim()}
            className="px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold disabled:opacity-50"
          >
            محاسبه
          </button>
      {/* وضعیت آزمون */}
        {testResult && (
            <span className={`text-xs font-bold ${testResult.startsWith('خطا') ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
              {testResult}
            </span>
          )}
        </div>
      </details>
    </div>
  );
}

export default function CoefficientsRulesTab({ state, api }: Props) {
  const { showToast } = api;
  const [coefficients, setCoefficients] = useState<CoefficientItem[]>([]);
  const [rules, setRules] = useState<CalculationRuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // فرم افزودن قانون جدید (ابعاد خالی = همه)
  const [newRule, setNewRule] = useState({
    offeringType: '',
    professorRole: '',
    academicRank: '',
    courseType: '',
    classMode: 'ANY',
    expression: '',
    departmentId: '',
    repeatNumber: '',
    flatBase: '',
    minStudents: '',
    maxStudents: '',
    perStudentHours: '',
    title: '',
  });
  const newExprRef = useRef<HTMLTextAreaElement | null>(null);
  // ویرایش درون‌خطی یک قانون موجود (null = بسته)
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});
  const editExprRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // دریافت ضرایب
      const coefRes = await fetch('/api/admin/payroll/coefficients');
      if (coefRes.ok) {
        const coefData = await coefRes.json();
        if (coefData.ok) setCoefficients(coefData.coefficients);
      }

      // دریافت قوانین محاسبه
      const ruleRes = await fetch('/api/admin/payroll/calculation-rules');
      if (ruleRes.ok) {
        const ruleData = await ruleRes.json();
        if (ruleData.ok) setRules(ruleData.rules);
      }
    } catch (err) {
      showToast('خطا در بارگذاری داده‌ها');
    } finally {
      setLoading(false);
    }
  };

  const handleCoefficientChange = async (ruleName: string, value: string) => {
    const numValue = parseFloat(value) || 1;
    setSaving(ruleName);
    try {
      const res = await fetch('/api/admin/payroll/coefficients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleName, multiplier: numValue }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`ضریب ${COEF_LABELS[ruleName] || ruleName} به‌روزرسانی شد`);
        setCoefficients(c => c.map(c => c.ruleName === ruleName ? { ...c, multiplier: String(numValue) } : c));
      } else {
        showToast(`خطا: ${data.error}`);
      }
    } catch {
      showToast('خطا در ارتباط با سرور');
    } finally {
      setSaving(null);
    }
  };

  const ruleToPayload = (rule: CalculationRuleItem) => ({
    offeringType: rule.offeringType || null,
    professorRole: rule.professorRole || null,
    academicRank: rule.academicRank || null,
    expression: rule.expression || null,
    departmentId: rule.departmentId ?? null,
    courseType: rule.courseType || null,
    repeatNumber: rule.repeatNumber ?? null,
    flatBase: rule.flatBase != null && rule.flatBase !== '' ? Number(rule.flatBase) : null,
    classMode: (rule.classMode as 'ANY' | 'WITH_CLASS' | 'NO_CLASS') || 'ANY',
    minStudents: rule.minStudents ?? null,
    maxStudents: rule.maxStudents ?? null,
    perStudentHours: rule.perStudentHours != null && rule.perStudentHours !== '' ? Number(rule.perStudentHours) : null,
    title: rule.title,
    isActive: rule.isActive,
  });

  const handleRuleUpdate = async (rule: CalculationRuleItem): Promise<boolean> => {
    setSaving(`rule-${rule.id}`);
    try {
      const res = await fetch(`/api/admin/payroll/calculation-rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ruleToPayload(rule)),
      });
      const data = await res.json();
      if (data.ok) {
        showToast('قانون محاسبه به‌روزرسانی شد');
        return true;
      } else {
        showToast(`خطا: ${data.error}`);
        loadData(); // بازگرداندن به حالت قبلی
        return false;
      }
    } catch {
      showToast('خطا در ارتباط با سرور');
      loadData();
      return false;
    } finally {
      setSaving(null);
    }
  };

  const openEdit = (rule: CalculationRuleItem) => {
    setEditingId(rule.id);
    setEditDraft({
      offeringType: rule.offeringType ?? '',
      professorRole: rule.professorRole ?? '',
      academicRank: rule.academicRank ?? '',
      courseType: rule.courseType ?? '',
      classMode: rule.classMode ?? 'ANY',
      expression: rule.expression ?? '',
      departmentId: rule.departmentId != null ? String(rule.departmentId) : '',
      repeatNumber: rule.repeatNumber != null ? String(rule.repeatNumber) : '',
      flatBase: rule.flatBase ?? '',
      minStudents: rule.minStudents != null ? String(rule.minStudents) : '',
      maxStudents: rule.maxStudents != null ? String(rule.maxStudents) : '',
      perStudentHours: rule.perStudentHours ?? '',
      title: rule.title ?? '',
    });
  };

  const saveEdit = async (rule: CalculationRuleItem) => {
    const updated: CalculationRuleItem = {
      ...rule,
      offeringType: editDraft.offeringType || null,
      professorRole: editDraft.professorRole || null,
      academicRank: editDraft.academicRank || null,
      courseType: editDraft.courseType || null,
      classMode: editDraft.classMode || 'ANY',
      expression: editDraft.expression?.trim() || null,
      departmentId: editDraft.departmentId ? Number(editDraft.departmentId) : null,
      repeatNumber: editDraft.repeatNumber ? Number(editDraft.repeatNumber) : null,
      flatBase: editDraft.flatBase !== '' ? editDraft.flatBase : null,
      minStudents: editDraft.minStudents !== '' ? Number(editDraft.minStudents) : null,
      maxStudents: editDraft.maxStudents !== '' ? Number(editDraft.maxStudents) : null,
      perStudentHours: editDraft.perStudentHours !== '' ? editDraft.perStudentHours : null,
      title: editDraft.title,
    };
    const ok = await handleRuleUpdate(updated);
    if (ok) {
      setRules(rs => rs.map(x => (x.id === rule.id ? updated : x)));
      setEditingId(null);
    }
  };

  const handleRuleDelete = async (id: number) => {
    if (!window.confirm('آیا از حذف این قانون اطمینان دارید؟')) return;
    try {
      const res = await fetch(`/api/admin/payroll/calculation-rules/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.ok) {
        showToast('قانون محاسبه حذف شد');
        setRules(r => r.filter(rule => rule.id !== id));
      } else {
        showToast(`خطا: ${data.error}`);
      }
    } catch {
      showToast('خطا در ارتباط با سرور');
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving('create');
    try {
      const res = await fetch('/api/admin/payroll/calculation-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offeringType: newRule.offeringType || null,
          professorRole: newRule.professorRole || null,
          academicRank: newRule.academicRank || null,
          expression: newRule.expression.trim() || null,
          departmentId: newRule.departmentId ? Number(newRule.departmentId) : null,
          courseType: newRule.courseType || null,
          repeatNumber: newRule.repeatNumber ? Number(newRule.repeatNumber) : null,
          flatBase: newRule.flatBase ? Number(newRule.flatBase) : null,
          classMode: newRule.classMode || 'ANY',
          minStudents: newRule.minStudents !== '' ? Number(newRule.minStudents) : null,
          maxStudents: newRule.maxStudents !== '' ? Number(newRule.maxStudents) : null,
          perStudentHours: newRule.perStudentHours !== '' ? Number(newRule.perStudentHours) : null,
          title: newRule.title,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast('قانون جدید ایجاد شد');
        setNewRule({
          offeringType: '',
          professorRole: '',
          academicRank: '',
          courseType: '',
          classMode: 'ANY',
          expression: '',
          departmentId: '',
          repeatNumber: '',
          flatBase: '',
          minStudents: '',
          maxStudents: '',
          perStudentHours: '',
          title: '',
        });
        loadData();
      } else {
        showToast(`خطا: ${data.error}`);
      }
    } catch {
      showToast('خطا در ارتباط با سرور');
    } finally {
      setSaving(null);
    }
  };

  const getRuleDescription = (rule: CalculationRuleItem) => {
    const parts: string[] = [];
    if (rule.offeringType) parts.push(`نوع درس: ${rule.offeringType}`);
    if (rule.professorRole) parts.push(`نقش: ${rule.professorRole}`);
    if (rule.academicRank) parts.push(`مرتبه: ${rule.academicRank}`);
    if (rule.courseType) parts.push(`نوع دقیق: ${rule.courseType}`);
    if (rule.classMode && rule.classMode !== 'ANY') parts.push(`کلاس: ${CLASS_MODES.find(c => c.v === rule.classMode)?.fa ?? rule.classMode}`);
    if (rule.repeatNumber != null) parts.push(`تکرار ${faNum(rule.repeatNumber)}ام`);
    if (rule.minStudents != null || rule.maxStudents != null) {
      parts.push(`دانشجو: ${rule.minStudents != null ? faNum(rule.minStudents) : '۰'} تا ${rule.maxStudents != null ? faNum(rule.maxStudents) : '∞'}`);
    }
    if (rule.perStudentHours != null) parts.push(`ساعت/دانشجو: ${faNum(Number(rule.perStudentHours))}`);
    return parts.join(' · ') || '— (قانون پیش‌فرض: همهٔ درس‌ها)';
  };

  /** رندر عبارت با تول‌تیپ نام فارسی هر متغیر */
  const renderExpression = (expr: string | null) => {
    if (!expr) return <span className="text-slate-400">—</span>;
    const tokens = expr.split(/([A-Za-z_]+)/g);
    return (
      <span className="font-mono" dir="ltr">
        {tokens.map((tok, i) => {
          const h = FORMULA_VAR_HELP.find(v => v.v === tok.toUpperCase());
          return h ? (
            <span key={i} title={`${h.fa}${h.old ? ` (قدیمی: ${h.old})` : ''}`} className="text-emerald-700 font-bold underline decoration-dotted underline-offset-2 cursor-help">{tok}</span>
          ) : (
            <span key={i}>{tok}</span>
          );
        })}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="card p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-indigo-500 border-t-transparent mx-auto"></div>
        <p className="mt-2 text-slate-500">در حال بارگذاری ضرایب و قوانین...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* بخش ۱: ضرایب تدریس (teaching_coefficients) */}
      <div className="card space-y-4">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-xl">⚙️</div>
          <div>
            <h2 className="font-black text-slate-900 text-base">ضرایب تدریس (Teaching Coefficients)</h2>
            <p className="text-xs text-slate-500">این ضرایب بر روی واحدهای معادل دروس نظری اعمال می‌شوند. مقادیر از جدول teaching_coefficients خوانده می‌شوند.</p>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-2xl">
          <table className="w-full text-right text-xs border-collapse rt">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="p-2.5">کد قانون</th>
                <th className="p-2.5">عنوان</th>
                <th className="p-2.5 text-center">ضریب جاری</th>
                <th className="p-2.5 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {coefficients.map(coef => (
                <tr key={coef.ruleName} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-2.5 font-mono text-slate-700">{coef.ruleName}</td>
                  <td className="p-2.5 font-medium text-slate-900">{COEF_LABELS[coef.ruleName] || coef.ruleName}</td>
                  <td className="p-2.5 text-center">
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="5"
                      value={coef.multiplier}
                      onChange={e => handleCoefficientChange(coef.ruleName, e.target.value)}
                      disabled={saving === coef.ruleName}
                      className="w-20 text-center border border-slate-300 rounded px-1.5 py-0.5 font-mono font-bold text-slate-800 text-xs"
                    />
                  </td>
                  <td className="p-2.5 text-center">
                    {saving === coef.ruleName && <span className="text-amber-600 text-3xs">⟳ ذخیره...</span>}
                  </td>
                </tr>
              ))}
              {coefficients.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-slate-400">هیچ ضریبی یافت نشد</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <strong>نحوه اعمال:</strong> واحد درس × ضریب درس عملی × ضریب مقطع ارشد × ضریب کلاس جمعی = واحد معادل نهایی.
          <br />آستانه کلاس جمعی از تنظیمات (PAYROLL_CROWDED_THRESHOLD) خوانده می‌شود (پیش‌فرض ۴۰ نفر).
        </div>
      </div>

      {/* بخش ۲: قوانین محاسبه حق‌التدریس (payroll_calculation_rules) */}
      <div className="card space-y-4">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-xl">📐</div>
          <div>
            <h2 className="font-black text-slate-900 text-base">قوانین محاسبه حق‌التدریس (Calculation Rules)</h2>
            <p className="text-xs text-slate-500">قوانین فرمول‌ساز برای موارد خاص (پایان‌نامه، معرفی به استاد، تدریس ارشد/دکتری). خاص‌ترین قانون (بیشترین فیلدهای پرشده) برنده می‌شود.</p>
          </div>
        </div>

        {/* فرم افزودن قانون جدید */}
        <form onSubmit={handleCreateRule} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
          <h3 className="font-bold text-slate-800">➕ افزودن قانون جدید <span className="text-2xs font-normal text-slate-500">(هر بُعد خالی = همهٔ موارد)</span></h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <select
              value={newRule.offeringType}
              onChange={e => setNewRule({ ...newRule, offeringType: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs"
            >
              <option value="">نوع درس (اختیاری)</option>
              {OFFERING_TYPES.filter(Boolean).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              value={newRule.professorRole}
              onChange={e => setNewRule({ ...newRule, professorRole: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs"
            >
              <option value="">نقش استاد (اختیاری)</option>
              {PROFESSOR_ROLES.filter(Boolean).map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select
              value={newRule.academicRank}
              onChange={e => setNewRule({ ...newRule, academicRank: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs"
            >
              <option value="">مرتبه علمی (اختیاری)</option>
              {ACADEMIC_RANKS.filter(Boolean).map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select
              value={newRule.classMode}
              onChange={e => setNewRule({ ...newRule, classMode: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs"
            >
              {CLASS_MODES.map(c => <option key={c.v} value={c.v}>کلاس: {c.fa}</option>)}
            </select>
            <input
              type="text"
              placeholder="عنوان قانون"
              value={newRule.title}
              onChange={e => setNewRule({ ...newRule, title: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs md:col-span-2"
              required
            />
            <input
              type="text"
              placeholder="نوع دقیق درس (courseType)"
              value={newRule.courseType}
              onChange={e => setNewRule({ ...newRule, courseType: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <input
              type="number" min="0"
              placeholder="کف دانشجو"
              value={newRule.minStudents}
              onChange={e => setNewRule({ ...newRule, minStudents: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs"
            />
            <input
              type="number" min="0"
              placeholder="سقف دانشجو"
              value={newRule.maxStudents}
              onChange={e => setNewRule({ ...newRule, maxStudents: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs"
            />
            <input
              type="number" min="0" step="0.01"
              placeholder="ساعت/دانشجو"
              value={newRule.perStudentHours}
              onChange={e => setNewRule({ ...newRule, perStudentHours: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs"
            />
            <input
              type="number" min="0"
              placeholder="شناسه گروه (خالی=همه)"
              value={newRule.departmentId}
              onChange={e => setNewRule({ ...newRule, departmentId: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs"
            />
            <input
              type="number" min="1" max="20"
              placeholder="تکرار Nام"
              value={newRule.repeatNumber}
              onChange={e => setNewRule({ ...newRule, repeatNumber: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs"
            />
            <input
              type="number" min="0" step="100000"
              placeholder="مبنای F (ریال)"
              value={newRule.flatBase}
              onChange={e => setNewRule({ ...newRule, flatBase: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700">عبارت فرمول (یک سطر — خروجی: ریال)</label>
            <ExpressionEditor
              value={newRule.expression}
              onChange={v => setNewRule({ ...newRule, expression: v })}
              inputRef={newExprRef}
            />
          </div>
          <button
            type="submit"
            disabled={saving === 'create' || !newRule.title}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold disabled:opacity-50"
          >
            {saving === 'create' ? '⟳ در حال ایجاد...' : 'ایجاد قانون'}
          </button>
        </form>

        {/* لیست قوانین — کارت‌های مدرن */}
        <div className="space-y-3">
          {rules.map(rule => {
            const isEditing = editingId === rule.id;
            return (
              <div key={rule.id} className={`rounded-2xl border ${rule.isActive === 1 ? 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900' : 'border-slate-200 bg-slate-50 opacity-75 dark:border-slate-700 dark:bg-slate-800'}`}>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-2xs text-slate-400">#{faNum(rule.id)}</span>
                        <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm">{rule.title || '(بدون عنوان)'}</h4>
                        {rule.isActive !== 1 && (
                          <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300 text-3xs font-bold">غیرفعال</span>
                        )}
                      </div>
                      <p className="text-2xs text-slate-500 dark:text-slate-400 mt-1">{getRuleDescription(rule)}</p>
                      <div className="mt-2 text-xs text-slate-700 dark:text-slate-200">
                        <span className="text-3xs text-slate-400 ml-1">فرمول:</span>
                        {renderExpression(rule.expression)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <label className="flex items-center gap-1 text-3xs text-slate-500 cursor-pointer" title="فعال/غیرفعال">
                        <input
                          type="checkbox"
                          checked={rule.isActive === 1}
                          onChange={e => {
                            const updated = { ...rule, isActive: e.target.checked ? 1 : 0 };
                            setRules(rs => rs.map(x => (x.id === rule.id ? updated : x)));
                            handleRuleUpdate(updated);
                          }}
                        />
                        فعال
                      </label>
                      {saving === `rule-${rule.id}` ? (
                        <span className="text-amber-600 text-3xs">⟳</span>
                      ) : (
                        <>
                          <button
                            onClick={() => (isEditing ? setEditingId(null) : openEdit(rule))}
                            className="px-2 py-1 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 rounded text-2xs font-bold"
                            title="ویرایش قانون"
                          >
                            {isEditing ? 'بستن ✕' : '✏️ ویرایش'}
                          </button>
                          <button
                            onClick={() => handleRuleDelete(rule.id)}
                            className="px-2 py-1 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950 rounded text-2xs font-bold"
                            title="حذف قانون"
                          >
                            🗑️
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {isEditing && (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <input
                          type="text" placeholder="عنوان قانون" value={editDraft.title ?? ''}
                          onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                          className="border border-slate-300 rounded px-2 py-1.5 text-xs md:col-span-2"
                        />
                        <select value={editDraft.offeringType ?? ''} onChange={e => setEditDraft(d => ({ ...d, offeringType: e.target.value }))} className="border border-slate-300 rounded px-2 py-1.5 text-xs">
                          <option value="">نوع درس (همه)</option>
                          {OFFERING_TYPES.filter(Boolean).map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <select value={editDraft.professorRole ?? ''} onChange={e => setEditDraft(d => ({ ...d, professorRole: e.target.value }))} className="border border-slate-300 rounded px-2 py-1.5 text-xs">
                          <option value="">نقش استاد (همه)</option>
                          {PROFESSOR_ROLES.filter(Boolean).map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <select value={editDraft.academicRank ?? ''} onChange={e => setEditDraft(d => ({ ...d, academicRank: e.target.value }))} className="border border-slate-300 rounded px-2 py-1.5 text-xs">
                          <option value="">مرتبه علمی (همه)</option>
                          {ACADEMIC_RANKS.filter(Boolean).map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <select value={editDraft.classMode ?? 'ANY'} onChange={e => setEditDraft(d => ({ ...d, classMode: e.target.value }))} className="border border-slate-300 rounded px-2 py-1.5 text-xs">
                          {CLASS_MODES.map(c => <option key={c.v} value={c.v}>کلاس: {c.fa}</option>)}
                        </select>
                        <input type="text" placeholder="نوع دقیق درس" value={editDraft.courseType ?? ''} onChange={e => setEditDraft(d => ({ ...d, courseType: e.target.value }))} className="border border-slate-300 rounded px-2 py-1.5 text-xs" />
                        <input type="number" min="0" placeholder="کف دانشجو" value={editDraft.minStudents ?? ''} onChange={e => setEditDraft(d => ({ ...d, minStudents: e.target.value }))} className="border border-slate-300 rounded px-2 py-1.5 text-xs" />
                        <input type="number" min="0" placeholder="سقف دانشجو" value={editDraft.maxStudents ?? ''} onChange={e => setEditDraft(d => ({ ...d, maxStudents: e.target.value }))} className="border border-slate-300 rounded px-2 py-1.5 text-xs" />
                        <input type="number" min="0" step="0.01" placeholder="ساعت/دانشجو" value={editDraft.perStudentHours ?? ''} onChange={e => setEditDraft(d => ({ ...d, perStudentHours: e.target.value }))} className="border border-slate-300 rounded px-2 py-1.5 text-xs" />
                        <input type="number" min="0" placeholder="شناسه گروه" value={editDraft.departmentId ?? ''} onChange={e => setEditDraft(d => ({ ...d, departmentId: e.target.value }))} className="border border-slate-300 rounded px-2 py-1.5 text-xs" />
                        <input type="number" min="1" max="20" placeholder="تکرار Nام" value={editDraft.repeatNumber ?? ''} onChange={e => setEditDraft(d => ({ ...d, repeatNumber: e.target.value }))} className="border border-slate-300 rounded px-2 py-1.5 text-xs" />
                        <input type="number" min="0" step="100000" placeholder="مبنای F (ریال)" value={editDraft.flatBase ?? ''} onChange={e => setEditDraft(d => ({ ...d, flatBase: e.target.value }))} className="border border-slate-300 rounded px-2 py-1.5 text-xs" />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-700">عبارت فرمول</label>
                        <ExpressionEditor
                          value={editDraft.expression ?? ''}
                          onChange={v => setEditDraft(d => ({ ...d, expression: v }))}
                          inputRef={editExprRef}
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(rule)}
                          disabled={saving === `rule-${rule.id}`}
                          className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
                        >
                          {saving === `rule-${rule.id}` ? '⟳ در حال ذخیره...' : '💾 ذخیره تغییرات'}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-4 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-bold"
                        >
                          انصراف
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {rules.length === 0 && (
            <div className="p-6 text-center text-slate-400 dark:text-slate-500 text-xs border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">هیچ قانون محاسبه‌ای یافت نشد — اولین قانون را با فرم بالا بسازید.</div>
          )}
        </div>

        <div className="p-3 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950 rounded-xl border border-indigo-200 text-xs text-indigo-900 dark:text-indigo-200">
          <strong>اولویت تطبیق:</strong> قانون با بیشترین تعداد بُعد مشخص (نوع درس + نقش + مرتبه + …) برنده است.
          <br />• <strong>عبارت فرمول:</strong> ترکیب متغیرهای TH PH WH UN ST RT CF BS HR (خروجی: ریال). بُعد خالی یعنی «همهٔ موارد».
          <br />• <strong>بازه دانشجو:</strong> قانون فقط وقتی اعمال می‌شود که تعداد دانشجو در بازه باشد (سقف خالی = بی‌نهایت).
        </div>
      </div>
    </div>
  );
}