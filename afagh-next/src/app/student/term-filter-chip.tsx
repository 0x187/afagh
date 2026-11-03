'use client';

/** نشان «فیلتر نیمسال فعال» پنل دانشجو + پاک‌کردن آن با POST به Route Handler. */
export default function TermFilterChip({
  title,
  universityId: _universityId,
}: {
  title: string;
  /** دیگر لازم نیست؛ دانشگاه از کوکی معتبر سرور خوانده می‌شود */
  universityId?: number | null;
}) {
  return (
    <div className="print:hidden flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-900">
      <span className="font-bold">نیمسال: {title}</span>
      <form action="/api/scope/term" method="post" className="mr-auto">
        <input type="hidden" name="termId" value="" />
        <button
          type="submit"
          className="rounded-lg border border-indigo-300 bg-white px-2 py-0.5 text-2xs font-bold text-indigo-800 hover:bg-indigo-100"
        >
          پاک کردن فیلتر
        </button>
      </form>
    </div>
  );
}
