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
  mode,
  isRecommended,
  isAlternative,
}: {
  mode: ModeResult;
  isRecommended: boolean;
  isAlternative: boolean;
}) {
  const borderClass = isRecommended
    ? "border-2 border-green-400 bg-green-50"
    : isAlternative
    ? "border border-blue-300 bg-blue-50"
    : !mode.eligible
    ? "border border-gray-200 bg-gray-50 opacity-60"
    : "border border-gray-200 bg-white";

  const co2Bar = mode.savingsPct > 0 ? mode.savingsPct : 0;

  return (
    <div className={`rounded-xl p-4 space-y-3 ${borderClass}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{mode.emoji}</span>
          <div>
            <p className={`font-semibold text-sm ${isRecommended ? "text-green-800" : "text-gray-800"}`}>
              {mode.label}
            </p>
            {isRecommended && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                ✅ Recommended
              </span>
            )}
            {isAlternative && !isRecommended && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                ↗ Alternative
              </span>
            )}
            {!mode.eligible && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                🚫 Excluded
              </span>
            )}
          </div>
        </div>
        {mode.eligible && <ScoreDot score={mode.score} />}
      </div>

      {/* Stats */}
      {mode.eligible ? (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {[
            { label: "Travel time", value: `~${mode.estimatedMinutes} min`, warn: !mode.withinTimeLimit },
            { label: "CO₂ / trip",  value: `${mode.co2PerTrip}g`,          warn: false },
            { label: "Walking",     value: mode.key === "walking" ? `${mode.estimatedMinutes} min` : mode.walkingMinutes > 0 ? `~${mode.walkingMinutes} min` : "Minimal", warn: !mode.withinWalkLimit },
            { label: "vs. driving", value: mode.key === "solo-car" ? "baseline" : `${mode.savingsPct}% less`, warn: false },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-lg p-2 text-center border border-gray-100">
              <p className="text-gray-400 mb-0.5">{s.label}</p>
              <p className={`font-bold ${s.warn ? "text-orange-600" : isRecommended ? "text-green-700" : "text-gray-700"}`}>
                {s.value}
                {s.warn && <span className="block text-orange-500 font-normal text-xs">over limit</span>}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg p-2">{mode.safetyNote}</p>
      )}

      {/* CO₂ bar */}
      {mode.eligible && mode.key !== "solo-car" && (
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>CO₂ savings vs. driving</span>
            <span className="font-bold text-green-600">{co2Bar}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-green-500 h-1.5 rounded-full transition-all"
              style={{ width: `${co2Bar}%` }}
            />
          </div>
        </div>
      )}

      {/* Warnings */}
      {mode.warnings.slice(0, 1).map((w) => (
        <p key={w} className="text-xs text-yellow-700 bg-yellow-50 rounded px-2 py-1">{w}</p>
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* ── Header ── */}
        <div className="text-center space-y-2 py-6">
          <h1 className="text-4xl font-bold text-green-800">🌿 Sustainable Commute Planner</h1>
          <p className="text-green-700 text-lg">Condition-aware, AI-assisted commute decision support</p>
          <div className="flex justify-center gap-2 mt-2 flex-wrap">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">IPCC AR6 Data</span>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Safety-First Scoring</span>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">Built with IBM Bob</span>
          </div>
          <p className="text-sm text-gray-500 max-w-2xl mx-auto mt-2">
            The greenest option isn&apos;t always practical. This planner combines estimated CO₂, weather, travel time, and your constraints to recommend a lower-carbon commute that actually fits your situation.
          </p>
        </div>

        {/* ── Input card ── */}
        <Card className="border border-green-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-green-800">📍 Your Journey</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Origin / Destination + Map */}
            <LocationPicker
              origin={origin}
              destination={destination}
              onOriginChange={(label) => setOrigin(label)}
              onDestinationChange={(label) => setDestination(label)}
              onDistanceChange={(km) => setDistance(km)}
            />

            {/* Distance (read-only display; set automatically by LocationPicker) */}
            <div className="flex items-center gap-3 text-sm text-gray-700">
              <span className="font-medium">Distance (one way):</span>
              <span className="text-green-700 font-bold">{distance} km</span>
              <span className="text-gray-400 text-xs">
                {distance <= WALKING_MAX_KM ? "— walkable" : distance <= CYCLING_MAX_KM ? "— cycleable" : "— transit/car route"}
              </span>
            </div>

            <hr className="border-green-100" />

            {/* User preferences */}
            <div className="space-y-4">
              <p className="text-sm font-semibold text-gray-700">🎯 Your Preferences</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Departure time
                  </label>
                  <input
                    type="time"
                    value={departureTime}
                    onChange={(e) => setDepartureTime(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Max travel time: <span className="font-bold text-green-700">{maxTravelMinutes} min</span>
                  </label>
                  <input
                    type="range"
                    min={10} max={120} step={5}
                    value={maxTravelMinutes}
                    onChange={(e) => setMaxTravelMinutes(Number(e.target.value))}
                    className="w-full accent-green-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Max walking: <span className="font-bold text-green-700">{maxWalkingMinutes} min</span>
                  </label>
                  <input
                    type="range"
                    min={2} max={30} step={1}
                    value={maxWalkingMinutes}
                    onChange={(e) => setMaxWalkingMinutes(Number(e.target.value))}
                    className="w-full accent-green-600"
                  />
                </div>
                <div className="flex items-center gap-3 pt-4">
                  <input
                    type="checkbox"
                    id="comfort-check"
                    checked={comfortPriority}
                    onChange={(e) => setComfortPriority(e.target.checked)}
                    className="w-4 h-4 accent-green-600"
                  />
                  <label htmlFor="comfort-check" className="text-xs text-gray-600 cursor-pointer">
                    Prefer comfort / cost over active modes
                  </label>
                </div>
              </div>

              <ConditionSelect
                label="Sustainability preference"
                value={sustainabilityPref}
                onChange={setSustainabilityPref}
                options={sustainabilityOptions}
              />
            </div>

            <hr className="border-green-100" />

            {/* Conditions */}
            <div className="space-y-4">
              <p className="text-sm font-semibold text-gray-700">⚡ Today&apos;s Conditions</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <ConditionSelect label="Weather"  value={weather}  onChange={setWeather}  options={weatherOptions}  />
                <ConditionSelect label="Traffic"  value={traffic}  onChange={setTraffic}  options={trafficOptions}  />
                <ConditionSelect label="Flooding" value={flooding} onChange={setFlooding} options={floodingOptions} />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  User-reported conditions <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <TextArea
                  placeholder='e.g. "Flooding reported near Jalan X" or "LRT service normal"'
                  value={communityNote}
                  onChange={(e) => setCommunityNote(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-3 text-sm resize-none focus:border-green-500 focus:outline-none"
                  rows={2}
                />
              </div>
            </div>

            <Button
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl text-base"
              onPress={handlePlan}
              isDisabled={!origin || !destination}
            >
              🌱 Analyse My Commute Options
            </Button>
          </CardContent>
        </Card>

        {/* ── Results ── */}
        {plan && (
          <div id="results-section" className="space-y-6">
            {/* Safety alerts */}
            {plan.safetyAlerts.length > 0 && (
              <div className="space-y-2">
                {plan.safetyAlerts.map((alert) => (
                  <div key={alert} className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
                    <span className="text-lg leading-none">⚠️</span>
                    <span>{alert}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-2 border-b border-gray-200">
              {(["options", "details", "enterprise"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab
                      ? "border-green-600 text-green-700"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {tab === "options"     ? "📊 Commute Options"     : null}
                  {tab === "details"     ? "🔍 Analysis Details"    : null}
                  {tab === "enterprise"  ? "🏢 Enterprise Impact"   : null}
                </button>
              ))}
            </div>

            {/* ── TAB: Commute Options ── */}
            {activeTab === "options" && (
              <div className="space-y-5">
                {/* AI Recommendation banner */}
                <Card className="border-2 border-green-400 bg-green-50 shadow-sm">
                  <CardContent className="pt-6 space-y-4">
                    <div>
                      <p className="text-xs text-green-600 uppercase font-semibold tracking-wide mb-1">
                        🤖 Recommendation — based on your preferences
                      </p>
                      <h3 className="text-3xl font-bold text-green-800">
                        {plan.recommended.emoji} {plan.recommended.label}
                      </h3>
                      <p className="text-sm text-green-700 mt-1">
                        {origin} → {destination} • {distance} km
                        {departureTime && ` • Depart ${departureTime}`}
                      </p>
                    </div>

                    {/* AI reasoning */}
                    <div className="bg-white rounded-xl p-4 border border-green-200 text-sm text-gray-700 leading-relaxed">
                      <p className="font-semibold text-gray-800 mb-1">💡 Why this recommendation:</p>
                      <p>{plan.reasoning}</p>
                    </div>

                    {/* Trade-off notes */}
                    {plan.tradeOffNotes.length > 0 && (
                      <div className="space-y-1">
                        {plan.tradeOffNotes.map((note) => (
                          <p key={note} className="text-sm text-blue-700 bg-blue-50 rounded-lg px-3 py-2">
                            ℹ️ {note}
                          </p>
                        ))}
                      </div>
                    )}

                    {/* Key stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                      {[
                        { label: "Est. travel time",  value: `~${plan.recommended.estimatedMinutes} min` },
                        { label: "CO₂ this trip",     value: `${plan.recommended.co2PerTrip}g`           },
                        { label: "Annual CO₂",        value: `${plan.recommended.co2Annual} kg`           },
                        { label: "Annual saving",     value: `${Math.round((plan.soloCarCo2Annual - plan.recommended.co2Annual))} kg` },
                      ].map((s) => (
                        <div key={s.label} className="bg-white rounded-lg p-3 shadow-sm border border-green-100">
                          <p className="text-xs text-gray-500">{s.label}</p>
                          <p className="text-lg font-bold text-green-700">{s.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Community note */}
                    {communityNote && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                        📢 Community report: {communityNote}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Option cards — side by side */}
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-3">📋 All Options Compared</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {plan.modes.sort((a, b) => b.score - a.score).map((m) => (
                      <OptionCard
                        key={m.key}
                        mode={m}
                        isRecommended={m.key === plan.recommended.key}
                        isAlternative={plan.alternative !== null && m.key === plan.alternative.key}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-3">
                    * Travel time estimates based on typical speeds. CO₂ based on IPCC AR6 / IEA 2023 data.{" "}
                    <span className="font-medium">All figures are indicative estimates, not real-time data.</span>
                  </p>
                </div>

                {/* Weekly planner trigger */}
                <Card className="border border-green-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-green-800 text-base">📅 Plan Your Week</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-gray-600">Set per-day conditions to get a personalised Mon–Fri recommendation.</p>
                    <div className="space-y-3">
                      {DAYS.map((day) => (
                        <div key={day} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end bg-gray-50 rounded-xl p-3">
                          <div className="font-medium text-sm text-gray-700 pt-1">{day}</div>
                          <ConditionSelect label="Weather"  value={dayConditions[day].weather}  onChange={(v) => updateDayCondition(day, "weather",  v)} options={weatherOptions}  />
                          <ConditionSelect label="Traffic"  value={dayConditions[day].traffic}  onChange={(v) => updateDayCondition(day, "traffic",  v)} options={trafficOptions}  />
                          <ConditionSelect label="Flooding" value={dayConditions[day].flooding} onChange={(v) => updateDayCondition(day, "flooding", v)} options={floodingOptions} />
                        </div>
                      ))}
                    </div>
                    <Button
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl text-base"
                      onPress={handleWeeklyPlan}
                    >
                      📅 Generate Weekly Plan
                    </Button>
                  </CardContent>
                </Card>

                {/* Weekly plan results */}
                {showWeekly && weeklyPlan && (
                  <Card className="border border-green-200 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-green-800">🗓️ Your Weekly Commute Plan</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {weeklyPlan.map(({ day, plan: dp }) => (
                        <div key={day} className="flex flex-col md:flex-row md:items-start gap-3 bg-gray-50 rounded-xl p-4">
                          <div className="min-w-[90px] font-semibold text-gray-700">{day}</div>
                          <div className="text-2xl">{dp.recommended.emoji}</div>
                          <div className="flex-1 space-y-1">
                            <p className="font-semibold text-gray-800">{dp.recommended.label}</p>
                            <p className="text-xs text-gray-500 leading-relaxed">{dp.reasoning}</p>
                            {dp.safetyAlerts.map((a) => (
                              <p key={a} className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">{a}</p>
                            ))}
                          </div>
                          <div className="text-right text-xs text-gray-500 min-w-[100px]">
                            <p className="font-medium text-green-700">~{dp.recommended.estimatedMinutes} min</p>
                            <p className="font-medium text-green-600">{dp.recommended.co2PerTrip}g CO₂</p>
                            <p>{dp.recommended.savingsPct}% saved</p>
                          </div>
                        </div>
                      ))}

                      {/* Weekly CO₂ totals */}
                      {(() => {
                        const totalWeekly = weeklyPlan.reduce((s, { plan: dp }) => s + dp.recommended.co2Weekly / 5, 0);
                        const totalSolo   = weeklyPlan.reduce((s, { plan: dp }) => s + dp.soloCarCo2Weekly / 5, 0);
                        const saving      = Math.round(totalSolo - totalWeekly);
                        return (
                          <div className="grid grid-cols-3 gap-3 mt-4 text-center">
                            {[
                              { label: "Weekly CO₂ (plan)",    value: `${Math.round(totalWeekly).toLocaleString()}g` },
                              { label: "Weekly CO₂ (driving)", value: `${Math.round(totalSolo).toLocaleString()}g`   },
                              { label: "Weekly saving",         value: `${saving.toLocaleString()}g`                },
                            ].map((s) => (
                              <div key={s.label} className="bg-white rounded-xl p-3 border border-green-100">
                                <p className="text-xs text-gray-500">{s.label}</p>
                                <p className="text-lg font-bold text-green-700">{s.value}</p>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* ── TAB: Analysis Details ── */}
            {activeTab === "details" && (
              <div className="space-y-5">
                {/* Conditions that influenced the recommendation */}
                <Card className="border border-gray-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-gray-800 text-base">🔍 Conditions Considered</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2 text-sm mb-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        weather === "heavy-rain" ? "bg-blue-100 text-blue-800" :
                        weather === "light-rain" ? "bg-sky-100 text-sky-800" :
                        "bg-green-100 text-green-800"
                      }`}>
                        {weather === "heavy-rain" ? "🌧️ Heavy Rain" : weather === "light-rain" ? "🌦️ Light Rain" : "☀️ Normal Weather"}
                      </span>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        traffic === "heavy" ? "bg-orange-100 text-orange-800" : "bg-green-100 text-green-800"
                      }`}>
                        {traffic === "heavy" ? "🚦 Heavy Traffic" : "🟢 Normal Traffic"}
                      </span>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        flooding === "reported" ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"
                      }`}>
                        {flooding === "reported" ? "🌊 Flooding Reported" : "✅ No Flooding"}
                      </span>
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                        📏 {distance} km
                      </span>
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                        🎯 Max {maxTravelMinutes} min
                      </span>
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                        🚶 Max {maxWalkingMinutes} min walking
                      </span>
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        {sustainabilityPref === "eco-priority" ? "🌱 Eco-first" : sustainabilityPref === "time-priority" ? "⚡ Time-first" : "⚖️ Balanced"}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* Full modes comparison table */}
                <Card className="border border-green-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-green-800">📊 Detailed Scoring Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left py-3 px-2 font-medium text-gray-600">Mode</th>
                            <th className="text-left py-3 px-2 font-medium text-gray-600">Score</th>
                            <th className="text-left py-3 px-2 font-medium text-gray-600">Est. time</th>
                            <th className="text-left py-3 px-2 font-medium text-gray-600">CO₂/week</th>
                            <th className="text-left py-3 px-2 font-medium text-gray-600">CO₂/year</th>
                            <th className="text-left py-3 px-2 font-medium text-gray-600">vs. Driving</th>
                            <th className="text-left py-3 px-2 font-medium text-gray-600">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {plan.modes.sort((a, b) => b.score - a.score).map((m) => (
                            <tr key={m.key} className={`border-b border-gray-100 ${m.key === plan.recommended.key ? "bg-green-50" : ""}`}>
                              <td className="py-3 px-2">
                                <div className="flex items-center gap-2">
                                  <span>{m.emoji}</span>
                                  <span className={m.key === plan.recommended.key ? "font-bold text-green-700" : ""}>{m.label}</span>
                                  {m.key === plan.recommended.key && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Best fit</span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-2">
                                {m.eligible ? <ScoreDot score={m.score} /> : <span className="text-gray-400 text-xs">—</span>}
                              </td>
                              <td className="py-3 px-2">
                                <span className={`text-xs ${!m.withinTimeLimit && m.eligible ? "text-orange-600 font-medium" : ""}`}>
                                  {m.eligible ? `~${m.estimatedMinutes} min` : "—"}
                                </span>
                              </td>
                              <td className="py-3 px-2">
                                <span className={!m.eligible ? "text-gray-300 line-through" : ""}>{m.co2Weekly.toLocaleString()}g</span>
                              </td>
                              <td className="py-3 px-2">
                                <span className={!m.eligible ? "text-gray-300 line-through" : ""}>{m.co2Annual} kg</span>
                              </td>
                              <td className="py-3 px-2">
                                {m.key === "solo-car" ? (
                                  <span className="text-gray-400 text-xs">baseline</span>
                                ) : m.eligible ? (
                                  <div className="flex items-center gap-2">
                                    <div className="w-16 bg-gray-200 rounded-full h-1.5">
                                      <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${m.savingsPct}%` }} />
                                    </div>
                                    <span className="text-green-700 text-xs font-medium">{m.savingsPct}%</span>
                                  </div>
                                ) : (
                                  <span className="text-gray-400 text-xs">—</span>
                                )}
                              </td>
                              <td className="py-3 px-2">
                                {!m.eligible ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">{m.safetyNote}</span>
                                ) : m.warnings.length > 0 ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">{m.warnings[0]}</span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">✅ Viable</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-gray-400 mt-3">* CO₂ estimates based on IPCC AR6 / IEA 2023 data. Score: 100 = ideal, 0 = excluded. All figures are indicative.</p>

                    {/* Score breakdown for recommended */}
                    <div className="mt-4 bg-gray-50 rounded-xl p-4">
                      <p className="text-xs font-semibold text-gray-600 mb-2">Score breakdown — {plan.recommended.label}:</p>
                      <ul className="text-xs text-gray-500 space-y-0.5">
                        <li>Base score: 100</li>
                        {plan.recommended.scoreBreakdown.map((b) => (
                          <li key={b}>{b}</li>
                        ))}
                        <li className="font-semibold text-green-700">Final score: {plan.recommended.score}</li>
                      </ul>
                    </div>
                  </CardContent>
                </Card>

                {/* CO₂ comparison solo vs recommended */}
                <Card className="border border-green-200 bg-emerald-50 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-green-800">🌍 CO₂ Impact (Indicative Estimates)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {[
                        { label: "🚗 Solo driving",         value: `${plan.soloCarCo2Weekly.toLocaleString()}g/wk`, sub: `${plan.soloCarCo2Annual} kg/yr`, color: "bg-red-50 border-red-200" },
                        { label: `${plan.recommended.emoji} ${plan.recommended.label}`, value: `${plan.recommended.co2Weekly.toLocaleString()}g/wk`, sub: `${plan.recommended.co2Annual} kg/yr`, color: "bg-green-50 border-green-200" },
                        { label: "💚 Estimated saving",     value: `${Math.max(0, plan.soloCarCo2Weekly - plan.recommended.co2Weekly).toLocaleString()}g/wk`, sub: `${Math.max(0, plan.soloCarCo2Annual - plan.recommended.co2Annual)} kg/yr`, color: "bg-blue-50 border-blue-200" },
                      ].map((s) => (
                        <div key={s.label} className={`rounded-xl p-4 border text-center ${s.color}`}>
                          <p className="text-xs font-medium text-gray-600 mb-1">{s.label}</p>
                          <p className="text-xl font-bold text-gray-800">{s.value}</p>
                          <p className="text-xs text-gray-500">{s.sub}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400">Sources: IPCC AR6 WG III (2022), IEA Transport Data (2023). All figures are indicative estimates.</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── TAB: Enterprise Impact ── */}
            {activeTab === "enterprise" && (
              <div className="space-y-5">
                <Card className="border border-purple-200 bg-purple-50 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-purple-800">🏢 Potential Enterprise Impact</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <p className="text-sm text-gray-600">
                      This section illustrates how the same individual decision-support logic could scale to a corporate sustainability programme.{" "}
                      <strong>All figures below are illustrative estimates based on the recommendation above.</strong>{" "}
                      They are not based on real organisational data.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Number of commuters: <span className="font-bold text-purple-700">{enterpriseCommuters.toLocaleString()}</span>
                        </label>
                        <input
                          type="range"
                          min={100} max={10000} step={100}
                          value={enterpriseCommuters}
                          onChange={(e) => setEnterpriseCommuters(Number(e.target.value))}
                          className="w-full accent-purple-600"
                        />
                        <div className="flex justify-between text-xs text-gray-400 mt-1">
                          <span>100</span><span>10,000</span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Days per week switching: <span className="font-bold text-purple-700">{enterpriseDaysPerWeek}</span>
                        </label>
                        <input
                          type="range"
                          min={1} max={5} step={1}
                          value={enterpriseDaysPerWeek}
                          onChange={(e) => setEnterpriseDaysPerWeek(Number(e.target.value))}
                          className="w-full accent-purple-600"
                        />
                        <div className="flex justify-between text-xs text-gray-400 mt-1">
                          <span>1 day</span><span>5 days</span>
                        </div>
                      </div>
                    </div>

                    {enterprise && (
                      <>
                        <div className="bg-white rounded-xl p-4 border border-purple-200 text-sm text-gray-700">
                          <p className="font-medium text-purple-800 mb-1">📊 Scenario summary:</p>
                          <p>
                            If <strong>{enterpriseCommuters.toLocaleString()} employees</strong> switched{" "}
                            <strong>{enterpriseDaysPerWeek} commute day{enterpriseDaysPerWeek > 1 ? "s" : ""}/week</strong>{" "}
                            from solo driving to <strong>{plan.recommended.label}</strong>:
                          </p>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                          {[
                            { label: "Estimated annual reduction",  value: `${enterprise.totalAnnual.toLocaleString()} kg CO₂e`, color: "border-green-300 bg-green-50" },
                            { label: "Monthly reduction",           value: `${enterprise.totalMonthly.toLocaleString()} kg CO₂e`, color: "border-blue-300 bg-blue-50"   },
                            { label: "Equiv. trees planted/yr",     value: `~${enterprise.treesEquiv.toLocaleString()}`,           color: "border-emerald-300 bg-emerald-50" },
                            { label: "Equiv. car trips avoided",    value: `~${enterprise.carTripsEquiv.toLocaleString()}`,         color: "border-purple-300 bg-purple-50"  },
                          ].map((s) => (
                            <div key={s.label} className={`rounded-xl p-4 border text-center ${s.color}`}>
                              <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                              <p className="text-lg font-bold text-gray-800">{s.value}</p>
                            </div>
                          ))}
                        </div>

                        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-xs text-yellow-800">
                          ⚠️ <strong>Simulated data:</strong> These figures are illustrative estimates derived from the IPCC-based CO₂ savings calculated for the route above. They are intended to demonstrate the concept of scaling individual decision support to enterprise sustainability reporting. Real organisational impact would depend on actual commuter data, route mix, and travel patterns.
                        </div>
                      </>
                    )}

                    <div className="border-t border-purple-100 pt-4 space-y-2 text-sm text-gray-600">
                      <p className="font-semibold text-purple-800">🚀 Potential enterprise applications</p>
                      <ul className="list-disc list-inside space-y-1 text-xs text-gray-600 ml-2">
                        <li>Corporate sustainable commuting programmes with personalised recommendations</li>
                        <li>ESG reporting — quantifying employee commute emissions across locations</li>
                        <li>Smart-city mobility planning — aggregate demand forecasting for transit investment</li>
                        <li>Employee transport benefit optimisation — compare shuttle, transit subsidy, and cycling allowances</li>
                        <li>Carbon credit accounting for employee commute behaviour change</li>
                      </ul>
                    </div>
                  </CardContent>
                </Card>

                {/* IBM Bob / Technology story */}
                <Card className="border border-blue-200 bg-blue-50 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-blue-800">🤖 Built with IBM Bob</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-gray-700">
                    <p>
                      This prototype was built using <strong>IBM Bob</strong> as the core development tool — not as a badge, but as an integral part of the design and implementation process.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      {[
                        { title: "Custom Mode", desc: "A 🌿 Commute Planner mode defines Bob's safety-first transport advisor persona and tool permissions" },
                        { title: "Skill", desc: "A SKILL.md encodes all domain knowledge — emission factors, scoring rules, condition handling, recommendation logic" },
                        { title: "Plan Mode", desc: "Used to reason about architecture and scoring priorities before implementation" },
                        { title: "Agent Mode", desc: "Executed file creation, code implementation, and iterative refinement" },
                        { title: "Validation", desc: "TEST_SCENARIOS.md was designed with Bob to validate the scoring engine" },
                        { title: "Documentation", desc: "README and all documentation authored in collaboration with Bob" },
                      ].map((f) => (
                        <div key={f.title} className="bg-white rounded-lg p-3 border border-blue-100">
                          <p className="font-semibold text-blue-800 mb-0.5">{f.title}</p>
                          <p className="text-gray-600">{f.desc}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 pt-1">
                      The application&apos;s scoring engine directly implements the rules defined in the Bob skill — meaning the skill isn&apos;t just documentation, it&apos;s the specification the code was built from.
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Footer */}
            <div className="text-center text-sm text-gray-400 pb-6 space-y-1">
              <p>CO₂ estimates based on IPCC AR6 / IEA 2023 Transport Data. All figures are indicative estimates, not real-time data.</p>
              <p>Built for IBM Bob Mini Hackathon · Powered by <span className="font-medium text-green-600">IBM Bob</span> custom modes &amp; skills</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
