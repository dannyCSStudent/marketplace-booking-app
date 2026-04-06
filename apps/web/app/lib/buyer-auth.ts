import { authenticateWithSupabase, refreshSupabaseSession } from "@repo/auth";

import { ApiError, createApiClient, type Profile } from "@/app/lib/api";

export type BuyerSession = {
  access_token: string;
  refresh_token: string;
};

export const BUYER_ACCESS_TOKEN_KEY = "web_buyer_access_token";
export const BUYER_REFRESH_TOKEN_KEY = "web_buyer_refresh_token";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const api = createApiClient(apiBaseUrl);

export function getBuyerSupabaseConfig() {
  return {
    supabaseUrl,
    anonKey: supabaseAnonKey,
  };
}

export async function authenticateBuyer(
  mode: "sign-in" | "sign-up",
  email: string,
  password: string,
) {
  return authenticateWithSupabase({
    mode,
    email,
    password,
    config: getBuyerSupabaseConfig(),
  });
}

export async function restoreBuyerSession(): Promise<BuyerSession | null> {
  const accessToken = window.localStorage.getItem(BUYER_ACCESS_TOKEN_KEY);
  const refreshToken = window.localStorage.getItem(BUYER_REFRESH_TOKEN_KEY);

  if (!accessToken || !refreshToken) {
    return null;
  }

  const refreshedSession = await refreshSupabaseSession(
    refreshToken,
    getBuyerSupabaseConfig(),
  );
  window.localStorage.setItem(BUYER_ACCESS_TOKEN_KEY, refreshedSession.access_token);
  window.localStorage.setItem(BUYER_REFRESH_TOKEN_KEY, refreshedSession.refresh_token);
  return refreshedSession;
}

export function persistBuyerSession(session: BuyerSession) {
  window.localStorage.setItem(BUYER_ACCESS_TOKEN_KEY, session.access_token);
  window.localStorage.setItem(BUYER_REFRESH_TOKEN_KEY, session.refresh_token);
}

export function clearBuyerSession() {
  window.localStorage.removeItem(BUYER_ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(BUYER_REFRESH_TOKEN_KEY);
}

export async function ensureBuyerProfile(
  accessToken: string,
  profileInput?: { full_name?: string | null; email?: string | null },
): Promise<Profile> {
  try {
    return await api.get<Profile>("/profiles/me", { accessToken });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return api.createProfile(
        {
          full_name: profileInput?.full_name ?? null,
          username: profileInput?.email?.split("@")[0] ?? null,
          city: "Dallas",
          state: "TX",
          country: "USA",
        },
        { accessToken },
      );
    }

    throw error;
  }
}
