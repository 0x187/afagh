'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { searchHelpIndex } from './help-normalize';
import type { HelpIndexEntry } from './help-types';

type Props = {
  index: HelpIndexEntry[];
  role?: string | null;
  placeholder?: string;
  id?: string;
};

export default function HelpSearch({ index, role = null, placeholder, id = 'help-search' }: Props) {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => searchHelpIndex(index, q, { role, limit: 20 }), [index, q, role]);
  const showList = focused && q.trim().length > 0;

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 shadow-sm focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100">
        <span aria-hidden="true">🔍</span>
        <input
          ref={inputRef}
          id={id}
          value={q}
          onChange={e => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={placeholder ?? 'جست‌وجو در راهنما… (کلید / یا Ctrl+K)'}
          className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          autoComplete="off"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            className="rounded-lg bg-slate-100 px-2 py-1 text-2xs font-bold text-slate-500 hover:bg-slate-200"
            aria-label="پاک کردن جست‌وجو"
          >
            ✕
          </button>
        )}
      </div>
      {showList && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          {results.length === 0 ? (
            <p className="p-4 text-xs text-slate-500">نتیجه‌ای پیدا نشد. واژهٔ دیگری را امتحان کنید؛ «ی» و «ک» عربی هم پذیرفته می‌شود.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-auto">
              {results.map(r => (
                <li key={`${r.role}:${r.slug}`}>
                  <Link
                    href={`/help/${r.role}/${r.slug}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-indigo-50/60"
                  >
                    <span>
                      <span className="block text-[13px] font-bold text-slate-800">{r.title}</span>
                      <span className="block text-2xs text-slate-500">
                        {r.roleIcon} {r.roleLabel} · {r.section}
                      </span>
                    </span>
                    <span className="shrink-0 text-slate-300">←</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!showList && q.trim().length === 0 && (
        <p className="mt-1.5 px-1 text-2xs text-slate-400">
          {index.length.toLocaleString('fa-IR')} موضوع نمایه شده · جست‌وجو «ی/ك» عربی، نیم‌فاصله و ارقام فارسی را هم می‌فهمد
        </p>
      )}
    </div>
  );
}
