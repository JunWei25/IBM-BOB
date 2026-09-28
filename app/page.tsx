"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Button, Card, CardContent, CardHeader, CardTitle, TextArea } from "@heroui/react";

const LocationPicker = dynamic(() => import("./components/LocationPicker"), { ssr: false });

// ─── Emission factors (IPCC AR6 / IEA 2023) ────────────────────────────────
// These are the ONLY place emission factors are defined.
// Change them here and the whole app updates.
export const EMISSION_FACTORS: Record<string, number> = {
  "solo-car":  171, // g CO₂ per km, average MY petrol vehicle
  "carpool":    85, // g CO₂ per km, split between 2 passengers
  "lrt":        41, // g CO₂ per km, RapidKL / public transit average
  "cycling":     0, // zero direct emissions
  "walking":     0, // zero direct emissions
};

// Heavy traffic adds ~30% to road vehicle emissions (idling)
const TRAFFIC_CO2_MULTIPLIER = 1.30;

// Distance thresholds (km) for suitability of active modes
const CYCLING_MAX_KM = 15;
const WALKING_MAX_KM = 3;

// ─── Estimated travel speed (km/h) per mode ─────────────────────────────────
// Used to estimate journey time. Adjusted for traffic conditions.
const SPEED_NORMAL: Record<string, number> = {
  "solo-car":  45,
  "carpool":   45,
  "lrt":       40, // includes station walking/waiting
  "cycling":   15,
  "walking":    5,
};
const SPEED_HEAVY_TRAFFIC: Record<string, number> = {
  "solo-car":  20,
  "carpool":   20,
  "lrt":       38, // LRT largely unaffected
  "cycling":   13, // slightly affected by road conditions
  "walking":    5,
};

