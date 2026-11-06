'use client';

// دکمهٔ «چاپ چارت» برای مدیر گروه — با قواعد @media print در globals.css
// فقط جدول ترم‌بندی چاپ می‌شود (سربرگ وب، بنرها و نوار فیلتر با print:hidden
// پنهان‌اند و کلاس printing-curriculum روی بدنه چیدمان چاپی را فشرده می‌کند).
export default function PrintChartButton() {
  const handlePrint = () => {
    document.body.classList.add('printing-curriculum');
    const cleanup = () => {
      document.body.classList.remove('printing-curriculum');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };
  return (
    <button
      type="button"
      onClick={handlePrint}
      title="چاپ یا ذخیرهٔ PDF از چارت ترم‌بندی"
      className="px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-extrabold text-xs border border-white/20 transition"
    >
      🖨️ چاپ چارت
    </button>
  );
}
