'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { saveRegulationAction, deleteRegulationAction } from './actions';
import type { RegulationConfig } from '@/lib/regulations-types';
import {
  DEFAULT_BACHELOR_REGULATION_1403,
  DEFAULT_BACHELOR_REGULATION_1390,
  DEFAULT_MASTER_REGULATION_1403,
  REGULATION_PRESETS,
} from '@/lib/regulations-types';

export interface DegreeLevelItem {
  id: number;
  levelName: string;
  title: string | null;
  defaultPassingGrade: string | number;
  conditionalGpaThreshold: string | number;
  maxUnitsPerTerm: number | null;
}

export interface RegulationItem {
  id: number;
  title: string;
  degreeLevelId: number;
  degreeLevelTitle?: string;
  effectiveFromYear: number;
  effectiveToYear: number | null;
  rulesConfig: RegulationConfig;
  createdAt?: string | Date | null;
}

const faNum = (n: any) =>
  n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/**
 * نرمال‌سازی rulesConfig پیش از نشستن در فرم.
 *
 * ⚠ آیین‌نامه‌هایی که با seed-base یا نسخه‌های قدیمی‌تر ساخته شده‌اند ممکن است
 * بعضی بخش‌ها (مثلاً grading_and_gpa یا probation_and_tenure) را نداشته باشند.
 * فرم به این کلیدها مستقیم دسترسی می‌گیرد و نبودشان کل صفحه را با
 * «Cannot read properties of undefined» کرش می‌کرد (۵۰۰). اینجا هر بخش گمشده
 * از قالب پیش‌فرض پر می‌شود و مقادیر واقعی آیین‌نامه دست‌نخورده می‌مانند.
 */
function normalizeConfig(cfg: Partial<RegulationConfig> | null | undefined): RegulationConfig {
  const base = JSON.parse(JSON.stringify(DEFAULT_BACHELOR_REGULATION_1403)) as RegulationConfig;
  if (!cfg || typeof cfg !== 'object') return base;
  const src = JSON.parse(JSON.stringify(cfg)) as Record<string, any>;
  const out = base as unknown as Record<string, any>;
  for (const key of Object.keys(src)) {
    const v = src[key];
    out[key] =
      v && typeof v === 'object' && !Array.isArray(v) && out[key] && typeof out[key] === 'object'
        ? { ...out[key], ...v }
        : v;
  }
  return out as unknown as RegulationConfig;
}

