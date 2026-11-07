import { Navigate } from 'react-router-dom';

import { homeFor } from '@/lib/home-route';
import { useSession } from '@/lib/session';

// Role-based landing — sends the signed-in user straight to their cartable
// (per the homeFor priority rule). Replaces the phase-0 demo home page;
// a no-role session lands on /login?e=norole through the same helper.
export function RoleLanding() {
  const { data, isLoading } = useSession();
  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center" aria-busy="true">
        <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
      </div>
    );
  }
  return <Navigate to={homeFor(data?.user?.roles ?? [])} replace />;
}
