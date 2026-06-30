/**
 * Client-side handle for a sales-rep impersonation session. The merchant rep
 * portal mints a session token (POST /rep/sessions) and stashes it in
 * sessionStorage; the buyer-portal API client ({@link file://./api/buyer.ts})
 * forwards it as `X-Sales-Rep-Session` so the rep transacts exactly as the buyer
 * would. sessionStorage (not localStorage) so the impersonation never outlives
 * the browser tab.
 */
export const REP_SESSION_TOKEN_KEY = 'rep_session_token';
export const REP_BUYER_NAME_KEY = 'rep_buyer_name';

export interface RepSessionInfo {
  token: string;
  buyerName: string;
}

export function readRepSession(): RepSessionInfo | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = window.sessionStorage.getItem(REP_SESSION_TOKEN_KEY);
    if (!token) return null;
    return {
      token,
      buyerName: window.sessionStorage.getItem(REP_BUYER_NAME_KEY) ?? 'this buyer',
    };
  } catch {
    return null;
  }
}

export function startRepSession(token: string, buyerName: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(REP_SESSION_TOKEN_KEY, token);
    window.sessionStorage.setItem(REP_BUYER_NAME_KEY, buyerName);
  } catch {
    /* sessionStorage unavailable (private mode) — impersonation simply won't start */
  }
}

export function clearRepSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(REP_SESSION_TOKEN_KEY);
    window.sessionStorage.removeItem(REP_BUYER_NAME_KEY);
  } catch {
    /* ignore */
  }
}
