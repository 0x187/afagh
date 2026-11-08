import { useState } from 'react';

/**
 * Header avatar — port of components/UserAvatar.tsx. The photo loads from the
 * secure /api/v2/photo/:userId route; on absence or failure the first letter
 * of the name renders on a colored circle so the header layout never breaks.
 */
export function UserAvatar({
  userId,
  hasPhoto,
  name,
  className = 'size-9',
  fallbackClass = 'bg-indigo-600',
  alt = 'عکس من',
}: {
  userId: number;
  hasPhoto?: boolean | null;
  name?: string | null;
  className?: string;
  fallbackClass?: string;
  alt?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name || '?').trim().charAt(0) || '?';
  if (hasPhoto && !failed) {
    return (
      <img
        src={`/api/v2/photo/${userId}`}
        alt={alt}
        onError={() => setFailed(true)}
        className={`${className} shrink-0 rounded-full object-cover`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`${className} flex shrink-0 items-center justify-center rounded-full font-black text-white ${fallbackClass}`}
    >
      {initial}
    </span>
  );
}
