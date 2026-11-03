'use client';

import React from 'react';
import Link from 'next/link';

interface PlanData {
  published: boolean;
  plan: {
    id: number | null;
    courseMode: string;
    totalSessions: number;
    objectives: string;
    resources: string;
    status: string;
    submittedAt: string | null;
  } | null;
  sessions: { id?: number; sessionNo: number; sessionKind: string; topic: string; details?: string | null }[];
  weights: { id?: number; title: string; percent: number }[];
}

const faNum = (n: unknown) =>
  n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export default function PlanView({ offeringId, data }: { offeringId: number; data: PlanData }) {
  void offeringId;
  if (!data.published) {
    return (
      <div className="space-y-4 font-sans">
        <div className="bg-white rounded-2xl p-10 text-center border border-slate-200 shadow-sm space-y-2">
          <div className="text-4xl">📋</div>
          <h2 className="font-extrabold text-slate-800 text-lg">طرح درس هنوز منتشر نشده</h2>
          <p className="text-xs text-slate-500 leading-6">
            استاد درس هنوز طرح درس این ارائه را ثبت و منتشر نکرده است. پس از انتشار، برنامه جلسات، اهداف و
            بارم‌بندی ارزشیابی همین‌جا نمایش داده می‌شود.
          </p>
          <Link
            href="/student/schedule"
            className="inline-block mt-2 px-4 py-2 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-xs transition"
          >
            بازگشت به برنامه هفتگی
          </Link>
        </div>
      </div>
    );
  }

  const weightsSum = data.weights.reduce((s, w) => s + Number(w.percent || 0), 0);

  return (
    <div className="space-y-5 font-sans">
      <div className="bg-gradient-to-l from-indigo-950 via-indigo-900 to-slate-900 text-white rounded-2xl p-5 shadow-lg border border-indigo-700/50">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold bg-emerald-400 text-slate-950">
              طرح درس منتشرشده
            </span>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight mt-1">📋 طرح درس ارائه‌شده توسط استاد</h1>
            <p className="text-xs text-indigo-200 mt-1">
              {faNum(data.sessions.length)} جلسه · جمع بارم: {faNum(weightsSum)} از ۱۰۰
            </p>
          </div>
          <Link
            href="/student/schedule"
            className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/20 transition"
          >
            بازگشت به برنامه هفتگی
          </Link>
        </div>
      </div>

      {(data.plan?.objectives || data.plan?.resources) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data.plan?.objectives && (
            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
              <h3 className="font-extrabold text-slate-900 text-sm mb-1.5">اهداف درس</h3>
              <p className="text-xs text-slate-600 leading-6 whitespace-pre-wrap">{data.plan.objectives}</p>
            </div>
          )}
          {data.plan?.resources && (
            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
              <h3 className="font-extrabold text-slate-900 text-sm mb-1.5">منابع درس</h3>
              <p className="text-xs text-slate-600 leading-6 whitespace-pre-wrap">{data.plan.resources}</p>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-3">
        <h3 className="font-extrabold text-slate-900 text-base">برنامه جلسات</h3>
        <ol className="relative border-r-2 border-indigo-100 mr-2 space-y-4">
          {data.sessions.map(s => (
            <li key={s.sessionNo} className="mr-4">
              <span className="absolute -right-[7px] mt-1 w-3 h-3 rounded-full bg-indigo-600 border-2 border-white shadow" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-black text-slate-900 text-xs">جلسه {faNum(s.sessionNo)}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-3xs font-bold ${
                    String(s.sessionKind).toUpperCase().startsWith('PRACT')
                      ? 'bg-amber-100 text-amber-900'
                      : 'bg-blue-100 text-blue-900'
                  }`}
                >
                  {String(s.sessionKind).toUpperCase().startsWith('PRACT') ? 'عملی' : 'تئوری'}
                </span>
              </div>
              <div className="font-bold text-slate-800 text-xs mt-1">{s.topic || '—'}</div>
              {s.details && <p className="text-2xs text-slate-500 leading-5 mt-0.5 whitespace-pre-wrap">{s.details}</p>}
            </li>
          ))}
        </ol>
      </div>

      {data.weights.length > 0 && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-2">
          <h3 className="font-extrabold text-slate-900 text-base">بارم‌بندی ارزشیابی</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs rt">
              <thead>
                <tr className="bg-slate-900 text-white text-center">
                  <th className="p-2.5 border border-slate-800">عنوان</th>
                  <th className="p-2.5 border border-slate-800 w-28">درصد</th>
                </tr>
              </thead>
              <tbody>
                {data.weights.map((w, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="p-2 border border-slate-200 font-bold text-slate-800">{w.title}</td>
                    <td className="p-2 border border-slate-200 text-center font-black">{faNum(w.percent)}٪</td>
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
