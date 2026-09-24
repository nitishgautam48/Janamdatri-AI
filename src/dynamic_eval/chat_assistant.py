"""
Instant Help Chat Assistant - rule-based (no external LLM dependency, so
it works offline and needs no API key), sharing the same danger-sign
detection this app's assessment flow already uses. If a message matches a
WHO danger sign, safety comes first: the bot responds with an emergency
escalation and does not try to be a general FAQ bot for that turn - the
way a trained health-worker helpline would triage a call before chatting.

This is a scripted assistant, not a real conversational AI - it matches
keywords into a fixed set of intents. It exists to get a woman a useful,
instant answer (or an emergency escalation) at 2am when no health worker
is reachable, not to replace one. "Training" it means widening its
phrase coverage and adding a graceful clarifying-question fallback for
vague distress language ("I'm in pain", "I don't feel well") that isn't
specific enough to match a category on its own - asking a follow-up
question is far more useful than a flat "I didn't understand that."
"""

from . import danger_ladder, expert_system, self_harm_ladder, text_analyzer
from .phrase_match import contains_phrase, normalize

FAQ_INTENTS = [
    {
        "id": "greeting",
        "phrases": ["hi", "hello", "hey", "namaste", "namaskar", "नमस्ते", "good morning", "good evening",
                    "good afternoon", "hii", "helo", "hola"],
        "reply": ("Hello! I can help with common pregnancy questions - nutrition, ANC visits, danger "
                  "signs, labor, vaccinations, or where to get help. What would you like to know? If "
                  "this is an emergency, just tell me your symptoms and I'll flag it right away."),
    },
    {
        "id": "thanks",
        "phrases": ["thank you", "thanks", "thank u", "thnx", "shukriya", "dhanyavad", "धन्यवाद", "appreciate it",
                    "that helps", "that helped", "makes sense", "got it thanks", "ok thank you"],
        "reply": "You're welcome! Take care of yourself, and reach out anytime you have a question or concern.",
    },
    {
        "id": "anc_schedule",
        "phrases": ["anc visit", "anc checkup", "checkup schedule", "when should i go for checkup", "antenatal care",
                    "pmsma", "next checkup", "first checkup", "when is my first checkup", "how many checkups",
                    "how many anc visits", "how many times should i visit the doctor", "prenatal visit",
                    "prenatal checkup", "prenatal check up", "doctor visit schedule", "when is my next checkup",
                    "anc card", "how often should i see doctor", "how often checkup", "एएनसी"],
        "reply": ("India's RCH programme recommends at least 4 ANC visits: within 12 weeks, 14-26 weeks, "
                  "28-34 weeks, and 36 weeks to term. PMSMA gives a free ANC checkup on the 9th of every "
                  "month at government facilities. See the Pregnancy Guide tab for your personalized schedule."),
    },
    {
        "id": "nutrition",
        "phrases": ["what should i eat", "what to eat", "diet", "nutrition", "food during pregnancy",
                    "iron tablets", "folic acid", "eating habits", "hungry all the time", "vomiting",
                    "ulti", "ulti ho rahi", "morning sickness", "nausea", "nauseous", "iron rich food", "iron rich foods",
                    "foods with iron", "food with iron", "high iron food", "high iron foods",
                    "which foods have iron", "foods high in iron", "food high in iron",
                    "foods are high in iron", "food is high in iron", "which food has iron",
                    "what food has iron", "protein foods",
                    "protein rich food", "calcium foods", "calcium rich food", "foods for pregnancy",
                    "healthy food pregnancy", "healthy diet", "balanced diet", "foods for baby growth",
                    "prenatal nutrition", "good food for pregnancy", "diet plan", "diet chart",
                    "nutritious food", "no appetite", "not eating well", "loss of appetite",
                    "best food for pregnant", "vitamins to take", "which vitamins", "पोषण", "खाना"],
        "reply": ("Take your iron-folic acid (IFA) tablets as prescribed, eat iron-rich foods (leafy "
                  "greens, jaggery, lentils), and add calcium from the second trimester. Small, frequent "
                  "meals help with nausea. See the Pregnancy Guide tab for trimester-specific tips."),
    },
    {
        "id": "food_safety",
        "phrases": ["eat papaya", "raw papaya", "eat pineapple", "safe to eat", "ok to eat", "okay to eat",
                    "foods to avoid", "food to avoid", "foods should i avoid", "what not to eat",
                    "what should i avoid eating", "avoid eating", "street food", "raw food",
                    "undercooked", "raw fish", "sushi",
                    "papaya safe", "pineapple safe", "eating outside food", "junk food pregnancy",
                    "coffee during pregnancy", "is coffee safe", "caffeine safe", "drink tea", "tea safe",
                    "chocolate safe", "seafood safe", "fish safe to eat", "eggs safe",
                    "cheese safe", "unpasteurized"],
        "reply": ("Ripe papaya and pineapple in normal amounts are fine - the traditional caution is "
                  "specifically about large amounts of RAW/unripe papaya. Avoid unpasteurized dairy, "
                  "undercooked meat/eggs/fish, and raw seafood (listeria/toxoplasmosis risk); limit "
                  "caffeine, and avoid alcohol completely. When in doubt about a specific food, ask your "
                  "ANC provider rather than relying on general advice."),
    },
    {
        "id": "hydration",
        "phrases": ["how much water", "hydration", "drink water", "dehydration", "dehydrated",
                    "not drinking enough water", "thirsty all the time", "how many litres of water",
                    "how many glasses of water"],
        "reply": ("Aim for about 2.5-3 litres of water a day, more in hot weather or if you're vomiting - "
                  "dark urine, dizziness, or a dry mouth are signs you need more. Severe vomiting that "
                  "stops you from keeping fluids down needs same-day medical attention, not just more water."),
    },
    {
        "id": "missed_period",
        "phrases": ["missed my period", "missed period", "late period", "think im pregnant",
                    "might be pregnant", "period is late", "no periods", "pregnancy test",
                    "am i pregnant", "confirm pregnancy", "early signs of pregnancy",
                    "signs of pregnancy", "pregnancy symptoms"],
        "reply": ("A missed period is one of the earliest pregnancy signs - a home urine pregnancy test "
                  "(after your period is a few days late) or a visit to your ASHA/ANM or a clinic can "
                  "confirm it. If it's positive, register for ANC care as early as possible - the first "
                  "trimester matters for screening and starting supplements."),
    },
    {
        "id": "medication_safety",
        "phrases": ["take paracetamol", "is paracetamol safe", "safe medicine", "which medicines are safe",
                    "can i take medicine", "otc medicine", "pain medicine", "ibuprofen", "safe painkiller",
                    "cold medicine", "fever medicine", "safe to take tablet", "antibiotics safe",
                    "safe drugs", "safe during pregnancy medicine", "headache tablet", "flu medicine",
                    "cough syrup safe", "ayurvedic medicine safe", "herbal medicine safe"],
        "reply": ("Paracetamol (acetaminophen) at the recommended dose is generally considered safe in "
                  "pregnancy, but ibuprofen, aspirin, and most other painkillers are NOT recommended, "
                  "especially later in pregnancy. Always check with your ANC provider or pharmacist before "
                  "taking ANY medicine, including ones that seem harmless - this includes herbal/ayurvedic "
                  "remedies too."),
    },
    {
        "id": "anemia",
        "phrases": ["anemia", "anaemia", "hemoglobin", "haemoglobin", "hb level", "hb count", "feeling weak",
                    "always tired", "low hemoglobin", "iron deficiency", "blood count low", "pale skin",
                    "looking pale", "low iron", "एनीमिया"],
        "reply": ("Anemia is very common in pregnancy in India - about half of pregnant women are affected. "
                  "If you have a recent hemoglobin (Hb) test, enter it in the Assessment tab's Anemia Check "
                  "for India-specific grading. Below 7 g/dL is a severe-anemia emergency - go to a facility."),
    },
    {
        "id": "newborn_care",
        "phrases": ["baby crying", "baby is crying", "newborn crying", "infant crying",
                    "baby not sleeping", "newborn not sleeping", "baby wont sleep", "baby won't sleep",
                    "how to burp baby", "burping baby", "umbilical cord care", "cord stump",
                    "newborn care", "newborn care tips", "caring for newborn", "baby not feeding well",
                    "baby refusing to feed", "baby feeding problems"],
        "reply": ("Frequent crying, unsettled sleep, and feeding hiccups are common in the first weeks as "
                  "a newborn adjusts - try feeding on demand, skin-to-skin contact, and burping after "
                  "feeds (hold upright, gently pat the back). Keep the umbilical cord stump clean and dry "
                  "until it falls off on its own (usually 1-2 weeks) - don't pull it off. See a doctor "
                  "promptly if the baby is unusually hard to wake, refuses multiple feeds in a row, has a "
                  "fever, or the cord area looks red, swollen, or smells bad."),
    },
    {
        "id": "mental_health",
        "phrases": ["feeling sad", "feel sad", "very sad", "so sad", "depressed", "anxious", "anxiety",
                    "cant sleep", "can't sleep", "mood", "stress", "stressed", "im scared", "i am scared",
                    "worried", "overwhelmed", "crying a lot", "not supportive", "no support",
                    "no one to talk to", "alone in this", "feeling low", "feeling down", "feel low",
                    "feel down", "postpartum depression", "baby blues", "mood swings", "irritable",
                    "panic attack", "feel like crying", "want to cry", "उदास"],
        "reply": ("Feeling low, anxious, or overwhelmed during or after pregnancy is common and treatable - "
                  "it's not a personal failing. Try the Mental Health Check (EPDS) tab, or talk to your ANC "
                  "provider. If you ever have thoughts of harming yourself, call KIRAN: 1800-599-0019 (24x7)."),
    },
    {
        "id": "helpline",
        "phrases": ["helpline", "phone number", "emergency number", "ambulance number", "contact",
                    "call ambulance", "who do i call", "who can i call", "call for support",
                    "emergency contact", "who to call", "nearest hospital number", "108 number",
                    "asha worker contact", "anm contact", "need help now", "helpline number"],
        "reply": ("Emergency ambulance: 108. Pregnancy emergency transport: 102. Women's helpline: 181. "
                  "Mental health (KIRAN): 1800-599-0019. See the Helplines tab for the full list."),
    },
    {
        "id": "labor_signs",
        "phrases": ["in labor", "in labour", "labour signs", "labor signs", "contractions",
                    "how do i know labor", "how do i know if im in labor", "water broke", "waters broke",
                    "when will i deliver", "am i in labor", "am i in labour", "false labor",
                    "braxton hicks", "when to go to hospital", "signs of labour", "signs of labor",
                    "period like cramps", "tightening of stomach", "belly tightening"],
        "reply": ("Signs labor may be starting: regular, increasingly strong contractions; your water "
                  "breaking; lower back pain with tightening. If contractions are regular and less than "
                  "5-10 minutes apart, or your water breaks, head to your planned facility now - don't wait "
                  "at home to see if it's 'real' labor."),
    },
    {
        "id": "fetal_movement",
        "phrases": ["baby movement", "kick count", "how many kicks", "baby kicking", "fetal movement",
                    "feel the baby move", "when will i feel movement", "when should i feel movement",
                    "baby move", "how often should baby move", "how much should baby move",
                    "normal baby movement", "how many movements per day"],
        "reply": ("From about the second trimester, you should feel regular movement every day. A noticeable "
                  "drop in movement, or none at all in a few hours where the baby is usually active, is a "
                  "reason to go get checked the same day - don't wait until the next scheduled visit."),
    },
    {
        "id": "vaccination",
        "phrases": ["vaccine", "vaccination", "tt injection", "tetanus shot", "td injection", "immunization",
                    "tdap", "flu shot", "flu vaccine", "covid vaccine pregnancy", "which vaccines needed",
                    "which vaccines do i need", "what vaccines do i need", "which vaccine do i need",
                    "vaccine schedule", "when to take tt injection", "how many tt doses"],
        "reply": ("The Td (tetanus-diphtheria) vaccine is usually given in two doses during pregnancy, "
                  "starting in the second trimester - your ANC provider will schedule these at your visits. "
                  "See the Pregnancy Guide tab for the full ANC schedule."),
    },
    {
        "id": "delivery_place",
        "phrases": ["where should i deliver", "hospital delivery", "home birth", "which hospital",
                    "institutional delivery", "cost of delivery", "how much does delivery cost",
                    "is c section safe", "is cesarean safe", "c-section safe", "c section safe",
                    "normal delivery vs cesarean", "normal delivery vs c section", "vaginal delivery",
                    "which hospital to choose", "government hospital delivery", "delivery expenses",
                    "csection recovery", "c section recovery"],
        "reply": ("An institutional delivery (hospital or PHC/FRU with skilled staff and emergency care "
                  "available) is safer than a home birth, especially if any risk factors are present. "
                  "JSY provides cash assistance for institutional delivery - ask your ASHA worker."),
    },
    {
        "id": "blood_pressure",
        "phrases": ["blood pressure", "bp check", "whats normal bp", "what is normal bp", "is my bp high",
                    "bp reading", "hypertension", "high bp", "low bp", "hypotension", "bp normal range",
                    "check blood pressure", "what is preeclampsia", "what is pre-eclampsia",
                    "what is eclampsia", "signs of preeclampsia"],
        "reply": ("Normal BP in pregnancy is under 140/90 - readings at or above that (especially with "
                  "headache, blurred vision, or swelling) can mean pre-eclampsia and need same-day checking. "
                  "Get it checked at every ANC visit, and enter a reading in the Assessment tab if you have one."),
    },
    {
        "id": "gestational_diabetes",
        "phrases": ["gestational diabetes", "high blood sugar", "gdm", "sugar test", "glucose test",
                    "diabetes in pregnancy", "sugar level pregnancy", "blood sugar test", "gtt test",
                    "diabetes test", "blood sugar level pregnancy"],
        "reply": ("Gestational diabetes is usually screened with a glucose tolerance test around 24-28 weeks - "
                  "it's common and manageable with diet, activity, and monitoring, and usually resolves after "
                  "delivery. Unmanaged, it raises risks for both you and the baby, so don't skip the test."),
    },
    {
        "id": "leg_swelling_dvt",
        "phrases": ["one leg is swollen", "swollen leg", "leg pain and swelling", "red swollen leg",
                    "calf pain", "leg is red and warm", "one leg more swollen than the other"],
        "reply": ("Swelling in BOTH legs is common in pregnancy, but swelling, redness, warmth, or pain in "
                  "just ONE leg (especially the calf) can be a blood clot (DVT) - this needs same-day medical "
                  "evaluation, not a wait-and-see approach."),
    },
    {
        "id": "itching_cholestasis",
        "phrases": ["itching all over", "severe itching", "itchy skin no rash", "itching hands and feet",
                    "itching at night", "very itchy", "skin itching pregnancy", "itchy at night pregnancy",
                    "itchy palms", "itchy soles"],
        "reply": ("Intense itching, especially on the palms/soles and worse at night, with no rash, can be "
                  "obstetric cholestasis - a liver condition that's treatable but needs a blood test (liver "
                  "function/bile acids) to confirm. Mention it to your ANC provider rather than just managing "
                  "the itch."),
    },
    {
        "id": "warning_signs_list",
        "phrases": ["what are the warning signs", "pregnancy warning signs", "list of danger signs",
                    "what should i watch for", "danger signs list", "warning signs of pregnancy",
                    "emergency signs", "when to worry", "red flags pregnancy", "when should i go to hospital",
                    "when is it an emergency", "what counts as an emergency"],
        "reply": ("Go to a facility now for any of: heavy vaginal bleeding, severe headache with blurred "
                  "vision, convulsions/fits, severe abdominal pain, high fever, fast/difficult breathing, "
                  "reduced or no baby movement, or chest pain. See the Pregnancy Guide tab for the full list "
                  "with more detail."),
    },
    # --- Postpartum topics: none of these existed before, so any real
    # postpartum question fell straight to the fallback message. ---
    {
        "id": "postpartum_period_return",
        "phrases": ["postpartum period", "period after delivery", "period after pregnancy",
                    "period after birth", "when will my period return", "period come back after delivery",
                    "periods after childbirth", "lochia", "how long does postpartum bleeding last"],
        "reply": ("The bleeding right after delivery (lochia) is not your period - it's the uterus healing, "
                  "and normally lightens and stops within about 6 weeks. Your actual period usually returns "
                  "6-8 weeks after delivery if you're not breastfeeding, or later (sometimes several months) "
                  "if you're exclusively breastfeeding, since that can delay ovulation. Heavy bleeding that "
                  "increases again after it had lightened, or large clots, should be checked promptly."),
    },
    {
        "id": "postpartum_contraception",
        "phrases": ["postpartum contraception", "family planning after delivery", "when can i get pregnant again",
                    "contraception after delivery", "contraception can i use after delivery",
                    "birth control after delivery", "family planning after birth", "spacing between pregnancies"],
        "reply": ("Spacing pregnancies by at least 2 years is recommended, for your body to recover and for "
                  "the baby's health. Exclusive breastfeeding can delay fertility for the first 6 months "
                  "only if periods haven't returned - it's not fully reliable beyond that. Ask your ASHA/ANM "
                  "about postpartum contraceptive options (condoms, pills, IUD, injectables) - many can start "
                  "soon after delivery."),
    },
    {
        "id": "postpartum_sex_exercise",
        "phrases": ["when can i have sex after delivery", "sex after delivery", "postpartum exercise",
                    "exercise after delivery", "losing weight after pregnancy", "when can i exercise after delivery",
                    "when can i resume exercise"],
        "reply": ("Most providers suggest waiting about 6 weeks before resuming sex or vigorous exercise, so "
                  "any tearing/incision can heal and bleeding can settle - gentle walking is usually fine much "
                  "sooner. Everyone heals at a different pace (a C-section or a difficult delivery may need "
                  "longer), so check with your provider at your postpartum visit before restarting either."),
    },
    {
        "id": "breastfeeding",
        "phrases": ["how often should i breastfeed", "baby not latching", "latching problems", "not enough milk",
                    "low milk supply", "sore nipples breastfeeding", "how long should i breastfeed",
                    "breastfeeding positions", "when will my milk come in", "engorged breasts", "engorgement",
                    "blocked milk duct", "clogged milk duct", "mastitis", "breastfeeding difficulty",
                    "breastfeeding pain", "cracked nipples"],
        "reply": ("Feed on demand - newborns typically feed 8-12 times a day. A good latch (baby's mouth "
                  "covering most of the areola, not just the nipple) is the biggest fix for pain and low "
                  "supply; a lactation counsellor or ASHA can help check this. Milk usually 'comes in' by "
                  "day 3-5. Engorgement, a hard/red tender lump (blocked duct), or fever with breast pain "
                  "(possible mastitis) are worth checking with a provider rather than pushing through - "
                  "mastitis in particular can need antibiotics."),
    },
    # --- Pregnancy lifestyle topics - common questions with no obstetric
    # danger-sign content, so nothing else in this file was ever going to
    # catch them. ---
    {
        "id": "exercise_pregnancy",
        "phrases": ["exercise during pregnancy", "is exercise safe during pregnancy", "is yoga safe during pregnancy",
                    "can i exercise during pregnancy", "safe exercises pregnancy", "walking during pregnancy",
                    "physical activity pregnancy", "can i do yoga pregnant", "gym during pregnancy"],
        "reply": ("Moderate exercise (walking, prenatal yoga, swimming) is generally encouraged throughout an "
                  "uncomplicated pregnancy and helps with sleep, mood, and labor. Avoid contact sports, "
                  "activities with a fall risk, and lying flat on your back for long periods after the first "
                  "trimester. Stop and get checked if you get bleeding, contractions, fluid leaking, or "
                  "dizziness during activity - and check with your provider first if you have any pregnancy "
                  "complication."),
    },
    {
        "id": "travel_pregnancy",
        "phrases": ["travel during pregnancy", "is flying safe during pregnancy", "air travel pregnancy",
                    "safe to travel while pregnant", "car travel pregnancy", "flying while pregnant",
                    "train travel pregnancy"],
        "reply": ("Travel is usually fine in an uncomplicated pregnancy, and the second trimester is generally "
                  "the most comfortable time for it. Most airlines restrict flying close to the due date "
                  "(often after 36 weeks) and may want a fitness certificate late in pregnancy. On longer "
                  "trips, move/stretch your legs periodically to lower blood clot risk, and carry your ANC "
                  "card. Check with your provider first if you have any pregnancy complication or are past "
                  "36 weeks."),
    },
    {
        "id": "sex_pregnancy",
        "phrases": ["sex during pregnancy", "is sex safe during pregnancy", "intercourse during pregnancy",
                    "sexual activity pregnancy", "can we have sex while pregnant"],
        "reply": ("Sex is generally safe throughout an uncomplicated pregnancy and doesn't harm the baby. Your "
                  "provider may advise avoiding it if you have a low-lying placenta (placenta previa), a "
                  "history of preterm labor, unexplained bleeding, or your water has broken. Stop and get "
                  "checked if it triggers bleeding, fluid leakage, or persistent cramping/contractions "
                  "afterward."),
    },
    {
        "id": "weight_gain",
        "phrases": ["how much weight should i gain", "normal weight gain pregnancy", "weight gain trimester",
                    "underweight pregnancy", "overweight pregnancy", "is my weight gain normal",
                    "too much weight gain pregnancy", "not gaining enough weight"],
        "reply": ("Healthy total weight gain depends on your starting weight - roughly 11-16 kg for a normal "
                  "starting BMI, more if underweight and less if overweight, most of it in the second and "
                  "third trimesters. Very little/no gain, or a sudden large jump in a short time (possible "
                  "fluid retention/pre-eclampsia), are both worth flagging to your ANC provider rather than "
                  "guessing on your own."),
    },
    {
        "id": "twins_multiple",
        "phrases": ["twins pregnancy", "am i having twins", "multiple pregnancy", "twin pregnancy risks",
                    "expecting twins", "carrying twins"],
        "reply": ("A multiple (twin or more) pregnancy is usually confirmed on an early ultrasound and needs "
                  "closer monitoring - more frequent ANC visits, extra scans, and watching for pre-eclampsia, "
                  "gestational diabetes, and preterm labor, all somewhat more common with multiples. "
                  "Institutional delivery is strongly recommended. Your ANC provider will set a monitoring "
                  "schedule specific to your pregnancy."),
    },
    {
        "id": "due_date",
        "phrases": ["when is my due date", "how to calculate due date", "due date calculator",
                    "expected date of delivery", "edd", "when will i deliver", "how many weeks left",
                    "how many weeks am i", "how many weeks pregnant am i"],
        "reply": ("Your due date (EDD) is usually estimated as 40 weeks from the first day of your last "
                  "menstrual period, or more accurately from an early ultrasound if you had one. It's an "
                  "estimate, not an exact date - most babies arrive anywhere from 37 to 42 weeks. Enter your "
                  "LMP or week in the Pregnancy Guide tab to see your estimated timeline."),
    },
    {
        "id": "birth_plan_pain_relief",
        "phrases": ["birth plan", "pain relief during labor", "epidural safe", "is epidural safe",
                    "labor pain management", "normal delivery pain relief", "pain relief options labor",
                    "can i request epidural"],
        "reply": ("It's worth discussing your preferences (pain relief options, who's with you, immediate "
                  "skin-to-skin, etc.) with your provider in advance, though plans may need to change if "
                  "complications come up. An epidural is a commonly used, generally safe option for labor "
                  "pain at most hospitals, alongside breathing techniques and position changes - ask what's "
                  "available at your planned facility, since not every centre offers it."),
    },
    {
        "id": "ultrasound_scans",
        "phrases": ["ultrasound schedule", "when is my first ultrasound", "anomaly scan", "gender scan",
                    "how many scans", "dating scan", "nt scan", "how many ultrasounds needed"],
        "reply": ("A typical schedule includes an early dating scan (around 6-10 weeks), an NT scan (11-14 "
                  "weeks) for early risk screening, and an anomaly/mid-pregnancy scan (18-22 weeks) that "
                  "checks the baby's growth and organs - your provider may add more if needed. Gender is "
                  "often visible from the anomaly scan onward, though that isn't the scan's main purpose and "
                  "isn't always fully certain."),
    },
    {
        "id": "sleep_position",
        "phrases": ["sleeping position pregnancy", "which side to sleep pregnancy", "can i sleep on my back",
                    "best sleeping position pregnancy", "safe to sleep on back", "sleeping on stomach pregnancy"],
        "reply": ("Sleeping on your LEFT side from the second trimester onward is generally recommended - it "
                  "improves blood flow to the baby and reduces pressure on major blood vessels. Occasionally "
                  "rolling onto your back or right side isn't harmful, but try to settle back onto your side; "
                  "stomach sleeping simply becomes impractical as the bump grows."),
    },
    # --- Common, usually-benign discomforts that were previously either
    # unrecognized (fallback) or - for "backache"/"pelvic pain" - routed
    # into the generic "pain" clarifying question instead of a direct,
    # informational answer that's more useful for something this common. ---
    {
        "id": "discharge_normal",
        "phrases": ["white discharge normal", "is discharge normal", "normal vaginal discharge pregnancy",
                    "increased discharge pregnancy", "clear discharge pregnancy", "yellow discharge",
                    "green discharge", "brown discharge"],
        "reply": ("An increase in thin, milky-white, mild-smelling discharge is common and normal in "
                  "pregnancy. See your ANC provider if it becomes thick and itchy (possible yeast infection), "
                  "yellow/green, foul-smelling, or is blood-tinged or watery and gushing (possible fluid "
                  "leak) - those are worth checking rather than waiting."),
    },
    {
        "id": "backache_pregnancy",
        "phrases": ["backache pregnancy", "backache", "back pain pregnancy", "lower back pain pregnancy",
                    "back ache pregnancy"],
        "reply": ("Backache is very common as pregnancy progresses, from the shifting centre of gravity and "
                  "loosening ligaments - gentle stretching, good posture, a supportive pillow between the "
                  "knees when sleeping, and avoiding heavy lifting all help. Get checked promptly if it's "
                  "sudden/severe, rhythmic (possible contractions), or comes with fever, bleeding, or pain "
                  "when urinating."),
    },
    {
        "id": "pelvic_girdle_pain",
        "phrases": ["pelvic pain pregnancy", "pelvic pain", "round ligament pain", "hip pain pregnancy",
                    "groin pain pregnancy", "pelvic girdle pain"],
        "reply": ("Sharp, brief pains in the lower belly or groin when you move suddenly (standing up, "
                  "rolling over) are often round ligament pain - the ligaments supporting the uterus "
                  "stretching - and are common and usually harmless. Persistent pelvic/hip pain that affects "
                  "walking may be pelvic girdle pain, which a physiotherapist can help with. Get checked if "
                  "the pain is severe, constant, or comes with bleeding, fever, or contractions."),
    },
    {
        "id": "hemorrhoids_piles",
        "phrases": ["hemorrhoids pregnancy", "piles during pregnancy", "piles pregnancy", "anal pain pregnancy",
                    "hemorrhoids during pregnancy"],
        "reply": ("Hemorrhoids (piles) are common in pregnancy from increased pressure, and are usually "
                  "managed with more fibre and water, avoiding straining, and a warm sitz bath - ask your "
                  "provider about a safe topical cream if needed. Mention it if there's significant bleeding, "
                  "severe pain, or it doesn't improve, so other causes aren't missed."),
    },
    {
        "id": "constipation_pregnancy",
        "phrases": ["constipation pregnancy", "constipated pregnancy", "hard stools pregnancy",
                    "not passing stool pregnancy", "constipation during pregnancy"],
        "reply": ("Constipation is common in pregnancy (hormones slow digestion, and iron supplements can add "
                  "to it). More fibre (fruit, vegetables, whole grains), plenty of water, and gentle movement "
                  "usually help. Ask your provider before taking any laxative - some are fine, but "
                  "self-medicating isn't advised."),
    },
    {
        "id": "heartburn_reflux",
        "phrases": ["heartburn pregnancy", "acid reflux pregnancy", "heartburn during pregnancy",
                    "indigestion pregnancy"],
        "reply": ("Heartburn/acid reflux is common, especially later in pregnancy as the growing uterus puts "
                  "pressure on the stomach. Smaller, more frequent meals, avoiding lying down right after "
                  "eating, and cutting spicy/oily/acidic foods often help. Ask your provider before taking "
                  "any antacid - some are considered safe in pregnancy, but check first rather than "
                  "guessing."),
    },
    {
        "id": "stretch_marks_varicose",
        "phrases": ["stretch marks", "varicose veins pregnancy", "varicose veins", "spider veins pregnancy"],
        "reply": ("Stretch marks and varicose veins are common, largely genetic, cosmetic changes from skin "
                  "stretching and increased blood volume - moisturizing can help with itching but won't "
                  "prevent them, and both typically fade or improve after delivery. They're not a medical "
                  "concern unless a vein becomes hot, red, hard, and tender (possible clot), which needs "
                  "prompt checking."),
    },
    # --- Small talk. Not medical content, but a scripted assistant that
    # answers "who are you" or "bye" with "I don't understand" reads as
    # broken, not careful. ---
    {
        "id": "smalltalk_identity",
        "phrases": ["who are you", "what can you do", "are you a doctor", "are you human", "how are you",
                    "what languages do you speak", "what is this app", "what do you do", "how do you work"],
        "reply": ("I'm doing fine, thanks for asking! I'm Janamdatri's built-in assistant - a scripted helper "
                  "(not a doctor or a real person) that can answer common pregnancy questions (nutrition, ANC "
                  "visits, danger signs, labor, vaccinations, postpartum care) and check anything you "
                  "describe for danger signs. For anything that needs an actual diagnosis or exam, please "
                  "see your ANC provider or ASHA/ANM."),
    },
    {
        "id": "smalltalk_farewell",
        "phrases": ["bye", "goodbye", "see you", "see you later", "talk later", "gtg", "got to go"],
        "reply": "Take care of yourself! Come back anytime you have a question, or if anything changes - I'm here 24x7.",
    },
]

