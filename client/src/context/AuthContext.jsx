import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('medifind_token') || null);
  const [loading, setLoading] = useState(true);

  // Validate existing token with backend on mount
  useEffect(() => {
    async function loadUser() {
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && data.user) {
          setUser(data.user);
        } else {
          // Token is invalid or expired: clear session
          localStorage.removeItem('medifind_token');
          setToken(null);
          setUser(null);
        }
      } catch (err) {
        console.error('Session validation error:', err);
        // On connection failure, do not falsely authenticate
        localStorage.removeItem('medifind_token');
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    }

    loadUser();
  }, [token]);

  // Real user login (supports email, phone, pharmacy ID, assistant ID, admin ID)
  async function login(identifier, password, roleHint = null) {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: identifier?.trim(),
          email: identifier?.trim(),
          role: roleHint,
          password
        })
      });
      const data = await res.json();
      if (data.success && data.token) {
        localStorage.setItem('medifind_token', data.token);
        setToken(data.token);
        setUser(data.user);
        return { success: true, user: data.user };
      } else {
        return { success: false, error: data.error || 'Invalid credentials.' };
      }
    } catch (err) {
      console.error('Login network error:', err);
      return { success: false, error: 'Unable to connect to authentication server. Please try again.' };
    }
  }

  // Real user registration (Patient or Assistant account creation)
  async function register({ name, email, phone, password, confirmPassword, role = 'PATIENT' }) {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, password, confirmPassword, role })
      });
      const data = await res.json();
      if (data.success && data.token) {
        localStorage.setItem('medifind_token', data.token);
        setToken(data.token);
        setUser(data.user);
        return { success: true, user: data.user };
      } else {
        return { success: false, error: data.error || 'Registration failed.' };
      }
    } catch (err) {
      console.error('Registration network error:', err);
      return { success: false, error: 'Unable to connect to registration server. Please try again.' };
    }
  }

  // OAuth Sign-In / Sign-Up
  async function oauthLogin({ provider = 'google', email, name, avatarUrl }) {
    try {
      const res = await fetch('/api/auth/oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, email, name, avatarUrl })
      });
      const data = await res.json();
      if (data.success && data.token) {
        localStorage.setItem('medifind_token', data.token);
        setToken(data.token);
        setUser(data.user);
        return { success: true, user: data.user };
      } else {
        return { success: false, error: data.error || `${provider} authentication failed.` };
      }
    } catch (err) {
      console.error('OAuth network error:', err);
      return { success: false, error: `Unable to connect to ${provider} authentication service. Please try again.` };
    }
  }

  // Phone Number + OTP Direct Sign In
  async function loginWithPhone(phone, code) {
    try {
      const res = await fetch('/api/auth/phone-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code })
      });
      const data = await res.json();
      if (data.success && data.token) {
        localStorage.setItem('medifind_token', data.token);
        setToken(data.token);
        setUser(data.user);
        return { success: true, user: data.user };
      } else {
        return { success: false, error: data.error || 'Failed to authenticate phone OTP.' };
      }
    } catch (err) {
      console.error('Phone login error:', err);
      return { success: false, error: 'Unable to connect to authentication server.' };
    }
  }

  // Send OTP
  async function sendOtp(phone) {
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      return await res.json();
    } catch (err) {
      console.error('Send OTP error:', err);
      return { success: false, error: 'Could not send verification code.' };
    }
  }

  // Verify OTP
  async function verifyOtp(phone, code) {
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code })
      });
      return await res.json();
    } catch (err) {
      console.error('Verify OTP error:', err);
      return { success: false, error: 'Could not verify code.' };
    }
  }

  // Initiate Neon Auth Google OAuth
  async function initiateNeonGoogleAuth() {
    const neonAuthUrl = import.meta.env.VITE_NEON_AUTH_URL || 'https://ep-weathered-mouse-a751mmhd.neonauth.ap-southeast-2.aws.neon.tech/neondb/auth';
    try {
      const res = await fetch(`${neonAuthUrl}/sign-in/social`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin
        },
        body: JSON.stringify({
          provider: 'google',
          callbackURL: window.location.origin + '/auth',
          newUserCallbackURL: window.location.origin + '/auth'
        })
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return { redirected: true };
      }
      return { redirected: false, error: data.message || 'OAuth initialization failed' };
    } catch (err) {
      console.warn('Neon Auth Google initiation error, falling back:', err);
      return { redirected: false, error: err.message };
    }
  }

  // Logout action
  function logout() {
    try {
      localStorage.removeItem('medifind_token');
      localStorage.removeItem('medifind_prescription_session');
      sessionStorage.removeItem('medifind_rx_image');
    } catch (err) {
      console.warn('Prescription session logout cleanup warning:', err);
    } finally {
      setToken(null);
      setUser(null);
    }
  }

  return (
    <AuthContext.Provider value={{
      user,
      token,
      loading,
      login,
      register,
      oauthLogin,
      loginWithPhone,
      sendOtp,
      verifyOtp,
      initiateNeonGoogleAuth,
      logout,
      setUser
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

