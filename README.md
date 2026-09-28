# 🌿 Sustainable Commute Planner

> Built for the IBM Bob Mini Hackathon — powered by [IBM Bob](https://www.ibm.com/bob)

A **safety-first, condition-aware** commute planning tool that helps commuters find the most sustainable transport option for their daily route. It considers weather, traffic, flooding, and user-reported observations — then scores and explains each option transparently.

---

## 🎯 Problem Statement

Daily commuters default to driving alone — not because it's the best option, but because comparing alternatives is friction-heavy and context-blind.

- When it's raining or flooding, is cycling still safe?
- When traffic is jammed, is the LRT actually faster?
- How much CO₂ am I actually saving?

This tool answers all three in under 5 seconds.

---

## 🚀 Features

| Feature | Description |
|---|---|
| **Condition inputs** | Separate weather, traffic, and flooding selectors |
| **Safety-first exclusions** | Cycling/walking blocked during flooding, regardless of CO₂ benefit |
| **Transparent scoring** | Every mode scored 0–100 with visible reasoning |
| **Recommendation + reasoning** | Human-readable explanation of why a mode was chosen |
| **Alternative option** | Second-best mode always shown |
| **CO₂ comparison** | Solo driving vs. recommended vs. estimated saving |
| **Weekly plan generator** | Per-day condition settings → full Mon–Fri plan |
| **Community reporting** | Free-text field for user-reported conditions |
| **Safety alerts** | Prominent warnings for flooding, heavy rain, heavy traffic |

---

## 🏗️ Architecture

```
app/page.tsx
├── EMISSION_FACTORS        — central config (change once, updates everywhere)
├── scoreModes()            — scoring engine (safety → feasibility → weather → traffic → CO₂)
├── buildPlan()             — recommendation engine (scores + reasoning + alerts)
├── buildWeeklyPlan()       — applies buildPlan() per day with individual conditions
├── ConditionSelect         — reusable condition picker component
└── Home                    — single-page UI (input → results → weekly plan)

.bob/
├── custom_modes.yaml       — 🌿 Commute Planner mode definition
└── skills/commute-planner/
    └── SKILL.md            — domain knowledge, scoring rules, CO₂ methodology

TEST_SCENARIOS.md           — 6 validation scenarios
commute-plan.md             — sample generated output
```

Single-page app. No backend, no database, no auth. All logic runs client-side.
Structure allows real weather/traffic APIs to be connected later via `scoreModes()`.

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
| Carpool | 85 | Split 2 passengers |
| LRT/Transit | 41 | RapidKL average |
| Cycling | 0 | Zero direct emissions |
| Walking | 0 | Zero direct emissions |

**Traffic adjustment:** Heavy traffic adds 30% to road vehicle CO₂ (idling emissions).

> All figures are indicative estimates. Sources: IPCC AR6 WG III (2022), IEA Transport Data (2023).

Emission factors are defined in a single `EMISSION_FACTORS` constant in [`app/page.tsx`](app/page.tsx) — change them there and the entire app updates.

---

## 🛡️ Safety & Condition-Aware Reasoning

The planner balances **5 priorities** in order:

1. **Safety** — hard exclusions (flooding → no cycling/walking)
2. **Feasibility** — distance limits (cycling >15km: −30pts, walking >3km: −50pts)
3. **Travel time** — heavy traffic penalises road modes, boosts LRT
4. **CO₂ emissions** — lower-emission modes receive bonus points
5. **Convenience** — remaining score difference breaks ties

### Scoring engine

| Condition | Mode | Effect |
|---|---|---|
| Flooding | Cycling, Walking | 🚫 **Excluded** (score = 0) |
| Heavy rain | Cycling | −35 pts |
| Heavy rain | Walking | −25 pts |
| Light rain | Cycling | −15 pts |
| Heavy traffic | Solo car | −25 pts |
| Heavy traffic | Carpool | −15 pts |
| Heavy traffic | LRT | +10 pts |
| Heavy traffic | Cycling | +5 pts (can filter) |

The recommendation is always the **highest-scoring eligible mode**, with a plain-English reasoning sentence.

Example:
> "🚆 LRT/Transit recommended because flooding rules out cycling and walking, heavy traffic makes driving less attractive and raises road emissions, LRT provides a faster and lower-emission alternative."

---

## 📅 Weekly Planning

The weekly plan section lets users set **per-day conditions** (Mon–Fri) independently, then generates:

- A transport mode recommendation for each day
- A one-line reasoning sentence per day
- Per-day safety alerts
- Weekly CO₂ totals (plan vs. driving solo)

Each day runs through the same scoring engine independently.

---

## 🧠 IBM Bob Integration

IBM Bob was used not just to generate code, but to **structure the domain knowledge, reason about the decision logic, and iteratively refine the planner**.

### 1. Custom Mode — `🌿 Commute Planner`

Defined in [`.bob/custom_modes.yaml`](.bob/custom_modes.yaml).

- Gives Bob a **safety-first transport advisor** identity
- Instructs Bob to: apply safety exclusions first, explain recommendations in plain language, label CO₂ figures as estimates
- Restricts tools to: `read`, `edit`, `skill` — only what's needed

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

The application's scoring engine in `app/page.tsx` directly implements the rules defined in this skill.

### 3. Plan Mode → Agent Mode Pipeline

Bob's **Plan mode** was used to reason about the architecture and scoring logic before implementation. **Agent mode** then executed the file creation.

### 4. Validation

The [`TEST_SCENARIOS.md`](TEST_SCENARIOS.md) file was designed with IBM Bob to validate the scoring engine against 6 real-world scenarios.

### Bob Feature Summary

| Bob Feature | How Used |
|---|---|
| Custom Mode | Safety-first transport advisor persona, tool permissions |
| Skill | Full domain knowledge: scoring rules, CO₂ logic, condition handling |
| Plan Mode | Architecture decisions, scoring engine design |
| Agent Mode | File creation, code implementation, README authoring |
| Validation | Test scenarios reasoned through with Bob |

---

## 🛤️ IBM Bob Development Journey

**Iteration 1 — Idea generation**
Bob was used in Ask mode to evaluate hackathon ideas against the judging criteria (IBM Bob usage, technical implementation, feasibility, NoSlop). The Sustainable Commute Planner was selected for its real-world relevance and clear Bob integration story.

**Iteration 2 — Architecture + skill design**
Switched to 🌿 Commute Planner mode. Bob structured the domain knowledge into the `SKILL.md` — emission factors, condition rules, scoring priority order. This skill became the single source of truth for the application logic.

**Iteration 3 — UI scaffolding**
Bob generated the initial Next.js + HeroUI page with CO₂ calculations, condition toggles, and results display.

**Iteration 4 — Scoring engine upgrade**
Based on the spec requirements (safety-first, explainable recommendations, feasibility scoring), Bob redesigned the scoring engine from "lowest CO₂ wins" to the 5-priority system now implemented.

**Iteration 5 — Weekly planner**
Bob added the per-day condition selector and weekly plan generator, reusing the same `buildPlan()` engine.

**Iteration 6 — Test scenarios**
Bob generated `TEST_SCENARIOS.md` with 6 validation cases covering normal conditions, flooding, heavy rain + traffic, and short-distance scenarios.

**Iteration 7 — Documentation**
Bob authored this README, updated the skill and custom mode, and generated the sample `commute-plan.md`.

Throughout the process, Bob was used to **reason about edge cases** (e.g., "what if flooding AND heavy rain?"), **refine the scoring penalties**, and **ensure the reasoning sentences were human-readable**.

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

## 🛠️ Running the Project

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Demo flow (2 minutes)

1. Enter **TTDI** → **KL Sentral**, distance **12 km**
2. Set weather: **Heavy Rain**, traffic: **Heavy**, flooding: **None**
3. Click **Plan My Commute**
4. Observe: LRT recommended, reasoning shown, cycling/walking penalised
5. Scroll to **Weekly Plan** → set Tuesday to **Flooding Reported**
6. Click **Generate Weekly Plan**
7. Observe: Tuesday shows LRT, cycling/walking excluded with safety note

---

## 📁 Project Structure

```
.
├── .bob/
│   ├── custom_modes.yaml               # 🌿 Commute Planner mode
│   └── skills/commute-planner/
│       └── SKILL.md                    # Domain knowledge + scoring rules
├── app/
│   ├── page.tsx                        # Full app (scoring engine + UI)
│   ├── layout.tsx                      # Next.js layout
│   └── providers.tsx                   # Provider wrapper
├── commute-plan.md                     # Sample generated output
├── TEST_SCENARIOS.md                   # 6 validation scenarios
└── README.md
```

---

## 🏆 Judging Criteria

| Criterion | Our Approach |
|---|---|
| **IBM Bob** | Bob is the product — custom mode + skill define the domain logic. The scoring engine in `app/page.tsx` directly implements the rules in `SKILL.md`. Development journey documented above. |
| **Technical Implementation** | Safety-first scoring engine, condition-aware reasoning, transparent explanations, weekly plan generator, CO₂ comparison |
| **Feasibility / NoSlop** | Real IPCC/IEA emission data, daily-life pain point (KL commuters), works for any route, no gimmicks |
| **Presentation** | 2-minute demo flow above. GitHub docs cover the Bob story. `TEST_SCENARIOS.md` shows rigour. |

---

## 👨‍💻 Built With

- [IBM Bob](https://www.ibm.com/bob) — AI development assistant (custom modes, skills, Plan/Agent pipeline)
- [Next.js 16](https://nextjs.org) — React framework
- [HeroUI](https://heroui.com) — UI component library
- [Tailwind CSS](https://tailwindcss.com) — styling
- IPCC AR6 / IEA 2023 — emission factor data sources