# A second, looser matching pass tried ONLY when no full phrase above
# matched anything - enumerating every real-world way to ask a question
# is a losing game (a rule-based matcher will always miss some phrasing),
# so this catches the rest via single strong topic words instead of
# giving up to the flat fallback. Deliberately short and topic-specific
# (not generic words like "food" or "pain" that would over-match) - each
# entry maps to the SAME FAQ_INTENTS id, so it reuses the existing reply
# text rather than needing its own.
KEYWORD_HINTS = {
    "anc_schedule": ["anc", "prenatal"],
    "nutrition": ["iron", "nutrition", "protein", "calcium", "supplement", "supplements", "appetite"],
    "food_safety": ["papaya", "pineapple", "caffeine", "seafood", "unpasteurized"],
    "hydration": ["hydration", "dehydration"],
    # "pregnant" removed - it's common enough in unrelated real messages
    # ("when can I get pregnant again", "is it safe when pregnant") that it
    # was misrouting postpartum/general questions into "missed period"
    # advice; "period" alone is specific enough for this hint's purpose.
    "missed_period": ["period"],
    "medication_safety": ["paracetamol", "ibuprofen", "painkiller", "antibiotics", "medicine", "tablet"],
    "anemia": ["anemia", "anaemia", "hemoglobin", "haemoglobin"],
    "mental_health": ["depressed", "depression", "anxiety", "anxious", "stressed", "overwhelmed"],
    "helpline": ["helpline", "ambulance"],
    "labor_signs": ["labor", "labour", "contractions", "braxton"],
    "fetal_movement": ["kicks", "kicking"],
    "vaccination": ["vaccine", "vaccination", "immunization", "tdap"],
    "delivery_place": ["cesarean", "caesarean", "c-section", "csection"],
    "blood_pressure": ["hypertension", "hypotension", "preeclampsia", "pre-eclampsia", "eclampsia"],
    "gestational_diabetes": ["gdm", "glucose"],
    "leg_swelling_dvt": ["dvt"],
    "itching_cholestasis": ["cholestasis"],
    "breastfeeding": ["breastfeed", "breastfeeding", "lactation", "latch"],
    "exercise_pregnancy": ["yoga"],
    "twins_multiple": ["twins"],
    "hemorrhoids_piles": ["hemorrhoids", "piles"],
    # "danger sign(s)" is the app's own phrasing everywhere in the UI (the
    # Home page's "Call 108 right away if" card, the chat widget's own
    # starter chip "What danger signs should I watch for?") but wasn't
    # actually recognized - the exact-phrase list only had "warning
    # signs"/"red flags" wording, so this fell straight to the fallback.
    "warning_signs_list": ["danger sign", "danger signs"],
}


