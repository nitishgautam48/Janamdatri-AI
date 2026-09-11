import { KEYS, epdsDaysSince, epdsFollowUpDue, loadSavedEpds, scopedGet } from "./storage";

// Ported from the vanilla-JS app's buildTodayCareTasks() - a checklist
// that actually changes with pregnancy stage and the person's own last
// result, instead of a fixed generic list.
export function buildTodayCareTasks(history) {
  const guide = scopedGet(KEYS.GUIDE);
  const postpartumGuide = scopedGet(KEYS.POSTPARTUM_GUIDE);
  const isPostpartum = !!(postpartumGuide && postpartumGuide.isWithin6Weeks);
  const nutrition = scopedGet(KEYS.NUTRITION);
  const latest = history && history[0];

  const tasks = [
    { id: "supplement", text: "Take your prescribed iron-folic acid supplement", manual: true },
    { id: "hydration", text: "Stay hydrated through the day", manual: true },
  ];

  const gaps = nutrition?.result?.gaps || [];
  if (gaps.length) {
    tasks.push({ id: "nutrition_gaps", text: `Possible nutrition gaps to discuss with your provider: ${gaps.join(", ")}`, manual: true });
  } else {
    tasks.push({ id: "nutrition_check", text: "Complete your nutrition check", manual: false, done: !!nutrition });
  }

  if (isPostpartum && postpartumGuide.nextVisit) {
    postpartumGuide.nextVisit.checks.forEach((check, i) => {
      tasks.push({
        id: `pnc_${postpartumGuide.nextVisit.visit}_${i}`,
        text: `${check} (PNC Visit ${postpartumGuide.nextVisit.visit}, ${postpartumGuide.nextVisit.window})`,
        manual: true,
      });
    });
  } else if (guide?.nextAncVisit) {
    guide.nextAncVisit.checks.forEach((check, i) => {
      tasks.push({
        id: `anc_${guide.nextAncVisit.visit}_${i}`,
        text: `${check} (Visit ${guide.nextAncVisit.visit}, ${guide.nextAncVisit.window})`,
        manual: true,
      });
    });
  }

  // Td/TT dose 1 is typically due once the second trimester starts; dose 2
  // a few weeks after that - only nudge once it's actually relevant to the
  // recorded week, not for someone who hasn't set a week at all, and not
  // once someone has already delivered.
  const profileExtra = scopedGet(KEYS.PROFILE_EXTRA);
  if (!isPostpartum && guide && guide.week >= 14 && !profileExtra?.vaccineDose1) {
    tasks.push({ id: "vaccine_dose1_due", text: "Td/TT vaccine dose 1 due", manual: false, done: false });
  } else if (!isPostpartum && guide && guide.week >= 18 && profileExtra?.vaccineDose1 && !profileExtra.vaccineDose2) {
    tasks.push({ id: "vaccine_dose2_due", text: "Td/TT vaccine dose 2 due", manual: false, done: false });
  }

  if (latest?.result?.severity) {
    const sev = latest.result.severity;
    if (sev.level === "Critical" || sev.level === "Severe") {
      const reason = sev.escalatedBy ? sev.escalatedBy.replace(/_/g, " ") : sev.level.toLowerCase();
      tasks.push({ id: "followup_escalation", text: `Follow up with your provider on your last result (${reason})`, manual: true });
    }
  }
  const psychResult = latest?.result?.psychologicalEvaluation;
  if (psychResult && psychResult.classification !== "Low probability") {
    tasks.push({ id: "followup_mental_health", text: "Follow up on your Mental Health Check result", manual: true });
  }

  const savedEpds = loadSavedEpds();
  if (epdsFollowUpDue(savedEpds)) {
    tasks.push({
      id: "epds_followup_due",
      text: `Time for a Mental Health Check follow-up (last check: ${savedEpds.result.classification}, ${epdsDaysSince(savedEpds)} days ago)`,
      manual: false,
      done: false,
    });
  }

  tasks.push({ id: "warning_signs_review", text: "Review this week's warning signs", manual: true });
  return tasks;
}
