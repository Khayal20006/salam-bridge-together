import { Link } from "@tanstack/react-router";

export function SiteFooter({ overlay = false }: { overlay?: boolean }) {
  const cls = overlay
    ? "pointer-events-auto fixed bottom-1 left-1/2 z-30 -translate-x-1/2 flex gap-3 rounded-full bg-card/60 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur"
    : "mt-12 flex flex-wrap justify-center gap-4 border-t border-border pt-6 text-sm text-muted-foreground";
  return (
    <nav className={cls} aria-label="Legal">
      <Link to="/about" className="hover:text-primary">About</Link>
      <Link to="/pricing" className="hover:text-primary">Pricing</Link>
      <Link to="/terms" className="hover:text-primary">Terms</Link>
      <Link to="/privacy" className="hover:text-primary">Privacy</Link>
      <Link to="/refund" className="hover:text-primary">Refunds</Link>
    </nav>
  );
}

export function PageShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-6 py-12 font-display text-foreground">
      <article className="mx-auto max-w-3xl space-y-4 leading-relaxed [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_a]:text-primary [&_a]:underline">
        <Link to="/" className="text-sm text-primary">← Back to the game</Link>
        <h1 className="text-4xl font-bold text-gradient">{title}</h1>
        {children}
      </article>
      <SiteFooter />
    </main>
  );
}
