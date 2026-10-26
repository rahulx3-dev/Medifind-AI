/**
 * MediFind AI — Client-side Opening Hours Parser
 *
 * Computes live open/closed status from stored opening hours using IST (Asia/Kolkata).
 * Ensures reservation hold submission is strictly blocked when the dispensary is closed.
 */

export function formatMinutesTo12Hour(totalMinutes) {
  const norm = ((totalMinutes % 1440) + 1440) % 1440;
  let hours = Math.floor(norm / 60);
  const minutes = norm % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const mm = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${hours}:${mm} ${period}`;
}

export function formatDuration(mins) {
  if (mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m < 10 ? '0' : ''}${m}m`;
}

export function parseTimeTo24MinutesSinceMidnight(timeStr) {
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

export function getCurrentISTMinutes() {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
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
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }
}

export function computeOpenStatus(openingHours, isOpenOverride, is24x7 = false) {
  if (isOpenOverride === false) {
    return {
      isCurrentlyOpen: false,
      status: 'CLOSED',
      allowsReservations: false,
      note: 'Temporarily closed (manual override)',
      badgeText: 'Temporarily Closed',
      opensAt: 'scheduled hours'
    };
  }

  if (is24x7 === true && (!openingHours || openingHours === '24/7' || openingHours.includes('24'))) {
    return {
      isCurrentlyOpen: true,
      status: 'OPEN',
      allowsReservations: true,
      opensAt: '12:00 AM',
      closesAt: '11:59 PM',
      is24Hours: true,
      badgeText: 'Open 24/7',
      note: 'Open 24 Hours'
    };
  }

  if (!openingHours || openingHours === 'CONTACT-NOT-AVAILABLE') {
    return {
      isCurrentlyOpen: true,
      status: 'UNKNOWN',
      allowsReservations: true,
      note: 'Operating hours on file: Not available',
      badgeText: 'Hours Not Available',
      opensAt: '9:30 AM'
    };
  }

  const normalized = openingHours.trim().toLowerCase();

  if (normalized.includes('24 hour') || normalized.includes('24/7') || normalized.includes('round-the-clock')) {
    return {
      isCurrentlyOpen: true,
      status: 'OPEN',
      allowsReservations: true,
      opensAt: '12:00 AM',
      closesAt: '11:59 PM',
      is24Hours: true,
      badgeText: 'Open 24/7',
      note: 'Open 24 Hours'
    };
  }

  if (normalized === 'closed' || normalized.includes('closed today')) {
    return {
      isCurrentlyOpen: false,
      status: 'CLOSED',
      allowsReservations: false,
      isClosedToday: true,
      badgeText: 'Closed Today',
      opensAt: '9:30 AM'
    };
  }

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
          timeRemainingFormatted,
          badgeText: `Open Now • Closes at ${closesAtFormatted} (in ${timeRemainingFormatted})`,
          note: `Open now (${openingHours})`
        };
      } else {
        let minsUntilOpen = 0;
        if (currentMins < openMins) {
          minsUntilOpen = openMins - currentMins;
        } else {
          minsUntilOpen = (1440 - currentMins) + openMins;
        }
        const timeRemainingFormatted = formatDuration(minsUntilOpen);

        return {
          isCurrentlyOpen: false,
          status: 'CLOSED',
          allowsReservations: false,
          opensAt: opensAtFormatted,
          closesAt: closesAtFormatted,
          timeRemainingFormatted,
          badgeText: `Closed • Opens at ${opensAtFormatted} (in ${timeRemainingFormatted})`,
          note: `Closed now (${openingHours})`
        };
      }
    }
  }

  return {
    isCurrentlyOpen: false,
    status: 'UNKNOWN',
    allowsReservations: false,
    badgeText: openingHours,
    opensAt: '9:30 AM'
  };
}