export default function RegulationsClient(props: {
  regulations: RegulationItem[];
  degreeLevels: DegreeLevelItem[];
}) {
  const [selectedRegId, setSelectedRegId] = useState<number | null>(
    props.regulations[0]?.id || null
  );
  const [activeTab, setActiveTab] = useState<
    'overview' | 'probation' | 'units' | 'grading' | 'quotas' | 'simulator'
  >('overview');

  // State for form editing
  const selectedReg = useMemo(() => {
    return (
      props.regulations.find(r => r.id === selectedRegId) || {
        id: 0,
        title: 'آیین‌نامه جدید کارشناسی مصوب ۱۴۰۵',
        degreeLevelId: props.degreeLevels[0]?.id || 1,
        effectiveFromYear: 1405,
        effectiveToYear: null,
        rulesConfig: JSON.parse(JSON.stringify(DEFAULT_BACHELOR_REGULATION_1403)),
      }
    );
  }, [props.regulations, selectedRegId, props.degreeLevels]);

  const [formTitle, setFormTitle] = useState(selectedReg.title);
  const [formDegreeLevelId, setFormDegreeLevelId] = useState(selectedReg.degreeLevelId);
  const [formFromYear, setFormFromYear] = useState(selectedReg.effectiveFromYear);
  const [formToYear, setFormToYear] = useState<number | null>(selectedReg.effectiveToYear);
  const [formConfig, setFormConfig] = useState<RegulationConfig>(
    normalizeConfig(selectedReg.rulesConfig)
  );

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Sync state when selecting different regulation
  const handleSelectReg = (reg: RegulationItem) => {
    setSelectedRegId(reg.id);
    setFormTitle(reg.title);
    setFormDegreeLevelId(reg.degreeLevelId);
    setFormFromYear(reg.effectiveFromYear);
    setFormToYear(reg.effectiveToYear);
    setFormConfig(normalizeConfig(reg.rulesConfig));
    setMsg(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await saveRegulationAction({
        id: selectedRegId && selectedRegId > 0 ? selectedRegId : undefined,
        title: formTitle,
        degreeLevelId: formDegreeLevelId,
        effectiveFromYear: formFromYear,
        effectiveToYear: formToYear,
        rulesConfig: formConfig,
      });

      if (res.ok) {
        setMsg({ type: 'success', text: res.message || 'عملیات با موفقیت انجام شد.' });
      } else {
        setMsg({ type: 'error', text: res.error || 'خطا در ذخیره‌سازی' });
      }
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'خطای غیرمنتظره' });
    }
    setSaving(false);
  };

  // ── مرتب‌سازی فهرست نسخه‌های آیین‌نامه (کلیک: صعودی → نزولی → بدون سورت) ──
  // این صفحه جدول ندارد؛ سرستون‌های کوچک بالای فهرستِ کناری همین کار را می‌کنند.
  const [regSortKey, setRegSortKey] = useState<'title' | 'year' | 'degree' | null>(null);
  const [regSortDir, setRegSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleRegSort = (key: 'title' | 'year' | 'degree') => {
    if (regSortKey !== key) {
      setRegSortKey(key);
      setRegSortDir('asc');
    } else if (regSortDir === 'asc') {
      setRegSortDir('desc');
    } else {
      setRegSortKey(null);
    }
  };
  const sortedRegulations = useMemo(() => {
    if (!regSortKey) return props.regulations;
    const dir = regSortDir === 'asc' ? 1 : -1;
    return [...props.regulations].sort((a, b) => {
      if (regSortKey === 'year') return (a.effectiveFromYear - b.effectiveFromYear) * dir;
      if (regSortKey === 'degree')
        return String(a.degreeLevelTitle ?? '').localeCompare(String(b.degreeLevelTitle ?? ''), 'fa') * dir;
      return a.title.localeCompare(b.title, 'fa') * dir;
    });
  }, [props.regulations, regSortKey, regSortDir]);

  // ════════════════════════════════════════════════════════════════════════════
  // SIMULATOR STATE
  // ════════════════════════════════════════════════════════════════════════════
  const [simDegreeLevel, setSimDegreeLevel] = useState<number>(1);
  const [simEntryYear, setSimEntryYear] = useState<number>(1403);
  const [simPassedUnits, setSimPassedUnits] = useState<number>(132);
  const [simTotalUnits, setSimTotalUnits] = useState<number>(140);
  const [simPrevGpa, setSimPrevGpa] = useState<number>(11.2);
  const [simProbationCount, setSimProbationCount] = useState<number>(2);
  const [simSemesters, setSimSemesters] = useState<number>(7);
  const [simIsSummer, setSimIsSummer] = useState<boolean>(true);
  const [simQuota, setSimQuota] = useState<'NORMAL' | 'SHAHED_ISARGAR' | 'ELITE'>('NORMAL');

  const simResults = useMemo(() => {
    const rem = Math.max(0, simTotalUnits - simPassedUnits);
    const cfg = {
      ...DEFAULT_BACHELOR_REGULATION_1403,
      ...(formConfig || {}),
      probation_and_tenure: {
        ...DEFAULT_BACHELOR_REGULATION_1403.probation_and_tenure,
        ...(formConfig?.probation_and_tenure || {}),
      },
      regular_term_rules: {
        ...DEFAULT_BACHELOR_REGULATION_1403.regular_term_rules,
        ...(formConfig?.regular_term_rules || {}),
      },
      summer_term_rules: {
        ...DEFAULT_BACHELOR_REGULATION_1403.summer_term_rules,
        ...(formConfig?.summer_term_rules || {}),
      },
      graduating_term_rules: {
        ...DEFAULT_BACHELOR_REGULATION_1403.graduating_term_rules,
        ...(formConfig?.graduating_term_rules || {}),
      },
      grading_and_gpa: {
        ...DEFAULT_BACHELOR_REGULATION_1403.grading_and_gpa,
        ...(formConfig?.grading_and_gpa || {}),
      },
    };

    const probationThreshold = cfg.probation_and_tenure?.probation_gpa_threshold ?? 12;
    const isProbated = simPrevGpa < probationThreshold;
    const isHonors = simPrevGpa >= (cfg.regular_term_rules?.honors_min_gpa ?? 17);

    // تشخیص ترم آخر
    const isGraduating = simIsSummer
      ? rem <= (cfg.summer_term_rules?.graduating_max_units ?? 8)
      : rem <= (cfg.graduating_term_rules?.max_units ?? 24);

    let allowedMax = cfg.regular_term_rules?.max_units ?? 20;
    let minAllowed = cfg.regular_term_rules?.min_units ?? 12;

    if (simIsSummer) {
      minAllowed = 0;
      allowedMax = cfg.summer_term_rules?.default_max_units ?? 6;
      if (isGraduating) allowedMax = cfg.summer_term_rules?.graduating_max_units ?? 8;

      if (
        simQuota === 'SHAHED_ISARGAR' &&
        cfg.quota_overrides?.SHAHED_ISARGAR?.summer_term_rules?.default_max_units
      ) {
        allowedMax = Math.max(
          allowedMax,
          cfg.quota_overrides.SHAHED_ISARGAR.summer_term_rules.default_max_units
        );
      }
    } else {
      if (isGraduating && cfg.graduating_term_rules?.can_take_with_probation) {
        allowedMax = cfg.graduating_term_rules?.max_units ?? 24;
        minAllowed = 0;
      } else if (isProbated) {
        allowedMax = cfg.regular_term_rules?.probation_max_units ?? 14;
      } else if (isHonors) {
        allowedMax = cfg.regular_term_rules?.honors_max_units ?? 24;
      }
    }

    // بررسی سد مشروطی یا سنوات
    const maxProbations = cfg.probation_and_tenure?.max_total_probations ?? 3;
    const maxSemesters = cfg.probation_and_tenure?.max_study_semesters ?? 10;
    const isBlockedProbation = simProbationCount >= maxProbations;
    const isBlockedTenure = simSemesters >= maxSemesters;
    const isBlocked = isBlockedProbation || isBlockedTenure;

    return {
      rem,
      isProbated,
      isHonors,
      isGraduating,
      allowedMax,
      minAllowed,
      isBlocked,
      isBlockedProbation,
      isBlockedTenure,
      policy: cfg.grading_and_gpa?.failed_course_gpa_policy ?? 'EXCLUDE_IF_PASSED',
    };
  }, [
    simTotalUnits,
    simPassedUnits,
    formConfig,
    simPrevGpa,
    simIsSummer,
    simQuota,
    simProbationCount,
    simSemesters,
  ]);

  return (
    <div className="space-y-6 text-slate-800" dir="rtl">
      {/* Header Banner */}
      <div className="card !p-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-indigo-900 text-white rounded-2xl shadow-xl border-0">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">⚖️</span>
              <h1 className="text-xl sm:text-2xl font-black">
                مرکز مدیریت و کنترل آیین‌نامه‌های آموزشی (Regulation Engine)
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-indigo-200 leading-relaxed max-w-3xl">
              تنظیم و نسخه‌بندی بدون کد (No-Code) قوانین آموزشی، سقف واحدها، مشروطی، ترم تابستان،
              سهمیه‌های شاهد و سیاست حذف نمرات ردی پس از قبولی با اعمال بلادرنگ در انتخاب واحد و
              کارنامه.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setSelectedRegId(0);
                setFormTitle('آیین‌نامه جدید کارشناسی مصوب ۱۴۰۵');
                setFormDegreeLevelId(props.degreeLevels[0]?.id || 1);
                setFormFromYear(1405);
                setFormToYear(null);
                setFormConfig(JSON.parse(JSON.stringify(DEFAULT_BACHELOR_REGULATION_1403)));
                setActiveTab('overview');
                setMsg(null);
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl transition-all shadow-md active:scale-95 flex items-center gap-1.5"
            >
              <span>➕</span>
              <span>تعریف آیین‌نامه جدید</span>
            </button>
            <Link
              href="/admin/curriculum"
              className="bg-indigo-800/80 hover:bg-indigo-800 text-indigo-100 font-bold text-xs px-3.5 py-2.5 rounded-xl transition-all border border-indigo-700/60"
            >
              📚 سرفصل دروس
            </Link>
          </div>
        </div>
      </div>

      {/* Main Grid: Sidebar + Tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar: Regulations Version List */}
        <div className="lg:col-span-1 space-y-3">
          <div className="card !p-4 bg-white rounded-2xl shadow-sm border border-slate-200">
            <h3 className="font-extrabold text-xs text-slate-500 uppercase tracking-wider mb-3">
              نسخه‌های فعال آیین‌نامه‌ها
            </h3>
            {/* سرستون‌های مرتب‌سازی فهرست — کلیک: صعودی ▲ / نزولی ▼ / بدون سورت ↕ */}
            <div className="mb-2 flex flex-wrap items-center gap-1 text-2xs">
              <span className="text-slate-400">مرتب‌سازی:</span>
              {([
                ['title', 'عنوان'],
                ['year', 'ورودی'],
                ['degree', 'مقطع'],
              ] as const).map(([k, label]) => {
                const active = regSortKey === k;
                return (
                  <button
                    key={k}
                    onClick={() => toggleRegSort(k)}
                    title="مرتب‌سازی"
                    className={`rounded-md border px-1.5 py-0.5 font-bold transition-all ${
                      active
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 bg-slate-50 text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {label}{' '}
                    <span className="inline-block w-3 text-center">
                      {active ? (regSortDir === 'asc' ? '▲' : '▼') : <span className="opacity-30">↕</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="space-y-2">
              {sortedRegulations.map(reg => {
                const isSelected = reg.id === selectedRegId;
                return (
                  <button
                    key={reg.id}
                    onClick={() => handleSelectReg(reg)}
                    className={`w-full text-right p-3 rounded-xl transition-all border text-xs font-bold block ${
                      isSelected
                        ? 'bg-indigo-50 border-indigo-500 text-indigo-950 shadow-sm ring-2 ring-indigo-500/20'
                        : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-black truncate">{reg.title}</span>
                      <span className="text-3xs bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-mono">
                        {reg.degreeLevelTitle || 'مقطع'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-2xs text-slate-500 font-normal">
                      <span>ورودی {faNum(reg.effectiveFromYear)} به بعد</span>
                      <span
                        className={`text-3xs font-bold px-1.5 py-0.2 rounded ${
                          reg.rulesConfig?.grading_and_gpa?.failed_course_gpa_policy ===
                          'EXCLUDE_IF_PASSED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {reg.rulesConfig?.grading_and_gpa?.failed_course_gpa_policy ===
                        'EXCLUDE_IF_PASSED'
                          ? 'حذف نمره ردی'
                          : 'ابقای نمره ردی'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Info Box */}
          <div className="p-4 bg-indigo-50/80 border border-indigo-200 rounded-2xl text-xs text-indigo-900 space-y-2">
            <div className="font-extrabold text-sm flex items-center gap-1.5 text-indigo-950">
              <span>💡</span>
              <span>نحوه عملکرد موتور آیین‌نامه‌ها</span>
            </div>
            <p className="leading-relaxed text-slate-700">
              سیستم به هنگام <b>انتخاب واحد</b> و <b>تولید کارنامه رسمی</b>، بدون نیاز به تغییر کد
              برنامه، قوانین ورودی دانشجو را از این جدول خوانده و به صورت داینامیک ارزیابی می‌کند.
            </p>
          </div>
        </div>

        {/* Content Area: Tabs + Form Configuration */}
        <div className="lg:col-span-3 space-y-4">
          {/* Tabs Navigation */}
          <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-200/80 rounded-2xl text-xs font-bold">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3.5 py-2 rounded-xl transition-all ${
                activeTab === 'overview'
                  ? 'bg-white text-indigo-950 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📋 مشخصات پایه و نسخه
            </button>
            <button
              onClick={() => setActiveTab('probation')}
              className={`px-3.5 py-2 rounded-xl transition-all ${
                activeTab === 'probation'
                  ? 'bg-white text-indigo-950 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ⚠️ سنوات، مشروطی و سجاد
            </button>
            <button
              onClick={() => setActiveTab('units')}
              className={`px-3.5 py-2 rounded-xl transition-all ${
                activeTab === 'units'
                  ? 'bg-white text-indigo-950 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🎯 سقف واحد، تابستان و ترم آخر
            </button>
            <button
              onClick={() => setActiveTab('grading')}
              className={`px-3.5 py-2 rounded-xl transition-all ${
                activeTab === 'grading'
                  ? 'bg-white text-indigo-950 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📊 نمرات و حذف نمره ردی
            </button>
            <button
              onClick={() => setActiveTab('quotas')}
              className={`px-3.5 py-2 rounded-xl transition-all ${
                activeTab === 'quotas'
                  ? 'bg-white text-indigo-950 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🎖️ سهمیه شاهد و ایثارگر
            </button>
            <button
              onClick={() => setActiveTab('simulator')}
              className={`px-3.5 py-2 rounded-xl transition-all ${
                activeTab === 'simulator'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🧪 شبیه‌ساز و تست زنده قوانین
            </button>
          </div>

          {/* Alert Message */}
          {msg && (
            <div
              className={`p-3.5 rounded-xl text-xs font-bold flex items-center justify-between ${
                msg.type === 'success'
                  ? 'bg-emerald-50 text-emerald-900 border border-emerald-300'
                  : 'bg-rose-50 text-rose-900 border border-rose-300'
              }`}
            >
              <span>{msg.text}</span>
              <button onClick={() => setMsg(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
          )}

          {/* TAB 1: OVERVIEW & BASE INFO */}
          {activeTab === 'overview' && (
            <div className="card !p-5 bg-white rounded-2xl shadow-sm border border-slate-200 space-y-4">
              <h2 className="font-extrabold text-sm text-slate-800">
                مشخصات شناسه و بازه اعتبار آیین‌نامه
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    عنوان کامل آیین‌نامه:
                  </label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={e => setFormTitle(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 text-xs font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    مقطع تحصیلی هدف:
                  </label>
                  <select
                    value={formDegreeLevelId}
                    onChange={e => {
                      const id = Number(e.target.value);
                      setFormDegreeLevelId(id);
                      // آیین‌نامهٔ تازه (ذخیره‌نشده): قالب پیش‌فرض هم‌زمان با مقطع عوض شود
                      if (!selectedRegId || selectedRegId <= 0) {
                        const lv = props.degreeLevels.find(d => d.id === id);
                        const t = `${lv?.title || ''} ${lv?.levelName || ''}`;
                        if (/ارشد/i.test(t)) {
                          setFormConfig(JSON.parse(JSON.stringify(DEFAULT_MASTER_REGULATION_1403)));
                        } else if (/دکتر|phd/i.test(t)) {
                          setFormConfig(JSON.parse(JSON.stringify(REGULATION_PRESETS.reg1394PhdFor())));
                        } else {
                          setFormConfig(JSON.parse(JSON.stringify(DEFAULT_BACHELOR_REGULATION_1403)));
                        }
                      }
                    }}
                    className="w-full p-2.5 rounded-xl border border-slate-300 text-xs font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                  >
                    {props.degreeLevels.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.title || d.levelName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    سال شروع اجرا (از ورودی سال):
                  </label>
                  <input
                    type="number"
                    value={formFromYear}
                    onChange={e => setFormFromYear(Number(e.target.value))}
                    className="w-full p-2.5 rounded-xl border border-slate-300 text-xs font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    سال پایان اجرا (اختیاری):
                  </label>
                  <input
                    type="number"
                    value={formToYear || ''}
                    placeholder="خالی = همچنان معتبر و جاری"
                    onChange={e =>
                      setFormToYear(e.target.value ? Number(e.target.value) : null)
                    }
                    className="w-full p-2.5 rounded-xl border border-slate-300 text-xs font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Presets Button Bar — الگوهای آماده به تفکیک مقطع */}
              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-500">کارشناسی/کاردانی:</span>
                <button
                  type="button"
                  onClick={() =>
                    setFormConfig(JSON.parse(JSON.stringify(DEFAULT_BACHELOR_REGULATION_1403)))
                  }
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg font-medium"
                >
                  الگوی کارشناسی ۱۳۹۷ به بعد (حذف نمره ردی)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setFormConfig(JSON.parse(JSON.stringify(REGULATION_PRESETS.reg1402())))
                  }
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg font-medium"
                >
                  الگوی ۱۴۰۲ (حذف نمره ردی)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setFormConfig(JSON.parse(JSON.stringify(REGULATION_PRESETS.reg1393())))
                  }
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg font-medium"
                >
                  الگوی ۱۳۹۳ (حذف نمره ردی)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setFormConfig(JSON.parse(JSON.stringify(REGULATION_PRESETS.reg1391())))
                  }
                  className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-900 px-3 py-1.5 rounded-lg font-medium"
                  title="تبصره ۱۳۹۱: مردودی فقط با قبولی ۱۴+ حذف می‌شود"
                >
                  الگوی ۱۳۹۱ (تبصره ۱۴)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setFormConfig(JSON.parse(JSON.stringify(REGULATION_PRESETS.regPre1391())))
                  }
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg font-medium"
                >
                  الگوی ماقبل ۱۳۹۱ (ابقای نمره ردی)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setFormConfig(JSON.parse(JSON.stringify(DEFAULT_BACHELOR_REGULATION_1390)))
                  }
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg font-medium"
                >
                  الگوی کارشناسی ۱۳۹۰ (ابقای نمره ردی)
                </button>
                <span className="text-xs font-bold text-slate-500">ارشد:</span>
                <button
                  type="button"
                  onClick={() =>
                    setFormConfig(JSON.parse(JSON.stringify(DEFAULT_MASTER_REGULATION_1403)))
                  }
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg font-medium"
                >
                  الگوی کارشناسی ارشد (کف ۱۲، مرز ۱۴)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setFormConfig(JSON.parse(JSON.stringify(REGULATION_PRESETS.reg1394MasterFor())))
                  }
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg font-medium"
                >
                  الگوی ارشد ۱۳۹۴ (کف ۱۲، مرز ۱۴)
                </button>
                <span className="text-xs font-bold text-slate-500">دکتری:</span>
                <button
                  type="button"
                  onClick={() =>
                    setFormConfig(JSON.parse(JSON.stringify(REGULATION_PRESETS.reg1394PhdFor())))
                  }
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg font-medium"
                >
                  الگوی دکتری ۱۳۹۴ (کف ۱۴، مرز ۱۶)
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: PROBATION & STUDY SEMESTERS & SAJJAD INTEGRATION */}
          {activeTab === 'probation' && (
            <div className="card !p-5 bg-white rounded-2xl shadow-sm border border-slate-200 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-extrabold text-sm text-slate-800">
                  قوانین مشروطی، سقف سنوات و اتصال به کمیسیون سامانه سجاد
                </h2>
                <span className="text-xs bg-rose-100 text-rose-800 font-bold px-2 py-1 rounded-lg">
                  ⛔ قفل خودکار و ارجاع به سجاد (saorg.ir)
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                در صورت رسیدن دانشجو به سقف مشروطی یا اتمام سنوات، وضعیت دانشجو فوراً به{' '}
                <code className="text-rose-700 bg-rose-50 px-1 py-0.5 rounded font-mono">
                  BLOCKED_COMMISSION
                </code>{' '}
                تغییر کرده و پرونده دادخواست سجاد برای وی به صورت خودکار باز می‌شود.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    حداقل معدل مشروطی (GPA Threshold):
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={formConfig.probation_and_tenure.probation_gpa_threshold}
                    onChange={e =>
                      setFormConfig({
                        ...formConfig,
                        probation_and_tenure: {
                          ...formConfig.probation_and_tenure,
                          probation_gpa_threshold: Number(e.target.value),
                        },
                      })
                    }
                    className="w-full p-2.5 rounded-xl border border-slate-300 text-xs font-mono"
                  />
                  <span className="text-2xs text-slate-500">
                    ۱۲.۰۰ برای کارشناسی، ۱۴.۰۰ برای کارشناسی ارشد
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    حداکثر تعداد مشروطی متوالی مجاز:
                  </label>
                  <input
                    type="number"
                    value={formConfig.probation_and_tenure.max_consecutive_probations}
                    onChange={e =>
                      setFormConfig({
                        ...formConfig,
                        probation_and_tenure: {
                          ...formConfig.probation_and_tenure,
                          max_consecutive_probations: Number(e.target.value),
                        },
                      })
                    }
                    className="w-full p-2.5 rounded-xl border border-slate-300 text-xs font-mono"
                  />
                  <span className="text-2xs text-slate-500">معمولاً ۳ نیمسال متوالی</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    حداکثر تعداد مشروطی کل مجاز (متناوب):
                  </label>
                  <input
                    type="number"
                    value={formConfig.probation_and_tenure.max_total_probations}
                    onChange={e =>
                      setFormConfig({
                        ...formConfig,
                        probation_and_tenure: {
                          ...formConfig.probation_and_tenure,
                          max_total_probations: Number(e.target.value),
                        },
                      })
                    }
                    className="w-full p-2.5 rounded-xl border border-slate-300 text-xs font-mono"
                  />
                  <span className="text-2xs text-slate-500">معمولاً ۴ نیمسال برای کارشناسی</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    سقف سنوات عادی تحصیلی (نیمسال):
                  </label>
                  <input
                    type="number"
                    value={formConfig.probation_and_tenure.max_study_semesters}
                    onChange={e =>
                      setFormConfig({
                        ...formConfig,
                        probation_and_tenure: {
                          ...formConfig.probation_and_tenure,
                          max_study_semesters: Number(e.target.value),
                        },
                      })
                    }
                    className="w-full p-2.5 rounded-xl border border-slate-300 text-xs font-mono"
                  />
                  <span className="text-2xs text-slate-500">
                    ۸ نیمسال کارشناسی پیوسته، ۴ نیمسال ارشد
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: UNIT LIMITS, SUMMER & GRADUATING TERM */}
          {activeTab === 'units' && (
            <div className="card !p-5 bg-white rounded-2xl shadow-sm border border-slate-200 space-y-4">
              <h2 className="font-extrabold text-sm text-slate-800">
                قوانین سقف و کف انتخاب واحد، ترم تابستان و ترم آخر
              </h2>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <h3 className="font-bold text-xs text-indigo-950 flex items-center gap-2">
                  <span>📅</span>
                  <span>قوانین نیمسال عادی (مهر / بهمن):</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-2xs font-bold text-slate-600 mb-1">
                      کف واحد عادی:
                    </label>
                    <input
                      type="number"
                      value={formConfig.regular_term_rules.min_units}
                      onChange={e =>
                        setFormConfig({
                          ...formConfig,
                          regular_term_rules: {
                            ...formConfig.regular_term_rules,
                            min_units: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full p-2 rounded-lg border border-slate-300 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-2xs font-bold text-slate-600 mb-1">
                      سقف واحد عادی:
                    </label>
                    <input
                      type="number"
                      value={formConfig.regular_term_rules.max_units}
                      onChange={e =>
                        setFormConfig({
                          ...formConfig,
                          regular_term_rules: {
                            ...formConfig.regular_term_rules,
                            max_units: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full p-2 rounded-lg border border-slate-300 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-2xs font-bold text-slate-600 mb-1">
                      سقف واحد دانشجوی مشروط:
                    </label>
                    <input
                      type="number"
                      value={formConfig.regular_term_rules.probation_max_units}
                      onChange={e =>
                        setFormConfig({
                          ...formConfig,
                          regular_term_rules: {
                            ...formConfig.regular_term_rules,
                            probation_max_units: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full p-2 rounded-lg border border-slate-300 text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="block text-2xs font-bold text-slate-600 mb-1">
                      حداقل معدل دانشجوی ممتاز (معدل الف):
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={formConfig.regular_term_rules.honors_min_gpa}
                      onChange={e =>
                        setFormConfig({
                          ...formConfig,
                          regular_term_rules: {
                            ...formConfig.regular_term_rules,
                            honors_min_gpa: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full p-2 rounded-lg border border-slate-300 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-2xs font-bold text-slate-600 mb-1">
                      سقف واحد دانشجوی ممتاز (معدل الف):
                    </label>
                    <input
                      type="number"
                      value={formConfig.regular_term_rules.honors_max_units}
                      onChange={e =>
                        setFormConfig({
                          ...formConfig,
                          regular_term_rules: {
                            ...formConfig.regular_term_rules,
                            honors_max_units: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full p-2 rounded-lg border border-slate-300 text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Summer Rules */}
              <div className="p-4 bg-amber-50/70 rounded-xl border border-amber-200 space-y-3">
                <h3 className="font-bold text-xs text-amber-950 flex items-center gap-2">
                  <span>☀️</span>
                  <span>قوانین نیمسال تابستان:</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-2xs font-bold text-slate-600 mb-1">
                      سقف واحد عادی تابستان:
                    </label>
                    <input
                      type="number"
                      value={formConfig.summer_term_rules.default_max_units}
                      onChange={e =>
                        setFormConfig({
                          ...formConfig,
                          summer_term_rules: {
                            ...formConfig.summer_term_rules,
                            default_max_units: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full p-2 rounded-lg border border-slate-300 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-2xs font-bold text-slate-600 mb-1">
                      سقف واحد تابستان برای دانشجوی ترم آخر:
                    </label>
                    <input
                      type="number"
                      value={formConfig.summer_term_rules.graduating_max_units}
                      onChange={e =>
                        setFormConfig({
                          ...formConfig,
                          summer_term_rules: {
                            ...formConfig.summer_term_rules,
                            graduating_max_units: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full p-2 rounded-lg border border-slate-300 text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Graduating Rules */}
              <div className="p-4 bg-emerald-50/70 rounded-xl border border-emerald-200 space-y-3">
                <h3 className="font-bold text-xs text-emerald-950 flex items-center gap-2">
                  <span>🎓</span>
                  <span>تسهیلات فارغ‌التحصیلی (ترم آخر):</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-2xs font-bold text-slate-600 mb-1">
                      سقف واحد ترم آخر:
                    </label>
                    <input
                      type="number"
                      value={formConfig.graduating_term_rules.max_units}
                      onChange={e =>
                        setFormConfig({
                          ...formConfig,
                          graduating_term_rules: {
                            ...formConfig.graduating_term_rules,
                            max_units: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full p-2 rounded-lg border border-slate-300 text-xs font-mono"
                    />
                  </div>
                  <div className="flex flex-col justify-center space-y-2 pt-2">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-800">
                      <input
                        type="checkbox"
                        checked={formConfig.graduating_term_rules.can_take_with_probation}
                        onChange={e =>
                          setFormConfig({
                            ...formConfig,
                            graduating_term_rules: {
                              ...formConfig.graduating_term_rules,
                              can_take_with_probation: e.target.checked,
                            },
                          })
                        }
                        className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                      />
                      <span>مجاز بودن اخذ سقف واحد ترم آخر حتی در صورت مشروط بودن ترم قبل</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-800">
                      <input
                        type="checkbox"
                        checked={formConfig.graduating_term_rules.auto_corequisite_allowed}
                        onChange={e =>
                          setFormConfig({
                            ...formConfig,
                            graduating_term_rules: {
                              ...formConfig.graduating_term_rules,
                              auto_corequisite_allowed: e.target.checked,
                            },
                          })
                        }
                        className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                      />
                      <span>هم‌نیازی خودکار دروس پیش‌نیاز/پس‌نیاز در ترم آخر</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: GRADING & EXCLUDE_IF_PASSED POLICY */}
          {activeTab === 'grading' && (
            <div className="card !p-5 bg-white rounded-2xl shadow-sm border border-slate-200 space-y-4">
              <h2 className="font-extrabold text-sm text-slate-800">
                سیاست ارزیابی نمرات و حذف نمره ردی پس از قبولی
              </h2>

              <div className="p-4 bg-indigo-50/70 rounded-xl border border-indigo-200 space-y-3">
                <label className="block text-xs font-bold text-indigo-950 mb-1">
                  سیاست نمره ردی پس از گذراندن مجدد درس (Failed Course GPA Policy):
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label
                    className={`p-3.5 rounded-xl border cursor-pointer block transition-all ${
                      formConfig.grading_and_gpa.failed_course_gpa_policy === 'EXCLUDE_IF_PASSED'
                        ? 'bg-emerald-50 border-emerald-500 ring-2 ring-emerald-500/20'
                        : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <input
                        type="radio"
                        name="policy"
                        checked={
                          formConfig.grading_and_gpa.failed_course_gpa_policy ===
                          'EXCLUDE_IF_PASSED'
                        }
                        onChange={() =>
                          setFormConfig({
                            ...formConfig,
                            grading_and_gpa: {
                              ...formConfig.grading_and_gpa,
                              failed_course_gpa_policy: 'EXCLUDE_IF_PASSED',
                            },
                          })
                        }
                        className="text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="font-bold text-xs text-emerald-950">
                        EXCLUDE_IF_PASSED (آیین‌نامه مصوب ۱۳۹۷ به بعد)
                      </span>
                    </div>
                    <p className="text-2xs text-slate-600 leading-relaxed pr-6">
                      اگر دانشجو در درسی مردود شود و در ترم‌های بعد آن درس را با نمره قبولی پاس
                      کند، <b>نمره مردودی قبلی از صورت و مخرج معدل کل کسر و حذف می‌شود</b>.
                    </p>
                  </label>

                  <label
                    className={`p-3.5 rounded-xl border cursor-pointer block transition-all ${
                      formConfig.grading_and_gpa.failed_course_gpa_policy === 'KEEP_ALWAYS'
                        ? 'bg-amber-50 border-amber-500 ring-2 ring-amber-500/20'
                        : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <input
                        type="radio"
                        name="policy"
                        checked={
                          formConfig.grading_and_gpa.failed_course_gpa_policy === 'KEEP_ALWAYS'
                        }
                        onChange={() =>
                          setFormConfig({
                            ...formConfig,
                            grading_and_gpa: {
                              ...formConfig.grading_and_gpa,
                              failed_course_gpa_policy: 'KEEP_ALWAYS',
                            },
                          })
                        }
                        className="text-amber-600 focus:ring-amber-500"
                      />
                      <span className="font-bold text-xs text-amber-950">
                        KEEP_ALWAYS (آیین‌نامه مصوب ۱۳۹۰)
                      </span>
                    </div>
                    <p className="text-2xs text-slate-600 leading-relaxed pr-6">
                      تمام نمرات مردودی و قبولی دانشجو همیشه در محاسبه معدل کل ضرب شده و در کارنامه
                      باقی می‌مانند.
                    </p>
                  </label>
                </div>

                <div className="pt-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    کف نمره قبولی پیش‌فرض مقطع (Default Passing Grade):
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={formConfig.grading_and_gpa.default_passing_grade}
                    onChange={e =>
                      setFormConfig({
                        ...formConfig,
                        grading_and_gpa: {
                          ...formConfig.grading_and_gpa,
                          default_passing_grade: Number(e.target.value),
                        },
                      })
                    }
                    className="w-full sm:w-1/2 p-2.5 rounded-xl border border-slate-300 text-xs font-mono"
                  />
                  <span className="text-2xs text-slate-500">
                    ۱۰ برای کاردانی و کارشناسی، ۱۲ برای ارشد، ۱۴ برای دکتری
                  </span>
                </div>

                <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      حد نصاب قبولی مجدد (تبصره ۱۳۹۱):
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={formConfig.grading_and_gpa.retakeMinGrade ?? ''}
                      placeholder="خالی = همان کف قبولی"
                      onChange={e =>
                        setFormConfig({
                          ...formConfig,
                          grading_and_gpa: {
                            ...formConfig.grading_and_gpa,
                            retakeMinGrade: e.target.value === '' ? undefined : Number(e.target.value),
                          },
                        })
                      }
                      className="w-full p-2.5 rounded-xl border border-slate-300 text-xs font-mono"
                    />
                    <span className="text-2xs text-slate-500">
                      فقط تبصره ۱۳۹۱: مردودی قبلی فقط با قبولی ۱۴+ حذف می‌شود.
                    </span>
                    {formConfig.grading_and_gpa.failed_course_gpa_policy === 'EXCLUDE_IF_PASSED_1391' &&
                      formConfig.grading_and_gpa.retakeMinGrade == null && (
                        <span className="block text-2xs text-amber-700 font-bold">
                          ⚠ سیاست ۱۳۹۱ انتخاب شده ولی حد نصاب خالی است (فعلاً همان کف قبولی اعمال می‌شود).
                        </span>
                      )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      کد سفارشی سما برای مردودی حذف‌شده (اختیاری):
                    </label>
                    <input
                      type="text"
                      value={formConfig.grading_and_gpa.failed_sama_status_code ?? ''}
                      placeholder="خالی = خودکار (۹۳۱/۹۴۱/۹۵۱/‎-۹۱)"
                      onChange={e =>
                        setFormConfig({
                          ...formConfig,
                          grading_and_gpa: {
                            ...formConfig.grading_and_gpa,
                            failed_sama_status_code: e.target.value.trim() || undefined,
                          },
                        })
                      }
                      className="w-full p-2.5 rounded-xl border border-slate-300 text-xs font-mono"
                      dir="ltr"
                    />
                    <span className="text-2xs text-slate-500">
                      اگر پر شود، به‌جای کد خودکار آیین‌نامه روی مردودیِ جبران‌شده می‌نشیند.
                    </span>
                  </div>
                </div>

                <div className="pt-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    برچسب نمایشی آیین‌نامه (در کارنامه چاپ می‌شود):
                  </label>
                  <input
                    type="text"
                    value={formConfig.grading_and_gpa.regulationLabel ?? ''}
                    placeholder="مثلاً آیین‌نامه ۱۳۹۳"
                    onChange={e =>
                      setFormConfig({
                        ...formConfig,
                        grading_and_gpa: {
                          ...formConfig.grading_and_gpa,
                          regulationLabel: e.target.value.trim() || undefined,
                        },
                      })
                    }
                    className="w-full sm:w-1/2 p-2.5 rounded-xl border border-slate-300 text-xs font-medium"
                  />
                </div>

                <div className="pt-2 border-t border-indigo-200/70 mt-1">
                  <label className="flex items-start gap-2.5 cursor-pointer p-3 rounded-xl bg-white border border-slate-200 hover:border-indigo-300">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-indigo-700 w-4 h-4 shrink-0"
                      checked={formConfig.grading_and_gpa.dedupeRepeatedCourses === true}
                      onChange={e =>
                        setFormConfig({
                          ...formConfig,
                          grading_and_gpa: {
                            ...formConfig.grading_and_gpa,
                            dedupeRepeatedCourses: e.target.checked,
                          },
                        })
                      }
                    />
                    <span>
                      <span className="block font-bold text-xs text-slate-800">
                        فقط بهترین نمرهٔ درس تکراری در معدل کل شمرده شود
                      </span>
                      <span className="block text-2xs text-slate-500 leading-relaxed mt-0.5">
                        اگر دانشجو درسی را که <b>قبلاً هم قبول شده</b> دوباره برای ارتقای معدل اخذ
                        کند، با فعال‌کردن این گزینه فقط <b>بالاترین</b> نمره‌ی آن درس (و واحدش
                        یک‌بار) در معدل کل حساب می‌شود؛ در غیر این صورت هر بار اخذ، جدا در معدل
                        کل ضرب می‌شود (رفتار پیش‌فرض فعلی). این گزینه مستقل از سیاست حذف نمره
                        مردودی بالاست و فقط روی درسی که <u>هر دو بار قبول شده</u> اثر دارد.
                      </span>
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: QUOTA OVERRIDES (SHAHED / ISARGAR) */}
          {activeTab === 'quotas' && (
            <div className="card !p-5 bg-white rounded-2xl shadow-sm border border-slate-200 space-y-4">
              <h2 className="font-extrabold text-sm text-slate-800">
                تبصره‌ها و اوررایدهای سهمیه‌های خاص (شاهد، ایثارگر و استعداد درخشان)
              </h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                قوانین این بخش برای دانشجویان دارای سهمیه ثبت‌شده در پرونده، بر قوانین عمومی تقدم
                داشته و به صورت خودکار اعمال می‌گردد.
              </p>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <h3 className="font-bold text-xs text-indigo-950">
                  🎖️ سهمیه شاهد و ایثارگر (SHAHED_ISARGAR):
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-2xs font-bold text-slate-600 mb-1">
                      سقف واحد تابستان برای سهمیه شاهد:
                    </label>
                    <input
                      type="number"
                      value={
                        formConfig.quota_overrides?.SHAHED_ISARGAR?.summer_term_rules
                          ?.default_max_units || 8
                      }
                      onChange={e =>
                        setFormConfig({
                          ...formConfig,
                          quota_overrides: {
                            ...formConfig.quota_overrides,
                            SHAHED_ISARGAR: {
                              ...formConfig.quota_overrides?.SHAHED_ISARGAR,
                              summer_term_rules: {
                                default_max_units: Number(e.target.value),
                              },
                            },
                          },
                        })
                      }
                      className="w-full p-2 rounded-lg border border-slate-300 text-xs font-mono"
                    />
                    <span className="text-3xs text-slate-500">
                      طبق بخشنامه وزارت علوم: ۸ واحد در تابستان عادی
                    </span>
                  </div>
                  <div>
                    <label className="block text-2xs font-bold text-slate-600 mb-1">
                      سنوات ارفاقی پیش‌فرض سهمیه شاهد (نیمسال):
                    </label>
                    <input
                      type="number"
                      value={
                        formConfig.quota_overrides?.SHAHED_ISARGAR?.extra_allowed_semesters || 2
                      }
                      onChange={e =>
                        setFormConfig({
                          ...formConfig,
                          quota_overrides: {
                            ...formConfig.quota_overrides,
                            SHAHED_ISARGAR: {
                              ...formConfig.quota_overrides?.SHAHED_ISARGAR,
                              extra_allowed_semesters: Number(e.target.value),
                            },
                          },
                        })
                      }
                      className="w-full p-2 rounded-lg border border-slate-300 text-xs font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: REGULATION SANDBOX / SIMULATOR */}
          {activeTab === 'simulator' && (
            <div className="card !p-5 bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 text-white rounded-2xl shadow-xl border-0 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-black text-sm text-white flex items-center gap-2">
                    <span>🧪</span>
                    <span>شبیه‌ساز و تست زنده موتور آیین‌نامه‌ها (Sandbox)</span>
                  </h2>
                  <p className="text-xs text-indigo-200 mt-0.5">
                    با تغییر مقادیر زیر، تصمیمات موتور هوشمند آیین‌نامه‌ها را برای سناریوهای مختلف
                    تست و اعتبارسنجی نمایید.
                  </p>
                </div>
                <span className="text-xs bg-indigo-500/30 text-indigo-200 px-3 py-1 rounded-xl border border-indigo-400/30 font-mono">
                  Live Regulation Evaluator
                </span>
              </div>

              {/* Simulation Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-white/10 p-4 rounded-xl backdrop-blur-sm text-xs">
                <div>
                  <label className="block font-bold text-indigo-200 mb-1">واحدهای گذرانده:</label>
                  <input
                    type="number"
                    value={simPassedUnits}
                    onChange={e => setSimPassedUnits(Number(e.target.value))}
                    className="w-full p-2 rounded-lg bg-slate-900 border border-indigo-400/50 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-indigo-200 mb-1">کل واحدهای چارت:</label>
                  <input
                    type="number"
                    value={simTotalUnits}
                    onChange={e => setSimTotalUnits(Number(e.target.value))}
                    className="w-full p-2 rounded-lg bg-slate-900 border border-indigo-400/50 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-indigo-200 mb-1">معدل ترم قبل:</label>
                  <input
                    type="number"
                    step="0.1"
                    value={simPrevGpa}
                    onChange={e => setSimPrevGpa(Number(e.target.value))}
                    className="w-full p-2 rounded-lg bg-slate-900 border border-indigo-400/50 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-indigo-200 mb-1">تعداد مشروطی‌ها:</label>
                  <input
                    type="number"
                    value={simProbationCount}
                    onChange={e => setSimProbationCount(Number(e.target.value))}
                    className="w-full p-2 rounded-lg bg-slate-900 border border-indigo-400/50 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-indigo-200 mb-1">نیمسال تحصیلی:</label>
                  <input
                    type="number"
                    value={simSemesters}
                    onChange={e => setSimSemesters(Number(e.target.value))}
                    className="w-full p-2 rounded-lg bg-slate-900 border border-indigo-400/50 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-indigo-200 mb-1">نوع نیمسال جاری:</label>
                  <select
                    value={simIsSummer ? '1' : '0'}
                    onChange={e => setSimIsSummer(e.target.value === '1')}
                    className="w-full p-2 rounded-lg bg-slate-900 border border-indigo-400/50 text-white font-medium"
                  >
                    <option value="0">نیمسال عادی (مهر / بهمن)</option>
                    <option value="1">نیمسال تابستان</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-indigo-200 mb-1">نوع سهمیه دانشجو:</label>
                  <select
                    value={simQuota}
                    onChange={e => setSimQuota(e.target.value as any)}
                    className="w-full p-2 rounded-lg bg-slate-900 border border-indigo-400/50 text-white font-medium"
                  >
                    <option value="NORMAL">عادی</option>
                    <option value="SHAHED_ISARGAR">شاهد و ایثارگر</option>
                    <option value="ELITE">استعداد درخشان</option>
                  </select>
                </div>
              </div>

              {/* Simulation Output Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                {/* Result Card 1 */}
                <div className="p-4 bg-white/10 rounded-xl border border-white/10 space-y-1">
                  <span className="text-2xs text-indigo-300 font-bold">
                    سقف مجاز انتخاب واحد:
                  </span>
                  <div className="text-2xl font-black text-emerald-400">
                    {faNum(simResults.allowedMax)} واحد
                  </div>
                  <p className="text-2xs text-slate-300">
                    کف واحد مجاز: {faNum(simResults.minAllowed)} واحد
                  </p>
                </div>

                {/* Result Card 2 */}
                <div className="p-4 bg-white/10 rounded-xl border border-white/10 space-y-1">
                  <span className="text-2xs text-indigo-300 font-bold">وضعیت فارغ‌التحصیلی:</span>
                  <div className="text-sm font-extrabold text-amber-300">
                    {simResults.isGraduating ? '🎓 دانشجوی ترم آخر' : 'تحصیل عادی'}
                  </div>
                  <p className="text-2xs text-slate-300">
                    {faNum(simResults.rem)} واحد تا فراغت از تحصیل
                  </p>
                </div>

                {/* Result Card 3 */}
                <div className="p-4 bg-white/10 rounded-xl border border-white/10 space-y-1">
                  <span className="text-2xs text-indigo-300 font-bold">وضعیت حساب دانشجو:</span>
                  <div
                    className={`text-sm font-extrabold ${
                      simResults.isBlocked ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  >
                    {simResults.isBlocked ? '⛔ مسدود (کمیسیون سجاد)' : '✅ فعال و مجاز'}
                  </div>
                  <p className="text-2xs text-slate-300">
                    {simResults.isBlockedProbation
                      ? 'تجاوز از سقف مشروطی'
                      : simResults.isBlockedTenure
                      ? 'اتمام سقف سنوات'
                      : 'سیاست کارنامه: ' +
                        (simResults.policy === 'EXCLUDE_IF_PASSED' ? 'حذف نمره ردی' : 'ابقای نمره')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Action Bottom Bar */}
          <div className="card !p-4 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-500 font-medium">
              تغییرات فوراً در موتور محاسباتی انتخاب واحد و تولید کارنامه کل فعال خواهند شد.
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs px-6 py-2.5 rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center gap-2"
              >
                <span>💾</span>
                <span>{saving ? 'در حال ذخیره‌سازی...' : 'ذخیره و اعمال سراسری آیین‌نامه'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
