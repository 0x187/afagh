'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { requestContractOtpAction, signContractAction, type ContractView } from './actions';
import {
  DEMO_CONTRACT_DOCUMENT_CODE,
  DEMO_CONTRACT_DOCUMENT_VERSION,
  DEMO_CONTRACT_PAYMENT_NOTE,
  DEMO_CONTRACT_UNIVERSITY_SEAL_CODE,
  DEMO_FACULTY_NAME,
} from '@/lib/demo-professor-data';
import { notify } from '@/lib/ui-feedback';

export type { ContractView };
export type ContractCourseItem = ContractView['lines'][number];

export type ContractDetails = ContractView;

interface Props {
  demo?: boolean;
  initialContract: ContractDetails;
  universityTitle: string;
  universityLogoUrl?: string | null;
}

const faNum = (n: any) => (n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]));

export default function ProfessorContractClient({ demo = false, initialContract, universityTitle, universityLogoUrl }: Props) {
  const [contract, setContract] = useState<ContractDetails>(initialContract);
  const [showSignModal, setShowSignModal] = useState<boolean>(false);
  const [otpCode, setOtpCode] = useState<string>('');
  const [demoOtp, setDemoOtp] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState<boolean>(false);
  const [signing, setSigning] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastError, setToastError] = useState<boolean>(false);

  const showToast = (msg: string, isError = false) => {
    setToastMessage(msg);
    setToastError(isError);
    setTimeout(() => setToastMessage(null), 6000);
  };

  /** باز کردن مودال امضا → درخواست کد OTP واقعی از سرور (پیامک در production / نمایش در دمو) */
  const openSignModal = async () => {
    setShowSignModal(true);
    setOtpCode('');
    setDemoOtp(null);
    setOtpBusy(true);
    try {
      const res = await requestContractOtpAction();
      if (!res.ok) {
        showToast(res.error || 'دریافت کد تأیید ناموفق بود.', true);
        setShowSignModal(false);
        return;
      }
      if (res.demoOtp) setDemoOtp(res.demoOtp);
    } catch {
      showToast('خطا در ارتباط با سرور برای دریافت کد تأیید.', true);
      setShowSignModal(false);
    } finally {
      setOtpBusy(false);
    }
  };

  /** ثبت امضا فقط پس از تأیید OTP در سرور (هش سند سمت سرور محاسبه می‌شود) */
  const handleSignContract = async () => {
    if (!otpCode.trim()) {
      notify('کد تایید را وارد کنید.', 'error');
      return;
    }
    setSigning(true);
    try {
      const res = await signContractAction(otpCode.trim());
      if (!res.ok) {
        notify(res.error || 'امضا ناموفق بود.', 'error');
        return;
      }
      if (res.contract) {
        setContract(res.contract);
        setShowSignModal(false);
        setOtpCode('');
        showToast('✅ قرارداد تدریس شما با موفقیت امضای دیجیتال گردید و نسخهٔ الکترونیک در دبیرخانه ثبت شد.');
      }
    } catch {
      notify('خطا در ارتباط با سرور.', 'error');
    } finally {
      setSigning(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-5" dir="rtl">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="p-4 bg-emerald-900 print:hidden text-emerald-100 rounded-2xl shadow-xl border border-emerald-700 font-bold text-sm flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <span>✅</span>
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-white/60 hover:text-white text-xs">✕</button>
        </div>
      )}

      {/* Top Action Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs print:hidden">
        <div>
          <h1 className="font-extrabold text-slate-900 text-lg sm:text-xl">
            📑 فرم و متن رسمی قرارداد تدریس حق‌التدریس دانشگاه
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {contract.termTitle} · شماره قرارداد: {faNum(contract.contractNo)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition flex items-center gap-1.5"
          >
            <span>🖨️ چاپ قرارداد</span>
          </button>

          {contract.signatureStatus === 'PENDING' ? (
            <button
              onClick={openSignModal}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white font-extrabold text-xs shadow-md transition flex items-center gap-1.5"
            >
              <span>✍️ امضای الکترونیکی قرارداد</span>
            </button>
          ) : (
            <span className="px-3 py-2 rounded-xl bg-emerald-100 text-emerald-900 font-extrabold text-xs flex items-center gap-1.5 border border-emerald-300">
              <span>✓ امضا شده در {contract.signedAt}</span>
            </span>
          )}

          <Link
            href="/professor"
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition"
          >
            بازگشت
          </Link>
        </div>
      </div>

      {/* Printable Official Contract Paper */}
      <div className="print-area bg-white rounded-3xl p-6 sm:p-10 shadow-lg border border-slate-200 space-y-6 text-slate-900 print:shadow-none print:border-none print:p-0">
        
        {/* University Header */}
        <div className="flex items-center justify-between pb-6 border-b-2 border-slate-900">
          <div className="text-xs space-y-1 font-bold">
            <p>شماره قرارداد: <span className="font-mono">{faNum(contract.contractNo)}</span></p>
            <p>تاریخ صدور: {contract.contractDate}</p>
            <p>پیوست: دارد (جدول دروس مصوب)</p>
          </div>

          <div className="text-center space-y-1">
            {universityLogoUrl ? (
              <img src={universityLogoUrl} alt="" width={48} height={48} className="mx-auto mb-1 h-12 w-12 object-contain" />
            ) : (
              <div className="w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center text-xl font-bold mx-auto mb-1">
                🏛️
              </div>
            )}
            <h2 className="font-extrabold text-base sm:text-lg">جمهوری اسلامی ایران</h2>
            <h3 className="font-bold text-sm text-slate-700">
              وزارت علوم، تحقیقات و فناوری — {universityTitle || 'نام دانشگاه در سامانه ثبت نشده است'}
            </h3>
            <h4 className="font-extrabold text-xs text-indigo-900 bg-indigo-50 px-3 py-0.5 rounded-full inline-block border border-indigo-200">
              قرارداد حق‌التدریس آموزشی اعضای هیئت علمی و مدعو ({contract.termTitle})
            </h4>
          </div>

          <div className="text-xs space-y-1 text-left font-bold text-slate-600">
            <p>فرم استاندارد آموزشی</p>
            {demo ? (
              <>
                <p>کد سند: {DEMO_CONTRACT_DOCUMENT_CODE}</p>
                <p>نسخه: {DEMO_CONTRACT_DOCUMENT_VERSION}</p>
              </>
            ) : (
              <>
                <p>کد سند: <span className="font-mono">{faNum(contract.contractNo)}</span></p>
                <p>هش سند: <span className="font-mono">{contract.digitalHash ? faNum(contract.digitalHash.slice(0, 16)) : '—'}</span></p>
              </>
            )}
          </div>
        </div>

        {/* Contract Parties */}
        <div className="text-xs leading-6 space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-200">
          <p className="font-bold text-slate-800">
            این قرارداد بر اساس آیین‌نامه استخدامی اعضای هیئت علمی و مصوبات هیئت امنای دانشگاه، در تاریخ <b>{contract.contractDate}</b> فی‌مابین طرفین زیر منعقد می‌گردد:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="space-y-1">
              <span className="font-extrabold text-indigo-950 block">طرف اول (کارفرما):</span>
              <p className="text-slate-700">
                {demo
                  ? `${universityTitle} به نمایندگی معاونت آموزشی و تحصیلات تکمیلی و ریاست ${DEMO_FACULTY_NAME}.`
                  : `${universityTitle || 'دانشگاه'} به نمایندگی معاونت آموزشی و تحصیلات تکمیلی${
                      contract.departmentName ? ` و گروه آموزشی ${contract.departmentName}` : ''
                    }.`}
              </p>
            </div>
            <div className="space-y-1">
              <span className="font-extrabold text-indigo-950 block">طرف دوم (مدرس / عضو هیئت علمی):</span>
              <p className="text-slate-700">
                جناب آقای/سرکار خانم <b>{contract.professorName}</b>، کد ملی: <span className="font-mono">{faNum(contract.nationalCode)}</span>، کد پرسنلی: <span className="font-mono">{faNum(contract.staffCode)}</span>، مرتبه علمی: <b>{contract.academicRank}</b>، آخرین مدرک: <b>{contract.degree}</b>، شماره حساب بانکی: <span className="font-mono text-2xs">{faNum(contract.bankAccountNo || '—')}</span>.
              </p>
            </div>
          </div>
        </div>

        {/* Clause 1: Subject of Contract & Course Breakdown */}
        <div className="space-y-3">
          <h4 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-indigo-900 text-white flex items-center justify-center text-xs">۱</span>
            <span>ماده ۱: موضوع قرارداد و جدول دروس مصوب تخصیص‌یافته</span>
          </h4>
          <p className="text-xs text-slate-700 leading-5">
            تدریس سرفصل‌های مصوب وزارت علوم، تحقیقات و فناوری در دروس مشروحه زیر در طول ۱۶ هفته آموزشی نیمسال تحصیلی:
          </p>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs rt">
              <thead>
                <tr className="bg-slate-900 text-white text-center">
                  <th className="p-2.5 border border-slate-800 w-12">ردیف</th>
                  <th className="p-2.5 border border-slate-800">کد درس</th>
                  <th className="p-2.5 border border-slate-800">عنوان درس مصوب</th>
                  <th className="p-2.5 border border-slate-800">گروه</th>
                  <th className="p-2.5 border border-slate-800">واحد تئوری</th>
                  <th className="p-2.5 border border-slate-800">واحد عملی</th>
                  <th className="p-2.5 border border-slate-800">ساعت هفتگی</th>
                  <th className="p-2.5 border border-slate-800">کل ساعات ترم</th>
                </tr>
              </thead>
              <tbody>
                {contract.lines.map((c, idx) => (
                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="p-2 border border-slate-200 text-center font-bold text-slate-500">{faNum(idx + 1)}</td>
                    <td className="p-2 border border-slate-200 font-mono text-center font-bold text-indigo-950">{c.code}</td>
                    <td className="p-2 border border-slate-200 font-extrabold text-slate-900">{c.title}</td>
                    <td className="p-2 border border-slate-200 text-center font-bold">گروه {faNum(c.groupNumber)}</td>
                    <td className="p-2 border border-slate-200 text-center font-bold">{faNum(c.theoryUnits)}</td>
                    <td className="p-2 border border-slate-200 text-center font-bold">{faNum(c.practicalUnits)}</td>
                    <td className="p-2 border border-slate-200 text-center font-bold text-indigo-900">{faNum(c.weeklyHours)} ساعت</td>
                    <td className="p-2 border border-slate-200 text-center font-extrabold text-slate-900">{faNum(c.termTotalHours)} ساعت</td>
                  </tr>
                ))}
                <tr className="bg-slate-100 font-extrabold">
                  <td colSpan={6} className="p-2.5 border border-slate-200 text-left font-black text-slate-800">
                    مجموع کل ساعات تدریس موظف در طول نیمسال:
                  </td>
                  <td className="p-2.5 border border-slate-200 text-center text-indigo-900">
                    {faNum(contract.lines.reduce((s, c) => s + c.weeklyHours, 0))} ساعت
                  </td>
                  <td className="p-2.5 border border-slate-200 text-center text-slate-900">
                    {faNum(contract.totalTermHours)} ساعت
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Clause 2: Financial Terms & Calculations */}
        <div className="space-y-3">
          <h4 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-indigo-900 text-white flex items-center justify-center text-xs">۲</span>
            <span>ماده ۲: مبلغ قرارداد، نرخ حق‌التدریس و شیوه پرداخت</span>
          </h4>

          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div className="space-y-1">
              <span className="text-slate-500 font-bold block">نرخ هر ساعت حق‌التدریس:</span>
              <span className="font-black text-slate-900 text-sm">{faNum(contract.hourlyRate.toLocaleString('fa-IR'))} ریال</span>
            </div>
            <div className="space-y-1">
              <span className="text-slate-500 font-bold block">مبلغ ناخالص کل حق‌التدریس:</span>
              <span className="font-black text-indigo-950 text-sm">{faNum(contract.grossAmount.toLocaleString('fa-IR'))} ریال</span>
            </div>
            <div className="space-y-1">
              <span className="text-slate-500 font-bold block">کسورات قانونی (مالیات ۱۰٪ و بیمه):</span>
              <span className="font-black text-rose-700 text-sm">{faNum((contract.taxDeduction + contract.insuranceDeduction).toLocaleString('fa-IR'))} ریال</span>
            </div>
            <div className="space-y-1">
              <span className="text-slate-500 font-bold block">مبلغ خالص قابل پرداخت:</span>
              <span className="font-black text-emerald-700 text-sm">{faNum(contract.netAmount.toLocaleString('fa-IR'))} ریال</span>
            </div>
          </div>

          <p className="text-xs text-slate-600 leading-5">
            <b>شیوه پرداخت:</b>{' '}
            {demo
              ? DEMO_CONTRACT_PAYMENT_NOTE
              : '۵۰٪ از مبلغ قرارداد پس از برگزاری موفق امتحانات میان‌ترم و ثبت حضور و غیاب منظم به عنوان پیش‌پرداخت، و ۵۰٪ باقیمانده پس از تحویل نهایی نمرات در سامانه یکپارچه و پاسخ‌دهی به کلیه اعتراضات دانشجویان تسویه خواهد شد.'}
          </p>
        </div>

        {/* Clause 3: Obligations */}
        <div className="space-y-2">
          <h4 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-indigo-900 text-white flex items-center justify-center text-xs">۳</span>
            <span>ماده ۳: تعهدات طرفین و قوانین آموزشی</span>
          </h4>
          <ul className="list-disc list-inside text-xs text-slate-700 space-y-1 leading-5">
            <li>مدرس موظف به حضور دقیق و منظم در ساعات کلاسی و ثبت سیستماتیک حضور و غیاب در هر جلسه می‌باشد.</li>
            <li>بارم‌بندی دروس و سرفصل آموزشی در ابتدای ترم به دانشجویان ابلاغ و نمرات میان‌ترم و نهایی در موعد قانونی در سامانه ثبت گردد.</li>
            <li>دروس دارای دو استاد مشترک طبق سهم‌بندی مصوب شورای گروه آموزشی محاسبه و نمره‌دهی خواهد شد.</li>
            <li>این قرارداد از حیث قوانین کار و تامین اجتماعی مشمول مقررات خاص دانشگاه‌ها و مراکز آموزش عالی است.</li>
          </ul>
        </div>

        {/* Signatures Box */}
        <div className="pt-6 border-t-2 border-slate-900 grid grid-cols-2 gap-6 text-center text-xs">
          <div className="space-y-8 p-4 bg-slate-50 rounded-2xl border border-slate-200">
            <p className="font-extrabold text-slate-900">طرف اول: معاونت آموزشی و ریاست دانشکده</p>
            <div className="h-16 flex items-center justify-center">
              <div className="px-4 py-2 border-2 border-dashed border-indigo-500 rounded-xl text-indigo-900 font-extrabold text-2xs bg-indigo-50/50">
                🏛️ مهر و امضای دیجیتال دانشگاه
                <div className="text-[9px] font-mono text-slate-500">
                  {demo ? DEMO_CONTRACT_UNIVERSITY_SEAL_CODE : 'در انتظار تأیید اداره آموزش'}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-8 p-4 bg-slate-50 rounded-2xl border border-slate-200">
            <p className="font-extrabold text-slate-900">طرف دوم: مدرس / عضو هیئت علمی</p>
            <div className="h-16 flex items-center justify-center">
              {contract.signatureStatus === 'SIGNED' ? (
                <div className="px-4 py-2 border-2 border-emerald-600 rounded-xl text-emerald-900 font-extrabold text-2xs bg-emerald-50">
                  <span>✓ امضای الکترونیکی ثبت شد</span>
                  <div className="text-[9px] font-mono text-slate-600">{contract.signedAt}</div>
                  <div className="text-[8px] font-mono text-slate-400 break-all">{contract.digitalHash?.slice(0, 24)}...</div>
                </div>
              ) : (
                <button
                  onClick={openSignModal}
                  className="px-4 py-2 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold text-xs shadow transition print:hidden"
                >
                  ✍️ جهت امضای دیجیتال کلیک کنید
                </button>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* OTP Signature Modal */}
      {showSignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4 animate-scaleUp text-slate-900">
            <div className="w-12 h-12 bg-indigo-100 text-indigo-800 rounded-2xl flex items-center justify-center text-2xl mx-auto">
              ✍️
            </div>
            <div className="text-center space-y-1">
              <h3 className="font-extrabold text-base text-slate-900">
                امضای الکترونیکی قرارداد تدریس حق‌التدریس
              </h3>
              <p className="text-xs text-slate-600 leading-5">
                این امضا دارای بار حقوقی کامل و سندیت رسمی طبق قانون تجارت الکترونیک جمهوری اسلامی ایران می‌باشد.
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1 text-center">
              {otpBusy ? (
                <span className="text-slate-500 block">در حال ارسال کد تأیید…</span>
              ) : demoOtp ? (
                <>
                  <span className="text-slate-500 block">حالت دمو — کد تأیید (در محیط عملیاتی از طریق پیامک ارسال می‌شود):</span>
                  <span className="font-mono font-black text-indigo-700 text-lg tracking-widest">{demoOtp}</span>
                </>
              ) : (
                <span className="text-slate-500 block">کد ۶ رقمی تأیید امضا به شمارهٔ همراه ثبت‌شده شما پیامک شد.</span>
              )}
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1 text-center">
                کد تایید پیامک‌شده را وارد کنید:
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otpCode}
                onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="• • • • • •"
                className="w-full border-2 border-indigo-500 rounded-xl p-3 text-center font-mono font-black text-xl tracking-widest text-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSignContract}
                disabled={signing || otpBusy}
                className="flex-1 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs transition shadow-md disabled:opacity-50"
              >
                {signing ? 'در حال ثبت امضا…' : '✓ ثبت قطعی امضای قرارداد'}
              </button>
              <button
                onClick={() => setShowSignModal(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
