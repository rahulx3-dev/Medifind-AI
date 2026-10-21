/**
 * MediFind AI — Opening Hours Parser (Enhanced)
 *
 * Computes live open/closed status from stored opening hours using IST (Asia/Kolkata).
 * Provides dynamic countdown timers ("Opens at 9:30 AM in 8h 45m" or "Closes at 8:00 PM in 5h 15m")
 * and reservation eligibility enforcement.
 */

const { OPENING_HOURS_TIMEZONE } = require('./pharmacyNetwork');

/**
 * Format minutes since midnight into a clean 12-hour time string (e.g. 570 -> "9:30 AM")
 */
function formatMinutesTo12Hour(totalMinutes) {
  const norm = ((totalMinutes % 1440) + 1440) % 1440;
  let hours = Math.floor(norm / 60);
  const minutes = norm % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const mm = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${hours}:${mm} ${period}`;
}

/**
 * Format a duration in minutes into "Xh Ym"
 */
function formatDuration(mins) {
  if (mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m < 10 ? '0' : ''}${m}m`;
}

/**
 * Parse a 12-hour or 24-hour time string into minutes-since-midnight.
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
      if (hours === 12) hours = 0;
    } else {
      if (hours !== 12) hours += 12;
    }
  }

  return hours * 60 + minutes;
}

/**
 * Get current minutes-since-midnight in IST.
 */
function getCurrentISTMinutes() {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: OPENING_HOURS_TIMEZONE || 'Asia/Kolkata',
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
 * Compute whether a pharmacy is currently open, opening/closing countdown, and reservation eligibility.
 *
 * @param {string} openingHours - e.g. "09:30–20:00" or "8:00 AM - 10:00 PM" or "Open 24 Hours"
 * @param {boolean} isOpenOverride - manual DB override (e.g. emergency closure)
 * @returns {Object} Full status details
 */
function computeOpenStatus(openingHours, isOpenOverride) {
  // 1. Manual override
  if (isOpenOverride === false) {
    return {
      isCurrentlyOpen: false,
      status: 'CLOSED',
      allowsReservations: false,
      note: 'Temporarily closed (manual override)',
      badgeText: 'Temporarily Closed',
      source: 'override'
    };
  }

  if (!openingHours || openingHours === 'CONTACT-NOT-AVAILABLE') {
    return {
      isCurrentlyOpen: null,
      status: 'UNKNOWN',
      allowsReservations: true,
      note: 'Operating hours on file: Not available',
      badgeText: 'Hours Not Available',
      source: 'unknown'
    };
  }

  const normalized = openingHours.trim().toLowerCase();

  // 2. 24-Hour Pharmacy
  if (normalized.includes('24 hour') || normalized.includes('24/7') || normalized.includes('round-the-clock')) {
    return {
      isCurrentlyOpen: true,
      status: 'OPEN',
      allowsReservations: true,
      opensAt: '12:00 AM',
      closesAt: '11:59 PM',
      is24Hours: true,
      note: 'Open 24 Hours (Round-the-clock Care)',
      badgeText: 'Open 24/7',
      source: 'hours'
    };
  }

  if (normalized === 'closed') {
    return {
      isCurrentlyOpen: false,
      status: 'CLOSED',
      allowsReservations: false,
      note: 'Closed',
      badgeText: 'Closed',
      source: 'hours'
    };
  }

  // 3. Parse "H:MM [AM/PM] - H:MM [AM/PM]" (supporting hyphens, colons, en-dashes, em-dashes)
  const rangeMatch = openingHours.match(/(\d{1,2}:\d{2}(?:\s*[AP]M)?)\s*[-–—]\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i);
  if (rangeMatch) {
    const openMins = parseTimeTo24MinutesSinceMidnight(rangeMatch[1]);
    const closeMins = parseTimeTo24MinutesSinceMidnight(rangeMatch[2]);
    const currentMins = getCurrentISTMinutes();

    if (openMins !== null && closeMins !== null && currentMins !== null) {
      const opensAtFormatted = formatMinutesTo12Hour(openMins);
      const closesAtFormatted = formatMinutesTo12Hour(closeMins);

      const isOpen = currentMins >= openMins && currentMins < closeMins;

      if (isOpen) {
        const minsUntilClose = closeMins - currentMins;
        const timeRemainingFormatted = formatDuration(minsUntilClose);
        return {
          isCurrentlyOpen: true,
          status: 'OPEN',
          allowsReservations: true,
          opensAt: opensAtFormatted,
          closesAt: closesAtFormatted,
          nextAction: 'CLOSES',
          targetTime: closesAtFormatted,
          minutesUntilNext: minsUntilClose,
          timeRemainingFormatted,
          timerSeconds: minsUntilClose * 60,
          badgeText: `Open Now • Closes at ${closesAtFormatted} (in ${timeRemainingFormatted})`,
          note: `Open now (${openingHours})`,
          source: 'hours'
        };
      } else {
        // Closed: calculate minutes until next opening
        let minsUntilOpen = 0;
        if (currentMins < openMins) {
          minsUntilOpen = openMins - currentMins;
        } else {
          // After closing today: minutes remaining today + minutes until open tomorrow
          minsUntilOpen = (1440 - currentMins) + openMins;
        }
        const timeRemainingFormatted = formatDuration(minsUntilOpen);

        return {
          isCurrentlyOpen: false,
          status: 'CLOSED',
          allowsReservations: false,
          opensAt: opensAtFormatted,
          closesAt: closesAtFormatted,
          nextAction: 'OPENS',
          targetTime: opensAtFormatted,
          minutesUntilNext: minsUntilOpen,
          timeRemainingFormatted,
          timerSeconds: minsUntilOpen * 60,
          badgeText: `Closed • Opens at ${opensAtFormatted} (in ${timeRemainingFormatted})`,
          note: `Closed now (${openingHours})`,
          source: 'hours'
        };
      }
    }
  }

  // Fallback
  return {
    isCurrentlyOpen: null,
    status: 'UNKNOWN',
    allowsReservations: true,
    note: `Hours on file: ${openingHours}`,
    badgeText: openingHours,
    source: 'unparseable'
  };
}

module.exports = {
  computeOpenStatus,
  formatMinutesTo12Hour,
  formatDuration,
  parseTimeTo24MinutesSinceMidnight,
  getCurrentISTMinutes
};
