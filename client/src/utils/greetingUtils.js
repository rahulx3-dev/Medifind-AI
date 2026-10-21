import { useState, useEffect } from 'react';

/**
 * Resolves the cleanest, most accurate user profile name across portals.
 * Checks saved local storage profile (from UserProfile.jsx edits) as well as AuthContext user.
 * Strips dev artifact markers such as "[TEST ACCOUNT]".
 */
export function getResolvedUserName(user, defaultRole = 'PATIENT') {
  let resolvedName = '';
  const currentRole = user?.role || defaultRole;

  // 1. Check local storage profile customized in UserProfile.jsx
  try {
    const keysToCheck = [
      user?.id ? `medifind_user_profile_${user.id}` : null,
      `medifind_user_profile_${currentRole}`,
      `medifind_user_profile_${defaultRole}`
    ].filter(Boolean);

    for (const key of keysToCheck) {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.name && typeof parsed.name === 'string' && parsed.name.trim().length > 0) {
          resolvedName = parsed.name.trim();
          break;
        }
      }
    }
  } catch (e) {
    // ignore storage errors
  }

  // 2. If no saved profile name, check user.name or user.fullName
  if (!resolvedName && user) {
    resolvedName = (user.name || user.fullName || '').trim();
  }

  // 3. Clean any test account prefixes or bracketed markers
  if (resolvedName) {
    resolvedName = resolvedName.replace(/\[.*?\]/g, '').trim();
  }

  // 4. Fallback based on role if still empty
  if (!resolvedName) {
    const role = (user?.role || defaultRole).toUpperCase();
    if (role === 'ADMIN') resolvedName = 'Administrator';
    else if (role === 'PHARMACIST') resolvedName = 'Pharmacist';
    else if (role === 'ASSISTANT') resolvedName = 'Assistant';
    else resolvedName = 'Guest';
  }

  // Extract first name for warm greetings
  const parts = resolvedName.split(' ').filter(Boolean);
  const firstName = parts[0] || resolvedName;

  return {
    fullName: resolvedName,
    firstName
  };
}

/**
 * Calculates current time of day greeting based on local clock.
 */
export function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) {
    return {
      timeGreet: 'Good morning',
      icon: 'light_mode',
      period: 'morning'
    };
  }
  if (hour >= 12 && hour < 17) {
    return {
      timeGreet: 'Good afternoon',
      icon: 'wb_sunny',
      period: 'afternoon'
    };
  }
  return {
    timeGreet: 'Good evening',
    icon: 'dark_mode',
    period: 'evening'
  };
}

/**
 * Reactive React hook that listens to profile updates and window storage events,
 * automatically keeping greeting names in sync across all open tabs and portal views.
 */
export function usePortalGreeting(user, role = 'PATIENT') {
  const [greetingData, setGreetingData] = useState(() => {
    const { fullName, firstName } = getResolvedUserName(user, role);
    const { timeGreet, icon, period } = getTimeGreeting();
    return { fullName, firstName, timeGreet, icon, period };
  });

  useEffect(() => {
    const update = () => {
      const { fullName, firstName } = getResolvedUserName(user, role);
      const { timeGreet, icon, period } = getTimeGreeting();
      setGreetingData({ fullName, firstName, timeGreet, icon, period });
    };

    update();

    window.addEventListener('medifind_profile_updated', update);
    window.addEventListener('storage', update);

    // Refresh every minute to transition morning -> afternoon -> evening seamlessly
    const interval = setInterval(update, 60000);

    return () => {
      window.removeEventListener('medifind_profile_updated', update);
      window.removeEventListener('storage', update);
      clearInterval(interval);
    };
  }, [user, role]);

  return greetingData;
}
