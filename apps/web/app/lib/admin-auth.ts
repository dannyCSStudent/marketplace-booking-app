import { refreshSupabaseSession } from "@repo/auth";

export type AdminSession = {
  access_token: string;
  refresh_token: string;
  user_id: string | null;
};

export const SELLER_ACCESS_TOKEN_KEY = "seller_access_token";
export const SELLER_REFRESH_TOKEN_KEY = "seller_refresh_token";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function parseUserIdFromJwt(token: string): string | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) {
      return null;
    }

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = window.atob(normalized);
    const parsed = JSON.parse(decoded) as { sub?: string };
    return parsed.sub ?? null;
  } catch {
    return null;
  }
}

export async function restoreAdminSession(): Promise<AdminSession | null> {
  const accessToken = window.localStorage.getItem(SELLER_ACCESS_TOKEN_KEY);
  const refreshToken = window.localStorage.getItem(SELLER_REFRESH_TOKEN_KEY);

  if (!accessToken || !refreshToken) {
    return null;
  }

  const refreshedSession = await refreshSupabaseSession(refreshToken, {
    supabaseUrl,
    anonKey: supabaseAnonKey,
  });

  window.localStorage.setItem(SELLER_ACCESS_TOKEN_KEY, refreshedSession.access_token);
  window.localStorage.setItem(SELLER_REFRESH_TOKEN_KEY, refreshedSession.refresh_token);

  return {
    ...refreshedSession,
    user_id: parseUserIdFromJwt(refreshedSession.access_token),
  };
}