# Two related follow-up questions offered as tappable chips under each
# FAQ answer - what makes this an interactive session rather than a
# one-shot Q&A. Each one is worded to match a phrase already in
# FAQ_INTENTS (or a keyword hint) above, so tapping it always resolves to
# a real answer rather than accidentally hitting the fallback.
RELATED_PROMPTS = {
    "anc_schedule": ["What tests happen at each ANC visit?", "What vaccines do I need?"],
    "nutrition": ["What foods should I avoid?", "How much water should I drink?"],
    "food_safety": ["What foods are high in iron?", "Is coffee safe during pregnancy?"],
    "hydration": ["What should I eat during pregnancy?"],
    "missed_period": ["What are the early signs of pregnancy?", "How many ANC visits do I need?"],
    "medication_safety": ["What foods should I avoid?"],
    "anemia": ["What foods are high in iron?", "How often should I have ANC checkups?"],
    "mental_health": ["Who can I call for support?"],
    "helpline": ["What are the pregnancy warning signs?"],
    "labor_signs": ["What are the pregnancy warning signs?", "Where should I deliver?"],
    "fetal_movement": ["How often should baby move?"],
    "vaccination": ["What is my ANC visit schedule?"],
    "delivery_place": ["Is c-section safe?", "How much does delivery cost?"],
    "blood_pressure": ["What is gestational diabetes?", "What is preeclampsia?"],
    "gestational_diabetes": ["What is normal bp?"],
    "leg_swelling_dvt": ["What are the warning signs I should watch for?"],
    "itching_cholestasis": ["What are the warning signs I should watch for?"],
    "warning_signs_list": ["Who do I call in an emergency?"],
    "newborn_care": ["My baby has yellow skin, is that normal?", "How often should I breastfeed?"],
    "postpartum_period_return": ["What contraception can I use after delivery?", "How long does postpartum bleeding last?"],
    "postpartum_contraception": ["When will my period return after delivery?", "When can I exercise after delivery?"],
    "postpartum_sex_exercise": ["What contraception can I use after delivery?"],
    "breastfeeding": ["My baby is crying a lot, what should I do?"],
    "exercise_pregnancy": ["Is sex safe during pregnancy?", "How much weight should I gain?"],
    "travel_pregnancy": ["Is exercise safe during pregnancy?"],
    "sex_pregnancy": ["Is exercise safe during pregnancy?"],
    "weight_gain": ["Is exercise safe during pregnancy?"],
    "twins_multiple": ["What is gestational diabetes?", "What is normal bp?"],
    "due_date": ["Am I having twins?"],
    "birth_plan_pain_relief": ["Where should I deliver?", "Is c-section safe?"],
    "ultrasound_scans": ["When is my due date?"],
    "sleep_position": ["Is exercise safe during pregnancy?"],
    "discharge_normal": ["What are the warning signs I should watch for?"],
    "backache_pregnancy": ["What are the warning signs I should watch for?"],
    "pelvic_girdle_pain": ["What are the warning signs I should watch for?"],
    "hemorrhoids_piles": ["What helps with constipation during pregnancy?"],
    "constipation_pregnancy": ["What should I eat during pregnancy?"],
    "heartburn_reflux": ["What foods should I avoid?"],
    "stretch_marks_varicose": ["What are the warning signs I should watch for?"],
    "smalltalk_identity": ["What are the pregnancy warning signs?"],
    "smalltalk_farewell": [],
}


