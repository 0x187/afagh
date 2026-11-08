// ═══ Personal photo of a person — port of components/PersonPhoto.tsx ═══
//
// The photo lives in object storage and its direct key is never exposed; the only
// display path is the authenticated /api/v2/photo/:userId route (same as
// UserAvatar / StudentCardPrintPage). On absence or failure the placeholder
// renders so the print/dossier layout never breaks.

import { useEffect, useState } from 'react';

export default function PersonPhoto({
  userId,
  hasPhoto,
  className = 'w-28 h-36',
  icon = '👤',
  label = 'عکس پرسنلی',
}: {
  userId?: number | null;
  hasPhoto?: boolean | null;
  className?: string;
  icon?: string;
  label?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [userId]);

  const id = typeof userId === 'number' ? userId : -1;
  if (!hasPhoto || !Number.isInteger(id) || id <= 0 || failed) {
    return (
      <div className={`${className} bg-slate-200 border-2 border-slate-400 rounded flex flex-col items-center justify-center text-slate-500 shadow-inner`}>
        <span className="text-3xl">{icon}</span>
        <span className="text-3xs mt-1 font-bold">{label}</span>
      </div>
    );
  }
  return (
    <img
      src={`/api/v2/photo/${id}`}
      alt={label}
      className={`${className} object-cover border-2 border-slate-400 rounded shadow-inner bg-slate-100`}
      onError={() => setFailed(true)}
    />
  );
}
