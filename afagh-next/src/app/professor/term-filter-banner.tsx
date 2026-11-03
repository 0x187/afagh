import TermFilterChip from '@/components/TermFilterChip';
import { demoProfessorTermFilterNotice } from '@/lib/professor-term-filter';
import type { TermScope } from '@/lib/term-scope';

export default function ProfessorTermFilterBanner({
  selectedTerm,
  universityId,
  demo,
}: {
  selectedTerm: TermScope | null;
  universityId: number | null;
  demo?: boolean;
}) {
  if (!selectedTerm) return null;

  return (
    <div className="space-y-2 print:hidden">
      <TermFilterChip title={selectedTerm.title} universityId={universityId} />
      {demo && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-2xs text-slate-600">
          {demoProfessorTermFilterNotice(selectedTerm.title)}
        </p>
      )}
    </div>
  );
}
