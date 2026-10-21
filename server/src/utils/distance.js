/**
 * Distance Calculation Utility using the Haversine Formula
 * Calculates great-circle distance between two points on the Earth's surface in kilometers.
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) {
    return 999.9;
  }

  const R = 6371; // Earth's radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;

  // Return rounded to 2 decimal places
  return Number(d.toFixed(2));
}

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Approximate GPS coordinates for Kerala towns and localities across the primary operating region
 */
const KERALA_TOWN_COORDINATES = {
  'chengannur': { lat: 9.3170, lon: 76.6145, town: 'Chengannur', district: 'Alappuzha' },
  'kallissery': { lat: 9.3250, lon: 76.6200, town: 'Kallissery', district: 'Alappuzha' },
  'pandanad': { lat: 9.3320, lon: 76.5980, town: 'Pandanad', district: 'Alappuzha' },
  'budhanoor': { lat: 9.3080, lon: 76.5620, town: 'Budhanoor', district: 'Alappuzha' },
  'ala': { lat: 9.3020, lon: 76.6180, town: 'Ala', district: 'Alappuzha' },
  'mannar': { lat: 9.3120, lon: 76.5380, town: 'Mannar', district: 'Alappuzha' },
  'mavelikara': { lat: 9.2650, lon: 76.5510, town: 'Mavelikara', district: 'Alappuzha' },
  'mavelikkara': { lat: 9.2650, lon: 76.5510, town: 'Mavelikara', district: 'Alappuzha' },
  'haripad': { lat: 9.2350, lon: 76.4700, town: 'Haripad', district: 'Alappuzha' },
  'kayamkulam': { lat: 9.1720, lon: 76.5000, town: 'Kayamkulam', district: 'Alappuzha' },
  'thiruvalla': { lat: 9.3830, lon: 76.5740, town: 'Thiruvalla', district: 'Pathanamthitta' },
  'kozhencherry': { lat: 9.3410, lon: 76.7110, town: 'Kozhencherry', district: 'Pathanamthitta' },
  'aranmula': { lat: 9.3070, lon: 76.6850, town: 'Aranmula', district: 'Pathanamthitta' },
  'adoor': { lat: 9.1530, lon: 76.7330, town: 'Adoor', district: 'Pathanamthitta' },
  'alappuzha': { lat: 9.4981, lon: 76.3388, town: 'Alappuzha', district: 'Alappuzha' },
  'kottayam': { lat: 9.5916, lon: 76.5222, town: 'Kottayam', district: 'Kottayam' },
  'changanassery': { lat: 9.4440, lon: 76.5390, town: 'Changanassery', district: 'Kottayam' }
};

/**
 * Resolves GPS coordinates from explicit numbers or text description / town name
 */
function resolveCoordinates(lat, lon, textLocation) {
  const pLat = parseFloat(lat);
  const pLon = parseFloat(lon);
  if (!isNaN(pLat) && !isNaN(pLon) && Math.abs(pLat) <= 90 && Math.abs(pLon) <= 180) {
    return { lat: pLat, lon: pLon, source: 'EXPLICIT_COORDS' };
  }

  if (textLocation && typeof textLocation === 'string') {
    const clean = textLocation.toLowerCase();
    for (const [key, coords] of Object.entries(KERALA_TOWN_COORDINATES)) {
      if (clean.includes(key)) {
        return { lat: coords.lat, lon: coords.lon, source: `GEOCODED_${key.toUpperCase()}`, town: coords.town };
      }
    }
  }

  // Fallback to central hub (Chengannur)
  return { lat: 9.3170, lon: 76.6145, source: 'DEFAULT_HUB', town: 'Chengannur' };
}

/**
 * Estimates transit travel time in minutes based on distance in kilometers
 * Default average road speed: 30 km/h (standard for Kerala two-wheeler urban relay)
 */
function estimateTravelTimeMinutes(distanceKm, speedKmh = 30) {
  if (typeof distanceKm !== 'number' || isNaN(distanceKm) || distanceKm <= 0) return 10;
  const hours = distanceKm / speedKmh;
  const minutes = Math.round(hours * 60);
  return Math.max(5, minutes);
}


module.exports = {
  calculateDistance,
  estimateTravelTimeMinutes,
  KERALA_TOWN_COORDINATES,
  resolveCoordinates
};
