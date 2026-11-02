import { Skeleton } from "@/components/ui/skeleton";

export default function AppLoading() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Skeleton da Barra Lateral (Desktop) */}
      <aside className="hidden md:flex h-full w-64 flex-col border-r border-border/60 bg-card/40 p-4 gap-6 shrink-0">
        <div className="flex items-center gap-3 px-2">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-5 w-32 rounded" />
        </div>
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-20 px-2 my-2" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-4 w-16 px-2 pt-4 my-2" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
        <div className="flex items-center gap-3 pt-3 border-t border-border/40 px-2">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </aside>

      {/* Skeleton da Área Principal */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex h-14 items-center justify-between border-b border-border/60 px-6 shrink-0">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-md md:hidden" />
            <Skeleton className="h-6 w-36 rounded" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-44 rounded-md hidden sm:block" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
        </header>

        {/* Conteúdo Central */}
        <main className="flex-1 overflow-auto p-6 space-y-4">
          <div className="flex items-center justify-between pb-2">
            <Skeleton className="h-8 w-48 rounded" />
            <Skeleton className="h-9 w-28 rounded-md" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
          <Skeleton className="h-64 w-full rounded-xl" />
        </main>
      </div>
    </div>
  );
}
