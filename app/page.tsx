"use client";

import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, TextArea } from "@heroui/react";

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

// ─── Types ──────────────────────────────────────────────────────────────────
type Weather   = "normal" | "light-rain" | "heavy-rain";
type Traffic   = "normal" | "heavy";
type Flooding  = "none"   | "reported";
type ModeKey   = "solo-car" | "carpool" | "lrt" | "cycling" | "walking";

interface DayConditions {
  weather:  Weather;
  traffic:  Traffic;
  flooding: Flooding;
}

interface ModeResult {
  key:          ModeKey;
  label:        string;
  emoji:        string;
  eligible:     boolean;
  safetyNote:   string;       // blocking reason if ineligible
  warnings:     string[];     // non-blocking cautions
  score:        number;       // 0–100, higher = better
  co2PerTrip:   number;       // grams for one-way trip
  co2Weekly:    number;       // grams per week (return × days)
  co2Annual:    number;       // kg per year
  savingsPct:   number;       // % saved vs solo-car baseline
  scoreBreakdown: string[];   // human-readable scoring steps
}

interface PlanResult {
  modes:        ModeResult[];
  recommended:  ModeResult;
  alternative:  ModeResult | null;
  reasoning:    string;
  safetyAlerts: string[];
  soloCarCo2Weekly: number;
  soloCarCo2Annual: number;
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
  flooding: Flooding
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

  return modes.map(({ key, label, emoji }) => {
    let score = 100;
    let eligible = true;
    let safetyNote = "";
    const warnings: string[] = [];
    const breakdown: string[] = [];

    const baseCo2 = EMISSION_FACTORS[key];

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

    // ── 5. CO₂ bonus ──────────────────────────────────────────────────────
    if (eligible) {
      const co2Factor = baseCo2 / (EMISSION_FACTORS["solo-car"] || 1);
      const co2Bonus = Math.round((1 - co2Factor) * 20); // up to +20
      if (co2Bonus > 0) {
        score += co2Bonus;
        breakdown.push(`+${co2Bonus} lower emissions`);
      }
    }

    score = Math.max(0, Math.min(100, score));

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
    };
  });
}

function buildPlan(
  distanceKm: number,
  weather: Weather,
  traffic: Traffic,
  flooding: Flooding
): PlanResult {
  const modes = scoreModes(distanceKm, weather, traffic, flooding);
  const eligible = modes.filter((m) => m.eligible).sort((a, b) => b.score - a.score);
  const recommended = eligible[0] ?? modes[0];
  const alternative  = eligible[1] ?? null;

  const soloCar = modes.find((m) => m.key === "solo-car")!;

  // ── Build reasoning sentence ──────────────────────────────────────────
  const reasons: string[] = [];
  if (flooding === "reported") reasons.push("flooding rules out cycling and walking");
  if (weather === "heavy-rain") reasons.push("heavy rain reduces suitability of cycling and walking");
  if (weather === "light-rain") reasons.push("light rain slightly reduces comfort for active modes");
  if (traffic === "heavy") reasons.push("heavy traffic makes driving less attractive and raises road emissions");
  if (recommended.key === "lrt" && traffic === "heavy") reasons.push("LRT provides a faster and lower-emission alternative");
  if (recommended.key === "cycling" || recommended.key === "walking") reasons.push("conditions are favourable for zero-emission active travel");
  if (reasons.length === 0) reasons.push("conditions are normal and all modes are viable");

  const reasoning = `${recommended.emoji} ${recommended.label} recommended because ${reasons.join(", ")}.`;

  // ── Safety alerts ─────────────────────────────────────────────────────
  const safetyAlerts: string[] = [];
  if (flooding === "reported") safetyAlerts.push("🌊 Flooding reported — avoid low-lying roads and pedestrian underpasses");
  if (weather === "heavy-rain") safetyAlerts.push("🌧️ Heavy rain — reduce speed if driving, avoid cycling");
  if (traffic === "heavy") safetyAlerts.push("🚦 Heavy traffic — allow extra time for road-based commutes");

  return {
    modes,
    recommended,
    alternative,
    reasoning,
    safetyAlerts,
    soloCarCo2Weekly: soloCar.co2Weekly,
    soloCarCo2Annual: soloCar.co2Annual,
  };
}

