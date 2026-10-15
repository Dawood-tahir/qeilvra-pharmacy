export default function Loading() {
  return (
    <main className="mx-auto max-w-7xl p-5 lg:p-8">
      <div className="skeleton h-8 w-56 rounded-lg" />
      <div className="mt-3 skeleton h-4 w-80 max-w-full rounded" />
      <div className="mt-8 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <div key={item} className="skeleton h-32 rounded-2xl" />)}
      </div>
      <div className="mt-4 skeleton h-96 rounded-2xl" />
    </main>
  );
}
