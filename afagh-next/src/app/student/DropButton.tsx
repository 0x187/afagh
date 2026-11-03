'use client';

// حذف درس — محرک رویداد ارتقای خودکار لیست انتظار (§۱۰۱۸)
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { dropCourseAction } from './actions';

export default function DropButton({ enrollmentId }: { enrollmentId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function drop() {
    setBusy(true); setNote('');
    const res = await dropCourseAction(enrollmentId);
    setBusy(false);
    setNote(res.ok ? (res.promotedTo ? 'حذف شد ✓ (نفر بعدی لیست انتظار ارتقا یافت)' : 'حذف شد ✓') : res.error || 'خطا');
    if (res.ok) router.refresh();
  }

  return (
    <div className="text-left">
      <button className="text-xs text-red-600 underline" disabled={busy} onClick={drop}>{busy ? '…' : 'حذف'}</button>
      {note && <p className="text-3xs text-slate-500">{note}</p>}
    </div>
  );
}
