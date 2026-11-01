import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/setup")({
  head: () => ({
    meta: [
      { title: "Ödəniş quraşdırması — neonworm.app" },
      { name: "description", content: "neonworm.app ödənişlərinin canlı rejimə keçməsi üçün Paddle yoxlama mərhələlərinin statusu və növbəti addım." },
      { property: "og:title", content: "Ödəniş quraşdırması — neonworm.app" },
      { property: "og:description", content: "Paddle yoxlama mərhələlərinin statusu və növbəti addım." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SetupPage,
});

type StepStatus = "done" | "action" | "waiting" | "locked";

type Step = {
  title: string;
  status: StepStatus;
  who: "biz" | "siz" | "paddle";
  note: string;
};

// Statuslar son yoxlamaya əsasən yenilənir (ödənişlər panelindəki canlı statusla).
const STEPS: Step[] = [
  {
    title: "Sayt hazırlığı (sənəd səhifələri)",
    status: "action",
    who: "biz",
    note: "İstifadə şərtləri, geri qaytarma və məxfilik səhifələri + qiymətlər saytda olmalıdır. Hazırlamaq üçün satıcının tam adı lazımdır.",
  },
  {
    title: "Saytı dərc etmək (Publish)",
    status: "action",
    who: "biz",
    note: "Son dəyişikliklər dərc olunmalıdır ki, Paddle saytı nəzərdən keçirə bilsin.",
  },
  {
    title: "Yoxlama forması (Verification)",
    status: "action",
    who: "siz",
    note: "Ödənişlər panelindəki formada ad, ölkə və bank hesabı məlumatlarını özünüz yazırsınız (~10 dəqiqə).",
  },
  {
    title: "Domen nəzərdən keçirilməsi",
    status: "locked",
    who: "paddle",
    note: "Paddle saytın tələblərə uyğunluğunu yoxlayır. Adətən 30 dəqiqə çəkir.",
  },
  {
    title: "Biznes identifikasiyası",
    status: "locked",
    who: "paddle",
    note: "Biznes kimi qeydiyyatdan keçmisinizsə, Paddle biznes məlumatlarını yoxlaya bilər (~30 dəqiqə).",
  },
  {
    title: "Şəxsiyyət təsdiqi",
    status: "locked",
    who: "paddle",
    note: "Paddle şəxsiyyət təsdiqi istəyə bilər. Tamamlandıqdan sonra 30–60 dəqiqə çəkir.",
  },
  {
    title: "Yekun nəzarət",
    status: "locked",
    who: "paddle",
    note: "Canlı rejimə keçməzdən əvvəl son yoxlama. Adətən 1 saatdan az çəkir.",
  },
];

const BADGE: Record<StepStatus, { label: string; cls: string }> = {
  done: { label: "✅ Hazırdır", cls: "border-primary/50 bg-primary/10 text-primary" },
  action: { label: "⚠️ Addım lazımdır", cls: "border-accent/50 bg-accent/10 text-accent" },
  waiting: { label: "⏳ Gözləyir", cls: "border-border bg-muted/40 text-muted-foreground" },
  locked: { label: "🔒 Sonra açılır", cls: "border-border bg-muted/20 text-muted-foreground" },
};

const WHO: Record<Step["who"], string> = {
  biz: "Biz edirik",
  siz: "Siz edirsiniz",
  paddle: "Paddle edir",
};

function SetupPage() {
  const next = STEPS.find((s) => s.status === "action");

  return (
    <div className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="text-sm text-muted-foreground hover:text-primary">← Oyuna qayıt</Link>
        <h1 className="mt-4 font-display text-3xl font-bold">
          <span className="text-gradient">Ödəniş quraşdırması</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Real ödənişlərin açılması üçün Paddle yoxlama mərhələləri. Canlı status həmişə Ödənişlər panelində görünür — bu səhifə yol xəritəsidir.
        </p>

        {next && (
          <div className="mt-6 rounded-2xl border border-accent/50 bg-accent/10 p-4 shadow-glow">
            <div className="text-xs font-semibold uppercase tracking-wide text-accent">Növbəti addım</div>
            <div className="mt-1 font-display text-lg font-bold">{next.title}</div>
            <p className="mt-1 text-sm text-muted-foreground">{next.note}</p>
          </div>
        )}

        <ol className="mt-6 space-y-3">
          {STEPS.map((s, i) => {
            const b = BADGE[s.status];
            return (
              <li key={s.title} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary font-display text-sm font-bold">{i + 1}</span>
                  <span className="font-display font-bold">{s.title}</span>
                  <span className={`ml-auto rounded-full border px-2 py-0.5 text-xs ${b.cls}`}>{b.label}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{s.note}</p>
                <div className="mt-1 text-xs text-muted-foreground">Kim edir: <b className="text-foreground">{WHO[s.who]}</b></div>
              </li>
            );
          })}
        </ol>

        <div className="mt-6 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          💡 O vaxta qədər ödənişlər <b className="text-foreground">test rejimində</b> işləyir — real pul çəkilmir. Test kartı: 4242 4242 4242 4242, istənilən gələcək tarix, CVC 123.
        </div>
      </div>
    </div>
  );
}
