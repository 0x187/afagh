import { ApiError, apiGet, apiPost } from './api';

// ═══ Typed scope and account switching client — phase 1 contract (phase1-contracts.md) ═══
//
//  • GET  /api/v2/scope                → current state + allowed lists
//  • POST /api/v2/scope/university     → sets the `afagh_uni` cookie
//  • POST /api/v2/scope/term           → sets the `afagh_term` cookie (null = clear it)
//  • POST /api/v2/auth/switch-account  → logs in to a same-person account with that account's password
//
// All routes carry the same cookie-based session; errors carry ready-to-display Persian messages.

/** University from the client's perspective — contract: `universities:[{id,title}]`. */
export type ScopeUniversity = { id: number; title: string };

/**
 * Term from the client's perspective — the switcher's required fields from the original TermScope; the remaining
 * server fields (dates, etc.) are not served in the contract and are not used here.
 */
export type ScopeTerm = {
  id: number;
  termCode: string;
  title: string;
  /** Current effective term based on the calendar — computed by the server ("current semester" label). */
  isEffectiveCurrent?: boolean;
};

export type ScopeResponse = {
  ok: boolean;
  universityId: number | null;
  termId: number | null;
  /** The other name for the selection — contract compatibility (both are in the server response) */
  selectedTermId?: number | null;
  universities: ScopeUniversity[];
  terms: ScopeTerm[];
};

/** Current state of the scopes — the port; allowed-ness is checked server-side. */
export function getScope(): Promise<ScopeResponse> {
  return apiGet<ScopeResponse>('/scope');
}

/**
 * Selects the "active university". Whether the target is allowed for this user is validated server-side
 * (the multi-institution security boundary); failure → ApiError with a Persian message.
 */
export function setUniversity(id: number): Promise<unknown> {
  return apiPost('/scope/university', { universityId: id });
}

/**
 * Selects the "active semester"; `null` = "all semesters" (clears the cookie — same as the original form's empty
 * value). The term must belong to the active university; checked server-side.
 */
export function setTerm(id: number | null): Promise<unknown> {
  return apiPost('/scope/term', { termId: id });
}

// ── Same-person account switching ────────────────────────────────────────────────────────

/** Same as SiblingAccount in the current system's account-switch.ts. */
export type SiblingAccount = {
  kind: 'staff' | 'student';
  code: string;
  name: string;
  universityTitle: string | null;
};

export type SwitchAccountResult = { ok: boolean; error?: string; mustChange?: boolean };

/**
 * Log in to a same-person account (same national ID, different staff/student code) with that account's password.
 *
 * Port of `switchAccountAction(kind, code, password)` — the phase 1 contract is identical to the original
 * action, and `kind` stays necessary so the server can tell a staff code apart from a student number;
 * therefore the three-parameter signature is preserved (not `switchAccount(code, pw)`).
 *
 * Unlike the scope routes, the business result, in the same shape as the original action, is returned as an object
 * (not thrown) so the account-switch form makes the same decisions as the original action.
 */
export async function switchAccount(
  kind: 'staff' | 'student',
  code: string,
  password: string,
): Promise<SwitchAccountResult> {
  try {
    const res = await apiPost<SwitchAccountResult>('/auth/switch-account', { kind, code, password });
    if (res.ok) return { ok: true, mustChange: res.mustChange === true };
    return { ok: false, error: res.error || 'انجام نشد.' };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'ارتباط با سرور برقرار نشد.' };
  }
}
