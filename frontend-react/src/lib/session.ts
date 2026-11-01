import { useQuery } from '@tanstack/react-query';
import { apiGet, type SessionResponse } from './api';

/**
 * Current session state from API v2 (Go backend) — the same session shared with Next.js.
 * staleTime=60s: session state rarely changes; any sensitive change
 * (logout/lock) is coordinated with a manual invalidate in phase 1.
 */
export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => apiGet<SessionResponse>('/session'),
    staleTime: 60_000,
    retry: false,
  });
}