def _match_keyword_hints(normalized_text: str):
    for intent_id, keywords in KEYWORD_HINTS.items():
        if any(contains_phrase(normalized_text, kw) for kw in keywords):
            return next(i for i in FAQ_INTENTS if i["id"] == intent_id)
    return None

# Vague distress language that isn't specific enough to match a category on
# its own ("I'm in pain", "I don't feel well") - rather than a flat "I
# didn't understand," ask a clarifying question the way a triage nurse
# would, so the person can give the detail that actually determines urgency.
# Grouped by topic (not one generic bucket) so the follow-up question
# actually engages with what the person said, instead of reading like a
# canned response no matter what they typed.
# One warm, single question per turn - not a bracketed checklist of 3-4
# questions stacked into one message. The old wording ("where is it (head,
# abdomen, chest, back)? Is it mild, or severe...? Did it start
# suddenly...? Is there any bleeding...?") read like a form's field labels,
# not like a person asking; it also forced a one-shot answer to cover
# every sub-question, which real short replies ("in my head", "since
# yesterday") never do. Asking one thing at a time is closer to how a
# health worker actually triages by phone, and - for "pain" specifically -
# the location answer is now actually understood (see _match_pain_location
# above) instead of only re-asking the same question if it doesn't land.
VAGUE_TOPICS = [
    {
        "id": "pain",
        "keywords": ["pain", "hurt", "hurting", "ache", "aching", "cramp", "cramping", "discomfort",
                     # Romanized Hindi (Hinglish) for pain/ache, representative not exhaustive.
                     "dard", "dard ho raha", "dard hai"],
        "question": "I'm sorry you're in pain - whereabouts is it? For example your head, tummy, chest, or back.",
    },
    {
        "id": "energy",
        "keywords": ["tired all the time", "always tired", "no energy", "exhausted",
                     "low energy", "feeling weak", "so weak"],
        "question": "How long have you been feeling this tired or weak - just today, or has it been a few days now?",
    },
    {
        "id": "mood",
        "keywords": ["not myself", "off today", "emotionally", "cant cope", "can't cope"],
        "question": (
            "Is this more about how you're feeling emotionally, or is something physical going on too? "
            "If it's your mood, the Mental Health Check tab has a proper screening tool for it - and if "
            "you're ever having thoughts of harming yourself, please call KIRAN right now: "
            "1800-599-0019 (toll-free, 24x7)."
        ),
    },
    {
        "id": "palpitations",
        "keywords": ["heart racing", "heart is racing", "palpitations", "heart pounding", "heart beating fast"],
        "question": "Does your heart racing happen even at rest, or mainly when you're active?",
    },
    {
        "id": "generic_unwell",
        "keywords": ["not feeling well", "dont feel well", "don't feel well", "feel sick",
                     "feeling sick", "unwell", "not well", "something wrong", "not right",
                     "worried about my body", "feeling weird", "feel weird", "feel off",
                     "something is wrong", "not sure whats wrong", "not sure what's wrong",
                     "not feeling good", "help me", "please help", "i need help", "need advice", "confused",
                     "im worried", "i am worried", "is this normal", "is that normal",
                     "dont know whats happening", "don't know what's happening",
                     "dont know whats wrong", "don't know what's wrong"],
        "question": "Can you tell me a bit more - is it something physical, or more about how you're feeling emotionally?",
    },
]

