export function ComingSoon({ description }: { description: string }) {
  return (
    <main className="page">
      <section className="card soon-card">
        <p className="soon-kicker">Coming soon</p>
        <p className="soon-copy">{description}</p>
      </section>
    </main>
  );
}
