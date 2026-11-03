'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { saveLessonPlan } from '@/app/professor/lesson-plan/actions';

type SessionKind = 'THEORY' | 'PRACTICAL';
type CourseMode = 'THEORY' | 'PRACTICAL' | 'COMBINED';
type PlanStatus = 'DRAFT' | 'SUBMITTED';

interface SessionRow {
  sessionNo: number;
  sessionKind: SessionKind;
  topic: string;
  details: string;
  weightId?: number;
}

interface WeightRow {
  id?: number;
  title: string;
  percent: number;
}

export interface LessonPlanInitial {
  plan: {
    id: number | null;
    courseMode: string;
    totalSessions: number;
    objectives: string;
    resources: string;
    status: string;
    submittedAt: string | null;
  } | null;
  sessions: { id?: number; sessionNo: number; sessionKind: string; topic: string; details?: string | null; weightId?: number | null }[];
  weights: { id?: number; title: string; percent: number }[];
  required: boolean;
  notice: string | null;
  isOwner: boolean;
  courseTitle: string;
  courseModeDefault: string;
}

const faNum = (n: unknown) =>
  n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

function normMode(v: string | null | undefined, fallback: string): CourseMode {
  const s = String(v ?? fallback ?? 'COMBINED').toUpperCase();
  if (s === 'THEORY' || s === 'T' || s === 'تئوری') return 'THEORY';
  if (s === 'PRACTICAL' || s === 'P' || s === 'عملی') return 'PRACTICAL';
  return 'COMBINED';
}

function normKind(v: string | null | undefined): SessionKind {
  return String(v ?? '').toUpperCase().startsWith('PRACT') ? 'PRACTICAL' : 'THEORY';
}

