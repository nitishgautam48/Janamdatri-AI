import { useLang } from "../../context/LangContext";

// A week 1-40 timeline with trimester bands and a marker at the current
// week - richer than a single progress bar, but still just a read of the
// same guide.week value everything else already uses (no new data).
export default function PregnancyTimeline({ week }) {
  const { t } = useLang();
  const TRIMESTERS = [
    { key: "t1", labelKey: "guide.trimester1", range: [1, 13] },
    { key: "t2", labelKey: "guide.trimester2", range: [14, 27] },
    { key: "t3", labelKey: "guide.trimester3", range: [28, 40] },
  ];
  const clampedWeek = Math.min(Math.max(Math.round(week), 1), 40);
  const pct = ((clampedWeek - 1) / 39) * 100;

  return (
    <div>
      <div className="relative h-3 w-full rounded-full bg-surface-hover">
        <div className="pointer-events-none absolute inset-y-0 left-[30.8%] w-px bg-border-strong" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-y-0 left-[66.7%] w-px bg-border-strong" aria-hidden="true" />
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        <div
          className="absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-primary bg-paper-ink text-[10px] font-bold text-primary shadow"
          style={{ left: `${pct}%` }}
          title={`${t("guide.weekLabel")} ${clampedWeek}`}
        >
          {clampedWeek}
        </div>
      </div>
      <div className="mt-4 flex justify-between text-[11px] font-medium text-faint">
        <span>{t("guide.week1")}</span>
        <span>{t("guide.week40")}</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {TRIMESTERS.map((tri) => {
          const active = clampedWeek >= tri.range[0] && clampedWeek <= tri.range[1];
          return (
            <div
              key={tri.key}
              className={`rounded-md border px-2 py-1.5 text-center text-xs font-semibold ${
                active ? "border-primary/40 bg-primary-soft text-primary" : "border-border text-faint"
              }`}
            >
              {t(tri.labelKey)}
              <div className="text-[10px] font-normal">{t("guide.wkAbbrev")} {tri.range[0]}–{tri.range[1]}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
