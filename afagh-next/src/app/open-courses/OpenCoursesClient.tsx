'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { registerOpenCourseAction, validateDiscountCodeAction } from './actions';
import { notify } from '@/lib/ui-feedback';

export interface PublicShortCourse {
  id: number;
  code: string;
  title: string;
  titleEn: string;
  category: string;
  description: string;
  hours: number;
  tuitionPrice: number; // تومان
  capacity: number;
  enrolledCount: number;
  instructorName: string;
  instructorBio: string;
  syllabus: string[];
  scheduleText: string;
  startDate: string;
  endDate: string;
  passingGrade: number;
}

const faNum = (n: any) =>
  n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

const formatPrice = (p: number) => faNum(p.toLocaleString('fa-IR')) + ' تومان';

export default function OpenCoursesClient({
  initialCourses,
}: {
  initialCourses: PublicShortCourse[];
}) {
  const [courses, setCourses] = useState<PublicShortCourse[]>(initialCourses);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCourseForDetail, setSelectedCourseForDetail] = useState<PublicShortCourse | null>(null);

  // Registration & Checkout States
  const [checkoutCourse, setCheckoutCourse] = useState<PublicShortCourse | null>(null);
  const [fullName, setFullName] = useState<string>('');
  const [fullNameEn, setFullNameEn] = useState<string>('');
  const [nationalId, setNationalId] = useState<string>('');
  const [mobile, setMobile] = useState<string>('');
  const [discountCode, setDiscountCode] = useState<string>('');
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [discountAppliedCode, setDiscountAppliedCode] = useState<string>('');
  const [discountError, setDiscountError] = useState<string>('');
  const [isProcessingPayment, setIsProcessingPayment] = useState<boolean>(false);
  const [paymentSuccessData, setPaymentSuccessData] = useState<{
    trackingCode: string;
    courseTitle: string;
    amountDue: number;
    discountAmount: number;
    learnerName: string;
  } | null>(null);

  // Categories — پویا از دوره‌های واقعی (نه فهرست ثابت)
  const categories = ['ALL', ...Array.from(new Set(courses.map(c => c.category)))];

  // اعتبارسنجی کد تخفیف — واقعی در سرور (جدول short_term_discounts)
  const handleApplyDiscount = async () => {
    setDiscountError('');
    if (!checkoutCourse) return;
    const trimmed = discountCode.trim().toUpperCase();
    if (!trimmed) {
      setDiscountError('کد تخفیف را وارد کنید.');
      return;
    }
    try {
      const res = await validateDiscountCodeAction(checkoutCourse.id, trimmed);
      if (!res.ok) {
        setDiscountError(res.error || 'کد تخفیف نامعتبر است.');
        setDiscountAmount(0);
        setDiscountAppliedCode('');
        return;
      }
      setDiscountAmount(res.discountAmount ?? 0);
      setDiscountAppliedCode(trimmed);
    } catch {
      setDiscountError('خطا در بررسی کد تخفیف.');
    }
  };

  // Handle Checkout & Payment
  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutCourse) return;
    if (!fullName || !mobile || !nationalId) {
      notify('لطفاً تمامی فیلدهای الزامی (نام و نام‌خانوادگی، کدملی و شماره همراه) را تکمیل فرمایید.', 'error');
      return;
    }

    setIsProcessingPayment(true);

    // ثبت واقعی: اعتبارسنجی + کد تخفیف + ردیف ثبت‌نام (paymentStatus=PENDING) — همه در سرور
    try {
      const res = await registerOpenCourseAction({
        courseId: checkoutCourse.id,
        fullName, fullNameEn,
        nationalId, mobile,
        discountCode: discountCode.trim() || undefined,
      });
      if (!res.ok) {
        notify(res.error || 'ثبت‌نام ناموفق بود.', 'error');
        return;
      }
      setPaymentSuccessData({
        trackingCode: res.trackingCode ?? '',
        courseTitle: checkoutCourse.title,
        amountDue: res.amountDue ?? checkoutCourse.tuitionPrice,
        discountAmount: res.discountAmount ?? 0,
        learnerName: fullName,
      });
      setCourses(prev => prev.map(c => (c.id === checkoutCourse.id ? { ...c, enrolledCount: c.enrolledCount + 1 } : c)));
      setCheckoutCourse(null);
      setDiscountCode('');
      setDiscountAmount(0);
      setDiscountAppliedCode('');
    } catch {
      notify('خطا در ارتباط با سرور.', 'error');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const filteredCourses = courses.filter(c => {
    if (selectedCategory !== 'ALL' && c.category !== selectedCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      return (
        c.title.toLowerCase().includes(q) ||
        c.instructorName.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans" dir="rtl">
      {/* Header Bar */}
      <header className="border-b border-indigo-900/60 bg-slate-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center font-black text-white text-lg shadow-lg shadow-indigo-600/30">
              آ
            </div>
            <div>
              <h1 className="font-black text-base sm:text-lg text-white">
                مرکز آموزش‌های آزاد و دوره‌های تخصصی دانشگاه آفاق
              </h1>
              <p className="text-xs text-indigo-300">
                بوت‌کمپ‌های مهارت‌محور · صدور گواهینامه معتبر دوزبانه قابل ترجمه رسمی
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/verify-certificate"
              className="px-3.5 py-1.5 rounded-xl bg-indigo-950 hover:bg-indigo-900 text-indigo-200 border border-indigo-800 text-xs font-bold transition flex items-center gap-1.5"
            >
              <span>🔍 استعلام اصالت گواهینامه</span>
            </Link>
            <Link
              href="/login"
              className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition"
            >
              پورتال دانشجویان رسمی
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Banner */}
      <section className="relative overflow-hidden py-12 px-4 bg-gradient-to-b from-indigo-950/90 via-slate-900 to-slate-900 border-b border-indigo-900/40">
        <div className="max-w-4xl mx-auto text-center space-y-4">
          <span className="px-3 py-1 rounded-full text-xs font-black bg-amber-400/20 text-amber-300 border border-amber-400/30 inline-block">
            🚀 ثبت‌نام ترم پاییز و زمستان ۱۴۰۵ آغاز شد
          </span>
          <h2 className="text-2xl sm:text-4xl font-black text-white leading-tight">
            توسعه مهارت‌های کاربردی بازار کار با اساتید برتر صنعت
          </h2>
          <p className="text-sm text-indigo-200 leading-6 max-w-2xl mx-auto">
            دوره‌های کوتاه‌مدت دانشگاه آفاق ویژه دانشجویان، فارغ‌التحصیلان و شاغلین سراسر کشور بدون نیاز به کنکور.
            در پایان دوره، پس از قبولی در ارزیابی، گواهینامه رسمی دانشگاه با بارکد QR یکتا صادر می‌شود.
          </p>

          {/* Search & Filter Bar */}
          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-2 max-w-2xl mx-auto">
            <input
              type="text"
              placeholder="جستجوی عنوان دوره (مثلاً پایتون، هوش مصنوعی، حسابداری...)"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full sm:flex-1 bg-slate-950 border border-indigo-700/60 rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        </div>
      </section>

      {/* Category Pills */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-2xl text-xs font-black whitespace-nowrap transition ${
                selectedCategory === cat
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700/60'
              }`}
            >
              {cat === 'ALL' ? '🌐 همه دوره‌ها' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Course Cards Grid */}
      <main className="max-w-7xl mx-auto px-4 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCourses.map(course => {
            const isFull = course.enrolledCount >= course.capacity;
            const remainingSeats = course.capacity - course.enrolledCount;

            return (
              <div
                key={course.id}
                className="bg-slate-950 rounded-3xl border border-indigo-900/40 hover:border-indigo-600/60 transition-all p-5 shadow-xl flex flex-col justify-between group"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-full text-3xs font-black bg-indigo-900/80 text-indigo-300 border border-indigo-700/50">
                      {course.category}
                    </span>
                    <span className="text-3xs font-mono text-slate-400" dir="ltr">
                      {course.code}
                    </span>
                  </div>

                  <div>
                    <h3 className="font-black text-lg text-white group-hover:text-indigo-300 transition-colors">
                      {course.title}
                    </h3>
                    <p className="text-xs text-slate-400 font-mono mt-0.5" dir="ltr">
                      {course.titleEn}
                    </p>
                  </div>

                  <p className="text-xs text-slate-300 line-clamp-2 leading-5">{course.description}</p>

                  {/* Course Metadata */}
                  <div className="bg-slate-900/80 rounded-2xl p-3 border border-slate-800/80 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">👤 مدرس دوره:</span>
                      <span className="font-bold text-slate-200">{course.instructorName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">⏱️ طول دوره:</span>
                      <span className="font-mono font-bold text-amber-300">{faNum(course.hours)} ساعت تخصصی</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">📅 زمان برگزاری:</span>
                      <span className="text-slate-200 text-2xs">{course.scheduleText}</span>
                    </div>
                  </div>

                  {/* Capacity Bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-2xs">
                      <span className="text-slate-400">ظرفیت تکمیل‌شده:</span>
                      <span className={`font-bold ${isFull ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {isFull ? 'تکمیل ظرفیت' : `${faNum(remainingSeats)} صندلی خالی باقی‌مانده`}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          isFull ? 'bg-rose-500' : 'bg-gradient-to-r from-emerald-500 to-indigo-500'
                        }`}
                        style={{ width: `${Math.min(100, (course.enrolledCount / course.capacity) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Price & Action Buttons */}
                <div className="pt-5 border-t border-slate-800/80 mt-4 flex items-center justify-between gap-3">
                  <div>
                    <span className="text-3xs text-slate-400 block">شهریه مصوب دوره:</span>
                    <span className="text-sm sm:text-base font-black text-emerald-400 font-mono">
                      {formatPrice(course.tuitionPrice)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedCourseForDetail(course)}
                      className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition"
                    >
                      سرفصل‌ها
                    </button>
                    {isFull ? (
                      <button
                        disabled
                        className="px-4 py-2 rounded-xl bg-slate-800 text-slate-500 text-xs font-bold cursor-not-allowed"
                      >
                        تکمیل شد
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setCheckoutCourse(course);
                          setDiscountAmount(0);
                          setDiscountCode('');
                          setDiscountAppliedCode('');
                        }}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs shadow-lg shadow-indigo-600/30 transition flex items-center gap-1"
                      >
                        <span>ثبت‌نام آنی</span>
                        <span>←</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Course Detail & Syllabus Modal */}
      {selectedCourseForDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-slate-900 rounded-3xl p-6 max-w-xl w-full border border-indigo-900/60 shadow-2xl space-y-4 my-8 text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <span className="px-2 py-0.5 rounded text-3xs font-bold bg-indigo-900 text-indigo-300">
                  {selectedCourseForDetail.category}
                </span>
                <h3 className="font-black text-lg text-white mt-1">{selectedCourseForDetail.title}</h3>
              </div>
              <button
                onClick={() => setSelectedCourseForDetail(null)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs leading-6 text-slate-300">
              <div>
                <h4 className="font-bold text-white mb-1">📖 درباره دوره:</h4>
                <p>{selectedCourseForDetail.description}</p>
              </div>

              <div>
                <h4 className="font-bold text-white mb-1">👨‍🏫 مدرس و رزومه:</h4>
                <p className="bg-slate-950 p-3 rounded-2xl border border-slate-800 text-slate-300">
                  <b className="text-indigo-300">{selectedCourseForDetail.instructorName}</b>: {selectedCourseForDetail.instructorBio}
                </p>
              </div>

              <div>
                <h4 className="font-bold text-white mb-1.5">📑 سرفصل‌های آموزشی دوره:</h4>
                <ul className="space-y-1.5 list-disc list-inside bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
                  {selectedCourseForDetail.syllabus.map((s, i) => (
                    <li key={i} className="text-slate-200">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="p-3 bg-indigo-950/40 rounded-2xl border border-indigo-800/40 flex items-center justify-between text-xs">
                <span>شرط صدور گواهینامه:</span>
                <span className="font-bold text-amber-300">
                  کسب حداقل نمره {faNum(selectedCourseForDetail.passingGrade)} از ۲۰
                </span>
              </div>
            </div>

            <div className="flex gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => {
                  setCheckoutCourse(selectedCourseForDetail);
                  setSelectedCourseForDetail(null);
                }}
                className="flex-1 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs shadow-lg transition"
              >
                ورود به ثبت‌نام و پرداخت ({formatPrice(selectedCourseForDetail.tuitionPrice)})
              </button>
              <button
                onClick={() => setSelectedCourseForDetail(null)}
                className="px-5 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Express Checkout Modal */}
      {checkoutCourse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-slate-900 rounded-3xl p-6 max-w-lg w-full border border-indigo-700/60 shadow-2xl space-y-4 my-8 text-slate-100 animate-scaleUp">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="font-black text-lg text-white">ثبت‌نام مستقیم و تسویه شهریه</h3>
                <p className="text-xs text-indigo-300 mt-0.5">{checkoutCourse.title}</p>
              </div>
              <button
                onClick={() => setCheckoutCourse(null)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCheckoutSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">نام و نام‌خانوادگی (فارسی) *</label>
                  <input
                    type="text"
                    required
                    placeholder="مثال: علی رضایی"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">نام و نام‌خانوادگی (انگلیسی)</label>
                  <input
                    type="text"
                    placeholder="e.g. Ali Rezaei"
                    value={fullNameEn}
                    onChange={e => setFullNameEn(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white font-mono focus:ring-2 focus:ring-indigo-500"
                    dir="ltr"
                  />
                  <span className="text-3xs text-slate-400 mt-0.5 block">جهت درج در گواهی بین‌المللی</span>
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">کد ملی ۱۰ رقمی *</label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    placeholder="0012345678"
                    value={nationalId}
                    onChange={e => setNationalId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white font-mono focus:ring-2 focus:ring-indigo-500"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">شماره همراه (جهت ورود و OTP) *</label>
                  <input
                    type="tel"
                    required
                    maxLength={11}
                    placeholder="09123456789"
                    value={mobile}
                    onChange={e => setMobile(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white font-mono focus:ring-2 focus:ring-indigo-500"
                    dir="ltr"
                  />
                </div>
              </div>

              {/* Discount Code Input */}
              <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-2">
                <label className="text-xs font-bold text-slate-300 block">کد تخفیف (در صورت داشتن):</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="کد تخفیف (مثال: AFAGH30)"
                    value={discountCode}
                    onChange={e => setDiscountCode(e.target.value)}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={handleApplyDiscount}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition"
                  >
                    اعمال تخفیف
                  </button>
                </div>
                {discountAppliedCode && (
                  <p className="text-xs font-bold text-emerald-400">
                    ✓ کد تخفیف «{discountAppliedCode}» با موفقیت اعمال گردید ({formatPrice(discountAmount)} کسر شد).
                  </p>
                )}
                {discountError && <p className="text-xs font-bold text-rose-400">{discountError}</p>}
              </div>

              {/* Invoice Summary */}
              <div className="bg-indigo-950/50 p-4 rounded-2xl border border-indigo-800/60 space-y-2 text-xs">
                <div className="flex justify-between text-slate-300">
                  <span>شهریه خام دوره:</span>
                  <span className="font-mono">{formatPrice(checkoutCourse.tuitionPrice)}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-400 font-bold">
                    <span>تخفیف ویژه اعمال‌شده:</span>
                    <span className="font-mono">- {formatPrice(discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-white font-black text-sm pt-2 border-t border-indigo-800/60">
                  <span>مبلغ نهایی قابل پرداخت:</span>
                  <span className="text-emerald-400 font-mono">
                    {formatPrice(Math.max(0, checkoutCourse.tuitionPrice - discountAmount))}
                  </span>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isProcessingPayment}
                  className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 text-white font-black text-xs shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isProcessingPayment ? (
                    <>
                      <span className="animate-spin text-sm">⏳</span>
                      <span>در حال اتصال به درگاه پرداخت شاپرک...</span>
                    </>
                  ) : (
                    <>
                      <span>💳 پرداخت و ثبت‌نام قطعی</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setCheckoutCourse(null)}
                  className="px-4 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
                >
                  انصراف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment Success Modal */}
      {paymentSuccessData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4">
          <div className="bg-slate-900 rounded-3xl p-6 max-w-md w-full border border-emerald-500/60 shadow-2xl space-y-4 text-center text-slate-100 animate-scaleUp">
            <div className="w-16 h-16 rounded-3xl bg-emerald-950 text-emerald-400 border border-emerald-600/50 flex items-center justify-center text-3xl mx-auto shadow-lg shadow-emerald-900/40">
              ✓
            </div>

            <div className="space-y-1">
              <h3 className="font-black text-lg text-white">درخواست ثبت‌نام شما ثبت شد</h3>
              <p className="text-xs text-slate-400 leading-5">
                برای قطعی‌شدن، مبلغ شهریه را به حساب دانشگاه واریز و رسید آن را به کارشناس آموزش اعلام کنید.
                کد رهگیری زیر برای پیگیری وضعیت نزد شماست.
              </p>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2 text-xs text-right">
              <div className="flex justify-between">
                <span className="text-slate-400">نام فراگیر:</span>
                <span className="font-bold text-white">{paymentSuccessData.learnerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">دوره ثبت‌نامی:</span>
                <span className="font-bold text-indigo-300">{paymentSuccessData.courseTitle}</span>
              </div>
              {paymentSuccessData.discountAmount > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-400">تخفیف اعمال‌شده:</span>
                  <span className="font-mono font-bold text-amber-400">
                    {formatPrice(paymentSuccessData.discountAmount)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-400">مبلغ قابل پرداخت:</span>
                <span className="font-mono font-bold text-emerald-400">
                  {formatPrice(paymentSuccessData.amountDue)}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-800">
                <span className="text-slate-400">کد رهگیری ثبت‌نام:</span>
                <span className="font-mono font-black text-amber-300 tracking-wider">
                  {paymentSuccessData.trackingCode}
                </span>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <Link
                href="/verify-certificate"
                className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs block transition shadow-lg"
              >
                مشاهده سامانه استعلام مدارک دانشگاه
              </Link>
              <button
                onClick={() => setPaymentSuccessData(null)}
                className="w-full py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
              >
                بازگشت به لیست دوره‌ها
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
