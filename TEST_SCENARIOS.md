# 🧪 Test Scenarios — Sustainable Commute Planner

These scenarios validate the scoring engine and recommendation logic.
Run each scenario manually in the app or use the IBM Bob Commute Planner mode to verify.

---

## TEST 1 — Normal Conditions (short distance)

**Input:**
- Origin: TTDI
- Destination: Bangsar
- Distance: 4 km
- Weather: Normal ☀️
- Traffic: Normal 🟢
- Flooding: None ✅

**Expected behaviour:**
- Cycling should score high (0 CO₂, short distance, no adverse conditions)
- Walking may be considered (4km is above 3km threshold → slight penalty, still viable)
- LRT is eligible
- Solo car scores lowest due to CO₂

**Expected recommendation:** 🚲 Cycling or 🚆 LRT

---

## TEST 2 — Heavy Rain + Heavy Traffic

**Input:**
- Origin: TTDI
- Destination: KL Sentral
- Distance: 12 km
- Weather: Heavy Rain 🌧️
- Traffic: Heavy 🔴
- Flooding: None ✅

**Expected behaviour:**
- Cycling: −35 (heavy rain), −25 (traffic offset cancelled), low score
- Walking: −25 (heavy rain), low score
- Solo Car: −25 (heavy traffic) −5 (rain) = score ~70
- Carpool: −15 (heavy traffic) −5 (rain) = score ~80
- LRT: +10 (traffic bonus) +CO₂ bonus = high score

**Expected recommendation:** 🚆 LRT / Transit
**Expected reasoning:** includes "heavy rain reduces suitability of cycling and walking" and "heavy traffic makes driving less attractive"

---

## TEST 3 — Flooding Reported

**Input:**
- Origin: Chow Kit
- Destination: KLCC
- Distance: 5 km
- Weather: Heavy Rain 🌧️
- Traffic: Normal 🟢
- Flooding: Reported 🌊

**Expected behaviour:**
- Cycling: **EXCLUDED** (safety — flooding)
- Walking: **EXCLUDED** (safety — flooding)
- Remaining eligible: Solo Car, Carpool, LRT
- LRT gets CO₂ bonus, highest score

**Expected recommendation:** 🚆 LRT / Transit
**Expected reasoning:** includes "flooding rules out cycling and walking"
**Safety alert must appear:** "🌊 Flooding reported — avoid low-lying roads and pedestrian underpasses"

---

## TEST 4 — Heavy Traffic, Normal Weather

**Input:**
- Origin: Subang Jaya
- Destination: Kuala Lumpur
- Distance: 18 km
- Weather: Normal ☀️
- Traffic: Heavy 🔴
- Flooding: None ✅

**Expected behaviour:**
- Solo Car: −25 (heavy traffic) = score ~75
- Carpool: −15 (heavy traffic) = score ~85
- LRT: +10 (traffic bonus) = score ~110 → capped at 100
- Cycling: 18km > 15km threshold → −30, but gets +5 traffic bonus → score ~75

**Expected recommendation:** 🚆 LRT / Transit
**Alternative:** 🚘 Carpool
**Reasoning:** includes "heavy traffic makes driving less attractive"

---

## TEST 5 — Short Distance, Normal Conditions

**Input:**
- Origin: Bangsar
- Destination: Mid Valley
- Distance: 2 km
- Weather: Normal ☀️
- Traffic: Normal 🟢
- Flooding: None ✅

**Expected behaviour:**
- Walking: 2km is within 3km threshold → no distance penalty → high score
- Cycling: 2km, no penalties → highest score possible (0 CO₂ + full score)
- LRT: eligible but less advantage at short distance

**Expected recommendation:** 🚲 Cycling or 🚶 Walking
**Expected reasoning:** "conditions are favourable for zero-emission active travel"

---

## TEST 6 — Light Rain Only

**Input:**
- Origin: Mont Kiara
- Destination: Bukit Bintang
- Distance: 8 km
- Weather: Light Rain 🌦️
- Traffic: Normal 🟢
- Flooding: None ✅

**Expected behaviour:**
- Cycling: −15 (light rain) = score ~85 + CO₂ bonus → still viable, warning shown
- Walking: 8km > 3km → −50 (distance) −10 (rain) = very low score
- LRT: no penalties, CO₂ bonus → competitive
- Cycling should remain viable — light rain does NOT exclude it

**Expected recommendation:** 🚲 Cycling (with warning) or 🚆 LRT
**Cycling warning:** "⚠️ Light rain — consider waterproof gear"

---

## Scoring Engine Validation

Use the IBM Bob Commute Planner mode to run:

```
Validate the scoring engine against TEST 3:
- Distance: 5 km
- Weather: Heavy Rain
- Traffic: Normal
- Flooding: Reported

Show scores for each mode and confirm cycling and walking are excluded.
```

Expected Bob output should match the score table in TEST 3 above.

---

## Running Tests in the App

1. Start the dev server: `npm run dev`
2. Open http://localhost:3000
3. Enter the inputs for each test scenario
4. Verify the recommendation, reasoning sentence, and safety alerts match expectations
5. Check the "All Options Evaluated" table shows correct scores and exclusions

---

*Test scenarios designed with IBM Bob Commute Planner mode*  
*Powered by IBM Bob custom modes & skills*
