# 🌿 Sustainable Commute Planner

> Built for the IBM Bob Mini Hackathon — powered by [IBM Bob](https://www.ibm.com/bob)

A **condition-aware, AI-assisted commute decision-support tool** that helps urban commuters find the most practical lower-carbon transport option for their journey — today, given current conditions and their personal constraints.

---

## 🎯 The Real-World Problem

Urban commuters want to make more sustainable transport choices, but the lowest-carbon option is not always practical:

- When it's raining or flooding, is cycling still safe?
- When traffic is jammed, is the LRT actually faster than driving?
- How far is the walk to the station? Does that fit my morning?
- How much CO₂ am I actually saving?

People don't default to driving because they don't care — they default to driving because **comparing the alternatives is friction-heavy and context-blind**.

Sustainable Commute Planner answers all of these questions in one place, in under 5 seconds.

---

## 🚀 How the Solution Works

The user provides:

| Input | Description |
|---|---|
| Origin & Destination | Via map search or pin drop (OpenStreetMap + Nominatim) |
| Departure time | For context and display |
| Max travel time | Upper limit the user will accept (e.g. 45 min) |
| Max walking distance | Upper limit for walking to/from a stop (e.g. 10 min) |
| Sustainability preference | Eco-first / Balanced / Time-first |
| Comfort preference | Optional: penalises active and shared modes |
| Today's conditions | Weather, traffic, flooding |
| Community note | Optional free-text field for user-reported conditions |

The application then:

1. **Estimates** journey time, walking component, and CO₂ for each transport mode
2. **Scores** each mode using a 7-factor safety-first scoring engine
3. **Compares** all options side-by-side with clear visual indicators
4. **Recommends** the best-fit lower-carbon option with a plain-English explanation
5. **Surfaces trade-offs** so the user understands why the top option was chosen
6. **Scales** the individual saving to an illustrative enterprise/fleet impact

---

## ⚖️ Why This Is Different from a Route Planner

This is **not** a route planner. It does not replace Google Maps.

| Conventional route planner | Sustainable Commute Planner |
|---|---|
| Optimises for speed or turn-by-turn | Optimises for sustainable + practical fit |
| Shows one route per mode | Compares all modes on CO₂, time, walking, safety |
| Weather/flooding not considered | Safety exclusions and condition penalties applied |
| No user constraint input | Max travel time, walking, sustainability preference, comfort |
| No reasoning exposed | Explains every recommendation in plain language |
| No CO₂ context | IPCC AR6-based CO₂ estimates per mode |
| Individual focus only | Enterprise/fleet sustainability impact projection |

The key differentiator is **condition-aware sustainable decision support** — combining multiple contextual factors into an explainable recommendation.

---

## 🧠 AI / Recommendation Approach

The recommendation engine is a **transparent, rule-based scoring system**, not a black-box model.

Each mode starts at a base score of 100. Points are added or deducted based on:

### Scoring priority order

1. **Safety** — hard exclusions (flooding → cycling and walking excluded, score = 0)
2. **Feasibility** — distance limits; exceeding user's max travel time or walking limit
3. **Weather penalties** — heavy rain penalises cycling (−35) and walking (−25)
4. **Traffic penalties** — heavy traffic penalises road vehicles (−25/−15); boosts LRT (+10)
5. **CO₂ bonus** — lower-emission modes earn bonus points (scaled by sustainability preference)
6. **Travel time bonus** — modes faster than driving earn additional points (scaled by time preference)
7. **Comfort adjustment** — optional penalty for active and shared modes if user prefers comfort

### Sustainability preference weighting

The `Eco-first` preference multiplies the CO₂ bonus by ×1.6 (up to 32 bonus points for zero-emission modes). The `Time-first` preference multiplies the travel time bonus by ×1.5. `Balanced` applies standard weighting.

This means sustainability does **not** automatically override all other factors — a zero-emission option with heavy rain and no time bonus will still score lower than a practical lower-carbon option.

### Recommendation language

The AI component generates a recommendation using language that reflects uncertainty and context:

> "🚆 LRT / Transit is recommended as the best fit for your current constraints — heavy traffic makes driving less attractive and raises road emissions, LRT provides a faster and lower-emission alternative. Eco-priority weighting applied."

Trade-off observations are surfaced separately:

> "ℹ️ Driving is ~8 min faster, but produces significantly more CO₂."

The system deliberately avoids phrases like "this is the best route" in favour of "best fit for your current constraints" and "lower-carbon option".

---

## 📊 CO₂ Methodology

**Formula:**
```
CO₂ per trip (g) = emission_factor × distance (km)
Weekly CO₂ (g)   = CO₂ per trip × 2 (return) × 5 days
Annual CO₂ (kg)  = weekly CO₂ × 52 / 1000
```

**Emission factors (IPCC AR6 / IEA 2023):**

| Mode | g CO₂/km | Notes |
|---|---|---|
| Solo car | 171 | Average MY petrol vehicle |
| Carpool | 85 | Split between 2 passengers |
| LRT/Transit | 41 | RapidKL / public transit average |
| Cycling | 0 | Zero direct emissions |
| Walking | 0 | Zero direct emissions |

**Traffic adjustment:** Heavy traffic adds 30% to road vehicle CO₂ (idling emissions).

> All CO₂ figures are indicative estimates. Sources: IPCC AR6 WG III (2022), IEA Transport Data (2023).

Emission factors are defined in a single `EMISSION_FACTORS` constant in [`app/page.tsx`](app/page.tsx) — change them there and the entire app updates.

---

## 🛡️ Safety-First Logic

Safety exclusions are applied **before** any other scoring:

| Condition | Mode | Effect |
|---|---|---|
| Flooding | Cycling | 🚫 **Excluded** (score = 0, not shown as viable) |
| Flooding | Walking | 🚫 **Excluded** (score = 0, not shown as viable) |
| Heavy rain | Cycling | −35 pts |
| Heavy rain | Walking | −25 pts |
| Light rain | Cycling | −15 pts |
| Heavy traffic | Solo car | −25 pts |
| Heavy traffic | Carpool | −15 pts |
| Heavy traffic | LRT | +10 pts |
| Heavy traffic | Cycling | +5 pts (can filter) |

---

## 🏢 Enterprise Impact Section

The **Enterprise Impact** tab illustrates how individual decision support could scale to a corporate sustainability programme.

The user can adjust:
- Number of commuters (100–10,000)
- Days per week switching modes (1–5)

The system then projects:
- Estimated annual CO₂e reduction
- Monthly CO₂e reduction
- Equivalent trees planted per year
- Equivalent car trips avoided

> ⚠️ All enterprise figures are **illustrative estimates** derived from the individual CO₂ saving calculated for the user's specific route. They are not based on real organisational data.

### Potential enterprise applications (concept)

- Corporate sustainable commuting programmes with personalised recommendations
- ESG reporting — quantifying employee commute emissions across locations
- Smart-city mobility planning — aggregate demand forecasting for transit investment
- Employee transport benefit optimisation
- Carbon credit accounting for commute behaviour change

---

## 🤖 IBM Bob Integration

IBM Bob was used not just to generate code, but to **structure the domain knowledge, reason about the decision logic, and iteratively refine the planner**.

### 1. Custom Mode — `🌿 Commute Planner`

Defined in [`.bob/custom_modes.yaml`](.bob/custom_modes.yaml).

- Gives Bob a **safety-first transport advisor** identity
- Instructs Bob to: apply safety exclusions first, explain recommendations in plain language, label CO₂ figures as estimates
- Restricts tools to only what's needed

### 2. Skill — `commute-planner`

Defined in [`.bob/skills/commute-planner/SKILL.md`](.bob/skills/commute-planner/SKILL.md).

The skill encodes the **full domain knowledge** of the planner:
- Transport modes and emission factors
- CO₂ calculation methodology
- Scoring system (safety → feasibility → weather → traffic → CO₂)
- All condition adjustment rules
- Recommendation logic
- Weekly plan format
- Edge cases

The application's scoring engine directly implements the rules defined in this skill. The skill is the specification the code was built from.

### 3. Plan Mode → Agent Mode Pipeline

Bob's **Plan mode** was used to reason about the architecture, scoring logic, and user preference model before implementation. **Agent mode** then executed the full implementation.

### 4. Validation

The [`TEST_SCENARIOS.md`](TEST_SCENARIOS.md) file was designed with IBM Bob to validate the scoring engine against 6 real-world scenarios.

### Bob Feature Summary

| Bob Feature | How Used |
|---|---|
| Custom Mode | Safety-first transport advisor persona, tool permissions |
| Skill | Full domain knowledge: scoring rules, CO₂ logic, condition handling |
| Plan Mode | Architecture decisions, scoring engine design, user preference model |
| Agent Mode | Full implementation, component design, README authoring |
| Validation | Test scenarios reasoned through with Bob |

---

## 🛤️ IBM Bob Development Journey

**Iteration 1 — Idea generation**
Bob was used in Ask mode to evaluate hackathon ideas against the judging criteria. The Sustainable Commute Planner was selected for its real-world relevance and clear Bob integration story.

**Iteration 2 — Architecture + skill design**
Switched to 🌿 Commute Planner mode. Bob structured the domain knowledge into the `SKILL.md` — emission factors, condition rules, scoring priority order. This skill became the single source of truth for the application logic.

**Iteration 3 — UI scaffolding**
Bob generated the initial Next.js + HeroUI page with CO₂ calculations, condition toggles, and results display.

**Iteration 4 — Scoring engine upgrade**
Based on the spec requirements (safety-first, explainable recommendations, feasibility scoring), Bob redesigned the scoring engine from "lowest CO₂ wins" to the 5-priority system.

**Iteration 5 — User preferences + travel time**
Bob extended the engine to support user-defined constraints (max travel time, max walking, sustainability preference, comfort priority), estimated journey times per mode, and trade-off surfacing.

**Iteration 6 — Enterprise Impact + IBM Bob section**
Bob added the Enterprise Impact tab with illustrative projections, the IBM Bob technology story panel, and the full tab-based results UI.

**Iteration 7 — Weekly planner**
Bob added the per-day condition selector and weekly plan generator, reusing the same `buildPlan()` engine.

**Iteration 8 — Documentation**
Bob authored this README, updated the skill and custom mode, and generated the sample `commute-plan.md`.

Throughout the process, Bob was used to **reason about edge cases**, **refine the scoring penalties**, and **ensure the reasoning sentences were human-readable**.

---

## 🧪 Validation

See [`TEST_SCENARIOS.md`](TEST_SCENARIOS.md) for 6 test scenarios covering:

| Test | Scenario | Expected |
|---|---|---|
| 1 | Normal conditions, short distance | Cycling or LRT recommended |
| 2 | Heavy rain + heavy traffic | LRT recommended, cycling/walking low score |
| 3 | Flooding reported | Cycling/walking excluded (safety), LRT recommended |
| 4 | Heavy traffic, normal weather | LRT recommended, car penalised |
| 5 | 2km distance, normal conditions | Cycling/walking recommended |
| 6 | Light rain only | Cycling viable with warning |

---

## ⚠️ Current Limitations

This is a **prototype** built for a hackathon. It does not:

- Connect to real-time weather APIs (conditions are user-entered)
- Connect to real-time transit APIs (no live disruption data)
- Use real-time traffic data (traffic conditions are user-entered)
- Calculate actual route-specific walking distances (walking is estimated from mode type and distance)
- Support journey legs (e.g. bus + LRT connections)
- Store user history or personalise over time
- Use actual route waypoints for CO₂ calculation (straight-line/road distance only)

All environmental and enterprise figures are **indicative estimates** based on IPCC/IEA published factors.

---

## 🚀 Future Improvements

| Enhancement | Description |
|---|---|
| Live weather integration | OpenWeatherMap API for automatic weather detection |
| Live transit disruptions | GTFS or transit agency APIs for service status |
| Multi-leg routing | Support bus+LRT, cycling+LRT combinations |
| Personalisation | User profiles to learn preferences over time |
| Real walking distance | Use routing API to calculate actual walking legs |
| Mobile app | React Native version with GPS-based origin detection |
| Organisation dashboard | Multi-user fleet analytics and ESG reporting module |
| Carbon offsetting | Integration with carbon credit / offset platforms |

---

## 🛠️ Running the Project

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Demo flow (2 minutes)

1. Enter **TTDI** → **KL Sentral**, distance auto-calculates (~12 km)
2. Set preferences: max travel time **45 min**, sustainability **Eco-first**
3. Set conditions: weather **Heavy Rain**, traffic **Heavy**
4. Click **🌱 Analyse My Commute Options**
5. Observe: LRT recommended with plain-English reasoning and trade-off notes
6. Switch to **🔍 Analysis Details** tab → see full scoring breakdown
7. Switch to **🏢 Enterprise Impact** tab → adjust sliders to see scaled projection
8. Back on **📊 Commute Options**, scroll to **Plan Your Week** → set Tuesday to **Flooding Reported**
9. Click **📅 Generate Weekly Plan** → observe Tuesday shows LRT with safety exclusion note

---

## 📁 Project Structure

```
.
├── .bob/
│   ├── custom_modes.yaml               # 🌿 Commute Planner mode
│   └── skills/commute-planner/
│       └── SKILL.md                    # Domain knowledge + scoring rules
├── app/
│   ├── page.tsx                        # Full app: scoring engine + UI
│   ├── layout.tsx                      # Next.js layout
│   ├── providers.tsx                   # Provider wrapper
│   ├── globals.css                     # Tailwind base
│   └── components/
│       └── LocationPicker.tsx          # Map + Nominatim autocomplete
├── commute-plan.md                     # Sample generated output
├── TEST_SCENARIOS.md                   # 6 validation scenarios
└── README.md
```

---

## 🏆 Judging Criteria

| Criterion | Our Approach |
|---|---|
| **IBM Bob** | Bob is the product — custom mode + skill define the domain logic. The scoring engine directly implements the rules in `SKILL.md`. The full development journey is documented above. |
| **Technical Implementation** | 7-factor scoring engine, user preference model, travel time estimation, option card comparison, trade-off surfacing, weekly planner, enterprise impact projections |
| **Feasibility / NoSlop** | Real IPCC/IEA emission data, daily-life pain point (KL commuters), works for any route, no fabricated live data |
| **Presentation** | 2-minute demo flow above. GitHub docs cover the Bob story. `TEST_SCENARIOS.md` shows rigour. |

---

## 👨‍💻 Built With

- [IBM Bob](https://www.ibm.com/bob) — AI development assistant (custom modes, skills, Plan/Agent pipeline)
- [Next.js 16](https://nextjs.org) — React framework
- [HeroUI](https://heroui.com) — UI component library
- [Tailwind CSS](https://tailwindcss.com) — styling
- [Leaflet](https://leafletjs.com) / [react-leaflet](https://react-leaflet.js.org) — interactive map
- [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org) — geocoding and location search
- [OSRM](https://project-osrm.org) — road distance routing
- IPCC AR6 WG III (2022) / IEA Transport Data (2023) — emission factor sources

---

## 📌 Prototype vs. Future Enterprise Application

| | Current Prototype | Potential Future Application |
|---|---|---|
| Data | User-entered conditions + IPCC estimates | Live weather, transit, and traffic APIs |
| Scope | Single user, single journey | Multi-user, multi-location fleet |
| CO₂ | Indicative estimates | Verified organisational carbon accounting |
| Output | Recommendation + explanation | ESG reports, dashboards, audit trails |
| Integration | Standalone web app | ERP / HR / sustainability platform integration |
| Personalisation | Session-only preferences | User profiles, learned preferences |

The enterprise figures in the **Enterprise Impact** tab are illustrative only and are clearly labelled as such. They demonstrate the concept of scaling individual decision support — not a claim that the prototype already has enterprise capabilities.
