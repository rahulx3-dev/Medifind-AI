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

  // Real user login
  async function login(email, password) {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
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

  // Real user registration (Patient account creation)
  async function register({ name, email, phone, password, confirmPassword }) {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, password, confirmPassword })
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

  // Logout action
  function logout() {
    localStorage.removeItem('medifind_token');
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, oauthLogin, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

