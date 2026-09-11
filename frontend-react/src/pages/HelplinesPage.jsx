import { useEffect, useState } from "react";
import Card from "../components/ui/Card";
import { api } from "../lib/api";

const SCHEMES = {
  PMSMA: "Pradhan Mantri Surakshit Matritva Abhiyan - free ANC checkup on the 9th of every month at government health facilities, from the 2nd trimester.",
  JSY: "Janani Suraksha Yojana - cash assistance for institutional delivery. Ask your ASHA worker about eligibility.",
  PMMVY: "Pradhan Mantri Matru Vandana Yojana - cash incentive in installments for ANC registration, checkups, and institutional delivery of the first living child.",
  AnemiaMuktBharat: "National programme for iron-folic acid supplementation and anemia screening/treatment during pregnancy.",
};

export default function HelplinesPage() {
  const [helplines, setHelplines] = useState(null);

  useEffect(() => {
    api.helplines().then(setHelplines);
  }, []);

  const tiles = helplines
    ? [
        { number: "108", label: "Emergency Ambulance", tel: "108" },
        { number: "102", label: "Pregnancy Emergency Transport", tel: "102" },
        { number: "104", label: "National Health Helpline", tel: "104" },
        { number: "181", label: "Women's Helpline", tel: "181" },
        { number: "1098", label: "Child Helpline", tel: "1098" },
        { number: "KIRAN", label: "Mental Health Helpline (1800-599-0019)", tel: "1800-599-0019" },
      ]
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card>
        <h1 className="mb-3 text-xl font-bold text-ink">Helplines</h1>
        <div className="grid gap-3 sm:grid-cols-3">
          {tiles.map((t) => (
            <a
              key={t.tel}
              href={`tel:${t.tel}`}
              className="rounded-md border border-border p-4 text-center transition-colors hover:border-primary/50 hover:bg-primary-soft"
            >
              <strong className="block text-lg font-extrabold text-primary">{t.number}</strong>
              <span className="mt-1 block text-xs text-muted">{t.label}</span>
            </a>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-bold text-ink">Government Schemes</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(SCHEMES).map(([name, desc]) => (
            <div key={name} className="rounded-md border border-border p-3.5">
              <strong className="text-sm text-ink">{name}</strong>
              <p className="mt-1 text-xs text-muted">{desc}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