// ─── Weekly plan ─────────────────────────────────────────────────────────────
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
type DayName = (typeof DAYS)[number];

function buildWeeklyPlan(
  distanceKm: number,
  dayConditions: Record<DayName, DayConditions>
): { day: DayName; plan: PlanResult }[] {
  return DAYS.map((day) => {
    const { weather, traffic, flooding } = dayConditions[day];
    return { day, plan: buildPlan(distanceKm, weather, traffic, flooding) };
  });
}

// ─── Small UI helpers ────────────────────────────────────────────────────────
function ScoreDot({ score }: { score: number }) {
  const color = score >= 75 ? "bg-green-500" : score >= 50 ? "bg-yellow-400" : "bg-red-400";
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} />
      <span className="text-xs font-medium text-gray-600">{score}</span>
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
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div className="flex gap-1 flex-wrap">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              value === o.value
                ? "bg-green-600 text-white border-green-600"
                : "bg-white text-gray-600 border-gray-300 hover:border-green-400"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
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

  // Results
  const [plan,    setPlan]    = useState<PlanResult | null>(null);
  const [showWeekly, setShowWeekly] = useState(false);

  // Weekly per-day conditions (default all normal)
  const defaultDay: DayConditions = { weather: "normal", traffic: "normal", flooding: "none" };
  const [dayConditions, setDayConditions] = useState<Record<DayName, DayConditions>>({
    Monday: { ...defaultDay }, Tuesday: { ...defaultDay }, Wednesday: { ...defaultDay },
    Thursday: { ...defaultDay }, Friday: { ...defaultDay },
  });
  const [weeklyPlan, setWeeklyPlan] = useState<{ day: DayName; plan: PlanResult }[] | null>(null);

  function handlePlan() {
    const result = buildPlan(distance, weather, traffic, flooding);
    setPlan(result);
    setShowWeekly(false);
    setWeeklyPlan(null);
  }

  function handleWeeklyPlan() {
    const result = buildWeeklyPlan(distance, dayConditions);
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* ── Header ── */}
        <div className="text-center space-y-2 py-6">
          <h1 className="text-4xl font-bold text-green-800">🌿 Sustainable Commute Planner</h1>
          <p className="text-green-700 text-lg">Safety-first, condition-aware commute recommendations</p>
          <div className="flex justify-center gap-2 mt-2 flex-wrap">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">IPCC AR6 Data</span>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Safety-First Scoring</span>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">IBM Bob Hackathon</span>
          </div>
        </div>

        {/* ── Input card ── */}
        <Card className="border border-green-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-green-800">📍 Your Commute</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Origin / Destination */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Origin</label>
                <Input
                  placeholder="e.g. TTDI"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Destination</label>
                <Input
                  placeholder="e.g. KL Sentral"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                />
              </div>
            </div>

            {/* Distance */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">
                Distance (one way): <span className="text-green-700 font-bold">{distance} km</span>
                <span className="text-gray-400 text-xs ml-2">
                  {distance <= WALKING_MAX_KM ? "— walkable" : distance <= CYCLING_MAX_KM ? "— cycleable" : "— transit/car route"}
                </span>
              </p>
              <input
                type="range" min={1} max={80} step={1}
                value={distance}
                onChange={(e) => setDistance(Number(e.target.value))}
                className="w-full accent-green-600"
              />
              <div className="flex justify-between text-xs text-gray-400">
                <span>1 km</span><span>80 km</span>
              </div>
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
              🌱 Plan My Commute
            </Button>
          </CardContent>
        </Card>

        {/* ── Results ── */}
        {plan && (
          <>
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

            {/* Recommendation banner */}
            <Card className="border-2 border-green-400 bg-green-50 shadow-sm">
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div>
                    <p className="text-xs text-green-600 uppercase font-semibold tracking-wide mb-1">✅ Recommended</p>
                    <h3 className="text-3xl font-bold text-green-800">
                      {plan.recommended.emoji} {plan.recommended.label}
                    </h3>
                    <p className="text-sm text-green-700 mt-1">
                      {origin} → {destination} • {distance} km
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center px-4 py-2 rounded-full text-lg font-bold bg-green-100 text-green-800 border border-green-300">
                      {plan.recommended.savingsPct}% less CO₂
                    </span>
                    <p className="text-xs text-gray-500 mt-1">vs. solo driving</p>
                  </div>
                </div>

                {/* Reasoning */}
                <div className="bg-white rounded-xl p-4 border border-green-200 text-sm text-gray-700 leading-relaxed">
                  <span className="font-semibold text-gray-800">Why: </span>{plan.reasoning}
                </div>

                {/* Alternative */}
                {plan.alternative && (
                  <div className="bg-white rounded-xl p-3 border border-gray-200 text-sm text-gray-600 flex items-center gap-3">
                    <span className="text-base">{plan.alternative.emoji}</span>
                    <div>
                      <span className="font-medium text-gray-800">Alternative: {plan.alternative.label}</span>
                      <span className="ml-2 text-gray-500">— score {plan.alternative.score}/100, {plan.alternative.savingsPct}% less CO₂</span>
                    </div>
                  </div>
                )}

                {/* Warnings for recommended mode */}
                {plan.recommended.warnings.length > 0 && (
                  <div className="space-y-1">
                    {plan.recommended.warnings.map((w) => (
                      <p key={w} className="text-sm text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2">{w}</p>
                    ))}
                  </div>
                )}

                {/* CO₂ stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                  {[
                    { label: "CO₂ this trip",   value: `${plan.recommended.co2PerTrip}g`    },
                    { label: "Weekly CO₂",       value: `${plan.recommended.co2Weekly.toLocaleString()}g` },
                    { label: "Annual CO₂",       value: `${plan.recommended.co2Annual} kg`   },
                    { label: "Annual saving",    value: `${Math.round((plan.soloCarCo2Annual - plan.recommended.co2Annual))} kg` },
                  ].map((s) => (
                    <div key={s.label} className="bg-white rounded-lg p-3 shadow-sm">
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

            {/* Conditions that influenced the recommendation */}
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-gray-800 text-base">🔍 Key Conditions Considered</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 text-sm">
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
                </div>
              </CardContent>
            </Card>

            {/* All modes comparison */}
            <Card className="border border-green-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-green-800">📊 All Options Evaluated</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-3 px-2 font-medium text-gray-600">Mode</th>
                        <th className="text-left py-3 px-2 font-medium text-gray-600">Score</th>
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
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Best</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-2">
                            {m.eligible ? <ScoreDot score={m.score} /> : <span className="text-gray-400 text-xs">—</span>}
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
                <p className="text-xs text-gray-400 mt-3">* CO₂ estimates based on IPCC AR6 / IEA 2023 data. Score: 100 = ideal, 0 = excluded.</p>
              </CardContent>
            </Card>

            {/* CO₂ comparison solo vs recommended */}
            <Card className="border border-green-200 bg-emerald-50 shadow-sm">
              <CardHeader>
                <CardTitle className="text-green-800">🌍 CO₂ Impact (Estimates)</CardTitle>
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
              </CardContent>
            </Card>

            {/* Weekly planner */}
            <Card className="border border-green-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-green-800">📅 Generate Weekly Plan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-gray-600">Set per-day conditions to get a personalised plan for each day of the week.</p>

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
                      <div className="text-right text-xs text-gray-500 min-w-[80px]">
                        <p className="font-medium text-green-700">{dp.recommended.co2PerTrip}g CO₂</p>
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
                          { label: "Weekly CO₂ (plan)",   value: `${Math.round(totalWeekly).toLocaleString()}g` },
                          { label: "Weekly CO₂ (driving)", value: `${Math.round(totalSolo).toLocaleString()}g` },
                          { label: "Weekly saving",         value: `${saving.toLocaleString()}g` },
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

            {/* Footer */}
            <div className="text-center text-sm text-gray-400 pb-6 space-y-1">
              <p>CO₂ estimates based on IPCC AR6 / IEA 2023 Transport Data. Figures are indicative.</p>
              <p>Built for IBM Bob Mini Hackathon · Powered by <span className="font-medium text-green-600">IBM Bob</span> custom modes &amp; skills</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
