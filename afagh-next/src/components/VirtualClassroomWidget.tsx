'use client';

import React, { useState } from 'react';
import type { VirtualClassSession } from '@/lib/moodle-bbb';
import { joinVirtualClassAction } from '@/lib/moodle-bbb-actions';
import { notify } from '@/lib/ui-feedback';

interface Props {
  user: {
    id: number;
    name: string;
    role: 'PROFESSOR' | 'STUDENT';
  };
  initialSessions: VirtualClassSession[];
  /** آرشیو ضبط‌ها — فقط برای حساب دمو مقدار ثابت دارد؛ برای بقیه از پایگاه داده می‌آید */
  recordings?: { title: string; meta: string }[];
}

const faNum = (n: any) =>
  n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export default function VirtualClassroomWidget({ user, initialSessions, recordings }: Props) {
  const [sessions, setSessions] = useState<VirtualClassSession[]>(initialSessions);
  const [isLaunching, setIsLaunching] = useState<string | null>(null);
  const [activeModalRoom, setActiveModalRoom] = useState<string | null>(null);

  const handleJoinClass = async (meetingId: string) => {
    setIsLaunching(meetingId);
    try {
      const res = await joinVirtualClassAction({ meetingId });

      if (res.ok) {
        // Open in new tab or popup
        window.open(res.url, '_blank');
      } else {
        notify(res.error || 'سرویس کلاس مجازی در دسترس نیست.', 'error');
      }
    } catch {
      notify('خطا در برقراری ارتباط با سرور آموزش مجازی (Moodle/BBB).', 'error');
    } finally {
      setIsLaunching(null);
    }
  };

  return (
    <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-200 space-y-4" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-lg shadow-md shadow-indigo-600/30">
            📡
          </div>
          <div>
            <h3 className="font-black text-slate-900 text-sm sm:text-base">
              کلاس‌های آنلاین و جلسات مجازی امروز (Moodle & BigBlueButton)
            </h3>
            <p className="text-2xs text-slate-500">
              ورود تک‌کلیکه با احراز هویت خودکار (SSO) · ثبت حضور در دفتر نمره
            </p>
          </div>
        </div>

        <span className="px-3 py-1 rounded-full text-3xs font-black bg-emerald-100 text-emerald-800 border border-emerald-200 self-start sm:self-auto">
          ● وب‌سرویس LMS آنلاین است
        </span>
      </div>

      {sessions.length === 0 ? (
        <div className="p-6 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-300 text-xs text-slate-500 font-bold">
          امروز هیچ کلاس آنلاینی در برنامه شما ثبت نشده است.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {sessions.map(sess => {
            const isJoiningThis = isLaunching === sess.meetingId;

            return (
              <div
                key={sess.meetingId}
                className={`p-4 rounded-2xl border transition-all flex flex-col justify-between space-y-3 ${
                  sess.isRunning
                    ? 'bg-gradient-to-b from-indigo-50/70 to-white border-indigo-300 shadow-xs'
                    : 'bg-slate-50 border-slate-200 opacity-90'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-3xs font-mono font-bold text-slate-500" dir="ltr">
                      {sess.courseCode}
                    </span>
                    {sess.isRunning ? (
                      <span className="px-2 py-0.5 rounded-full text-3xs font-black bg-rose-600 text-white animate-pulse flex items-center gap-1">
                        <span>●</span>
                        <span>در حال برگزاری</span>
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-3xs font-bold bg-slate-200 text-slate-700">
                        شروع در {faNum(sess.startTime)}
                      </span>
                    )}
                  </div>

                  <div>
                    <h4 className="font-black text-xs sm:text-sm text-slate-900">{sess.courseTitle}</h4>
                    <p className="text-2xs text-slate-500 mt-0.5">مدرس: {sess.professorName}</p>
                  </div>

                  <div className="bg-white/80 p-2.5 rounded-xl border border-slate-200/80 space-y-1 text-2xs">
                    <div className="flex justify-between text-slate-600">
                      <span>ساعت کلاس:</span>
                      <span className="font-mono font-bold text-indigo-950">
                        {faNum(sess.startTime)} الی {faNum(sess.endTime)}
                      </span>
                    </div>

                    {sess.isRunning && (
                      <div className="flex justify-between text-emerald-700 font-bold">
                        <span>حاضرین آنلاین:</span>
                        <span className="font-mono">{faNum(sess.activeParticipantsCount)} نفر</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => handleJoinClass(sess.meetingId)}
                    disabled={isJoiningThis}
                    className={`w-full py-2.5 rounded-xl font-black text-xs shadow-xs transition flex items-center justify-center gap-1.5 ${
                      user.role === 'PROFESSOR'
                        ? 'bg-rose-600 hover:bg-rose-700 text-white'
                        : sess.isRunning
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20'
                        : 'bg-indigo-900 hover:bg-indigo-950 text-white'
                    }`}
                  >
                    {isJoiningThis ? (
                      <>
                        <span className="animate-spin text-xs">⏳</span>
                        <span>اتصال به سرور بیگ‌بلوباتن...</span>
                      </>
                    ) : user.role === 'PROFESSOR' ? (
                      <>
                        <span>🔴 شروع جلسه (اتاق فرمان / Moderator)</span>
                      </>
                    ) : (
                      <>
                        <span>🟢 ورود به کلاس آنلاین (Attendee)</span>
                      </>
                    )}
                  </button>

                  {sess.recordingsCount > 0 && (
                    <button
                      onClick={() => setActiveModalRoom(sess.meetingId)}
                      className="w-full py-1 text-3xs text-indigo-900 hover:text-indigo-950 font-bold text-center block"
                    >
                      🎥 مشاهده آرشیو ویدیوهای ضبط‌شده ({faNum(sess.recordingsCount)} جلسه)
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recordings Archive Modal */}
      {activeModalRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-4 text-slate-900 animate-scaleUp">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <h3 className="font-black text-sm text-slate-900">
                آرشیو ویدیوهای ضبط‌شده در سرور بیگ‌بلوباتن (Moodle Cloud)
              </h3>
              <button onClick={() => setActiveModalRoom(null)} className="text-slate-400 hover:text-slate-700">
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs">
              {!recordings || recordings.length === 0 ? (
                <p className="p-4 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-300 text-2xs text-slate-500 font-bold">
                  فهرست ویدیوهای ضبط‌شدهٔ این اتاق در سامانه ثبت نشده است.
                </p>
              ) : (
                recordings.map(r => (
                  <div
                    key={r.title}
                    className="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between"
                  >
                    <div>
                      <span className="font-black block">{r.title}</span>
                      <span className="text-3xs text-slate-400">{r.meta}</span>
                    </div>
                    <button
                      onClick={() => notify('در حال بازپخش ویدیوی جلسه…', 'info')}
                      className="px-3 py-1.5 rounded-xl bg-indigo-900 text-white font-bold text-2xs"
                    >
                      پخش آنلاین ▶
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-200">
              <button
                onClick={() => setActiveModalRoom(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
