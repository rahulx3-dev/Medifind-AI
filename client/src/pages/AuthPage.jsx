import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import MediFindLogo from '../components/MediFindLogo';
import ClinicalSageBackground from '../components/ClinicalSageBackground';

function FloatingPaths({ position = 1 }) {
  const paths = Array.from({ length: 18 }, (_, i) => ({
    id: i,
    d: `M${-200 - i * 15 * position} ${100 + i * 20}C${-100 - i * 10 * position} ${250 - i * 15} ${200 + i * 15 * position} ${150 + i * 20} ${700 + i * 20 * position} ${300 + i * 10}`,
    width: 0.8 + i * 0.05
  }));

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-45 -z-0">
      <svg className="h-full w-full" viewBox="0 0 800 600" fill="none">
        {paths.map((p) => (
          <motion.path
            key={p.id}
            d={p.d}
            stroke="#10b981"
            strokeWidth={p.width}
            strokeOpacity={0.15 + p.id * 0.02}
            initial={{ pathLength: 0.3, opacity: 0.3 }}
            animate={{
              pathLength: [0.3, 1, 0.3],
              opacity: [0.2, 0.6, 0.2]
            }}
            transition={{
              duration: 15 + p.id * 1.5,
              repeat: Infinity,
              ease: 'linear'
            }}
          />
        ))}
      </svg>
    </div>
  );
}

