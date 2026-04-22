"use client";


import { AdminNav } from "@/app/admin/admin-nav";
import { Suspense } from "react";

import { SellerInactivityPanel } from "./seller-inactivity-panel";

export default function SellerInactivityPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <AdminNav />
      <Suspense fallback={<div className="p-4">Loading seller inactivity tools…</div>}>
        <SellerInactivityPanel />
      </Suspense>
    </main>
  );
}
