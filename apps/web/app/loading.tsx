export default function Loading() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
      <div className="h-6 w-40 animate-pulse rounded bg-ink-200" />
      <div className="mt-6 h-[420px] animate-pulse rounded-2xl bg-white shadow-card" />
      <div className="mt-4 h-[320px] animate-pulse rounded-2xl bg-white shadow-card" />
      <div className="mt-4 h-[220px] animate-pulse rounded-2xl bg-white shadow-card" />
    </main>
  );
}