export default function AuthPage({ onLoginSuccess, showBackground = false }) {
  const { login, register, oauthLogin } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' or 'register'

  // Direct OAuth sign-in (no modal — simulates completed OAuth redirect)
  const [oauthLoadingProvider, setOauthLoadingProvider] = useState(null);

  const OAUTH_DEMO_ACCOUNTS = {
    Google: { email: 'rohan.sharma@gmail.com', name: 'Rohan Sharma' },
    Apple:  { email: 'rohan.sharma@icloud.com', name: 'Rohan Sharma' },
    ABHA:   { email: 'abha.90812@healthid.ndhm.gov.in', name: 'Rohan Sharma' },
    Microsoft: { email: 'rohan.sharma@outlook.com', name: 'Rohan Sharma' }
  };

  const handleOAuthSignIn = async (provider) => {
    setOauthLoadingProvider(provider);
    setErrorMessage('');
    const account = OAUTH_DEMO_ACCOUNTS[provider];
    const result = await oauthLogin({
      provider: provider.toLowerCase(),
      email: account.email,
      name: account.name
    });
    setOauthLoadingProvider(null);
    if (result.success) {
      if (onLoginSuccess) onLoginSuccess(result.user.role);
    } else {
      setErrorMessage(result.error || `${provider} sign-in failed. Please try again.`);
    }
  };

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Email history (remembered from previous logins)
  const [savedEmails, setSavedEmails] = useState([]);
  const [emailSuggestions, setEmailSuggestions] = useState([]);
  const [emailDropdownOpen, setEmailDropdownOpen] = useState(false);
  const emailWrapRef = useRef(null);

  // Load saved emails from localStorage on mount
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('mfai_saved_emails') || '[]');
      if (Array.isArray(stored)) setSavedEmails(stored);
    } catch { /* ignore */ }

    // Close dropdown when clicking outside
    const handler = (e) => {
      if (emailWrapRef.current && !emailWrapRef.current.contains(e.target)) {
        setEmailDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Save an email to the remembered list (max 5, most recent first)
  // Saves IMMEDIATELY to localStorage (sync) so it persists even if component unmounts on redirect
  const saveEmailToHistory = (addr) => {
    if (!addr || !addr.includes('@')) return;
    const cleaned = addr.trim().toLowerCase();
    try {
      const prev = JSON.parse(localStorage.getItem('mfai_saved_emails') || '[]');
      const next = [cleaned, ...prev.filter(e => e !== cleaned)].slice(0, 5);
      localStorage.setItem('mfai_saved_emails', JSON.stringify(next));
      setSavedEmails(next);
    } catch { /* ignore */ }
  };

  // Update suggestions as user types — uses includes() for fuzzy mid-string match
  const handleEmailChange = (val) => {
    setEmail(val);
    if (val.trim().length > 0) {
      const q = val.trim().toLowerCase();
      const matches = savedEmails.filter(e => e.includes(q));
      setEmailSuggestions(matches);
      setEmailDropdownOpen(matches.length > 0);
    } else {
      setEmailSuggestions(savedEmails);
      setEmailDropdownOpen(savedEmails.length > 0);
    }
  };

  // UI states
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!email.trim() || !password) {
      setErrorMessage('Please enter both email and password.');
      return;
    }

    setLoading(true);
    // Save email BEFORE login so it persists even if component unmounts on redirect
    saveEmailToHistory(email.trim());
    const result = await login(email.trim(), password);
    setLoading(false);

    if (result.success) {
      if (onLoginSuccess) {
        onLoginSuccess(result.user.role);
      }
    } else {
      setErrorMessage(result.error || 'The email or password does not match our verified patient records.');
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!name.trim() || !email.trim() || !password) {
      setErrorMessage('Please fill in all required fields.');
      return;
    }

    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please re-enter.');
      return;
    }

    setLoading(true);
    const result = await register({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      password,
      confirmPassword
    });
    setLoading(false);

    if (result.success) {
      setSuccessMessage('Patient account created successfully! Signing in...');
      if (onLoginSuccess) {
        onLoginSuccess(result.user.role);
      }
    } else {
      setErrorMessage(result.error || 'Registration failed. Please check your details.');
    }
  };



  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      {/* WebGL Animated Healthcare Shader Background — only in standalone mode */}
      {showBackground && (
        <>
          <ClinicalSageBackground />
          <FloatingPaths position={1} />
          <FloatingPaths position={-1} />
        </>
      )}

      <main className="relative z-10 w-full max-w-7xl mx-auto px-4 py-8 sm:py-12 flex flex-col items-center justify-center">
        <div className="w-full flex flex-col items-center">
          {/* Main Card with Apple-like spring entrance */}
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-[440px] mx-auto flex flex-col items-center"
          >
            <div className="w-full bg-white/95 backdrop-blur-md shadow-2xl border border-emerald-100/70 rounded-2xl sm:rounded-3xl p-6 sm:p-9 flex flex-col">
              {/* Brand Logo & Badging */}
              <div className="flex flex-col items-center text-center mb-6">
                <div className="flex items-center justify-center mb-4">
                  <MediFindLogo size="xl" showText={false} />
                </div>

                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-low border border-surface-container-high text-secondary text-xs font-semibold tracking-wide mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                  <span>{mode === 'login' ? 'Patient Portal' : 'Patient Registration'}</span>
                </div>

                <h1 className="text-2xl sm:text-[26px] font-bold text-primary tracking-tight">
                  {mode === 'login' ? 'Welcome back' : 'Create Patient Account'}
                </h1>
                <p className="text-sm text-on-surface-variant mt-1 max-w-xs leading-relaxed">
                  {mode === 'login'
                    ? 'Access your verified prescriptions, medicine availability, and pharmacy orders.'
                    : 'Sign up to discover verified pharmacy inventory and emergency access.'}
                </p>
              </div>

              {/* Mode Switcher Tabs */}
              <div className="grid grid-cols-2 p-1 rounded-full bg-surface-container mb-5 border border-outline-variant/30">
                <button
                  type="button"
                  id="auth-tab-login"
                  onClick={() => {
                    setMode('login');
                    setErrorMessage('');
                    setSuccessMessage('');
                  }}
                  className={`py-2 rounded-full text-xs font-bold transition-all ${
                    mode === 'login'
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-on-surface-variant hover:text-primary'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  id="auth-tab-register"
                  onClick={() => {
                    setMode('register');
                    setErrorMessage('');
                    setSuccessMessage('');
                  }}
                  className={`py-2 rounded-full text-xs font-bold transition-all ${
                    mode === 'register'
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-on-surface-variant hover:text-primary'
                  }`}
                >
                  Create Account
                </button>
              </div>

              {/* Multi-Provider OAuth — click to sign in directly, no popup */}
              <div className="space-y-2.5 mb-4">
                {/* Primary: Continue with Google */}
                <button
                  className="w-full h-11 sm:h-12 rounded-xl bg-white hover:bg-gray-50 border border-outline-variant hover:border-[#4285F4]/50 text-on-surface font-medium text-sm flex items-center justify-center gap-3 transition-all duration-200 active:scale-[0.99] shadow-sm disabled:opacity-70 disabled:cursor-not-allowed"
                  id="google-signin-btn"
                  type="button"
                  disabled={!!oauthLoadingProvider}
                  onClick={() => handleOAuthSignIn('Google')}
                >
                  {oauthLoadingProvider === 'Google' ? (
                    <>
                      <svg className="animate-spin w-4 h-4 shrink-0 text-[#4285F4]" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" />
                      </svg>
                      <span className="text-sm font-medium text-[#4285F4]">Signing in with Google…</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                        <path d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z" fill="#EA4335" />
                        <path d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5.1 3.7-8.8z" fill="#4285F4" />
                        <path d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15s.7 5.3 1.9 7.7l3.7-2.9z" fill="#FBBC05" />
                        <path d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z" fill="#34A853" />
                      </svg>
                      <span className="text-sm font-medium">Continue with Google</span>
                    </>
                  )}
                </button>

                {/* Secondary row: Apple / ABHA / Microsoft */}
                <div className="grid grid-cols-3 gap-2">
                  {/* Apple */}
                  <button
                    type="button"
                    id="apple-oauth-btn"
                    disabled={!!oauthLoadingProvider}
                    onClick={() => handleOAuthSignIn('Apple')}
                    title="Sign in with Apple"
                    className="h-10 rounded-xl bg-black hover:bg-neutral-800 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-all shadow-xs disabled:opacity-60"
                  >
                    {oauthLoadingProvider === 'Apple' ? (
                      <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 fill-white" viewBox="0 0 170 170">
                        <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.08-7.7-7.94-12.01-14.59-6.3-9.74-11.05-20.91-14.25-33.51-3.2-12.6-4.8-24.32-4.8-35.17 0-14.48 3.52-26.47 10.57-35.98 7.05-9.5 15.86-14.36 26.44-14.58 4.79 0 10.37 1.34 16.74 4.02 6.36 2.68 10.42 4.06 12.16 4.14 1.36 0 5.65-1.47 12.87-4.41 7.22-2.94 13.19-4.22 17.91-3.84 13.43 1.1 23.95 6.42 31.57 15.96-11.91 7.21-17.73 17.1-17.47 29.68.25 9.77 4.02 17.84 11.31 24.21 7.28 6.37 15.73 10.02 25.33 10.96-2.22 6.59-4.78 13.19-7.68 19.8zM119.22 33.64c0-7.39 2.62-14.3 7.86-20.73 5.24-6.43 11.75-10.74 19.53-12.91.43 1.31.65 2.62.65 3.93 0 7.4-2.73 14.39-8.19 20.98-5.46 6.59-12.07 10.77-19.85 12.54-.22-1.31-.33-2.58-.33-3.81z" />
                      </svg>
                    )}
                    <span>Apple</span>
                  </button>

                  {/* ABHA Health ID */}
                  <button
                    type="button"
                    id="abha-oauth-btn"
                    disabled={!!oauthLoadingProvider}
                    onClick={() => handleOAuthSignIn('ABHA')}
                    title="Sign in with ABHA National Health ID"
                    className="h-10 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium flex items-center justify-center gap-1 transition-all shadow-xs disabled:opacity-60"
                  >
                    {oauthLoadingProvider === 'ABHA' ? (
                      <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" />
                      </svg>
                    ) : (
                      <span className="material-symbols-outlined text-[16px]">health_and_safety</span>
                    )}
                    <span>ABHA</span>
                  </button>

                  {/* Microsoft */}
                  <button
                    type="button"
                    id="ms-oauth-btn"
                    disabled={!!oauthLoadingProvider}
                    onClick={() => handleOAuthSignIn('Microsoft')}
                    title="Sign in with Microsoft"
                    className="h-10 rounded-xl bg-[#2f2f2f] hover:bg-[#1a1a1a] text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-all shadow-xs disabled:opacity-60"
                  >
                    {oauthLoadingProvider === 'Microsoft' ? (
                      <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 23 23">
                        <rect x="1" y="1" width="10" height="10" fill="#f25022" />
                        <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
                        <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
                        <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
                      </svg>
                    )}
                    <span>Microsoft</span>
                  </button>
                </div>

                {/* Demo note */}
                <p className="text-center text-[10px] text-on-surface-variant/60 font-medium">
                  Demo mode — signs in instantly as a test patient account
                </p>
              </div>


              {/* Divider */}
              <div className="relative my-4 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-outline-variant/60"></div>
                </div>
                <div className="relative px-3 bg-white text-[11px] font-medium tracking-wider uppercase text-on-surface-variant/70">
                  or continue with email &amp; password
                </div>
              </div>

              {/* Dismissible Error Banner */}
              {errorMessage && (
                <div
                  className="mb-4 p-3 rounded-xl bg-error-container/40 border border-error/25 text-on-error-container flex items-start gap-2.5 animate-in fade-in duration-150"
                  id="credential-error-banner"
                >
                  <span className="material-symbols-outlined text-error text-[20px] shrink-0 mt-0.5">
                    error
                  </span>
                  <div className="flex flex-col flex-1 text-xs">
                    <span className="font-semibold text-error text-xs">Authentication Failed</span>
                    <span className="text-on-surface-variant mt-0.5 leading-snug">
                      {errorMessage}
                    </span>
                  </div>
                  <button
                    onClick={() => setErrorMessage('')}
                    className="text-on-surface-variant/70 hover:text-on-surface transition-colors"
                    type="button"
                    aria-label="Dismiss error"
                  >
                    <span className="material-symbols-outlined text-base">close</span>
                  </button>
                </div>
              )}

              {/* Success Banner */}
              {successMessage && (
                <div className="mb-4 p-3 rounded-xl bg-secondary-container/40 border border-secondary/25 text-on-secondary-container flex items-start gap-2.5 animate-in fade-in duration-150">
                  <span className="material-symbols-outlined text-secondary text-[20px] shrink-0 mt-0.5">
                    check_circle
                  </span>
                  <div className="flex flex-col flex-1 text-xs">
                    <span className="font-bold text-secondary text-xs">Success</span>
                    <span className="text-on-surface mt-0.5 leading-snug">
                      {successMessage}
                    </span>
                  </div>
                </div>
              )}

              {/* LOGIN FORM */}
              {mode === 'login' && (
                <form onSubmit={handleLoginSubmit} className="flex flex-col gap-4" id="patient-login-form" autoComplete="off">
                  {/* Hidden dummy inputs to defeat browser autofill injection */}
                  <input type="text" name="username_fake" style={{ display: 'none' }} readOnly aria-hidden="true" tabIndex="-1" />
                  <input type="password" name="password_fake" style={{ display: 'none' }} readOnly aria-hidden="true" tabIndex="-1" />
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-on-surface flex items-center justify-between px-0.5" htmlFor="login-email">
                      <span>Registered Email</span>
                      <span className="text-[11px] text-on-surface-variant/70 font-normal">Primary or NHS ID</span>
                    </label>
                    <div className="relative flex items-center" ref={emailWrapRef}>
                      <span className="material-symbols-outlined absolute left-3.5 text-on-surface-variant/50 text-[19px] pointer-events-none z-10">
                        mail
                      </span>
                      <input
                        id="login-email"
                        type="email"
                        autoComplete="off"
                        required
                        value={email}
                        onChange={e => handleEmailChange(e.target.value)}
                        onFocus={() => {
                          const q = email.trim().toLowerCase();
                          const matches = q
                            ? savedEmails.filter(e => e.includes(q))
                            : savedEmails;
                          setEmailSuggestions(matches);
                          setEmailDropdownOpen(matches.length > 0);
                        }}
                        onClick={() => {
                          const q = email.trim().toLowerCase();
                          const matches = q
                            ? savedEmails.filter(e => e.includes(q))
                            : savedEmails;
                          setEmailSuggestions(matches);
                          setEmailDropdownOpen(matches.length > 0);
                        }}
                        placeholder="name@example.com"
                        className="w-full h-11 pl-10 pr-10 rounded-xl bg-surface-container-low/40 border border-[#cbe0d7] text-on-surface placeholder:text-on-surface-variant/50 text-sm transition-all duration-200 outline-none focus:bg-white focus:border-secondary focus:ring-2 focus:ring-secondary/15"
                      />
                      {/* History indicator */}
                      {savedEmails.length > 0 && (
                        <button
                          type="button"
                          tabIndex={-1}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            setEmailSuggestions(savedEmails);
                            setEmailDropdownOpen(true);
                          }}
                          className="absolute right-3 text-[#2e685d] hover:text-[#032f28] transition-colors"
                          title="Show saved emails"
                        >
                          <span className="material-symbols-outlined" style={{fontSize:17}}>history</span>
                        </button>
                      )}
                      {/* Email suggestion dropdown */}
                      {emailDropdownOpen && emailSuggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-white rounded-2xl shadow-xl border border-[#d5e6e0] overflow-hidden">
                          <div className="px-3 py-1.5 border-b border-[#e0f2eb] flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[#2e685d]" style={{fontSize:13}}>history</span>
                            <span className="text-[10px] font-bold text-[#717976] uppercase tracking-wider">Recent Emails</span>
                          </div>
                          {emailSuggestions.map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => {
                                setEmail(suggestion);
                                setEmailDropdownOpen(false);
                              }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-sm hover:bg-[#e6f8f1] transition-colors cursor-pointer group"
                            >
                              <span className="material-symbols-outlined text-base text-[#2e685d]">mail</span>
                              <span className="text-[#032f28] font-medium truncate flex-1">{suggestion}</span>
                              <span className="material-symbols-outlined text-[#c0c8c5] group-hover:text-[#2e685d] transition-colors" style={{fontSize:14}}>north_west</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between px-0.5">
                      <label className="text-xs font-semibold text-on-surface" htmlFor="login-password">
                        Password
                      </label>
                    </div>
                    <div className="relative flex items-center">
                      <span className="material-symbols-outlined absolute left-3.5 text-on-surface-variant/50 text-[19px] pointer-events-none">
                        lock
                      </span>
                      <input
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="w-full h-11 pl-10 pr-10 rounded-xl bg-surface-container-low/40 border border-[#cbe0d7] text-on-surface placeholder:text-on-surface-variant/50 text-sm transition-all duration-200 outline-none focus:bg-white focus:border-secondary focus:ring-2 focus:ring-secondary/15"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label="Toggle password visibility"
                        className="absolute right-2.5 h-7 w-7 flex items-center justify-center rounded-lg text-on-surface-variant/70 hover:text-on-surface hover:bg-surface-container-high/40 transition-colors border-none bg-transparent cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          {showPassword ? 'visibility_off' : 'visibility'}
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 px-0.5 pt-0.5">
                    <input
                      id="trust-device"
                      type="checkbox"
                      checked={rememberMe}
                      onChange={e => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded text-secondary border-outline-variant focus:ring-secondary/30 accent-[#1e453e] cursor-pointer"
                    />
                    <label className="text-xs text-on-surface-variant cursor-pointer select-none" htmlFor="trust-device">
                      Remember this device for 30 days
                    </label>
                  </div>

                  {/* Primary CTA button in deep spruce green */}
                  <button
                    id="submit-login-btn"
                    type="submit"
                    disabled={loading}
                    className="relative mt-2 w-full h-11 sm:h-12 rounded-xl bg-[#1e453e] hover:bg-[#15342e] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.99] border-none cursor-pointer"
                  >
                    {loading ? (
                      <span className="flex items-center gap-2 text-white">
                        <svg className="animate-spin h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" fill="currentColor"></path>
                        </svg>
                        <span className="text-xs">Verifying credentials...</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span>Sign In</span>
                        <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                      </span>
                    )}
                  </button>
                </form>
              )}

              {/* REGISTRATION FORM */}
              {mode === 'register' && (
                <form onSubmit={handleRegisterSubmit} className="flex flex-col gap-3.5" id="patient-registration-form" autoComplete="off">
                  {/* Hidden dummy inputs to defeat browser autofill injection */}
                  <input type="text" name="username_fake" style={{ display: 'none' }} readOnly aria-hidden="true" tabIndex="-1" />
                  <input type="password" name="password_fake" style={{ display: 'none' }} readOnly aria-hidden="true" tabIndex="-1" />
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-on-surface px-1" htmlFor="reg-name">
                      Full Legal Name
                    </label>
                    <div className="relative flex items-center">
                      <span className="material-symbols-outlined absolute left-3.5 text-on-surface-variant/50 text-[19px] pointer-events-none">
                        person
                      </span>
                      <input
                        id="reg-name"
                        type="text"
                        autoComplete="off"
                        required
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="John Doe"
                        className="w-full h-11 pl-10 pr-4 rounded-xl bg-surface-container-low/40 border border-[#cbe0d7] text-on-surface placeholder:text-on-surface-variant/50 text-sm transition-all duration-200 outline-none focus:bg-white focus:border-secondary focus:ring-2 focus:ring-secondary/15"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-on-surface px-1" htmlFor="reg-email">
                      Email Address
                    </label>
                    <div className="relative flex items-center">
                      <span className="material-symbols-outlined absolute left-3.5 text-on-surface-variant/50 text-[19px] pointer-events-none">
                        mail
                      </span>
                      <input
                        id="reg-email"
                        type="email"
                        autoComplete="off"
                        required
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="john.doe@example.com"
                        className="w-full h-11 pl-10 pr-4 rounded-xl bg-surface-container-low/40 border border-[#cbe0d7] text-on-surface placeholder:text-on-surface-variant/50 text-sm transition-all duration-200 outline-none focus:bg-white focus:border-secondary focus:ring-2 focus:ring-secondary/15"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-on-surface px-1" htmlFor="reg-phone">
                      Mobile Contact (Optional)
                    </label>
                    <div className="relative flex items-center">
                      <span className="material-symbols-outlined absolute left-3.5 text-on-surface-variant/50 text-[19px] pointer-events-none">
                        phone
                      </span>
                      <input
                        id="reg-phone"
                        type="tel"
                        autoComplete="off"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        placeholder="+91 98765 43210"
                        className="w-full h-11 pl-10 pr-4 rounded-xl bg-surface-container-low/40 border border-[#cbe0d7] text-on-surface placeholder:text-on-surface-variant/50 text-sm transition-all duration-200 outline-none focus:bg-white focus:border-secondary focus:ring-2 focus:ring-secondary/15"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-on-surface px-1" htmlFor="reg-pass">
                        Password (8+ chars)
                      </label>
                      <input
                        id="reg-pass"
                        type="password"
                        autoComplete="new-password"
                        required
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full h-11 px-3.5 rounded-xl bg-surface-container-low/40 border border-[#cbe0d7] text-on-surface text-sm transition-all duration-200 outline-none focus:bg-white focus:border-secondary focus:ring-2 focus:ring-secondary/15"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-on-surface px-1" htmlFor="reg-confirm">
                        Confirm
                      </label>
                      <input
                        id="reg-confirm"
                        type="password"
                        autoComplete="new-password"
                        required
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full h-11 px-3.5 rounded-xl bg-surface-container-low/40 border border-[#cbe0d7] text-on-surface text-sm transition-all duration-200 outline-none focus:bg-white focus:border-secondary focus:ring-2 focus:ring-secondary/15"
                      />
                    </div>
                  </div>

                  <button
                    id="submit-register-btn"
                    type="submit"
                    disabled={loading}
                    className="relative mt-2 w-full h-11 sm:h-12 rounded-xl bg-[#1e453e] hover:bg-[#15342e] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.99] border-none cursor-pointer"
                  >
                    {loading ? (
                      <span className="text-xs">Creating patient account...</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span>Create Patient Account</span>
                        <span className="material-symbols-outlined text-[18px]">person_add</span>
                      </span>
                    )}
                  </button>
                </form>
              )}

              {/* Account Registration Pathway toggle */}
              <div className="mt-5 text-center text-xs text-on-surface-variant">
                {mode === 'login' ? (
                  <>
                    Don't have an account?{' '}
                    <button
                      type="button"
                      onClick={() => setMode('register')}
                      className="font-semibold text-secondary hover:text-primary underline underline-offset-2 ml-1 transition-colors border-none bg-transparent cursor-pointer p-0"
                    >
                      Sign up
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => setMode('login')}
                      className="font-semibold text-secondary hover:text-primary underline underline-offset-2 ml-1 transition-colors border-none bg-transparent cursor-pointer p-0"
                    >
                      Sign in
                    </button>
                  </>
                )}
              </div>

              {/* Security Guarantee Badge */}
              <div className="mt-5 pt-4 border-t border-outline-variant/40 flex items-center justify-center gap-1.5 text-center text-on-surface-variant/80">
                <span className="material-symbols-outlined text-[16px] text-secondary">verified_user</span>
                <span className="text-[11px] font-medium">Role-Based Access Control • Secure PIN Verification</span>
              </div>
            </div>

            {/* Trust Indicators / Social Proof */}
            <div className="mt-5 flex items-center justify-center gap-2.5 text-center">
              <div className="flex items-center -space-x-2 overflow-hidden">
                <div className="w-6 h-6 rounded-full bg-[#2e685d] text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">P1</div>
                <div className="w-6 h-6 rounded-full bg-[#032f28] text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">Dr</div>
                <div className="w-6 h-6 rounded-full bg-[#10b981] text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">P2</div>
              </div>
              <p className="text-xs text-on-surface-variant font-medium">
                Prescription matching &amp; reservation platform
              </p>
            </div>


          </motion.div>
        </div>
      </main>
    </div>
  );
}