# After this many back-and-forth exchanges that STILL haven't resolved into
# a real answer, repeating another open-ended question stops being useful -
# a health worker would move to a concrete next step instead of asking the
# same thing a third time, so this bot should too.
MAX_CLARIFYING_ROUNDS = 2

NUDGE_REPLY = (
    "I don't want to keep going back and forth without actually helping. Please open the Assessment "
    "tab and run a full check (it takes about a minute and looks at a lot more than I can in chat), "
    "or contact your ASHA/ANM worker directly so they can properly examine what you're describing. "
    "If anything about this feels sudden, severe, or you're unsure, treat it as urgent and call 108 now."
)

FALLBACK_REPLY = (
    "I'm not sure I understood that. I can answer questions about ANC visits, nutrition, anemia, "
    "mental health, labor signs, vaccinations, or helplines - or describe your symptoms and I'll "
    "check for danger signs. For anything urgent, please contact your ASHA/ANM worker or call 108."
)

# Checked BEFORE anything else, independent of the EPDS tool - someone
# typing this in chat should never be routed into a physical-symptom flow
# or a generic FAQ answer first. Brief crisis-intervention structure
# (validate -> assess immediate safety -> reduce access to means -> connect
# with someone -> give a way to act right now), not just a phone number,
# following the same "ANY self-harm signal overrides everything else"
# principle this project already applies to EPDS item 10.
#
# The trigger check itself now reuses self_harm_ladder.py's full,
# ordinal-rung phrase set (a strict superset of what used to be this flat
# list - see that module's own comment) rather than maintaining two
# separate, overlapping self-harm phrase lists that could quietly drift
# out of sync. The rung is attached to the response purely as transparency
# detail (same role a Danger-Sign Ladder rung plays in Detailed Results) -
# every rung still gets this exact same maximum-urgency reply, never a
# softer one; see self_harm_ladder.py's header for why.
CRISIS_REPLY = (
    "I'm really glad you told me this - these feelings are taken seriously, and this is not your "
    "fault. Are you safe right now, in this moment? If there's anything nearby you could use to harm "
    "yourself, please try to move away from it, and stay with someone you trust if you can. Please "
    "call KIRAN right now: 1800-599-0019 (toll-free, 24x7, trained counsellors) - if you feel you might "
    "act on these thoughts right now, call 108 or go to the nearest hospital immediately instead of "
    "waiting. The Mental Health Check tab can help you talk through this further too. You don't have "
    "to go through this alone."
)

