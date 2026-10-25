import { useQuery } from '@tanstack/react-query';
import { apiGet, type SessionResponse } from './api';

/**
 * وضعیت نشست جاری از API v2 (بکند Go) — همان سشن مشترک با Next.js.
 * staleTime=60s: وضعیت نشست به‌ندرت عوض می‌شود؛ هر تغییر حساس
 * (خروج/قفل) در فاز ۱ با invalidate دستی هماهنگ می‌شود.
 */
export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => apiGet<SessionResponse>('/session'),
    staleTime: 60_000,
    retry: false,
  });
}
