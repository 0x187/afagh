import { useQuery } from '@tanstack/react-query';

import { getScope, setUniversity } from '@/lib/scope-api';

// ═══ "Active university" switcher — port of the header UniversitySwitcher ═══
// Shown only when the user has more than one allowed university (same as the original).
export function UniversitySwitcher() {
  const { data, isLoading } = useQuery({
    queryKey: ['scope'],
    queryFn: getScope,
    staleTime: 60_000,
  });

  if (isLoading || !data?.ok || data.universities.length <= 1) return null;

  return (
    <select
      aria-label="انتخاب دانشگاه"
      value={data.universityId ?? undefined}
      onChange={async (e) => {
        const id = Number(e.target.value);
        if (!Number.isFinite(id) || id <= 0) return;
        try {
          await setUniversity(id);
        } catch {
          return;
        }
        window.location.reload();
      }}
      className="cursor-pointer rounded-lg border border-white/25 bg-white/15 px-2 py-1.5 text-[12px] font-bold text-white backdrop-blur hover:bg-white/25 focus:ring-2 focus:ring-indigo-300/60 focus:outline-none"
    >
      {data.universities.map((u) => (
        <option key={u.id} value={u.id} className="text-slate-900">
          {u.title}
        </option>
      ))}
    </select>
  );
}