# Asked ALONGSIDE the "go now" directive, never instead of it - the
# directive always comes first and doesn't wait on an answer. This is
# what a health worker triaging a call actually does: give the urgent
# instruction immediately, then keep asking questions while the person
# is on the way, because the answers change what the FACILITY needs to
# be ready for (and, since this is carried as context into the next
# turn - see danger_sign_followup in the intent set below - a reply that
# adds real detail, like "and I can't breathe", gets re-analyzed and can
# surface an even more specific finding next turn).
# Keyed by keyword found IN the matched danger-ladder phrase, checked in
# order, first match wins.
_DANGER_FOLLOWUP_BY_KEYWORD = [
    (["chest pain", "chest tightness", "pain in my chest", "tightness in my chest",
      "breath", "breathless", "gasping", "सीने में दर्द", "छाती में दर्द", "सांस"],
     "While you're on your way - did this start suddenly, and is it with any breathlessness, dizziness, "
     "or swelling/pain in one leg? Tell the facility this as soon as you arrive."),
    (["bleeding", "soaked", "pad", "रक्तस्राव"],
     "While you're on your way - roughly how much bleeding (soaking through in under an hour is heavy), "
     "and are there clots or do you feel dizzy/faint? Tell the facility this as soon as you arrive."),
    (["headache", "see properly", "सिरदर्द"],
     "While you're on your way - do you also have blurred vision, swelling in your face/hands, or has "
     "your BP been high in this pregnancy? Tell the facility this as soon as you arrive."),
    (["baby", "movement", "कदम", "हिलना"],
     "While you're on your way - when did you last feel the baby move, and do you have any bleeding or "
     "pain along with it? Tell the facility this as soon as you arrive."),
    (["abdominal pain", "पेट दर्द"],
     "While you're on your way - is the pain constant or coming and going, and is there any bleeding or "
     "fever with it? Tell the facility this as soon as you arrive."),
    (["discharge", "weak to get out of bed", "स्राव"],
     "While you're on your way - do you also have a fever, and how long has this been going on? Tell "
     "the facility this as soon as you arrive."),
]

# Rung 5 (convulsions, unconsciousness, a stuck baby, labor over a day) is
# genuinely no time for questions, and the person typing may not even be
# the patient - act now, ask nothing.
_NO_FOLLOWUP_RUNG = 5


def _danger_sign_followup(matched_phrase: str, rung: int) -> str:
    if rung >= _NO_FOLLOWUP_RUNG:
        return None
    for keywords, question in _DANGER_FOLLOWUP_BY_KEYWORD:
        if any(kw in matched_phrase for kw in keywords):
            return question
    return (
        "While you're on your way - how long has this been going on, and is there any bleeding, fever, "
        "or reduced baby movement with it? Tell the facility this as soon as you arrive."
    )

# A friendly label for each text_analyzer.py category, and a fallback note
# for a category whose expert_system.py rule needs a higher (severe-tier)
# score than a moderate-only phrase reaches, or (malnutrition) has no
# matching rule at all - without this, _mild_symptom_reply had nothing to
# say beyond a generic "this sounds related to X" for something as common
# as a plain headache/head pain report.
CATEGORY_LABELS = {
    "hemorrhage": "bleeding", "hypertensive_disorder": "blood pressure/pre-eclampsia symptoms",
    "infection": "possible infection", "anemia": "anemia/fatigue", "fetal_distress": "baby's movement",
    "obstructed_labor": "labor progress", "malnutrition": "nutrition/appetite",
}
CATEGORY_FALLBACK_NOTES = {
    "malnutrition": "Not eating well for more than a day or two can affect both you and the baby.",
    "hypertensive_disorder": (
        "Headache, dizziness, or swelling in the feet/hands can be early signs of high blood pressure "
        "(pre-eclampsia) in pregnancy, which is why it's tracked even when mild."
    ),
}


def _match_faq(normalized_text: str):
    # Word-boundary matching, not a bare substring check - "hi" as a plain
    # `in` check matches inside "th-IS", "wh-ICH", "th-INK"... a short
    # greeting/FAQ phrase is exactly the kind of string that collides with
    # ordinary words, and it was silently hijacking unrelated messages
    # ("I missed my period THIS month" -> "greeting", "I THINK I am in
    # labor" -> "greeting") into the wrong intent.
    for intent in FAQ_INTENTS:
        if any(contains_phrase(normalized_text, phrase) for phrase in intent["phrases"]):
            return intent
    return None


def _match_topic(normalized_text: str):
    for topic in VAGUE_TOPICS:
        if any(contains_phrase(normalized_text, kw) for kw in topic["keywords"]):
            return topic
    return None


def _match_crisis(normalized_text: str) -> dict:
    """Returns self_harm_ladder.classify()'s result dict, or None if
    nothing on the ladder matched (rung 0) - None instead of the rung-0
    dict itself so `if _match_crisis(...)` at the call site works
    correctly; a dict is truthy even when its "rung" key is 0."""
    result = self_harm_ladder.classify(normalized_text)
    return result if result["rung"] > 0 else None


# "jaundice"/"yellow skin"/"yellow eyes" are severe-tier hypertensive_
# disorder phrases (a real maternal emergency sign - possible HELLP
# syndrome/acute fatty liver of pregnancy) and would otherwise be caught by
# the danger-sign check below and answered as a maternal emergency - wrong,
# and needlessly frightening, when the question is actually about the BABY
# having common, usually-benign newborn jaundice. This narrow check only
# fires when "baby"/"newborn"/"infant" appears alongside a jaundice word,
# so it never touches jaundice detection for the mother's own symptoms.
NEWBORN_JAUNDICE_REPLY = (
    "Mild yellowing of a newborn's skin/eyes in the first week is very common and usually harmless, "
    "peaking around day 3-5 and fading on its own within about two weeks - frequent feeding helps it "
    "clear. See a doctor promptly, rather than waiting, if it appears within the first 24 hours after "
    "birth, spreads to the arms/legs/soles, the baby is unusually sleepy or feeding poorly, or it hasn't "
    "improved by 2 weeks - significant jaundice needs treatment (usually phototherapy) to prevent "
    "complications."
)
_BABY_REFERENT_WORDS = ["baby", "newborn", "infant"]
_JAUNDICE_WORDS = ["jaundice", "yellow skin", "yellow eyes", "turning yellow", "looks yellow"]


