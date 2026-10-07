/**
 * MediFind AI — Opening Hours Parser
 *
 * Computes live open/closed status from a stored opening hours string
 * using the current IST (Asia/Kolkata) time.
 *
 * Supported formats:
 *   "8:00 AM - 10:00 PM"
 *   "Open 24 Hours"
 *   "Open 24 Hours (Test Simulation)"
 *   "Closed"
 *   "CONTACT-NOT-AVAILABLE" / unknown
 *
 * Returns:
 *   { isCurrentlyOpen: boolean|null, note: string }
 *   isCurrentlyOpen = null means "cannot determine from stored data"
 */

const { OPENING_HOURS_TIMEZONE } = require('./pharmacyNetwork');

/**
 * Parse a 12-hour or 24-hour time string like "8:00 AM" or "09:30" or "20:00" into minutes-since-midnight.
 * Returns null if unparseable.
 */
function parseTimeTo24MinutesSinceMidnight(timeStr) {
  if (!timeStr) return null;
  const cleaned = timeStr.trim();
  const match = cleaned.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3] ? match[3].toUpperCase() : null;

  if (period) {
    if (period === 'AM') {
      if (hours === 12) hours = 0; // 12 AM → midnight
    } else {
      if (hours !== 12) hours += 12; // PM → 24h
    }
  }

  return hours * 60 + minutes;
}

/**
 * Get current minutes-since-midnight in IST using Intl.DateTimeFormat.
 */
function getCurrentISTMinutes() {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: OPENING_HOURS_TIMEZONE,
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    });
    const parts = formatter.formatToParts(now);
    const hourPart = parts.find(p => p.type === 'hour');
    const minutePart = parts.find(p => p.type === 'minute');
    const dayPeriodPart = parts.find(p => p.type === 'dayPeriod');

    if (!hourPart || !minutePart || !dayPeriodPart) return null;

    let hours = parseInt(hourPart.value, 10);
    const minutes = parseInt(minutePart.value, 10);
    const period = dayPeriodPart.value.toUpperCase();

    if (period === 'AM') {
      if (hours === 12) hours = 0;
    } else {
      if (hours !== 12) hours += 12;
    }

    return hours * 60 + minutes;
  } catch {
    return null;
  }
}

/**
 * Compute whether a pharmacy is currently open.
 *
 * @param {string} openingHours - e.g. "8:00 AM - 10:00 PM" or "Open 24 Hours"
 * @param {boolean} isOpenOverride - manual DB override (e.g. emergency closure)
 * @returns {{ isCurrentlyOpen: boolean|null, note: string, source: string }}
 */
function computeOpenStatus(openingHours, isOpenOverride) {
  // If manual override explicitly closes the pharmacy, respect it immediately
  if (isOpenOverride === false) {
    return {
      isCurrentlyOpen: false,
      note: 'Temporarily closed (manual override)',
      source: 'override'
    };
  }

  if (!openingHours || openingHours === 'CONTACT-NOT-AVAILABLE') {
    return {
      isCurrentlyOpen: null,
      note: 'Opening hours not available',
      source: 'unknown'
    };
  }

  const normalized = openingHours.trim().toLowerCase();

  // 24-hour pharmacy
  if (normalized.includes('24 hour') || normalized.includes('24/7') || normalized.includes('round-the-clock')) {
    return {
      isCurrentlyOpen: true,
      note: 'Open 24 Hours',
      source: 'hours'
    };
  }

  if (normalized === 'closed') {
    return {
      isCurrentlyOpen: false,
      note: 'Closed',
      source: 'hours'
    };
  }

  // Try to parse "H:MM [AM/PM] - H:MM [AM/PM]" (supporting hyphens and en-dashes)
  const rangeMatch = openingHours.match(/(\d{1,2}:\d{2}(?:\s*[AP]M)?)\s*[-–—]\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i);
  if (rangeMatch) {
    const openMins = parseTimeTo24MinutesSinceMidnight(rangeMatch[1]);
    const closeMins = parseTimeTo24MinutesSinceMidnight(rangeMatch[2]);
    const currentMins = getCurrentISTMinutes();

    if (openMins !== null && closeMins !== null && currentMins !== null) {
      const isOpen = currentMins >= openMins && currentMins < closeMins;
      return {
        isCurrentlyOpen: isOpen,
        note: isOpen ? `Open now (${openingHours})` : `Closed now (${openingHours})`,
        source: 'hours'
      };
    }
  }

  // Fallback: cannot parse
  return {
    isCurrentlyOpen: null,
    note: `Hours on file: ${openingHours}`,
    source: 'unparseable'
  };
}

module.exports = { computeOpenStatus };
