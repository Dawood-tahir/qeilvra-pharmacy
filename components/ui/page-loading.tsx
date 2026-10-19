import { BrandMark } from "@/components/brand-mark";

export function StartupLoading() {
  return <main role="status" aria-label="Starting Qeilvra" className="grid min-h-dvh place-items-center p-6">
    <div className="flex flex-col items-center gap-5"><BrandMark /><div className="flex items-center gap-2 text-sm text-slate-500"><span className="size-4 animate-spin rounded-full border-2 border-blue-100 border-t-blue-600 motion-reduce:animate-none" aria-hidden="true" />Opening your pharmacy…</div></div>
  </main>;
}

export function PageLoading({ title = "Loading your pharmacy", layout = "table" }: { title?: string; layout?: "table" | "dashboard" | "pos" }) {
  return <main role="status" aria-label={title} aria-busy="true" className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
    <p className="text-sm font-semibold text-blue-700">Qeilvra</p><h1 className="mt-1 text-2xl font-extrabold">{title}</h1>
    <div aria-hidden="true" className="mt-5 space-y-4">
      {layout === "dashboard" && <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[0,1,2,3].map(n=><div key={n} className="skeleton h-32 rounded-2xl" />)}</div>}
      {layout === "pos" ? <div className="grid gap-4 lg:grid-cols-[1fr_350px]"><div className="grid grid-cols-2 gap-3 xl:grid-cols-3">{[0,1,2,3,4,5].map(n=><div key={n} className="skeleton h-52 rounded-xl" />)}</div><div className="skeleton hidden h-[32rem] rounded-2xl lg:block" /></div> : <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="skeleton mb-5 h-11 rounded-xl" />{[0,1,2,3,4,5].map(n=><div key={n} className="mb-3 flex gap-4"><div className="skeleton h-12 w-12 rounded-lg" /><div className="flex-1 space-y-2"><div className="skeleton h-4 w-2/3 rounded" /><div className="skeleton h-3 w-1/3 rounded" /></div></div>)}</div>}
    </div>
    <span className="sr-only">Please wait while current records load.</span>
  </main>;
}