def _is_about_newborn_jaundice(normalized_text: str) -> bool:
    return any(contains_phrase(normalized_text, b) for b in _BABY_REFERENT_WORDS) and any(
        contains_phrase(normalized_text, j) for j in _JAUNDICE_WORDS
    )


# A bare "ok"/"yes"/"no" as someone's WHOLE message (not part of a longer
# one) is too generic to be a phrase in FAQ_INTENTS or a keyword hint -
# "no" alone would match inside "no bleeding", "no fever", etc. via
# ordinary word-boundary matching, which would misfire constantly. Exact
# whole-message equality sidesteps that entirely: it can only ever match
# when the message truly is just that one word, never as a false positive
# inside a real sentence.
ACKNOWLEDGMENT_REPLY = "Okay! Let me know if you have any other questions - I'm here anytime."
_ACKNOWLEDGMENTS = {"ok", "okay", "k", "yes", "no", "sure", "cool", "great", "fine", "alright", "hmm", "lol", "haha"}


def _is_bare_acknowledgment(normalized_text: str) -> bool:
    return normalized_text.strip() in _ACKNOWLEDGMENTS


def _mild_symptom_reply(text_scores: dict) -> str:
    # Names the ACTUAL category and reuses the same clinical "why" the
    # Assessment tab would give (via expert_system's rules), instead of
    # one flat "worth keeping an eye on" sentence no matter what was
    # described - that genericness was the core of the "vague chat" gap.
    category = max(text_scores, key=text_scores.get)
    label = CATEGORY_LABELS.get(category, category.replace("_", " "))

    activated_rules = [r for r in expert_system.apply_rules(text_scores) if r.get("activated")]
    # Prefer a rule scoped to ONLY this category (e.g. severe_anemia_rule
    # for "anemia") over a multi-condition rule that also happens to read
    # this category (e.g. pph_rule, which activates from anemia alone but
    # whose "why" text is written about active bleeding) - a rule whose
    # text is actually about the category that scored highest, not just
    # any rule that happens to share it.
    why = next(
        (r["why"] for r in activated_rules if RULES_BY_CATEGORY.get(r["id"]) == [category]),
        next((r["why"] for r in activated_rules if category in RULES_BY_CATEGORY.get(r["id"], [])), None),
    )
    if not why:
        why = CATEGORY_FALLBACK_NOTES.get(category, f"This sounds related to {label}.")

    return (
        f"{why} It's worth having this properly checked - run a full Assessment in the Assessment "
        f"tab (it looks at a lot more than I can in chat), or contact your ASHA/ANM worker if it "
        f"doesn't improve. If it gets suddenly worse, treat it as urgent."
    )


# Maps each expert_system rule id to the categories it reads, so
# _mild_symptom_reply can find the rule that actually explains the
# category that scored highest, instead of guessing from the rule list.
RULES_BY_CATEGORY = {
    "pph_rule": ["hemorrhage", "anemia"],
    "sepsis_rule": ["infection"],
    "fetal_distress_rule": ["fetal_distress"],
    "obstructed_labor_rule": ["obstructed_labor"],
    "hypertensive_symptom_rule": ["hypertensive_disorder"],
    "severe_anemia_rule": ["anemia"],
}

# A single targeted follow-up for the ambiguous-severity mild-symptom tier
# (score 0.4-0.85, below the danger-sign threshold) - asked ONCE, on a
# fresh message only, mirroring _danger_sign_followup's pattern but for
# symptoms that haven't (yet) matched an actual danger phrase. Without
# this, "I have a headache" went straight to the generic "go run a full
# Assessment or contact your ASHA" boilerplate with no attempt to narrow
# down severity right there in the chat - which is exactly the case a
# quick answer here (mild vs severe, with/without blurred vision) can
# often resolve on the spot, or correctly escalate to the danger-sign
# path when the answer reveals more.
_MILD_SYMPTOM_FOLLOWUP_BY_CATEGORY = {
    "hypertensive_disorder": (
        "How bad is it - mild and comes and goes, or constant and severe? Any blurred vision, or "
        "swelling in your face or hands along with it?"
    ),
    "hemorrhage": (
        "About how much - light spotting, or enough to soak a pad? Any cramping or clots along with it?"
    ),
    "infection": "Do you have a fever with this, or any foul-smelling discharge?",
    "anemia": (
        "How many days has this been going on, and do you feel breathless or your heart race even "
        "with light activity?"
    ),
    "fetal_distress": (
        "When did you last feel the baby move, and does this feel clearly different from their usual pattern?"
    ),
    "obstructed_labor": "Are the pains coming at regular, shortening intervals, or is it more constant?",
    "malnutrition": "How many days has your appetite been low, and are you able to keep water down?",
}


def _check_symptom_signal(text_for_analysis: str, allow_mild_followup: bool = False):
    """Runs the same danger-sign-ladder + text-analyzer scoring the main
    flow uses, on whatever text is passed in, and returns a response dict
    if it found a danger sign or a scored symptom - or None if it found
    nothing, so the caller can fall through to something else. Factored
    out so the pain-location shortcut below (respond() reconstructing a
    short "in my head" reply into "pain in my head") gets exactly the same
    judgment a message actually typed that way would get, rather than a
    second, separately-maintained copy of this logic.

    allow_mild_followup gates whether a mild-tier match asks ONE
    clarifying question before the final answer, or answers immediately -
    the caller only passes True on a genuinely fresh message (no prior
    context_message), so a follow-up is never asked twice in a row."""
    ladder_result = danger_ladder.classify(text_for_analysis)
    text_scores = text_analyzer.analyze(text_for_analysis)["scores"]
    high_category_score = max(text_scores.values()) if text_scores else 0.0

    if ladder_result["rung"] >= 4 or high_category_score >= 0.85:
        matched_phrase = ladder_result["matchedPhrase"] or "this symptom"
        base_reply = (
            f"⚠️ What you're describing ({matched_phrase}) sounds like it could be a danger sign. "
            "Please go to the nearest health facility now, or call for emergency transport: 108 "
            "(ambulance) or 102 (pregnancy transport). Don't wait to see if it gets better."
        )
        followup = _danger_sign_followup(matched_phrase, ladder_result["rung"])
        return {
            "reply": f"{base_reply} {followup}" if followup else base_reply,
            "isEmergency": True,
            "dangerLadder": ladder_result,
            # Carried back as contextMessage on the next turn (see the
            # frontend's UNRESOLVED_CHAT_INTENTS/UNRESOLVED_INTENTS) only
            # when there IS a follow-up question actually asking for more -
            # rung 5 (seizure, unconscious, stuck baby...) asks nothing, so
            # there's nothing for a reply to attach context to.
            "intent": "danger_sign_followup" if followup else "danger_sign",
        }

    if high_category_score >= 0.4:
        category = max(text_scores, key=text_scores.get)
        followup_question = _MILD_SYMPTOM_FOLLOWUP_BY_CATEGORY.get(category)
        if allow_mild_followup and followup_question:
            label = CATEGORY_LABELS.get(category, category.replace("_", " "))
            return {
                "reply": f"That can be related to {label}. {followup_question}",
                "isEmergency": False,
                # Carried back as contextMessage on the next turn, same
                # mechanism as danger_sign_followup - the answer gets
                # combined with this original message and re-analyzed,
                # which correctly escalates to the danger-sign path if the
                # answer reveals a real danger sign.
                "intent": "mild_symptom_followup",
            }
        return {"reply": _mild_symptom_reply(text_scores), "isEmergency": False, "intent": "mild_symptom"}

    return None


