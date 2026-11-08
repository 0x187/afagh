import { Link } from 'react-router-dom';

import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { logout } from '@/lib/auth-api';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

/**
 * Header tool cluster — "guide / PDF / theme / logout" in one component,
 * port of components/HeaderActions.tsx: one height, one radius, one font for
 * all three panels; SVG icons aligned with the Persian text; the logout
 * button keeps its short label on mobile.
 */
export function HeaderActions({
  helpHref,
  pdfHref,
}: {
  helpHref: string;
  pdfHref?: string;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const ghost =
    'hidden text-xs font-medium border px-3 h-8 inline-flex items-center gap-1.5 rounded-lg transition-colors bg-indigo-900/80 text-indigo-200 border-indigo-700/60 hover:opacity-90';

  async function doLogout() {
    setBusy(true);
    try {
      await logout();
    } catch {
      /* the client-side session is cleared regardless */
    }
    await queryClient.invalidateQueries({ queryKey: ['session'] });
    setBusy(false);
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Link to={helpHref} className={`${ghost} max-sm:hidden`}>
        <span aria-hidden className="text-sm leading-none">📖</span>
        راهنما
      </Link>
      {pdfHref ? (
        <a href={pdfHref} download className={`${ghost} max-md:hidden`}>
          <span aria-hidden className="text-sm leading-none">📕</span>
          PDF
        </a>
      ) : null}
      <ThemeToggle />
      <button
        type="button"
        onClick={doLogout}
        disabled={busy}
        className="inline-flex h-8 items-center rounded-lg bg-rose-600 px-3 text-xs font-bold text-white transition-colors hover:bg-rose-500 disabled:opacity-50"
      >
        <span className="sm:hidden">خروج</span>
        <span className="hidden sm:inline">خروج از سامانه</span>
      </button>
    </div>
  );
}