// ─── Estimated walking component (minutes) per mode for a typical trip ──────
// These are additive to journey time: walk to station, park & walk, etc.
function estimateWalkingMinutes(key: string, distanceKm: number): number {
  switch (key) {
    case "lrt":      return Math.min(12, 4 + Math.round(distanceKm * 0.3)); // walk to/from station
    case "carpool":  return 3;  // walk to/from car
    case "solo-car": return 3;  // walk to/from car
    case "cycling":  return 0;  // cycling itself is active
    case "walking":  return 0;  // the whole trip is walking
    default:         return 0;
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────
type Weather   = "normal" | "light-rain" | "heavy-rain";
type Traffic   = "normal" | "heavy";
type Flooding  = "none"   | "reported";
type ModeKey   = "solo-car" | "carpool" | "lrt" | "cycling" | "walking";
type SustainabilityPref = "balanced" | "eco-priority" | "time-priority";

interface DayConditions {
  weather:  Weather;
  traffic:  Traffic;
  flooding: Flooding;
}

interface UserPreferences {
  maxTravelMinutes:   number;   // user's upper limit for journey time
  maxWalkingMinutes:  number;   // user's upper limit for walking
  sustainabilityPref: SustainabilityPref;
  departureTime:      string;   // HH:MM string
  comfortPriority:    boolean;  // user prefers comfort/cost over raw CO₂
}

interface ModeResult {
  key:              ModeKey;
  label:            string;
  emoji:            string;
  eligible:         boolean;
  safetyNote:       string;       // blocking reason if ineligible
  warnings:         string[];     // non-blocking cautions
  score:            number;       // 0–100, higher = better
  co2PerTrip:       number;       // grams for one-way trip
  co2Weekly:        number;       // grams per week (return × days)
  co2Annual:        number;       // kg per year
  savingsPct:       number;       // % saved vs solo-car baseline
  scoreBreakdown:   string[];     // human-readable scoring steps
  estimatedMinutes: number;       // estimated one-way travel time
  walkingMinutes:   number;       // walking component of the trip
  withinTimeLimit:  boolean;      // within user's max travel time
  withinWalkLimit:  boolean;      // within user's max walking distance
}

interface PlanResult {
  modes:            ModeResult[];
  recommended:      ModeResult;
  alternative:      ModeResult | null;
  reasoning:        string;
  safetyAlerts:     string[];
  soloCarCo2Weekly: number;
  soloCarCo2Annual: number;
  tradeOffNotes:    string[];     // key trade-off observations
}

// ─── Scoring engine ─────────────────────────────────────────────────────────
//
// Priority order:  1. SAFETY  2. FEASIBILITY  3. TRAVEL-TIME  4. CO₂  5. CONVENIENCE
//
// Each mode starts at 100 and loses points per penalty.
// Safety exclusion = ineligible (score = 0, not shown as viable).

function scoreModes(
  distanceKm: number,
  weather: Weather,
  traffic: Traffic,
  flooding: Flooding,
  prefs: UserPreferences
): ModeResult[] {
  const days = 5; // fixed for single-day plan scoring; weekly plan overrides

  const modes: { key: ModeKey; label: string; emoji: string }[] = [
    { key: "solo-car", label: "Solo Car",      emoji: "🚗" },
    { key: "carpool",  label: "Carpool",        emoji: "🚘" },
    { key: "lrt",      label: "LRT / Transit",  emoji: "🚆" },
    { key: "cycling",  label: "Cycling",         emoji: "🚲" },
    { key: "walking",  label: "Walking",          emoji: "🚶" },
  ];

  const soloBaseCo2 = EMISSION_FACTORS["solo-car"] *
    (traffic === "heavy" ? TRAFFIC_CO2_MULTIPLIER : 1);
  const soloWeekly = soloBaseCo2 * distanceKm * 2 * days;

  // Eco-priority boosts CO₂ scoring weight; time-priority boosts speed weight
  const ecoBoostFactor  = prefs.sustainabilityPref === "eco-priority"  ? 1.6 : prefs.sustainabilityPref === "balanced" ? 1.0 : 0.5;
  const timeBoostFactor = prefs.sustainabilityPref === "time-priority" ? 1.5 : 1.0;

  const speedTable = traffic === "heavy" ? SPEED_HEAVY_TRAFFIC : SPEED_NORMAL;

  return modes.map(({ key, label, emoji }) => {
    let score = 100;
    let eligible = true;
    let safetyNote = "";
    const warnings: string[] = [];
    const breakdown: string[] = [];

    const baseCo2 = EMISSION_FACTORS[key];

    // ── Estimate travel time ───────────────────────────────────────────────
    const speed = speedTable[key] ?? 30;
    const rawMinutes = Math.round((distanceKm / speed) * 60);
    const walkingMinutes = estimateWalkingMinutes(key, distanceKm);
    const estimatedMinutes = rawMinutes + walkingMinutes;

    const withinTimeLimit = estimatedMinutes <= prefs.maxTravelMinutes;
    const withinWalkLimit = walkingMinutes    <= prefs.maxWalkingMinutes;

    // ── 1. SAFETY exclusions ──────────────────────────────────────────────
    if (flooding === "reported") {
      if (key === "cycling") {
        eligible = false;
        safetyNote = "🚫 Excluded — flooding makes cycling unsafe";
        score = 0;
      }
      if (key === "walking") {
        eligible = false;
        safetyNote = "🚫 Excluded — flooding may affect pedestrian routes";
        score = 0;
      }
    }

    // ── 2. FEASIBILITY (distance) ─────────────────────────────────────────
    if (eligible) {
      if (key === "cycling" && distanceKm > CYCLING_MAX_KM) {
        score -= 30;
        warnings.push(`⚠️ ${distanceKm}km may be too far to cycle daily`);
        breakdown.push(`−30 distance (>${CYCLING_MAX_KM}km)`);
      }
      if (key === "walking" && distanceKm > WALKING_MAX_KM) {
        score -= 50;
        warnings.push(`⚠️ ${distanceKm}km is too far to walk daily`);
        breakdown.push(`−50 distance (>${WALKING_MAX_KM}km)`);
      }

      // User preference: travel time limit
      if (!withinTimeLimit) {
        score -= 20;
        warnings.push(`⚠️ Estimated ${estimatedMinutes} min exceeds your ${prefs.maxTravelMinutes} min limit`);
        breakdown.push(`−20 exceeds travel time limit`);
      }

      // User preference: walking limit
      if (!withinWalkLimit && key !== "cycling" && key !== "walking") {
        score -= 10;
        warnings.push(`⚠️ ~${walkingMinutes} min walking may exceed your preference`);
        breakdown.push(`−10 walking exceeds preference`);
      }
    }

    // ── 3. WEATHER penalties ──────────────────────────────────────────────
    if (eligible) {
      if (weather === "heavy-rain") {
        if (key === "cycling") {
          score -= 35;
          warnings.push("⚠️ Heavy rain makes cycling uncomfortable and risky");
          breakdown.push("−35 heavy rain");
        }
        if (key === "walking") {
          score -= 25;
          warnings.push("⚠️ Heavy rain is unpleasant for walking");
          breakdown.push("−25 heavy rain");
        }
        if (key === "solo-car" || key === "carpool") {
          score -= 5;
          breakdown.push("−5 slight visibility reduction");
        }
      }
      if (weather === "light-rain") {
        if (key === "cycling") {
          score -= 15;
          warnings.push("⚠️ Light rain — consider waterproof gear");
          breakdown.push("−15 light rain");
        }
        if (key === "walking") {
          score -= 10;
          warnings.push("⚠️ Light rain — bring an umbrella");
          breakdown.push("−10 light rain");
        }
      }
    }

    // ── 4. TRAFFIC penalties ──────────────────────────────────────────────
    if (eligible && traffic === "heavy") {
      if (key === "solo-car") {
        score -= 25;
        warnings.push("⚠️ Heavy traffic — expect significant delays, higher CO₂");
        breakdown.push("−25 heavy traffic (road)");
      }
      if (key === "carpool") {
        score -= 15;
        warnings.push("⚠️ Heavy traffic — expect delays");
        breakdown.push("−15 heavy traffic (road)");
      }
      if (key === "lrt") {
        score += 10; // LRT becomes more attractive
        breakdown.push("+10 LRT unaffected by road traffic");
      }
      if (key === "cycling") {
        score += 5; // bikes can filter
        breakdown.push("+5 cycling can filter through traffic");
      }
    }

    // ── 5. CO₂ bonus (weighted by sustainability preference) ──────────────
    if (eligible) {
      const co2Factor = baseCo2 / (EMISSION_FACTORS["solo-car"] || 1);
      const co2Bonus = Math.round((1 - co2Factor) * 20 * ecoBoostFactor); // up to +32 at eco-priority
      if (co2Bonus > 0) {
        score += co2Bonus;
        breakdown.push(`+${co2Bonus} lower emissions${prefs.sustainabilityPref === "eco-priority" ? " (eco-priority ×1.6)" : ""}`);
      }
    }

    // ── 6. Travel time bonus (weighted by time preference) ────────────────
    if (eligible) {
      const soloCar = speedTable["solo-car"] ?? 45;
      const soloMins = Math.round((distanceKm / soloCar) * 60) + 3;
      const timeDiff = soloMins - estimatedMinutes;
      if (timeDiff > 5) {
        const timeBonus = Math.min(15, Math.round(timeDiff / 3) * timeBoostFactor);
        score += timeBonus;
        breakdown.push(`+${timeBonus} faster than driving${prefs.sustainabilityPref === "time-priority" ? " (time-priority ×1.5)" : ""}`);
      }
    }

    // ── 7. Comfort penalty (if user prefers comfort) ───────────────────────
    if (eligible && prefs.comfortPriority) {
      if (key === "cycling" || key === "walking") {
        score -= 8;
        breakdown.push("−8 comfort preference (active mode)");
      }
      if (key === "lrt") {
        score -= 5;
        breakdown.push("−5 comfort preference (shared transit)");
      }
    }

    score = Math.max(0, Math.min(110, score)); // allow slight over-100 for strong eco-priority

    // ── CO₂ calculation ───────────────────────────────────────────────────
    const effectiveCo2 = key === "solo-car" || key === "carpool"
      ? baseCo2 * (traffic === "heavy" ? TRAFFIC_CO2_MULTIPLIER : 1)
      : baseCo2;

    const co2PerTrip  = Math.round(effectiveCo2 * distanceKm);
    const co2Weekly   = Math.round(effectiveCo2 * distanceKm * 2 * days);
    const co2Annual   = Math.round((co2Weekly * 52) / 1000);
    const savingsPct  = soloWeekly > 0
      ? Math.round(((soloWeekly - co2Weekly) / soloWeekly) * 100)
      : 0;

    return {
      key, label, emoji, eligible, safetyNote, warnings, score,
      co2PerTrip, co2Weekly, co2Annual, savingsPct,
      scoreBreakdown: breakdown,
      estimatedMinutes,
      walkingMinutes,
      withinTimeLimit,
      withinWalkLimit,
    };
  });
}

function buildPlan(
  distanceKm: number,
  weather: Weather,
  traffic: Traffic,
  flooding: Flooding,
  prefs: UserPreferences
): PlanResult {
  const modes = scoreModes(distanceKm, weather, traffic, flooding, prefs);
  const eligible = modes.filter((m) => m.eligible).sort((a, b) => b.score - a.score);
  const recommended = eligible[0] ?? modes[0];
  const alternative  = eligible[1] ?? null;

  const soloCar = modes.find((m) => m.key === "solo-car")!;

  // ── Build rich reasoning sentence ──────────────────────────────────────
  const reasons: string[] = [];
  if (flooding === "reported") reasons.push("flooding rules out cycling and walking");
  if (weather === "heavy-rain") reasons.push("heavy rain reduces suitability of cycling and walking");
  if (weather === "light-rain") reasons.push("light rain slightly reduces comfort for active modes");
  if (traffic === "heavy") reasons.push("heavy traffic makes driving less attractive and raises road emissions");
  if (recommended.key === "lrt" && traffic === "heavy") reasons.push("LRT provides a faster and lower-emission alternative");
  if (recommended.key === "cycling" || recommended.key === "walking") reasons.push("conditions are favourable for zero-emission active travel");
  if (reasons.length === 0) reasons.push("conditions are normal and all modes are viable");

  // Preference-aware note
  const prefNote =
    prefs.sustainabilityPref === "eco-priority"  ? " Eco-priority weighting applied." :
    prefs.sustainabilityPref === "time-priority" ? " Travel time was prioritised in scoring." :
    "";

  const reasoning = `${recommended.emoji} ${recommended.label} is recommended as the best fit for your current constraints — ${reasons.join(", ")}.${prefNote}`;

  // ── Safety alerts ─────────────────────────────────────────────────────
  const safetyAlerts: string[] = [];
  if (flooding === "reported") safetyAlerts.push("🌊 Flooding reported — avoid low-lying roads and pedestrian underpasses");
  if (weather === "heavy-rain") safetyAlerts.push("🌧️ Heavy rain — reduce speed if driving, avoid cycling");
  if (traffic === "heavy") safetyAlerts.push("🚦 Heavy traffic — allow extra time for road-based commutes");

  // ── Trade-off observations ─────────────────────────────────────────────
  const tradeOffNotes: string[] = [];
  if (recommended.key === "lrt" && soloCar.estimatedMinutes < recommended.estimatedMinutes) {
    tradeOffNotes.push(`Driving is ~${recommended.estimatedMinutes - soloCar.estimatedMinutes} min faster${traffic === "heavy" ? " (in normal conditions)" : ""}, but produces significantly more CO₂.`);
  }
  if (recommended.key !== "cycling" && modes.find(m => m.key === "cycling")?.eligible) {
    tradeOffNotes.push(`Cycling has the lowest carbon impact but received a lower score${weather !== "normal" ? " due to weather conditions" : ""}.`);
  }
  if (alternative && recommended.savingsPct - alternative.savingsPct > 30) {
    tradeOffNotes.push(`The recommended option saves ~${recommended.savingsPct}% more CO₂ than driving vs. the alternative's ${alternative.savingsPct}%.`);
  }

  return {
    modes,
    recommended,
    alternative,
    reasoning,
    safetyAlerts,
    soloCarCo2Weekly: soloCar.co2Weekly,
    soloCarCo2Annual: soloCar.co2Annual,
    tradeOffNotes,
  };
}

// ─── Weekly plan ─────────────────────────────────────────────────────────────
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
type DayName = (typeof DAYS)[number];

function buildWeeklyPlan(
  distanceKm: number,
  dayConditions: Record<DayName, DayConditions>,
  prefs: UserPreferences
): { day: DayName; plan: PlanResult }[] {
  return DAYS.map((day) => {
    const { weather, traffic, flooding } = dayConditions[day];
    return { day, plan: buildPlan(distanceKm, weather, traffic, flooding, prefs) };
  });
}

// ─── Enterprise impact calculator ────────────────────────────────────────────
function calcEnterpriseImpact(
  annualSavingKgPerPerson: number,
  commuters: number,
  daysPerWeek: number
) {
  // Scale annual saving by the fraction of week days the person would switch
  const fractionSwitched = daysPerWeek / 5;
  const savingPerPersonAdjusted = annualSavingKgPerPerson * fractionSwitched;
  const totalAnnual   = Math.round(savingPerPersonAdjusted * commuters);
  const totalMonthly  = Math.round(totalAnnual / 12);
  const treesEquiv    = Math.round(totalAnnual / 22); // ~22 kg CO₂ absorbed per tree/year
  const carTripsEquiv = Math.round(totalAnnual / 2.3); // ~2.3 kg CO₂ per avg car trip
  return { totalAnnual, totalMonthly, treesEquiv, carTripsEquiv };
}

// ─── Small UI helpers ────────────────────────────────────────────────────────
function ScoreDot({ score }: { score: number }) {
  const col = score >= 75 ? "#2d9e4a" : score >= 50 ? "#d97706" : "#dc2626";
  const r = 10, circ = 2 * Math.PI * r;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <svg width="28" height="28" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
        <circle cx="14" cy="14" r={r} fill="none" stroke="#e5e7eb" strokeWidth="3" />
        <circle cx="14" cy="14" r={r} fill="none" stroke={col} strokeWidth="3"
          strokeDasharray={`${(score / 100) * circ} ${circ}`}
          strokeLinecap="round" transform="rotate(-90 14 14)" />
        <text x="14" y="18" textAnchor="middle" fontSize="8" fontWeight="700" fill={col}>{score}</text>
      </svg>
    </span>
  );
}

function ConditionSelect<T extends string>({
  label, value, onChange, options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div>
      <label style={{ display: "block", marginBottom: 6, fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)" }}>
        {label}
      </label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={value === o.value ? {
              background: "var(--green-600)", color: "#fff",
              border: "1.5px solid var(--green-600)", borderRadius: "var(--r-sm)",
              padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
              transition: "all 0.15s", boxShadow: "0 2px 6px rgba(31,122,55,0.25)",
            } : {
              background: "var(--surface)", color: "var(--text-muted)",
              border: "1.5px solid var(--border)", borderRadius: "var(--r-sm)",
              padding: "6px 12px", fontSize: 12, fontWeight: 500, cursor: "pointer",
              transition: "all 0.15s",
            }}
          >{o.label}</button>
        ))}
      </div>
    </div>
  );
}

