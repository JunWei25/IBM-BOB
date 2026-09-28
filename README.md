# 🌿 Sustainable Commute Planner

> Built for the IBM Bob Mini Hackathon — powered by [IBM Bob](https://www.ibm.com/bob)

A condition-aware commute planning assistant that helps users find the most sustainable way to travel. Given your origin, destination, and current conditions (weather, flooding, traffic), it reasons through your options, estimates CO₂ savings versus driving alone, and generates a personalised weekly commute plan.

---

## 🎯 Problem Statement

Daily commuters default to driving alone — not because it's the best option, but because comparing alternatives is friction-heavy and context-blind. When it's raining or there's a flood alert, is the LRT still faster? Is cycling still viable? This tool answers that.

---

## 🚀 Features

- **Multi-modal commute comparison** — evaluates solo car, carpool, LRT/bus, cycling, and walking
- **CO₂ savings calculator** — uses real IPCC/IEA emission figures to show weekly and annual impact
- **Condition-aware reasoning** — adjusts recommendations based on reported weather, flooding, or heavy traffic
- **Weekly schedule generator** — produces a day-by-day commute plan as a structured Markdown file
- **Community condition reporting** — users describe current conditions in plain language; Bob factors them into the plan

---

## 🧠 How IBM Bob Was Used

This project is built **entirely inside IBM Bob** — Bob is not just a coding assistant here, it *is* the product.

### 1. Custom Mode — `🌿 Commute Planner`
Defined in [`.bob/custom_modes.yaml`](.bob/custom_modes.yaml), this mode gives Bob a focused identity as a sustainable transport advisor. It restricts Bob's tools to what's needed (read, skill, write) and sets a `roleDefinition` that primes it to reason about emissions, transport options, and real-world constraints.

### 2. Skill — `commute-planner`
Defined in [`.bob/skills/commute-planner/SKILL.md`](.bob/skills/commute-planner/SKILL.md), this skill loads:
- Emission factors per transport mode (g CO₂/km)
- Condition-adjustment logic (flood → avoid cycling/walking, heavy rain → prefer LRT)
- A structured output template for `commute-plan.md`
- Reasoning rules for comparing options and making a final recommendation

### 3. Plan → Agent Pipeline
Bob's **Plan mode** is used to reason through the commute options before writing. **Agent mode** then executes the file write. This Plan → Agent handoff is the core workflow the judges can observe live.

### Bob Usage Summary

| Bob Feature | How It Was Used |
|---|---|
| Custom Mode | Defines the Commute Planner persona and tool permissions |
| Skill | Encodes CO₂ logic, condition rules, and output template |
| Plan Mode | Reasons through commute options before generating output |
| Agent Mode | Writes the final `commute-plan.md` to disk |

---

## 📊 CO₂ Emission Factors

All figures are sourced from IPCC AR6 and IEA 2023 Transport Data.

| Transport Mode | CO₂ per km |
|---|---|
| Solo car (petrol) | 171 g |
| Carpool (2 passengers) | 85 g |
| LRT / Bus | 41 g |
| Cycling | 0 g |
| Walking | 0 g |

---

## ⚡ Condition-Aware Logic

Users report conditions in plain language. Bob adjusts recommendations accordingly:

| Reported Condition | Adjustment |
|---|---|
| Flooding on route | Removes cycling/walking; favours LRT or carpool |
| Heavy rain | Deprioritises cycling; adds comfort note for LRT |
| Heavy traffic (road) | Increases effective car CO₂ (idle emissions); boosts LRT recommendation |
| Clear conditions | All options considered; optimal by CO₂ selected |

---

## 📄 Sample Output

After describing your commute, Bob generates a [`commute-plan.md`](commute-plan.md) that looks like this:

```
## Your Sustainable Commute Plan
Route: Petaling Jaya → KLCC (12 km)
Current conditions: Heavy traffic reported on Federal Highway

### Options Compared
| Option       | CO₂/week | Savings vs. driving |
|--------------|----------|---------------------|
| LRT (RapidKL)| 205g     | 85% less            |
| Carpool (2)  | 425g     | 70% less            |
| Solo car     | 1,368g   | baseline            |

### Recommended: LRT
...

### Weekly Schedule
| Day | Mode | Departure | Notes |
|-----|------|-----------|-------|
| Mon | LRT  | 7:45am    | Avoid Federal Highway — heavy traffic |
...
```

---

## 🛠️ Running the Project

This is a Next.js app scaffolded as the front-end shell. The core product runs inside IBM Bob.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### To use the Commute Planner in Bob:

1. Open this repo in VS Code with the IBM Bob extension installed
2. Switch to the **🌿 Commute Planner** mode (Settings → Modes)
3. Describe your commute: *"I travel from [origin] to [destination] on weekdays. Current conditions: [describe]"*
4. Bob generates your personalised `commute-plan.md`

---

## 📁 Project Structure

```
.
├── .bob/
│   ├── custom_modes.yaml          # Commute Planner mode definition
│   └── skills/
│       └── commute-planner/
│           └── SKILL.md           # CO₂ logic, condition rules, output template
├── commute-plan.md                # Sample generated output
├── app/                           # Next.js app shell
└── README.md
```

---

## 🏆 Hackathon Judging Criteria

| Criterion | Our Approach |
|---|---|
| **IBM Bob** | Bob is the product — custom mode + skill + Plan→Agent pipeline. Explained above and demonstrable live. |
| **Technical Implementation** | Structured CO₂ reasoning, condition-aware adjustments, weekly plan generation |
| **Feasibility / NoSlop** | Real emission data, daily-life pain point, works for any city and any route |
| **Presentation** | Live 2-minute demo: describe commute → watch plan generate. GitHub docs cover the Bob story. |

---

## 👨‍💻 Built With

- [IBM Bob](https://www.ibm.com/bob) — AI development assistant (custom modes + skills)
- [Next.js](https://nextjs.org) — front-end framework
- IPCC AR6 / IEA 2023 — emission factor data sources
