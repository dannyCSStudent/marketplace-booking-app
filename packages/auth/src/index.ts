import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseAuthSession = {
  access_token: string;
  refresh_token: string;
};

type SupabaseAuthMode = "sign-in" | "sign-up";

type SupabaseAuthConfig = {
  supabaseUrl?: string;
  anonKey?: string;
};

const clientCache = new Map<string, SupabaseClient>();

type SupabaseAuthArgs = {
  mode: SupabaseAuthMode;
  email: string;
  password: string;
  config: SupabaseAuthConfig;
};

export async function authenticateWithSupabase({
  mode,
  email,
  password,
  config,
}: SupabaseAuthArgs): Promise<SupabaseAuthSession> {
  const { supabaseUrl, anonKey } = config;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase URL and anon key are required.");
  }

  const endpoint =
    mode === "sign-in"
      ? `${supabaseUrl}/auth/v1/token?grant_type=password`
      : `${supabaseUrl}/auth/v1/signup`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const payload = await response
    .json()
    .catch(() => ({ msg: "Unable to authenticate" }));

  if (!response.ok) {
    throw new Error(
      payload.msg ?? payload.error_description ?? "Unable to authenticate",
    );
  }

  const accessToken = payload.session?.access_token ?? payload.access_token;
  const refreshToken = payload.session?.refresh_token ?? payload.refresh_token;

  if (!accessToken || !refreshToken) {
    throw new Error(
      "Account created. Sign in after confirming the email to continue.",
    );
  }

  return { access_token: accessToken, refresh_token: refreshToken };
}

export async function refreshSupabaseSession(
  refreshToken: string,
  config: SupabaseAuthConfig,
): Promise<SupabaseAuthSession> {
  const { supabaseUrl, anonKey } = config;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase URL and anon key are required.");
  }

  const response = await fetch(
    `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
  );

  const payload = await response
    .json()
    .catch(() => ({ msg: "Unable to refresh session" }));

  if (!response.ok) {
    throw new Error(
      payload.msg ?? payload.error_description ?? "Unable to refresh session",
    );
  }

  const nextAccessToken = payload.access_token ?? payload.session?.access_token;
  const nextRefreshToken = payload.refresh_token ?? payload.session?.refresh_token ?? refreshToken;

  if (!nextAccessToken || !nextRefreshToken) {
    throw new Error("Unable to refresh session");
  }

  return {
    access_token: nextAccessToken,
    refresh_token: nextRefreshToken,
  };
}

export function getSupabaseRealtimeClient(
  config: SupabaseAuthConfig,
  accessToken?: string,
) {
  const { supabaseUrl, anonKey } = config;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase URL and anon key are required.");
  }

  const cacheKey = `${supabaseUrl}:${anonKey}`;
  let client = clientCache.get(cacheKey);

  if (!client) {
    client = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
    clientCache.set(cacheKey, client);
  }

  if (accessToken) {
    void client.realtime.setAuth(accessToken);
  }

  return client;
}
