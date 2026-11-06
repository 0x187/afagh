import Link from 'next/link';

export const dynamic = 'force-dynamic';

/**
 * صفحهٔ «راه بسته» پنل مدیر گروه.
 *
 * دو حالت متفاوت به اینجا می‌رسند و پیامشان نباید یکی باشد، وگرنه کاربر
 * نمی‌داند از چه کسی چه بخواهد:
 *   reason=no-staff → اصلاً پروندهٔ کارمندی ندارد.
 *   (پیش‌فرض)        → پرونده دارد ولی به گروه آموزشی وصل نیست.
 */
export default async function NoDept({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const noStaff = reason === 'no-staff';

  return (
    <div className="card space-y-3 rounded-xl bg-amber-50 p-5 text-amber-900 border border-amber-200">
      <p className="font-black">
        {noStaff ? 'پروندهٔ کارمندی شما ساخته نشده است' : 'پروندهٔ شما به گروه آموزشی وصل نیست'}
      </p>
      <p className="text-sm leading-7">
        {noStaff
          ? 'نقش «مدیر گروه» برای حساب شما فعال است، ولی هنوز پروندهٔ کارمندی (استاف) به این حساب وصل نشده؛ به همین دلیل معلوم نیست شما مدیر کدام گروه هستید.'
          : 'پروندهٔ کارمندی شما وجود دارد ولی گروه آموزشی آن خالی است؛ تا وقتی گروه مشخص نشود، فهرست دروس و ارائه‌ها قابل نمایش نیست.'}
      </p>
      <p className="text-sm leading-7">
        لطفاً از مدیر سامانه بخواهید در پنل «گروه‌های آموزشی و مدیران گروه» ({' '}
        <span className="font-mono text-xs">/admin/departments</span>{' '}) پروندهٔ شما را
        {noStaff ? ' بسازد و به گروه آموزشی وصل کند.' : ' به گروه آموزشی مربوطه وصل کند.'}
      </p>
      <div className="flex flex-wrap gap-2 pt-1 text-sm">
        <Link prefetch={false} href="/" className="rounded-lg bg-white px-3 py-1.5 font-bold text-amber-900 border border-amber-300 hover:bg-amber-100">
          بازگشت به کارتابل من
        </Link>
      </div>
    </div>
  );
}
