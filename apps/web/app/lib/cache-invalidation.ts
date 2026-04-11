export async function invalidateMarketplaceCaches() {
  try {
    await fetch("/api/cache/revalidate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      cache: "no-store",
    });
  } catch {
    // Best-effort cache busting. The UI refresh still happens even if this fails.
  }
}
