import { ReactNode } from "react";

import { AdminNav } from "@/app/admin/admin-nav";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background/60">
      <header className="grain sticky top-0 z-10 bg-background/95 pt-4 pb-0 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 sm:px-8 lg:px-12">
          <AdminNav />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-6 sm:px-8 lg:px-12">
        {children}
      </main>
    </div>
  );
}