# A short reply to the pain topic's "where is it" question - "in my
# head", "my back" - has almost no signal analyzed on its own, and
# combined with the ORIGINAL vague message ("I have pain") it still
# doesn't form one of the exact "pain in my <place>" phrases
# text_analyzer.py/danger_ladder.py match, because the two turns are
# joined with a period, not written as one sentence. Recognizing the bare
# location word and reconstructing the natural phrase lets a one-word
# answer get exactly the same judgment as if it had been typed that way
# to begin with, instead of silently scoring 0 and repeating the same
# opening question a second time.
_PAIN_LOCATION_KEYWORDS = [
    ("head", ["head"]),
    ("chest", ["chest"]),
    ("abdomen", ["tummy", "stomach", "belly", "abdomen", "abdominal"]),
    ("back", ["back"]),
    ("leg", ["leg", "legs", "thigh", "calf"]),
]

# For locations with no existing danger-sign/category phrase to
# reconstruct into (abdomen/back/leg pain isn't tied to one specific
# category the way head->hypertensive or chest->cardiopulmonary is) -
# one single, targeted next question instead of falling back to the
# original multi-part opening question again.
_PAIN_LOCATION_FOLLOWUP = {
    "abdomen": (
        "Is the tummy pain constant, or does it come and go - and is there any bleeding or fever "
        "with it? If it's severe or doesn't ease up, get checked today rather than waiting."
    ),
    "back": (
        "How long has the back pain been going on, and is it with any fever, bleeding, or unusual "
        "discharge? If it's sudden or severe, get checked today rather than waiting."
    ),
    "leg": (
        "Is that leg swollen, red, or warm compared to the other one, or is there any chest pain or "
        "breathlessness with it? If so, please get checked today - that combination needs prompt "
        "attention."
    ),
}


def _severity_rank(signal: dict):
    """Orders two _check_symptom_signal results so the worse one can be
    kept: emergency beats non-emergency, and among emergencies a higher
    danger-ladder rung beats a lower one. None (no match at all) ranks
    lowest of all."""
    if not signal:
        return (-1, -1)
    if not signal.get("isEmergency"):
        return (0, 0)
    return (1, signal.get("dangerLadder", {}).get("rung", 0))


def _match_pain_location(normalized_text: str):
    for location, keywords in _PAIN_LOCATION_KEYWORDS:
        if any(contains_phrase(normalized_text, kw) for kw in keywords):
            return location
    return None


def respond(message: str, context_message: str = None, unresolved_rounds: int = 0) -> dict:
    text = (message or "").strip()

    # One-turn memory: when the PREVIOUS bot reply was a clarifying
    # question ("tell me more"), the caller passes that original message
    # back as context_message. A short follow-up like "yes it started
    # bleeding" has almost no signal analyzed alone - combined with what
    # prompted the question in the first place, danger-sign detection has
    # something real to work with. Only the immediately preceding turn is
    # carried, not an unbounded conversation history, which keeps this a
    # deliberate one-step "tell me more" exchange rather than open-ended
    # state the caller has to manage.
    analysis_text = f"{context_message}. {text}" if context_message else text
    normalized = normalize(analysis_text)

    # Psychological safety comes first, before ANY physical-symptom check
    # or FAQ matching - the same never-let-a-critical-signal-hide-behind-
    # something-else rule this project applies to EPDS item 10.
    crisis_ladder = _match_crisis(normalized)
    if crisis_ladder:
        # selfHarmLadder is carried as detail only (mirrors dangerLadder on
        # the physical danger-sign path) - the reply/isEmergency are always
        # this exact same maximum response, regardless of which rung matched.
        return {"reply": CRISIS_REPLY, "isEmergency": True, "intent": "crisis_self_harm", "selfHarmLadder": crisis_ladder}

    # Checked before the maternal danger-sign scan below, which would
    # otherwise treat "baby has jaundice" as the MOTHER's own jaundice (a
    # real emergency sign) and reply with an alarming maternal-emergency
    # escalation for a question about a common, usually-benign newborn
    # condition. See _is_about_newborn_jaundice's comment above.
    if _is_about_newborn_jaundice(normalized):
        return {"reply": NEWBORN_JAUNDICE_REPLY, "isEmergency": False, "intent": "newborn_jaundice"}

    # Only ever matches when the ENTIRE message is one of these words (see
    # the comment above) - never as a false positive inside a longer,
    # real message, and only on a first message with no context_message
    # (context_message being set means this is combined with the prior
    # turn's text, so it will no longer be exactly "no" etc).
    if _is_bare_acknowledgment(normalized):
        return {"reply": ACKNOWLEDGMENT_REPLY, "isEmergency": False, "intent": "acknowledgment"}

    # Safety first: reuse the same danger-sign detection the assessment
    # flow uses. A matched danger sign always overrides FAQ matching. The
    # mild-symptom follow-up is only offered on a genuinely fresh message
    # (no context_message yet) - once context_message is set, either this
    # IS the follow-up's answer (ask once, not twice) or it's context
    # from a different exchange entirely (e.g. a vague-topic question),
    # and either way the final answer is what's owed here.
    #
    # Checked in BOTH orderings when there's context to combine with:
    # danger_ladder's phrase matching needs the qualifier and the symptom
    # noun adjacent ("severe headache"), which a two-turn exchange doesn't
    # guarantee - "I have a headache" then "it's severe with blurred
    # vision" concatenates to "...headache. it's severe..." where "severe"
    # and "headache" never end up next to each other, so the exact-phrase
    # check misses it even though a single message worded either way
    # ("severe headache with blurred vision") catches it correctly. Trying
    # the reverse order too and keeping the worse result closes that gap
    # without changing single-message behavior at all.
    allow_mild_followup = context_message is None
    signal = _check_symptom_signal(analysis_text, allow_mild_followup=allow_mild_followup)
    if context_message:
        reversed_signal = _check_symptom_signal(f"{text}. {context_message}", allow_mild_followup=allow_mild_followup)
        if _severity_rank(reversed_signal) > _severity_rank(signal):
            signal = reversed_signal
    if signal:
        return signal

    intent = _match_faq(normalized)
    if intent:
        return {
            "reply": intent["reply"], "isEmergency": False, "intent": intent["id"],
            "relatedPrompts": RELATED_PROMPTS.get(intent["id"], []),
        }

    # Neither a danger sign, an FAQ topic, nor a scored symptom matched -
    # this is genuinely vague or unrecognized. Ask a targeted follow-up (at
    # most MAX_CLARIFYING_ROUNDS times) rather than either a flat "I don't
    # understand" or an endless loop of open-ended questions that never
    # actually gets the person help.
    if unresolved_rounds >= MAX_CLARIFYING_ROUNDS:
        return {"reply": NUDGE_REPLY, "isEmergency": False, "intent": "nudge_to_assessment"}

    # Was the PREVIOUS turn the pain topic's "where is it" question? A
    # bare location answer ("in my head") doesn't contain the word "pain"
    # itself, so re-running the generic vague-topic matcher on it would
    # just match the SAME "pain"/"hurt" keywords again and repeat the
    # identical opening question - see the module comment above.
    if context_message:
        prior_topic = _match_topic(normalize(context_message))
        if prior_topic and prior_topic["id"] == "pain":
            location = _match_pain_location(normalize(text))
            if location:
                reconstructed = _check_symptom_signal(f"pain in my {location}")
                if reconstructed:
                    return reconstructed
                followup = _PAIN_LOCATION_FOLLOWUP.get(location)
                if followup:
                    return {"reply": followup, "isEmergency": False, "intent": "clarify_symptom", "topic": "pain"}

    topic = _match_topic(normalized)
    if topic:
        return {"reply": topic["question"], "isEmergency": False, "intent": "clarify_symptom", "topic": topic["id"]}

    # Last resort before giving up: a single strong topic word (see
    # KEYWORD_HINTS) that the exact-phrase pass above didn't happen to
    # cover. Tried last, not earlier, so it can only turn a would-be
    # fallback into a useful answer - it never pre-empts the more precise
    # matches (exact phrase, symptom score, vague-topic clarifying
    # question) that already run first.
    hint_intent = _match_keyword_hints(normalized)
    if hint_intent:
        return {
            "reply": hint_intent["reply"], "isEmergency": False, "intent": hint_intent["id"],
            "relatedPrompts": RELATED_PROMPTS.get(hint_intent["id"], []),
        }

    return {"reply": FALLBACK_REPLY, "isEmergency": False, "intent": "fallback"}
