import { useState } from "react";
import Button from "./Button";
import { useLang } from "../../context/LangContext";

// One question per screen, large tappable answer buttons, a progress bar,
// and auto-advance on selection - replaces the "list of radio buttons"
// layout (EPDS, the nutrition frequency questionnaire) that read like a
// Google Form. Selecting an option is itself the primary action here, so
// tapping it both records the answer AND moves on, the way a person
// answering out loud would - no separate "confirm, then click Next" step
// for the common case of moving forward for the first time. Back (and,
// once a question already has an answer, Next) are still available for
// revisiting earlier questions without re-tapping an unchanged answer.
export default function QuestionFlow({ questions, responses, onAnswer, onComplete, submitLabel, busy, error }) {
  const { t } = useLang();
  const [step, setStep] = useState(0);
  const total = questions.length;
  const q = questions[step];
  const answered = responses[q.id] !== undefined;
  const isLast = step === total - 1;

  function selectAnswer(value) {
    onAnswer(q.id, value);
    if (!isLast) {
      // Short pause so the selected state is visible before the card
      // changes underneath it - instant would feel like nothing happened.
      setTimeout(() => setStep((s) => s + 1), 350);
    }
  }

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted">
          <span>{t("questionFlow.questionOf").replace("{a}", step + 1).replace("{b}", total)}</span>
          <span>{Math.round((step / total) * 100)}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${(step / total) * 100}%` }}
          />
        </div>
      </div>

      <p className="mb-4 text-base font-semibold leading-snug text-ink">{q.text}</p>

      <div className="flex flex-col gap-2.5" role="radiogroup" aria-label={q.text}>
        {q.options.map((opt, val) => {
          const selected = responses[q.id] === val;
          return (
            <button
              key={val}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => selectAnswer(val)}
              className={`rounded-xl border-2 px-4 py-3.5 text-left text-sm font-medium transition-all active:scale-[0.98] ${
                selected
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border-strong text-ink hover:border-primary/50 hover:bg-surface-hover"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        {step > 0 ? (
          <Button variant="ghost" type="button" onClick={() => setStep((s) => s - 1)}>
            {t("questionFlow.back")}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {!isLast && answered && (
            <Button variant="ghost" type="button" onClick={() => setStep((s) => s + 1)}>
              {t("questionFlow.next")}
            </Button>
          )}
          {isLast && answered && (
            <Button type="button" onClick={onComplete} disabled={busy}>
              {busy ? "…" : submitLabel}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-critical">{error}</p>}
    </div>
  );
}