export default function LessonPlanEditor({
  offeringId,
  initial,
}: {
  offeringId: number;
  initial: LessonPlanInitial;
}) {
  const readOnly = !initial.isOwner;
  const [courseMode, setCourseMode] = useState<CourseMode>(() =>
    normMode(initial.plan?.courseMode, initial.courseModeDefault),
  );
  const [totalSessions, setTotalSessions] = useState<number>(
    Math.min(32, Math.max(1, initial.plan?.totalSessions ?? initial.sessions.length ?? 16)),
  );
  const [objectives, setObjectives] = useState(initial.plan?.objectives ?? '');
  const [resources, setResources] = useState(initial.plan?.resources ?? '');
  const [sessions, setSessions] = useState<SessionRow[]>(() => {
    const rows: SessionRow[] = (initial.sessions ?? []).map(s => ({
      sessionNo: s.sessionNo,
      sessionKind: normKind(s.sessionKind),
      topic: s.topic ?? '',
      details: s.details ?? '',
      weightId: s.weightId ?? undefined,
    }));
    const target = Math.min(32, Math.max(1, initial.plan?.totalSessions ?? rows.length ?? 16));
    const out: SessionRow[] = [];
    for (let n = 1; n <= target; n++) {
      const found = rows.find(r => r.sessionNo === n);
      out.push(found ?? { sessionNo: n, sessionKind: 'THEORY', topic: '', details: '' });
    }
    return out;
  });
  const [weights, setWeights] = useState<WeightRow[]>(() =>
    (initial.weights ?? []).map(w => ({ id: w.id, title: w.title ?? '', percent: Number(w.percent ?? 0) })),
  );
  const [status] = useState<string>(initial.plan?.status ?? 'DRAFT');
  const [saving, setSaving] = useState<'DRAFT' | 'SUBMITTED' | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState<string | null>(null);

  const weightsSum = useMemo(
    () => weights.reduce((s, w) => s + (Number.isFinite(Number(w.percent)) ? Number(w.percent) : 0), 0),
    [weights],
  );
  const weightsValid = weights.length > 0 && weightsSum === 100;

  const changeCount = (next: number) => {
    const clamped = Math.min(32, Math.max(1, next));
    setTotalSessions(clamped);
    setSessions(prev => {
      const byNo = new Map(prev.map(r => [r.sessionNo, r]));
      const out: SessionRow[] = [];
      for (let n = 1; n <= clamped; n++) {
        out.push(byNo.get(n) ?? { sessionNo: n, sessionKind: 'THEORY', topic: '', details: '' });
      }
      return out;
    });
  };

  const changeMode = (m: CourseMode) => {
    setCourseMode(m);
    if (m === 'THEORY' || m === 'PRACTICAL') {
      const kind: SessionKind = m === 'THEORY' ? 'THEORY' : 'PRACTICAL';
      setSessions(prev => prev.map(r => ({ ...r, sessionKind: kind })));
    }
  };

  const updateSession = (no: number, patch: Partial<SessionRow>) => {
    setSessions(prev => prev.map(r => (r.sessionNo === no ? { ...r, ...patch } : r)));
  };

  const doSave = async (target: 'DRAFT' | 'SUBMITTED') => {
    setServerError(null);
    setSavedOk(null);
    if (target === 'SUBMITTED' && !weightsValid) {
      setServerError('جمع درصدهای بارم‌بندی باید دقیقاً ۱۰۰ باشد تا ثبت نهایی انجام شود.');
      return;
    }
    setSaving(target);
    try {
      const res = await saveLessonPlan(offeringId, {
        courseMode,
        totalSessions,
        objectives,
        resources,
        status: target as PlanStatus,
        sessions: sessions.map(s => ({
          sessionNo: s.sessionNo,
          sessionKind: s.sessionKind,
          topic: s.topic,
          details: s.details || undefined,
          weightId: s.weightId,
        })),
        weights: weights.map(w => ({ title: w.title, percent: Number(w.percent) })),
      });
      if (!res.ok) {
        setServerError(res.error || 'خطا در ذخیره طرح درس.');
        return;
      }
      setSavedOk(target === 'SUBMITTED' ? 'طرح درس با موفقیت ثبت نهایی شد.' : 'پیش‌نویس طرح درس ذخیره شد.');
    } catch {
      setServerError('خطا در ارتباط با سرور.');
    } finally {
      setSaving(null);
    }
  };

  const disabled = readOnly || saving !== null;
  const inputCls =
    'w-full border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400';

  return (
    <div className="space-y-5 font-sans">
      {/* Header */}
      <div className="bg-gradient-to-l from-indigo-950 via-indigo-900 to-slate-900 text-white rounded-2xl p-5 shadow-lg border border-indigo-700/50">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold bg-amber-400 text-slate-950">
                طرح درس
              </span>
              <span className="text-xs text-indigo-200">{initial.courseTitle || `ارائه ${faNum(offeringId)}`}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">📋 تدوین طرح درس نیمسال</h1>
          </div>
          <Link
            href="/professor/schedule"
            className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/20 transition"
          >
            بازگشت به برنامه هفتگی
          </Link>
        </div>
      </div>

      {/* Required banner (pressure only, never a hard block) */}
      {initial.required && status !== 'SUBMITTED' && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl text-xs font-bold text-amber-900 leading-6">
          <div>تکمیل طرح درس از سوی آموزش الزامی شده است.</div>
          {initial.notice && <div className="mt-1 text-amber-800">{initial.notice}</div>}
        </div>
      )}

      {/* Non-owner read-only notice */}
      {readOnly && (
        <div className="p-4 bg-slate-100 border border-slate-300 rounded-2xl text-xs font-bold text-slate-700 leading-6">
          این طرح درس متعلق به استاد دیگری است؛ شما فقط امکان مشاهده دارید و دکمه‌های ذخیره غیرفعال است.
        </div>
      )}

      {serverError && (
        <div className="p-4 bg-rose-50 border border-rose-300 rounded-2xl text-xs font-bold text-rose-800 leading-6">
          {serverError}
        </div>
      )}
      {savedOk && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-2xl text-xs font-bold text-emerald-800 leading-6">
          {savedOk}
        </div>
      )}

      {/* Mode + totalSessions */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1.5">شیوه برگزاری درس:</label>
            <div className="flex items-center gap-1.5">
              {(
                [
                  { v: 'THEORY', label: 'تئوری' },
                  { v: 'PRACTICAL', label: 'عملی' },
                  { v: 'COMBINED', label: 'ترکیبی' },
                ] as { v: CourseMode; label: string }[]
              ).map(o => (
                <button
                  key={o.v}
                  type="button"
                  disabled={disabled}
                  onClick={() => changeMode(o.v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-50 ${
                    courseMode === o.v ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-2xs text-slate-500 mt-1.5 leading-5">
              در حالت تئوری/عملی همه جلسات یکدست می‌شوند؛ در حالت ترکیبی نوع هر جلسه جداگانه قابل انتخاب است.
            </p>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1.5">تعداد جلسات (۱ تا ۳۲):</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={disabled || totalSessions <= 1}
                onClick={() => changeCount(totalSessions - 1)}
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 font-black text-lg disabled:opacity-40"
              >
                −
              </button>
              <span className="min-w-12 text-center font-black text-lg">{faNum(totalSessions)}</span>
              <button
                type="button"
                disabled={disabled || totalSessions >= 32}
                onClick={() => changeCount(totalSessions + 1)}
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 font-black text-lg disabled:opacity-40"
              >
                ＋
              </button>
            </div>
            <p className="text-2xs text-slate-500 mt-1.5 leading-5">
              با تغییر تعداد، ردیف‌های مشترک حفظ می‌شوند و فقط ابتدا/انتهای جدول بازسازی می‌شود.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1.5">اهداف درس:</label>
            <textarea
              value={objectives}
              onChange={e => setObjectives(e.target.value)}
              disabled={disabled}
              rows={4}
              placeholder="اهداف آموزشی و یادگیری این درس را بنویسید…"
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1.5">منابع درس:</label>
            <textarea
              value={resources}
              onChange={e => setResources(e.target.value)}
              disabled={disabled}
              rows={4}
              placeholder="کتاب، جزوه و منابع کمک‌آموزشی…"
              className={inputCls}
            />
          </div>
        </div>
      </div>

      {/* Sessions */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-3">
        <h3 className="font-extrabold text-slate-900 text-base">جلسات درس ({faNum(totalSessions)} جلسه)</h3>
        <div className="space-y-3">
          {sessions.map(s => (
            <div key={s.sessionNo} className="border border-slate-200 rounded-2xl p-3 space-y-2 bg-slate-50/50">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="w-16 shrink-0 text-center px-2 py-1 rounded-lg bg-slate-900 text-white font-black text-xs">
                  جلسه {faNum(s.sessionNo)}
                </span>
                {courseMode === 'COMBINED' ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => updateSession(s.sessionNo, { sessionKind: 'THEORY' })}
                      className={`px-2.5 py-1 rounded-lg text-2xs font-bold transition disabled:opacity-50 ${
                        s.sessionKind === 'THEORY' ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      تئوری
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => updateSession(s.sessionNo, { sessionKind: 'PRACTICAL' })}
                      className={`px-2.5 py-1 rounded-lg text-2xs font-bold transition disabled:opacity-50 ${
                        s.sessionKind === 'PRACTICAL' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      عملی
                    </button>
                  </div>
                ) : (
                  <span
                    className={`px-2.5 py-1 rounded-lg text-2xs font-bold ${
                      s.sessionKind === 'THEORY' ? 'bg-blue-100 text-blue-900' : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {s.sessionKind === 'THEORY' ? 'تئوری' : 'عملی'}
                  </span>
                )}
                <input
                  value={s.topic}
                  onChange={e => updateSession(s.sessionNo, { topic: e.target.value })}
                  disabled={disabled}
                  placeholder="موضوع جلسه…"
                  className={inputCls}
                />
              </div>
              <textarea
                value={s.details}
                onChange={e => updateSession(s.sessionNo, { details: e.target.value })}
                disabled={disabled}
                rows={2}
                placeholder="شرح فعالیت‌ها و جزئیات جلسه (اختیاری)…"
                className={inputCls}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Weights */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h3 className="font-extrabold text-slate-900 text-base">بارم‌بندی ارزشیابی</h3>
          <span
            className={`px-3 py-1 rounded-xl text-xs font-black ${
              weightsValid ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
            }`}
          >
            جمع: {faNum(weightsSum)} از ۱۰۰
          </span>
        </div>
        {!weightsValid && (
          <p className="text-2xs font-bold text-rose-700 leading-5">
            جمع درصدها باید دقیقاً ۱۰۰ شود؛ تا آن زمان دکمه «ثبت نهایی» غیرفعال است.
          </p>
        )}
        <div className="space-y-2">
          {weights.map((w, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_120px_40px] gap-2">
              <input
                value={w.title}
                onChange={e =>
                  setWeights(prev => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                }
                disabled={disabled}
                placeholder="عنوان (مثلاً میان‌ترم، پایان‌ترم، فعالیت کلاسی)…"
                className={inputCls}
              />
              <input
                type="number"
                min={0}
                max={100}
                value={w.percent}
                onChange={e =>
                  setWeights(prev =>
                    prev.map((x, j) => (j === i ? { ...x, percent: Number(e.target.value) } : x)),
                  )
                }
                disabled={disabled}
                placeholder="درصد"
                className={inputCls}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => setWeights(prev => prev.filter((_, j) => j !== i))}
                className="px-2 py-1 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-black text-sm disabled:opacity-40"
                title="حذف ردیف"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setWeights(prev => [...prev, { title: '', percent: 0 }])}
          className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition disabled:opacity-50"
        >
          ＋ افزودن ردیف بارم
        </button>
      </div>

      {/* Actions */}
      {!readOnly && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
          <button
            type="button"
            disabled={saving !== null}
            onClick={() => doSave('DRAFT')}
            className="px-6 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold text-xs transition disabled:opacity-50"
          >
            {saving === 'DRAFT' ? 'در حال ذخیره…' : 'ذخیره پیش‌نویس'}
          </button>
          <button
            type="button"
            disabled={saving !== null || !weightsValid}
            title={!weightsValid ? 'جمع بارم‌بندی باید ۱۰۰ باشد' : undefined}
            onClick={() => doSave('SUBMITTED')}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-700 to-emerald-800 hover:from-emerald-800 hover:to-emerald-900 text-white font-extrabold text-xs shadow-lg transition disabled:opacity-50"
          >
            {saving === 'SUBMITTED' ? 'در حال ثبت…' : 'ثبت نهایی'}
          </button>
        </div>
      )}
    </div>
  );
}
