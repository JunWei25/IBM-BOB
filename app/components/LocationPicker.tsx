"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import L from "leaflet";

// ── Fix default Leaflet marker icons broken by webpack ──────────────────────
const originIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const destinationIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// ── Types ────────────────────────────────────────────────────────────────────
export interface LatLng {
  lat: number;
  lng: number;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface LocationPickerProps {
  origin: string;
  destination: string;
  onOriginChange: (label: string, latlng: LatLng | null) => void;
  onDestinationChange: (label: string, latlng: LatLng | null) => void;
  onDistanceChange: (km: number) => void;
}

// ── Nominatim autocomplete hook ──────────────────────────────────────────────
function useNominatim(query: string) {
  const [results, setResults] = useState<NominatimResult[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.length < 3) {
      setResults([]);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=my`;
        const res = await fetch(url, { headers: { "Accept-Language": "en" } });
        const data: NominatimResult[] = await res.json();
        setResults(data);
      } catch {
        setResults([]);
      }
    }, 350);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  return results;
}

// ── OSRM road-distance helper ────────────────────────────────────────────────
async function fetchRoadDistance(a: LatLng, b: LatLng): Promise<number> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes?.[0]?.distance) {
      return Math.round((data.routes[0].distance / 1000) * 10) / 10; // metres → km, 1dp
    }
  } catch { /* fall through */ }
  // Haversine fallback
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

// ── Map click handler (inner component, must be inside MapContainer) ─────────
function MapClickHandler({
  activePin,
  onPinDrop,
}: {
  activePin: "origin" | "destination" | null;
  onPinDrop: (which: "origin" | "destination", latlng: LatLng) => void;
}) {
  useMapEvents({
    click(e) {
      if (activePin) {
        onPinDrop(activePin, { lat: e.latlng.lat, lng: e.latlng.lng });
      }
    },
  });
  return null;
}

// ── Autocomplete input ────────────────────────────────────────────────────────
function AutocompleteInput({
  label,
  value,
  placeholder,
  onChange,
  onSelect,
  color,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onSelect: (display: string, latlng: LatLng) => void;
  color: "green" | "red";
}) {
  const results = useNominatim(value);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const borderColor = color === "green" ? "border-green-400 focus:border-green-600" : "border-red-400 focus:border-red-600";
  const dotColor    = color === "green" ? "bg-green-500" : "bg-red-500";

  return (
    <div ref={containerRef} className="relative">
      <label className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${dotColor}`} />
        {label}
      </label>
      <input
        type="text"
        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none ${borderColor} bg-white`}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-[9999] left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto text-sm">
          {results.map((r) => (
            <li
              key={r.place_id}
              className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-gray-700 border-b border-gray-100 last:border-0"
              onMouseDown={() => {
                onSelect(r.display_name, { lat: parseFloat(r.lat), lng: parseFloat(r.lon) });
                setOpen(false);
              }}
            >
              {r.display_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LocationPicker({
  origin,
  destination,
  onOriginChange,
  onDestinationChange,
  onDistanceChange,
}: LocationPickerProps) {
  const [originLatLng,      setOriginLatLng]      = useState<LatLng | null>(null);
  const [destinationLatLng, setDestinationLatLng] = useState<LatLng | null>(null);
  const [activePin,         setActivePin]         = useState<"origin" | "destination" | null>(null);
  const [distanceLabel,     setDistanceLabel]     = useState<string>("");

  // Recalculate distance whenever both pins are set
  useEffect(() => {
    if (!originLatLng || !destinationLatLng) { setDistanceLabel(""); return; }
    fetchRoadDistance(originLatLng, destinationLatLng).then((km) => {
      const clamped = Math.min(Math.max(Math.round(km), 1), 80);
      onDistanceChange(clamped);
      setDistanceLabel(`${km} km (road)`);
    });
  }, [originLatLng, destinationLatLng, onDistanceChange]);

  // Reverse geocode a dropped pin → human readable label
  const reverseGeocode = useCallback(async (latlng: LatLng): Promise<string> => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${latlng.lat}&lon=${latlng.lng}&format=json`;
      const res = await fetch(url, { headers: { "Accept-Language": "en" } });
      const data = await res.json();
      return data.display_name ?? `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
    } catch {
      return `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
    }
  }, []);

  async function handlePinDrop(which: "origin" | "destination", latlng: LatLng) {
    const label = await reverseGeocode(latlng);
    if (which === "origin") {
      setOriginLatLng(latlng);
      onOriginChange(label, latlng);
    } else {
      setDestinationLatLng(latlng);
      onDestinationChange(label, latlng);
    }
    setActivePin(null);
  }

  function handleOriginSelect(display: string, latlng: LatLng) {
    setOriginLatLng(latlng);
    onOriginChange(display, latlng);
  }

  function handleDestinationSelect(display: string, latlng: LatLng) {
    setDestinationLatLng(latlng);
    onDestinationChange(display, latlng);
  }

  // Default map centre: Kuala Lumpur
  const mapCenter: [number, number] = [3.139, 101.6869];

  return (
    <div className="space-y-4">
      {/* Autocomplete inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AutocompleteInput
          label="Origin"
          value={origin}
          placeholder="Search or click map…"
          onChange={(v) => onOriginChange(v, null)}
          onSelect={handleOriginSelect}
          color="green"
        />
        <AutocompleteInput
          label="Destination"
          value={destination}
          placeholder="Search or click map…"
          onChange={(v) => onDestinationChange(v, null)}
          onSelect={handleDestinationSelect}
          color="red"
        />
      </div>

      {/* Pin-drop toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-500">Or drop a pin:</span>
        <button
          type="button"
          onClick={() => setActivePin(activePin === "origin" ? null : "origin")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            activePin === "origin"
              ? "bg-green-600 text-white border-green-600"
              : "bg-white text-green-700 border-green-400 hover:bg-green-50"
          }`}
        >
          🟢 {activePin === "origin" ? "Click on map…" : "Set Origin"}
        </button>
        <button
          type="button"
          onClick={() => setActivePin(activePin === "destination" ? null : "destination")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            activePin === "destination"
              ? "bg-red-600 text-white border-red-600"
              : "bg-white text-red-700 border-red-400 hover:bg-red-50"
          }`}
        >
          🔴 {activePin === "destination" ? "Click on map…" : "Set Destination"}
        </button>
        {distanceLabel && (
          <span className="ml-auto text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-full">
            📏 {distanceLabel}
          </span>
        )}
      </div>

      {/* Map */}
      <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm" style={{ height: 320 }}>
        <MapContainer
          center={mapCenter}
          zoom={11}
          style={{ height: "100%", width: "100%" }}
          className={activePin ? "cursor-crosshair" : ""}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapClickHandler activePin={activePin} onPinDrop={handlePinDrop} />
          {originLatLng && (
            <Marker position={[originLatLng.lat, originLatLng.lng]} icon={originIcon} draggable
              eventHandlers={{ dragend(e) { handlePinDrop("origin", { lat: e.target.getLatLng().lat, lng: e.target.getLatLng().lng }); } }}
            >
              <Popup>🟢 Origin</Popup>
            </Marker>
          )}
          {destinationLatLng && (
            <Marker position={[destinationLatLng.lat, destinationLatLng.lng]} icon={destinationIcon} draggable
              eventHandlers={{ dragend(e) { handlePinDrop("destination", { lat: e.target.getLatLng().lat, lng: e.target.getLatLng().lng }); } }}
            >
              <Popup>🔴 Destination</Popup>
            </Marker>
          )}
        </MapContainer>
      </div>

      <p className="text-xs text-gray-400">
        Tip: use the search boxes for autocomplete, or click &ldquo;Set Origin / Destination&rdquo; then click anywhere on the map.
        Drag markers to adjust. Distance is calculated via road routing (OSRM).
      </p>
    </div>
  );
}
