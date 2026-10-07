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
 * Estimate travel time in minutes based on urban traffic speed (~25 km/h)
 */
function estimateTravelTimeMinutes(distanceKm) {
  const averageSpeedKmh = 25; // Urban road average
  const hours = distanceKm / averageSpeedKmh;
  const minutes = Math.max(3, Math.round(hours * 60)); // minimum 3 mins
  return minutes;
}

module.exports = {
  calculateDistance,
  estimateTravelTimeMinutes
};
