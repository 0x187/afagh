export default function TermFilterNote({ title }: { title: string }) {
  return (
    <p className="print:hidden rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-2xs text-slate-600">
      نیمسال انتخابی: <b className="text-slate-800">{title}</b> — فیلتر نیمسال در این بخش اعمال نمی‌شود.
    </p>
  );
}