// Option card — richer visual per commute mode
function OptionCard({
  mode, isRecommended, isAlternative,
}: {
  mode: ModeResult;
  isRecommended: boolean;
  isAlternative: boolean;
  maxTravelMinutes: number;  // accepted but unused — kept for API compat
}) {
  const co2Bar = Math.max(0, mode.savingsPct);
  const boxStyle: React.CSSProperties = {
    borderRadius: "var(--r-xl)", padding: "18px 16px",
    border: isRecommended ? "2px solid var(--green-400)" : isAlternative ? "1.5px solid var(--blue-200)" : !mode.eligible ? "1px solid var(--border)" : "1px solid var(--border-dim)",
    background: isRecommended ? "linear-gradient(145deg, var(--green-50) 0%, var(--surface) 100%)" : isAlternative ? "var(--blue-50)" : !mode.eligible ? "var(--surface-alt)" : "var(--surface)",
    opacity: !mode.eligible ? 0.65 : 1,
    display: "flex", flexDirection: "column", gap: 12,
    boxShadow: isRecommended ? "0 4px 16px rgba(45,158,74,0.14)" : "var(--shadow-sm)",
  };
  return (
    <div style={boxStyle}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 26, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--r-md)", background: isRecommended ? "var(--green-100)" : "var(--surface-alt)", flexShrink: 0 }}>{mode.emoji}</span>
          <div>
            <p style={{ fontWeight: 700, fontSize: 14, color: isRecommended ? "var(--green-800)" : "var(--text)", margin: "0 0 4px" }}>{mode.label}</p>
            {isRecommended && <span style={{ padding: "2px 8px", borderRadius: "var(--r-full)", fontSize: 10, fontWeight: 700, background: "var(--green-500)", color: "#fff" }}>✅ Recommended</span>}
            {isAlternative && !isRecommended && <span style={{ padding: "2px 8px", borderRadius: "var(--r-full)", fontSize: 10, fontWeight: 700, background: "var(--blue-200)", color: "var(--blue-700)" }}>↗ Alternative</span>}
            {!mode.eligible && <span style={{ padding: "2px 8px", borderRadius: "var(--r-full)", fontSize: 10, fontWeight: 700, background: "var(--red-50)", color: "var(--red-700)", border: "1px solid var(--red-200)" }}>🚫 Excluded</span>}
          </div>
        </div>
        {mode.eligible && <ScoreDot score={mode.score} />}
      </div>
      {mode.eligible ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            { label: "Travel time", value: `~${mode.estimatedMinutes} min`, warn: !mode.withinTimeLimit },
            { label: "CO₂ / trip",  value: `${mode.co2PerTrip}g`,          warn: false },
            { label: "Walking",     value: mode.key === "walking" ? `${mode.estimatedMinutes} min` : mode.walkingMinutes > 0 ? `~${mode.walkingMinutes} min` : "Minimal", warn: !mode.withinWalkLimit },
            { label: "vs. driving", value: mode.key === "solo-car" ? "baseline" : `${mode.savingsPct}% less`, warn: false },
          ].map(s => (
            <div key={s.label} style={{ background: "var(--surface)", borderRadius: "var(--r-sm)", padding: "8px 10px", textAlign: "center", border: "1px solid var(--border-dim)" }}>
              <p style={{ fontSize: 10, color: "var(--text-dim)", margin: "0 0 3px", fontWeight: 500 }}>{s.label}</p>
              <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: s.warn ? "#c2410c" : isRecommended ? "var(--green-600)" : "var(--text)" }}>
                {s.value}
                {s.warn && <span style={{ display: "block", fontSize: 10, color: "#c2410c", fontWeight: 400 }}>over limit</span>}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 12, color: "var(--red-700)", background: "var(--red-50)", borderRadius: "var(--r-sm)", padding: "8px 12px", margin: 0, border: "1px solid var(--red-200)" }}>{mode.safetyNote}</p>
      )}
      {mode.eligible && mode.key !== "solo-car" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
            <span>CO₂ savings vs. driving</span>
            <span style={{ fontWeight: 700, color: "var(--green-600)" }}>{co2Bar}%</span>
          </div>
          <div style={{ height: 5, background: "var(--border)", borderRadius: 3 }}>
            <div style={{ height: "100%", borderRadius: 3, width: `${co2Bar}%`, background: "linear-gradient(to right, var(--green-400), var(--green-600))", transition: "width 0.4s ease" }} />
          </div>
        </div>
      )}
      {mode.warnings.slice(0, 1).map((w) => (
        <p key={w} style={{ fontSize: 11, color: "var(--amber-700)", background: "var(--amber-50)", border: "1px solid var(--amber-200)", borderRadius: "var(--r-sm)", padding: "6px 10px", margin: 0 }}>{w}</p>
      ))}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function Home() {
  // Inputs
  const [origin,        setOrigin]        = useState("");
  const [destination,   setDestination]   = useState("");
  const [distance,      setDistance]      = useState(12);
  const [weather,       setWeather]       = useState<Weather>("normal");
  const [traffic,       setTraffic]       = useState<Traffic>("normal");
  const [flooding,      setFlooding]      = useState<Flooding>("none");
  const [communityNote, setCommunityNote] = useState("");

  // User preferences
  const [maxTravelMinutes,   setMaxTravelMinutes]   = useState(45);
  const [maxWalkingMinutes,  setMaxWalkingMinutes]  = useState(10);
  const [sustainabilityPref, setSustainabilityPref] = useState<SustainabilityPref>("balanced");
  const [departureTime,      setDepartureTime]      = useState("08:00");
  const [comfortPriority,    setComfortPriority]    = useState(false);

  // Enterprise impact inputs
  const [enterpriseCommuters,   setEnterpriseCommuters]   = useState(1000);
  const [enterpriseDaysPerWeek, setEnterpriseDaysPerWeek] = useState(1);

  // Results
  const [plan,       setPlan]       = useState<PlanResult | null>(null);
  const [showWeekly, setShowWeekly] = useState(false);
  const [activeTab,  setActiveTab]  = useState<"options" | "details" | "enterprise">("options");

  // Weekly per-day conditions (default all normal)
  const defaultDay: DayConditions = { weather: "normal", traffic: "normal", flooding: "none" };
  const [dayConditions, setDayConditions] = useState<Record<DayName, DayConditions>>({
    Monday: { ...defaultDay }, Tuesday: { ...defaultDay }, Wednesday: { ...defaultDay },
    Thursday: { ...defaultDay }, Friday: { ...defaultDay },
  });
  const [weeklyPlan, setWeeklyPlan] = useState<{ day: DayName; plan: PlanResult }[] | null>(null);

  function getPrefs(): UserPreferences {
    return {
      maxTravelMinutes,
      maxWalkingMinutes,
      sustainabilityPref,
      departureTime,
      comfortPriority,
    };
  }

  function handlePlan() {
    const result = buildPlan(distance, weather, traffic, flooding, getPrefs());
    setPlan(result);
    setShowWeekly(false);
    setWeeklyPlan(null);
    setActiveTab("options");
    // Scroll to results after a short delay
    setTimeout(() => {
      document.getElementById("results-section")?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }

  function handleWeeklyPlan() {
    const result = buildWeeklyPlan(distance, dayConditions, getPrefs());
    setWeeklyPlan(result);
    setShowWeekly(true);
  }

  function updateDayCondition<K extends keyof DayConditions>(day: DayName, field: K, value: DayConditions[K]) {
    setDayConditions((prev) => ({ ...prev, [day]: { ...prev[day], [field]: value } }));
  }

  const weatherOptions: { value: Weather; label: string }[] = [
    { value: "normal",     label: "☀️ Normal"      },
    { value: "light-rain", label: "🌦️ Light Rain"  },
    { value: "heavy-rain", label: "🌧️ Heavy Rain"  },
  ];
  const trafficOptions: { value: Traffic; label: string }[] = [
    { value: "normal", label: "🟢 Normal"  },
    { value: "heavy",  label: "🔴 Heavy"   },
  ];
  const floodingOptions: { value: Flooding; label: string }[] = [
    { value: "none",     label: "✅ None"     },
    { value: "reported", label: "🌊 Reported" },
  ];
  const sustainabilityOptions: { value: SustainabilityPref; label: string }[] = [
    { value: "eco-priority",  label: "🌱 Eco-first"   },
    { value: "balanced",      label: "⚖️ Balanced"    },
    { value: "time-priority", label: "⚡ Time-first"  },
  ];

  // Enterprise impact (computed when plan is available)
  const enterprise = plan
    ? calcEnterpriseImpact(
        Math.max(0, plan.soloCarCo2Annual - plan.recommended.co2Annual),
        enterpriseCommuters,
        enterpriseDaysPerWeek
      )
    : null;

  /* ─ shared CSS-in-JS shortcuts ─ */
  const card: React.CSSProperties = {
    background: "var(--surface)", border: "1px solid var(--border-dim)",
    borderRadius: "var(--r-xl)", boxShadow: "var(--shadow-md)", overflow: "hidden",
  };
  const sec: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
    textTransform: "uppercase" as const, color: "var(--text-muted)",
    marginBottom: 14, display: "flex", alignItems: "center", gap: 8,
  };
  const pill = (bg: string, fg: string, border: string): React.CSSProperties => ({
    padding: "4px 11px", borderRadius: "var(--r-full)", fontSize: 11, fontWeight: 600,
    background: bg, color: fg, border: `1px solid ${border}`, display: "inline-block",
  });

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: "24px 16px 56px" }}>
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", background: "radial-gradient(ellipse 80% 55% at 50% -5%, rgba(45,158,74,0.10) 0%, transparent 65%)" }} />
      <div style={{ maxWidth: 900, margin: "0 auto", position: "relative", zIndex: 1 }}>

        {/* ── Header ── */}
        <div style={{ textAlign: "center", padding: "36px 0 32px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <span style={{ width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(135deg, var(--green-500) 0%, var(--teal) 100%)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 22, boxShadow: "0 4px 14px rgba(45,158,74,0.32)" }}>🌿</span>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: "var(--green-800)", margin: 0, letterSpacing: "-0.5px" }}>Sustainable Commute Planner</h1>
          </div>
          <p style={{ fontSize: 15, color: "var(--text-muted)", margin: "0 0 16px" }}>Condition-aware, AI-assisted commute decision support</p>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <span style={pill("var(--green-50)", "var(--green-700)", "var(--green-200)")}>IPCC AR6 Data</span>
            <span style={pill("var(--blue-50)", "var(--blue-700)", "var(--blue-200)")}>Safety-First Scoring</span>
            <span style={pill("#f5f0ff", "#6d28d9", "#ddd6fe")}>Built with IBM Bob</span>
          </div>
          <p style={{ fontSize: 14, color: "var(--text-dim)", maxWidth: 600, margin: "0 auto", lineHeight: 1.7 }}>
            The greenest option isn&apos;t always practical. This planner combines estimated CO₂, weather, travel time, and your constraints to recommend a lower-carbon commute that actually fits your situation.
          </p>
        </div>

        {/* ── Input card ── */}
        <div style={{ ...card, marginBottom: 20 }}>
          <div style={{ padding: "15px 24px", borderBottom: "1px solid var(--border-dim)", background: "linear-gradient(to right, var(--green-50), var(--surface))", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 32, height: 32, borderRadius: "var(--r-sm)", flexShrink: 0, background: "var(--green-500)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📍</span>
            <span style={{ fontWeight: 700, fontSize: 16, color: "var(--green-800)" }}>Your Journey</span>
          </div>
          <div style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 22 }}>
            <LocationPicker
              origin={origin}
              destination={destination}
              onOriginChange={(label) => setOrigin(label)}
              onDestinationChange={(label) => setDestination(label)}
              onDistanceChange={(km) => setDistance(km)}
            />

            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 16px", borderRadius: "var(--r-md)", background: "var(--green-50)", border: "1px solid var(--green-100)" }}>
              <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>Distance (one way)</span>
              <span style={{ fontWeight: 800, fontSize: 17, color: "var(--green-600)" }}>{distance} km</span>
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{distance <= WALKING_MAX_KM ? "— walkable" : distance <= CYCLING_MAX_KM ? "— cycleable" : "— transit / car route"}</span>
            </div>

            <div style={{ height: 1, background: "var(--border-dim)" }} />

            <div>
              <p style={sec}><span>🎯</span> Your Preferences</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: "var(--text-muted)" }}>Departure time</label>
                  <input type="time" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} className="input-premium" />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: "var(--text-muted)" }}>Max travel time: <span style={{ color: "var(--green-600)", fontWeight: 800 }}>{maxTravelMinutes} min</span></label>
                  <input type="range" min={10} max={120} step={5} value={maxTravelMinutes} onChange={(e) => setMaxTravelMinutes(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--green-500)" }} />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: "var(--text-muted)" }}>Max walking: <span style={{ color: "var(--green-600)", fontWeight: 800 }}>{maxWalkingMinutes} min</span></label>
                  <input type="range" min={2} max={30} step={1} value={maxWalkingMinutes} onChange={(e) => setMaxWalkingMinutes(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--green-500)" }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 20 }}>
                  <input type="checkbox" id="comfort-check" checked={comfortPriority} onChange={(e) => setComfortPriority(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--green-500)", cursor: "pointer" }} />
                  <label htmlFor="comfort-check" style={{ fontSize: 13, color: "var(--text-muted)", cursor: "pointer" }}>Prefer comfort / cost over active modes</label>
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                <ConditionSelect label="Sustainability preference" value={sustainabilityPref} onChange={setSustainabilityPref} options={sustainabilityOptions} />
              </div>
            </div>

            <div style={{ height: 1, background: "var(--border-dim)" }} />

            <div>
              <p style={sec}><span>⚡</span> Today&apos;s Conditions</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
                <ConditionSelect label="Weather"  value={weather}  onChange={setWeather}  options={weatherOptions}  />
                <ConditionSelect label="Traffic"  value={traffic}  onChange={setTraffic}  options={trafficOptions}  />
                <ConditionSelect label="Flooding" value={flooding} onChange={setFlooding} options={floodingOptions} />
              </div>
              <div style={{ marginTop: 16 }}>
                <label style={{ display: "block", marginBottom: 6, fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: "var(--text-muted)" }}>Community-reported conditions <span style={{ fontWeight: 400, textTransform: "none" as const, letterSpacing: 0 }}>(optional)</span></label>
                <textarea placeholder='e.g. "Flooding reported near Jalan X" or "LRT service normal"' value={communityNote} onChange={(e) => setCommunityNote(e.target.value)} rows={2} className="input-premium" style={{ resize: "none", fontFamily: "inherit" }} />
              </div>
            </div>

            <button
              onClick={handlePlan}
              disabled={!origin || !destination}
              style={{
                width: "100%", padding: "14px 24px", border: "none",
                background: !origin || !destination ? "var(--border)" : "linear-gradient(135deg, var(--green-500) 0%, var(--teal) 100%)",
                color: !origin || !destination ? "var(--text-dim)" : "#fff",
                borderRadius: "var(--r-lg)", fontSize: 15, fontWeight: 700,
                cursor: !origin || !destination ? "not-allowed" : "pointer",
                boxShadow: !origin || !destination ? "none" : "0 4px 16px rgba(45,158,74,0.30)",
                transition: "all 0.2s", letterSpacing: "0.02em",
              }}
            >🌱 Analyse My Commute Options</button>
          </div>
        </div>

        {/* ── Results ── */}
        {plan && (
          <div id="results-section" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {plan.safetyAlerts.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {plan.safetyAlerts.map((alert) => (
                  <div key={alert} style={{ display: "flex", alignItems: "flex-start", gap: 12, background: "var(--red-50)", border: "1px solid var(--red-200)", borderRadius: "var(--r-lg)", padding: "14px 18px", fontSize: 14, color: "var(--red-700)" }}>
                    <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>⚠️</span><span>{alert}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Tabs */}
            <div style={{ display: "flex", gap: 4, borderBottom: "1.5px solid var(--border-dim)" }}>
              {(["options", "details", "enterprise"] as const).map((tab) => (
                <button key={tab} type="button" onClick={() => setActiveTab(tab)} style={{ padding: "10px 18px", fontSize: 13, fontWeight: activeTab === tab ? 700 : 500, border: "none", background: "transparent", cursor: "pointer", color: activeTab === tab ? "var(--green-700)" : "var(--text-dim)", borderBottom: activeTab === tab ? "2.5px solid var(--green-500)" : "2.5px solid transparent", marginBottom: -1.5, transition: "all 0.15s" }}>
                  {tab === "options" && "📊 Commute Options"}{tab === "details" && "🔍 Analysis Details"}{tab === "enterprise" && "🏢 Enterprise Impact"}
                </button>
              ))}
            </div>

            {/* TAB: Commute Options */}
            {activeTab === "options" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div style={{ ...card, border: "1.5px solid var(--green-300)", background: "linear-gradient(140deg, var(--green-50) 0%, var(--surface) 60%)" }}>
                  <div style={{ padding: "24px 24px 20px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 20 }}>
                      <div>
                        <div style={{ ...pill("var(--green-100)", "var(--green-700)", "var(--green-200)"), marginBottom: 12, fontSize: 10, letterSpacing: "0.07em" }}>🤖 RECOMMENDATION — BASED ON YOUR PREFERENCES</div>
                        <h3 style={{ fontSize: 32, fontWeight: 800, color: "var(--green-800)", margin: "0 0 6px", letterSpacing: "-0.5px" }}>{plan.recommended.emoji} {plan.recommended.label}</h3>
                        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{origin.split(",")[0]} → {destination.split(",")[0]} · {distance} km{departureTime && ` · Depart ${departureTime}`}</p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ padding: "10px 22px", borderRadius: "var(--r-lg)", background: "linear-gradient(135deg, var(--green-500), var(--teal))", color: "#fff", fontSize: 24, fontWeight: 800, boxShadow: "0 4px 16px rgba(45,158,74,0.30)" }}>{plan.recommended.savingsPct}%</div>
                        <p style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }}>less CO₂ vs. driving</p>
                      </div>
                    </div>
                    <div style={{ background: "var(--surface)", borderRadius: "var(--r-md)", padding: "14px 18px", border: "1px solid var(--border-dim)", fontSize: 14, color: "var(--text)", lineHeight: 1.7, marginBottom: 16 }}>
                      <p style={{ fontWeight: 700, marginBottom: 4 }}>💡 Why this recommendation:</p>
                      <p style={{ margin: 0 }}>{plan.reasoning}</p>
                    </div>
                    {plan.tradeOffNotes.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                        {plan.tradeOffNotes.map((note) => (
                          <div key={note} style={{ background: "var(--blue-50)", border: "1px solid var(--blue-200)", borderRadius: "var(--r-sm)", padding: "8px 14px", fontSize: 13, color: "var(--blue-700)" }}>ℹ️ {note}</div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
                      {[
                        { label: "Est. travel time", value: `~${plan.recommended.estimatedMinutes} min` },
                        { label: "CO₂ this trip",    value: `${plan.recommended.co2PerTrip}g`           },
                        { label: "Annual CO₂",       value: `${plan.recommended.co2Annual} kg`           },
                        { label: "Annual saving",    value: `${Math.round(plan.soloCarCo2Annual - plan.recommended.co2Annual)} kg` },
                      ].map((s) => (
                        <div key={s.label} style={{ background: "var(--surface)", border: "1px solid var(--border-dim)", borderRadius: "var(--r-md)", padding: "14px 10px", textAlign: "center" }}>
                          <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "0 0 4px", fontWeight: 500 }}>{s.label}</p>
                          <p style={{ fontSize: 18, fontWeight: 800, color: "var(--green-600)", margin: 0 }}>{s.value}</p>
                        </div>
                      ))}
                    </div>
                    {communityNote && (
                      <div style={{ marginTop: 14, background: "var(--amber-50)", border: "1px solid var(--amber-200)", borderRadius: "var(--r-md)", padding: "12px 16px", fontSize: 13, color: "var(--amber-700)" }}>📢 <strong>Community report:</strong> {communityNote}</div>
                    )}
                  </div>
                </div>

                <div>
                  <p style={sec}><span>📋</span> All Options Compared</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
                    {plan.modes.sort((a, b) => b.score - a.score).map((m) => (
                      <OptionCard key={m.key} mode={m} isRecommended={m.key === plan.recommended.key} isAlternative={plan.alternative !== null && m.key === plan.alternative.key} maxTravelMinutes={maxTravelMinutes} />
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 10 }}>* Travel time estimates based on typical speeds. CO₂ based on IPCC AR6 / IEA 2023 data. <strong>All figures are indicative estimates, not real-time data.</strong></p>
                </div>

                {/* Weekly planner */}
                <div style={card}>
                  <div style={{ padding: "15px 24px", borderBottom: "1px solid var(--border-dim)", background: "linear-gradient(to right, var(--green-50), var(--surface))", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 32, height: 32, borderRadius: "var(--r-sm)", flexShrink: 0, background: "var(--green-500)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📅</span>
                    <span style={{ fontWeight: 700, fontSize: 16, color: "var(--green-800)" }}>Plan Your Week</span>
                  </div>
                  <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
                    <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0 }}>Set per-day conditions to get a personalised Mon–Fri recommendation.</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {DAYS.map((day) => (
                        <div key={day} style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr 1fr", gap: 12, alignItems: "end", background: "var(--surface-alt)", border: "1px solid var(--border-dim)", borderRadius: "var(--r-md)", padding: "14px 16px" }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", paddingTop: 18 }}>{day}</div>
                          <ConditionSelect label="Weather"  value={dayConditions[day].weather}  onChange={(v) => updateDayCondition(day, "weather",  v)} options={weatherOptions}  />
                          <ConditionSelect label="Traffic"  value={dayConditions[day].traffic}  onChange={(v) => updateDayCondition(day, "traffic",  v)} options={trafficOptions}  />
                          <ConditionSelect label="Flooding" value={dayConditions[day].flooding} onChange={(v) => updateDayCondition(day, "flooding", v)} options={floodingOptions} />
                        </div>
                      ))}
                    </div>
                    <button onClick={handleWeeklyPlan} style={{ width: "100%", padding: "14px 24px", border: "none", background: "linear-gradient(135deg, var(--green-500) 0%, var(--teal) 100%)", color: "#fff", borderRadius: "var(--r-lg)", fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(45,158,74,0.28)", transition: "opacity 0.15s", letterSpacing: "0.02em" }}>📅 Generate Weekly Plan</button>
                  </div>
                </div>

                {/* Weekly results */}
                {showWeekly && weeklyPlan && (
                  <div style={card}>
                    <div style={{ padding: "20px 24px 0" }}><p style={sec}><span>🗓️</span> Your Weekly Commute Plan</p></div>
                    <div style={{ padding: "0 24px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                      {weeklyPlan.map(({ day, plan: dp }) => (
                        <div key={day} style={{ display: "flex", alignItems: "flex-start", gap: 14, background: "var(--surface-alt)", border: "1px solid var(--border-dim)", borderRadius: "var(--r-lg)", padding: "16px 18px" }}>
                          <div style={{ minWidth: 88, fontWeight: 700, fontSize: 13, color: "var(--text)", paddingTop: 2 }}>{day}</div>
                          <div style={{ fontSize: 26, lineHeight: 1, flexShrink: 0 }}>{dp.recommended.emoji}</div>
                          <div style={{ flex: 1 }}>
                            <p style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", margin: "0 0 4px" }}>{dp.recommended.label}</p>
                            <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 4px", lineHeight: 1.6 }}>{dp.reasoning}</p>
                            {dp.safetyAlerts.map((a) => <p key={a} style={{ fontSize: 12, color: "var(--red-700)", background: "var(--red-50)", borderRadius: "var(--r-sm)", padding: "4px 10px", margin: "4px 0 0", border: "1px solid var(--red-200)" }}>{a}</p>)}
                          </div>
                          <div style={{ textAlign: "right", minWidth: 90, flexShrink: 0 }}>
                            <p style={{ fontWeight: 700, fontSize: 13, color: "var(--green-600)", margin: "0 0 2px" }}>~{dp.recommended.estimatedMinutes} min</p>
                            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--green-500)", margin: "0 0 2px" }}>{dp.recommended.co2PerTrip}g CO₂</p>
                            <p style={{ fontSize: 11, color: "var(--text-dim)", margin: 0 }}>{dp.recommended.savingsPct}% saved</p>
                          </div>
                        </div>
                      ))}
                      {(() => {
                        const totalWeekly = weeklyPlan.reduce((s, { plan: dp }) => s + dp.recommended.co2Weekly / 5, 0);
                        const totalSolo   = weeklyPlan.reduce((s, { plan: dp }) => s + dp.soloCarCo2Weekly / 5, 0);
                        const saving      = Math.round(totalSolo - totalWeekly);
                        return (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 10 }}>
                            {[
                              { label: "Weekly CO₂ (plan)",    value: `${Math.round(totalWeekly).toLocaleString()}g`, color: "var(--green-600)" },
                              { label: "Weekly CO₂ (driving)", value: `${Math.round(totalSolo).toLocaleString()}g`,   color: "var(--red-700)"   },
                              { label: "Weekly saving",         value: `${saving.toLocaleString()}g`,                  color: "var(--teal)"      },
                            ].map((s) => (
                              <div key={s.label} style={{ background: "var(--surface)", border: "1px solid var(--border-dim)", borderRadius: "var(--r-md)", padding: "14px 10px", textAlign: "center" }}>
                                <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "0 0 4px", fontWeight: 500 }}>{s.label}</p>
                                <p style={{ fontSize: 18, fontWeight: 800, color: s.color, margin: 0 }}>{s.value}</p>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB: Analysis Details */}
            {activeTab === "details" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div style={card}>
                  <div style={{ padding: "20px 24px" }}>
                    <p style={sec}><span>🔍</span> Conditions Considered</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {[
                        weather === "heavy-rain" ? pill("var(--blue-50)", "var(--blue-700)", "var(--blue-200)") : weather === "light-rain" ? pill("#f0f9ff", "#0369a1", "#bae6fd") : pill("var(--green-50)", "var(--green-700)", "var(--green-100)"),
                        traffic === "heavy" ? pill("#fff7ed", "#c2410c", "#fed7aa") : pill("var(--green-50)", "var(--green-700)", "var(--green-100)"),
                        flooding === "reported" ? pill("var(--red-50)", "var(--red-700)", "var(--red-200)") : pill("var(--green-50)", "var(--green-700)", "var(--green-100)"),
                        pill("var(--surface-alt)", "var(--text-muted)", "var(--border)"),
                        pill("#faf5ff", "#6d28d9", "#ddd6fe"),
                        pill("#faf5ff", "#6d28d9", "#ddd6fe"),
                        pill("var(--green-50)", "var(--green-700)", "var(--green-100)"),
                      ].map((style, i) => {
                        const labels = [
                          weather === "heavy-rain" ? "🌧️ Heavy Rain" : weather === "light-rain" ? "🌦️ Light Rain" : "☀️ Normal Weather",
                          traffic === "heavy" ? "🚦 Heavy Traffic" : "🟢 Normal Traffic",
                          flooding === "reported" ? "🌊 Flooding Reported" : "✅ No Flooding",
                          `📏 ${distance} km`, `🎯 Max ${maxTravelMinutes} min`, `🚶 Max ${maxWalkingMinutes} min walking`,
                          sustainabilityPref === "eco-priority" ? "🌱 Eco-first" : sustainabilityPref === "time-priority" ? "⚡ Time-first" : "⚖️ Balanced",
                        ];
                        return <span key={i} style={style}>{labels[i]}</span>;
                      })}
                    </div>
                  </div>
                </div>

                <div style={card}>
                  <div style={{ padding: "20px 24px 0" }}><p style={sec}><span>📊</span> Detailed Scoring Breakdown</p></div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border-dim)" }}>
                          {["Mode", "Score", "Est. time", "CO₂/week", "CO₂/year", "vs. Driving", "Status"].map(h => (
                            <th key={h} style={{ textAlign: "left", padding: "10px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {plan.modes.sort((a, b) => b.score - a.score).map((m) => (
                          <tr key={m.key} style={{ borderBottom: "1px solid var(--border-dim)", background: m.key === plan.recommended.key ? "var(--green-50)" : "transparent" }}>
                            <td style={{ padding: "12px 16px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 17 }}>{m.emoji}</span>
                                <span style={{ fontWeight: m.key === plan.recommended.key ? 700 : 500, color: m.key === plan.recommended.key ? "var(--green-700)" : "var(--text)" }}>{m.label}</span>
                                {m.key === plan.recommended.key && <span style={{ padding: "2px 8px", borderRadius: "var(--r-full)", fontSize: 10, fontWeight: 700, background: "var(--green-500)", color: "#fff" }}>Best fit</span>}
                              </div>
                            </td>
                            <td style={{ padding: "12px 16px" }}>{m.eligible ? <ScoreDot score={m.score} /> : <span style={{ color: "var(--text-dim)", fontSize: 12 }}>—</span>}</td>
                            <td style={{ padding: "12px 16px", fontSize: 12, color: !m.withinTimeLimit && m.eligible ? "#c2410c" : "var(--text)" }}>{m.eligible ? `~${m.estimatedMinutes} min` : "—"}</td>
                            <td style={{ padding: "12px 16px", color: !m.eligible ? "var(--border)" : "var(--text)", textDecoration: !m.eligible ? "line-through" : "none" }}>{m.co2Weekly.toLocaleString()}g</td>
                            <td style={{ padding: "12px 16px", color: !m.eligible ? "var(--border)" : "var(--text)", textDecoration: !m.eligible ? "line-through" : "none" }}>{m.co2Annual} kg</td>
                            <td style={{ padding: "12px 16px" }}>
                              {m.key === "solo-car" ? <span style={{ fontSize: 11, color: "var(--text-dim)" }}>baseline</span>
                                : m.eligible ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ width: 64, height: 5, background: "var(--border)", borderRadius: 3 }}>
                                      <div style={{ width: `${m.savingsPct}%`, height: "100%", borderRadius: 3, background: "linear-gradient(to right, var(--green-400), var(--green-600))" }} />
                                    </div>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--green-600)" }}>{m.savingsPct}%</span>
                                  </div>
                                : <span style={{ fontSize: 11, color: "var(--text-dim)" }}>—</span>}
                            </td>
                            <td style={{ padding: "12px 16px" }}>
                              {!m.eligible ? <span style={{ ...pill("var(--red-50)", "var(--red-700)", "var(--red-200)"), fontSize: 11 }}>{m.safetyNote}</span>
                                : m.warnings.length > 0 ? <span style={{ ...pill("var(--amber-50)", "var(--amber-700)", "var(--amber-200)"), fontSize: 11 }}>{m.warnings[0]}</span>
                                : <span style={{ ...pill("var(--green-50)", "var(--green-700)", "var(--green-100)"), fontSize: 11 }}>✅ Viable</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: "10px 16px 16px" }}>
                    <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "0 0 12px" }}>* CO₂ estimates based on IPCC AR6 / IEA 2023 data. Score: 100 = ideal, 0 = excluded. All figures are indicative.</p>
                    <div style={{ background: "var(--surface-alt)", borderRadius: "var(--r-md)", padding: "14px 16px", border: "1px solid var(--border-dim)" }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", margin: "0 0 8px" }}>Score breakdown — {plan.recommended.label}:</p>
                      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
                        <li style={{ fontSize: 12, color: "var(--text-dim)" }}>Base score: 100</li>
                        {plan.recommended.scoreBreakdown.map((b) => <li key={b} style={{ fontSize: 12, color: "var(--text-dim)" }}>{b}</li>)}
                        <li style={{ fontSize: 12, fontWeight: 700, color: "var(--green-600)" }}>Final score: {plan.recommended.score}</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div style={{ ...card, background: "linear-gradient(to bottom right, var(--green-50), var(--surface))" }}>
                  <div style={{ padding: "20px 24px" }}>
                    <p style={sec}><span>🌍</span> CO₂ Impact (Indicative Estimates)</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                      {[
                        { label: "🚗 Solo driving",         value: `${plan.soloCarCo2Weekly.toLocaleString()}g/wk`, sub: `${plan.soloCarCo2Annual} kg/yr`, accent: "var(--red-700)", bg: "var(--red-50)", border: "var(--red-200)" },
                        { label: `${plan.recommended.emoji} ${plan.recommended.label}`, value: `${plan.recommended.co2Weekly.toLocaleString()}g/wk`, sub: `${plan.recommended.co2Annual} kg/yr`, accent: "var(--green-600)", bg: "var(--green-50)", border: "var(--green-100)" },
                        { label: "💚 Estimated saving",     value: `${Math.max(0, plan.soloCarCo2Weekly - plan.recommended.co2Weekly).toLocaleString()}g/wk`, sub: `${Math.max(0, plan.soloCarCo2Annual - plan.recommended.co2Annual)} kg/yr`, accent: "var(--teal)", bg: "var(--teal-light)", border: "#99f6e4" },
                      ].map((s) => (
                        <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: "var(--r-lg)", padding: "18px 16px", textAlign: "center" }}>
                          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", margin: "0 0 6px" }}>{s.label}</p>
                          <p style={{ fontSize: 22, fontWeight: 800, color: s.accent, margin: "0 0 3px" }}>{s.value}</p>
                          <p style={{ fontSize: 11, color: "var(--text-dim)", margin: 0 }}>{s.sub}</p>
                        </div>
                      ))}
                    </div>
                    <p style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 12 }}>Sources: IPCC AR6 WG III (2022), IEA Transport Data (2023). All figures are indicative estimates.</p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: Enterprise Impact */}
            {activeTab === "enterprise" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div style={{ ...card, border: "1px solid #ddd6fe" }}>
                  <div style={{ padding: "15px 24px", borderBottom: "1px solid #ede9fe", background: "linear-gradient(to right, #faf5ff, var(--surface))", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 32, height: 32, borderRadius: "var(--r-sm)", flexShrink: 0, background: "#7c3aed", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🏢</span>
                    <span style={{ fontWeight: 700, fontSize: 16, color: "#5b21b6" }}>Potential Enterprise Impact</span>
                  </div>
                  <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
                    <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0 }}>This section illustrates how the same individual decision-support logic could scale to a corporate sustainability programme. <strong>All figures below are illustrative estimates based on the recommendation above.</strong> They are not based on real organisational data.</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
                      <div>
                        <label style={{ display: "block", marginBottom: 6, fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: "#6d28d9" }}>Number of commuters: <span style={{ fontWeight: 800 }}>{enterpriseCommuters.toLocaleString()}</span></label>
                        <input type="range" min={100} max={10000} step={100} value={enterpriseCommuters} onChange={(e) => setEnterpriseCommuters(Number(e.target.value))} style={{ width: "100%", accentColor: "#7c3aed" }} />
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}><span>100</span><span>10,000</span></div>
                      </div>
                      <div>
                        <label style={{ display: "block", marginBottom: 6, fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: "#6d28d9" }}>Days/week switching: <span style={{ fontWeight: 800 }}>{enterpriseDaysPerWeek}</span></label>
                        <input type="range" min={1} max={5} step={1} value={enterpriseDaysPerWeek} onChange={(e) => setEnterpriseDaysPerWeek(Number(e.target.value))} style={{ width: "100%", accentColor: "#7c3aed" }} />
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}><span>1 day</span><span>5 days</span></div>
                      </div>
                    </div>
                    {enterprise && (
                      <>
                        <div style={{ background: "var(--surface-alt)", borderRadius: "var(--r-md)", padding: "14px 16px", border: "1px solid #ede9fe", fontSize: 14, color: "var(--text)" }}>
                          <p style={{ fontWeight: 600, color: "#5b21b6", margin: "0 0 6px" }}>📊 Scenario summary:</p>
                          <p style={{ margin: 0 }}>If <strong>{enterpriseCommuters.toLocaleString()} employees</strong> switched <strong>{enterpriseDaysPerWeek} commute day{enterpriseDaysPerWeek > 1 ? "s" : ""}/week</strong> from solo driving to <strong>{plan.recommended.label}</strong>:</p>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
                          {[
                            { label: "Annual CO₂ reduction",  value: `${enterprise.totalAnnual.toLocaleString()} kg`, accent: "var(--green-600)", bg: "var(--green-50)", border: "var(--green-100)" },
                            { label: "Monthly reduction",       value: `${enterprise.totalMonthly.toLocaleString()} kg`, accent: "var(--blue-700)", bg: "var(--blue-50)", border: "var(--blue-200)" },
                            { label: "Equiv. trees / year",     value: `~${enterprise.treesEquiv.toLocaleString()}`,    accent: "var(--teal)",    bg: "var(--teal-light)", border: "#99f6e4" },
                            { label: "Car trips avoided",       value: `~${enterprise.carTripsEquiv.toLocaleString()}`, accent: "#5b21b6",         bg: "#faf5ff",           border: "#ddd6fe" },
                          ].map((s) => (
                            <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: "var(--r-lg)", padding: "16px 14px", textAlign: "center" }}>
                              <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "0 0 5px", fontWeight: 500 }}>{s.label}</p>
                              <p style={{ fontSize: 20, fontWeight: 800, color: s.accent, margin: 0 }}>{s.value}</p>
                            </div>
                          ))}
                        </div>
                        <div style={{ background: "var(--amber-50)", border: "1px solid var(--amber-200)", borderRadius: "var(--r-md)", padding: "12px 16px", fontSize: 12, color: "var(--amber-700)" }}>⚠️ <strong>Simulated data:</strong> These figures are illustrative estimates derived from the IPCC-based CO₂ savings calculated for the route above. They are intended to demonstrate the concept of scaling individual decision support to enterprise sustainability reporting. Real organisational impact would depend on actual commuter data, route mix, and travel patterns.</div>
                      </>
                    )}
                    <div style={{ borderTop: "1px solid #ede9fe", paddingTop: 16 }}>
                      <p style={{ fontWeight: 700, fontSize: 14, color: "#5b21b6", marginBottom: 10 }}>🚀 Potential enterprise applications</p>
                      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
                        {["Corporate sustainable commuting programmes with personalised recommendations", "ESG reporting — quantifying employee commute emissions across locations", "Smart-city mobility planning — aggregate demand forecasting for transit investment", "Employee transport benefit optimisation — compare shuttle, transit subsidy, and cycling allowances", "Carbon credit accounting for employee commute behaviour change"].map(li => (
                          <li key={li} style={{ fontSize: 13, color: "var(--text-muted)", paddingLeft: 16, position: "relative" }}><span style={{ position: "absolute", left: 0, color: "#7c3aed" }}>·</span>{li}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                <div style={{ ...card, border: "1px solid var(--blue-200)" }}>
                  <div style={{ padding: "15px 24px", borderBottom: "1px solid var(--blue-200)", background: "linear-gradient(to right, var(--blue-50), var(--surface))", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 32, height: 32, borderRadius: "var(--r-sm)", flexShrink: 0, background: "var(--blue-700)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🤖</span>
                    <span style={{ fontWeight: 700, fontSize: 16, color: "var(--blue-700)" }}>Built with IBM Bob</span>
                  </div>
                  <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
                    <p style={{ fontSize: 14, color: "var(--text)", margin: 0 }}>This prototype was built using <strong>IBM Bob</strong> as the core development tool — not as a badge, but as an integral part of the design and implementation process.</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                      {[
                        { title: "Custom Mode",   desc: "A 🌿 Commute Planner mode defines Bob's safety-first transport advisor persona and tool permissions" },
                        { title: "Skill",         desc: "A SKILL.md encodes all domain knowledge — emission factors, scoring rules, condition handling, recommendation logic" },
                        { title: "Plan Mode",     desc: "Used to reason about architecture and scoring priorities before implementation" },
                        { title: "Agent Mode",    desc: "Executed file creation, code implementation, and iterative refinement" },
                        { title: "Validation",    desc: "TEST_SCENARIOS.md was designed with Bob to validate the scoring engine" },
                        { title: "Documentation", desc: "README and all documentation authored in collaboration with Bob" },
                      ].map((f) => (
                        <div key={f.title} style={{ background: "var(--surface-alt)", borderRadius: "var(--r-md)", padding: "12px 14px", border: "1px solid var(--border-dim)" }}>
                          <p style={{ fontWeight: 700, fontSize: 13, color: "var(--blue-700)", margin: "0 0 4px" }}>{f.title}</p>
                          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>{f.desc}</p>
                        </div>
                      ))}
                    </div>
                    <p style={{ fontSize: 12, color: "var(--text-dim)", margin: 0 }}>The application&apos;s scoring engine directly implements the rules defined in the Bob skill — meaning the skill isn&apos;t just documentation, it&apos;s the specification the code was built from.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Footer */}
            <div style={{ textAlign: "center", padding: "12px 0 8px" }}>
              <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 4px" }}>CO₂ estimates based on IPCC AR6 / IEA 2023 Transport Data. All figures are indicative estimates, not real-time data.</p>
              <p style={{ fontSize: 12, color: "var(--text-dim)", margin: 0 }}>Built for IBM Bob Mini Hackathon · Powered by <span style={{ fontWeight: 700, color: "var(--green-500)" }}>IBM Bob</span> custom modes &amp; skills</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
