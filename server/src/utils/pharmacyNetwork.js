/**
 * MediFind AI — Pharmacy Network Configuration
 * Region: Chengannur, Kerala, India
 *
 * This module is the single source of truth for geographic defaults,
 * emergency hotlines, and network-level constants.
 *
 * To change the operational region or add approved pharmacies,
 * update this file and the corresponding pharmacy data source.
 * No other code changes are required.
 */

module.exports = {
  // Default map center — Chengannur town center
  DEFAULT_LAT: 9.3200,
  DEFAULT_LON: 76.6160,

  // Human-readable region name shown in the UI
  REGION_NAME: 'Chengannur, Kerala',

  // Maximum pharmacy search radius in km (default when no radius is specified)
  MAX_RANGE_KM: 40,

  // Opening hours timezone for live open/closed computation
  OPENING_HOURS_TIMEZONE: 'Asia/Kolkata',

  /**
   * Emergency hotlines for this region.
   * These are publicly listed national/state/district lines only.
   * No private pharmacy phone numbers are included here.
   */
  EMERGENCY_HOTLINES: [
    {
      label: '112',
      desc: 'National Emergency (Police / Fire / Ambulance)',
      dialable: '112'
    },
    {
      label: '108',
      desc: 'Kerala Ambulance (EMRI — Emergency Medical Response)',
      dialable: '108'
    },
    {
      label: '1056',
      desc: 'Kerala Health Helpline',
      dialable: '1056'
    },
    {
      label: '1800-599-0019',
      desc: 'Ministry of AYUSH Health Helpline (toll-free)',
      dialable: '18005990019'
    }
  ]
};
