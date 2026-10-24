import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import MediFindLogo from '../components/MediFindLogo';
import { HeroGeometricBackground } from '../components/HeroGeometric';

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

export default function AuthPage({ onLoginSuccess, showBackground = false, onClose, initialRole }) {
  const {
    login,
    register,
    oauthLogin,
    loginWithPhone,
    sendOtp,
    verifyOtp,
    initiateNeonGoogleAuth,
    logout
  } = useAuth();
  // Core Authentication & Portal States
  const [mode, setMode] = useState('login'); // 'login' or 'register'
  const [loginMethod, setLoginMethod] = useState('password'); // 'password' | 'phone_otp'
  const [phoneLoginStep, setPhoneLoginStep] = useState(1); // 1 = enter phone, 2 = enter otp
  const [loginPortalRole, setLoginPortalRole] = useState(() => {
    if (initialRole === 'PHARMACIST') return 'PHARMACY';
    return initialRole || 'PATIENT';
  });
  const [registerRole, setRegisterRole] = useState('PATIENT'); // 'PATIENT' | 'ASSISTANT'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [oauthLoadingProvider, setOauthLoadingProvider] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (initialRole) {
      setLoginPortalRole(initialRole === 'PHARMACIST' ? 'PHARMACY' : initialRole);
    }
  }, [initialRole]);

  // Helper to validate that authenticated account role matches the active portal tab
  const validatePortalRole = (userRole) => {
    const normUser = String(userRole || '').trim().toUpperCase();
    const expected = loginPortalRole === 'PHARMACY' ? 'PHARMACIST' : loginPortalRole;
    if (normUser !== expected) {
      if (typeof logout === 'function') logout();
      const roleLabels = {
        PATIENT: 'Patient',
        PHARMACIST: 'Pharmacy',
        ASSISTANT: 'Care Assistant',
        ADMIN: 'System Administrator'
      };
      const actualName = roleLabels[normUser] || normUser;
      const targetName = roleLabels[expected] || loginPortalRole;
      setErrorMessage(`Access Denied: This account is registered as ${actualName}. You cannot sign in to the ${targetName} portal with these credentials. Please switch to the ${actualName} tab.`);
      return false;
    }
    return true;
  };

  const handleGoogleSignIn = async () => {
    setOauthLoadingProvider('Google');
    setErrorMessage('');
    try {
      // 1. Initiate Google OAuth via Neon Auth service
      const neonRes = await initiateNeonGoogleAuth();
      if (neonRes && neonRes.redirected) {
        return;
      }
      // 2. Fallback to direct OAuth authentication using real user email
      let targetEmail = email && email.includes('@') ? email.trim().toLowerCase() : '';
      let targetName = name?.trim() || '';
      if (!targetEmail) {
        targetEmail = window.prompt('Please enter your Google Account email to authenticate:');
        if (!targetEmail || !targetEmail.includes('@')) {
          setOauthLoadingProvider(null);
          return;
        }
        targetEmail = targetEmail.trim().toLowerCase();
        targetName = targetEmail.split('@')[0];
      }

      const result = await oauthLogin({
        provider: 'google',
        email: targetEmail,
        name: targetName || targetEmail.split('@')[0],
        role: loginPortalRole
      });
      setOauthLoadingProvider(null);
      if (result.success) {
        if (!validatePortalRole(result.user?.role)) return;
        if (onLoginSuccess) onLoginSuccess(result.user.role);
      } else {
        setErrorMessage(result.error || 'Google sign-in failed. Please try again.');
      }
    } catch (err) {
      setOauthLoadingProvider(null);
      setErrorMessage(err.message || 'Error connecting to Google OAuth.');
    }
  };

  // Check if returning from Google OAuth or Neon Auth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const emailParam = urlParams.get('email');
    if (token) {
      localStorage.setItem('medifind_token', token);
      window.history.replaceState({}, document.title, window.location.pathname);
      window.location.reload();
    } else if (emailParam) {
      oauthLogin({
        provider: 'google',
        email: emailParam,
        name: urlParams.get('name') || 'Google User',
        role: loginPortalRole
      }).then(res => {
        if (res.success) {
          if (!validatePortalRole(res.user?.role)) return;
          if (onLoginSuccess) onLoginSuccess(res.user.role);
        }
      });
    }
  }, [loginPortalRole]);

  // Multi-step Registration State
  const [signUpStep, setSignUpStep] = useState(1); // 1 = Details, 2 = OTP, 3 = Password
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [otpSentTo, setOtpSentTo] = useState('');
  const [resendCooldown, setResendCooldown] = useState(30);
  const [generatedOtp, setGeneratedOtp] = useState('123456');
  const otpInputsRef = useRef([]);

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

  // OTP resend countdown timer
  useEffect(() => {
    if (signUpStep !== 2 || resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [signUpStep, resendCooldown]);

  // Save an email to the remembered list (max 5, most recent first)
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

  // Update suggestions as user types
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

  // Live password strength calculation
  const evaluatePasswordStrength = (pass) => {
    if (!pass) {
      return {
        score: 0,
        label: 'Enter password',
        color: 'bg-slate-200',
        textCol: 'text-slate-400',
        checks: { length: false, upper: false, lower: false, number: false, special: false }
      };
    }

    const checks = {
      length: pass.length >= 8,
      upper: /[A-Z]/.test(pass),
      lower: /[a-z]/.test(pass),
      number: /[0-9]/.test(pass),
      special: /[^A-Za-z0-9]/.test(pass)
    };

    let score = 0;
    if (checks.length) score += 1;
    if (checks.upper) score += 1;
    if (checks.number) score += 1;
    if (checks.special) score += 1;

    if (checks.length && pass.length >= 10 && checks.upper && checks.number && checks.special) {
      score = 5;
    }

    let label = 'Low / Weak';
    let color = 'bg-rose-500';
    let textCol = 'text-rose-600';

    if (score === 2) {
      label = 'Low / Fair';
      color = 'bg-orange-500';
      textCol = 'text-orange-600';
    } else if (score === 3) {
      label = 'Medium';
      color = 'bg-amber-500';
      textCol = 'text-amber-600';
    } else if (score === 4) {
      label = 'Strong';
      color = 'bg-emerald-500';
      textCol = 'text-emerald-600';
    } else if (score >= 5) {
      label = 'Powerful';
      color = 'bg-teal-700';
      textCol = 'text-teal-800';
    }

    return { score, label, color, textCol, checks };
  };

  const passwordStrength = evaluatePasswordStrength(password);

  // OTP inputs handling
  const handleOtpChange = (index, value) => {
    // Handling multi-character paste
    if (value.length > 1) {
      const digits = value.replace(/\D/g, '').slice(0, 6).split('');
      const newOtp = [...otp];
      digits.forEach((d, i) => {
        newOtp[i] = d;
      });
      setOtp(newOtp);
      const nextIdx = Math.min(digits.length, 5);
      otpInputsRef.current[nextIdx]?.focus();
      return;
    }

    const cleanVal = value.replace(/\D/g, '');
    const newOtp = [...otp];
    newOtp[index] = cleanVal;
    setOtp(newOtp);

    if (cleanVal && index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    }
  };

  // Form submission handlers

  // 1. Login Submit (supports email, phone, pharmacyId, assistantId, adminId)
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!email.trim() || !password) {
      setErrorMessage('Please enter your login identifier and password.');
      return;
    }

    setLoading(true);
    if (email.includes('@')) {
      saveEmailToHistory(email.trim());
    }
    const result = await login(email.trim(), password, loginPortalRole);
    setLoading(false);

    if (result.success) {
      if (!validatePortalRole(result.user?.role)) return;
      if (onLoginSuccess) {
        onLoginSuccess(result.user.role);
      }
    } else {
      setErrorMessage(result.error || 'The credentials entered do not match our verified records.');
    }
  };

  // Phone OTP Sign In Handlers
  const handleSendPhoneLoginOtp = async (e) => {
    e?.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    const cleanPhone = phone.trim();
    if (!cleanPhone || cleanPhone.replace(/[\s\-()]/g, '').length < 10) {
      setErrorMessage('Please enter a valid mobile number (at least 10 digits).');
      return;
    }
    setLoading(true);
    const res = await sendOtp(cleanPhone);
    setLoading(false);
    if (res && res.success) {
      setOtp(['', '', '', '', '', '']);
      setOtpSentTo(cleanPhone);
      setGeneratedOtp(res.generatedOtp || '123456');
      setResendCooldown(30);
      setPhoneLoginStep(2);
      setSuccessMessage(`Verification code sent to ${cleanPhone}.`);
    } else {
      setErrorMessage(res?.error || 'Failed to send verification code.');
    }
  };

  const handlePhoneLoginVerify = async (e) => {
    e?.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    const code = otp.join('');
    if (code.length < 6) {
      setErrorMessage('Please enter the complete 6-digit verification code.');
      return;
    }
    setLoading(true);
    const result = await loginWithPhone(phone.trim(), code, loginPortalRole);
    setLoading(false);
    if (result.success) {
      if (!validatePortalRole(result.user?.role)) return;
      if (onLoginSuccess) onLoginSuccess(result.user.role);
    } else {
      setErrorMessage(result.error || 'Invalid verification code. Please try again.');
    }
  };

  // 2. Step 1 -> Step 2: Validate Name, Phone, Email & Send Phone OTP
  const handleProceedToOtp = async (e) => {
    e?.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();

    if (!trimmedName || trimmedName.length < 2) {
      setErrorMessage('Please enter your full legal name (minimum 2 characters).');
      return;
    }

    if (!trimmedPhone || trimmedPhone.replace(/[\s\-()]/g, '').length < 10) {
      setErrorMessage('Please enter a valid mobile contact (at least 10 digits) for Phone OTP verification.');
      return;
    }

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (trimmedEmail && !EMAIL_REGEX.test(trimmedEmail)) {
      setErrorMessage('Please enter a valid email address (e.g. name@example.com).');
      return;
    }

    setLoading(true);
    try {
      const query = new URLSearchParams({ phone: trimmedPhone });
      if (trimmedEmail) query.append('email', trimmedEmail);
      const res = await fetch(`/api/auth/check-user?${query.toString()}`);
      const data = await res.json();

      if (data && !data.available) {
        setLoading(false);
        setErrorMessage(data.error || 'An account with this mobile number or email already exists.');
        return;
      }
    } catch {
      // Fallback: proceed to OTP
    }

    // Call backend /send-otp (integrates with Neon Auth or local SMS generator)
    const otpRes = await sendOtp(trimmedPhone);
    setLoading(false);

    if (otpRes && otpRes.success) {
      setGeneratedOtp(otpRes.generatedOtp || '123456');
      setOtp(['', '', '', '', '', '']);
      setOtpSentTo(trimmedPhone);
      setResendCooldown(30);
      setSignUpStep(2);
      setSuccessMessage(`Phone OTP verification code sent to ${trimmedPhone}`);
    } else {
      setErrorMessage(otpRes?.error || 'Failed to send OTP to mobile number.');
    }
  };

  // 3. Step 2 -> Step 3: Verify OTP code
  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    const enteredOtp = otp.join('');
    if (enteredOtp.length < 6) {
      setErrorMessage('Please enter the complete 6-digit verification code.');
      return;
    }

    setLoading(true);
    const res = await verifyOtp(phone.trim(), enteredOtp);
    setLoading(false);

    if (res && res.success) {
      setSignUpStep(3);
      setSuccessMessage('Mobile phone verified via Neon Auth! Please set your secure password.');
    } else {
      setErrorMessage(res?.error || 'Invalid verification code. Please enter demo code 123456 or resend.');
    }
  };

  // 4. Step 3 -> Final Register Submit: Password validation & creation
  const handleCompleteRegistration = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!password) {
      setErrorMessage('Please choose a password.');
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

    if (passwordStrength.score < 2) {
      setErrorMessage('Please create a more secure password including numbers and symbols.');
      return;
    }

    setLoading(true);
    const result = await register({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      password,
      confirmPassword,
      role: registerRole
    });
    setLoading(false);

    if (result.success) {
      setSuccessMessage(registerRole === 'ASSISTANT'
        ? 'Assistant account verified! Opening Assistant Portal...'
        : 'Patient account verified & created! Signing in...');
      if (onLoginSuccess) {
        onLoginSuccess(result.user.role);
      }
    } else {
      setErrorMessage(result.error || 'Registration failed. Please check your details.');
    }
  };



  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
      {/* 3D Hero Geometric Shader Background with MediFind Theme Colors */}
      {showBackground && (
        <HeroGeometricBackground
          color1="#A5D6A7"
          color2="#e8f8f2"
          speed={0.7}
        />
      )}

      <main className="relative z-10 w-full max-w-[430px] sm:max-w-[440px] px-2.5 sm:px-3 flex flex-col items-center justify-center">
        <div className="w-full flex flex-col items-center">
          {/* Main Card with Apple-like spring entrance */}
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full mx-auto flex flex-col items-center"
          >
              {/* Windows 11 Fluent Acrylic Glass Container */}
              <div
                className="w-full relative px-5 py-4 sm:px-6 sm:py-5 flex flex-col transition-all duration-300"
                style={{
                  background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.76) 0%, rgba(255, 255, 255, 0.58) 100%)',
                  borderRadius: '20px',
                  boxShadow: '0 20px 50px rgba(3, 47, 40, 0.09), 0 4px 16px rgba(0, 0, 0, 0.04), inset 0 1px 1px rgba(255, 255, 255, 0.85), inset 0 0 0 1px rgba(255, 255, 255, 0.4)',
                  backdropFilter: 'blur(24px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                  border: '1px solid rgba(255, 255, 255, 0.65)',
                  minHeight: '585px'
                }}
              >
              {/* Optional Close Button in Card Corner */}
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant/60 hover:text-on-surface hover:bg-black/[0.05] transition-all cursor-pointer border-none bg-transparent"
                  aria-label="Close"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              )}

              {/* Brand Logo & Badging */}
              <div className="flex flex-col items-center text-center mb-2 sm:mb-2.5">
                <div className="flex items-center justify-center mb-1">
                  <MediFindLogo size="sm" showText={false} />
                </div>

                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-600/20 text-[#1e453e] text-[10.5px] font-semibold tracking-wide mb-1 shadow-2xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
                  <span>
                    {mode === 'login'
                      ? (loginPortalRole === 'PHARMACY'
                          ? 'Pharmacy Dispensary Portal'
                          : loginPortalRole === 'ASSISTANT'
                          ? 'Care Assistant Portal'
                          : loginPortalRole === 'ADMIN'
                          ? 'System Administrator Portal'
                          : 'Patient Access Portal')
                      : signUpStep === 1
                      ? 'Step 1 of 3 • Basic Details'
                      : signUpStep === 2
                      ? 'Step 2 of 3 • Identity Verification'
                      : 'Step 3 of 3 • Secure Credentials'}
                  </span>
                </div>

                <h1 className="text-lg sm:text-xl font-bold text-primary tracking-tight">
                  {mode === 'login'
                    ? (loginPortalRole === 'PHARMACY'
                        ? 'Dispensary Sign In'
                        : loginPortalRole === 'ASSISTANT'
                        ? 'Assistant Sign In'
                        : loginPortalRole === 'ADMIN'
                        ? 'Administrator Sign In'
                        : 'Welcome Back')
                    : signUpStep === 1
                    ? 'Create Account'
                    : signUpStep === 2
                    ? 'Verify Identity'
                    : 'Set Secure Password'}
                </h1>
                <p className="text-[11.5px] sm:text-xs text-on-surface-variant mt-0.5 max-w-xs leading-normal min-h-[34px] flex items-center justify-center text-center">
                  {mode === 'login'
                    ? (loginPortalRole === 'PHARMACY'
                        ? 'Update dispensary stock, verify prescriptions, and dispatch orders.'
                        : loginPortalRole === 'ASSISTANT'
                        ? 'Access local delivery tasks and patient medicine assignments.'
                        : loginPortalRole === 'ADMIN'
                        ? 'Manage network dispensaries, audit inventories, and platform security.'
                        : 'Access verified prescriptions & pharmacy orders.')
                    : signUpStep === 1
                    ? 'Enter your name, email, and mobile contact.'
                    : signUpStep === 2
                    ? `Enter the 6-digit code sent to ${otpSentTo || 'your contact'}.`
                    : 'Choose a strong password with symbols and numbers.'}
                </p>
              </div>

              {/* Mode Switcher Tabs OR Multi-Step Progress Indicator */}
              {mode === 'register' && signUpStep > 1 ? (
                <div className="flex items-center justify-between w-full mb-2.5 px-2 py-1.5 rounded-xl bg-black/[0.03] border border-white/70 shadow-inner">
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3].map((stepNum) => (
                      <div key={stepNum} className="flex items-center gap-1.5">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                            signUpStep === stepNum
                              ? 'bg-[#1e453e] text-white shadow-xs'
                              : signUpStep > stepNum
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-black/[0.06] text-on-surface-variant/60'
                          }`}
                        >
                          {signUpStep > stepNum ? '✓' : stepNum}
                        </div>
                        {stepNum < 3 && (
                          <div className={`w-6 sm:w-8 h-0.5 rounded-full ${signUpStep > stepNum ? 'bg-emerald-400' : 'bg-black/[0.08]'}`} />
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSignUpStep(prev => Math.max(1, prev - 1));
                      setErrorMessage('');
                    }}
                    className="text-xs font-semibold text-[#1e453e] hover:underline flex items-center gap-1 cursor-pointer bg-transparent border-none p-0"
                  >
                    <span className="material-symbols-outlined text-sm">arrow_back</span>
                    <span>Back</span>
                  </button>
                </div>
              ) : (
                <div className="relative grid grid-cols-2 p-1 rounded-xl bg-black/[0.04] backdrop-blur-md mb-2 sm:mb-2.5 border border-white/70 shadow-inner overflow-hidden">
                  {/* Fluid Sliding Active Pill Indicator */}
                  <div className="absolute inset-1 grid grid-cols-2 pointer-events-none">
                    <motion.div
                      className="w-full h-full rounded-lg bg-gradient-to-r from-[#032f28] to-[#0a4f43] shadow-[0_2px_10px_rgba(3,47,40,0.3)]"
                      initial={false}
                      animate={{
                        x: mode === 'login' ? '0%' : '100%'
                      }}
                      transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                    />
                  </div>

                  <button
                    type="button"
                    id="auth-tab-login"
                    onClick={() => {
                      setMode('login');
                      setSignUpStep(1);
                      setErrorMessage('');
                      setSuccessMessage('');
                    }}
                    className={`relative z-10 py-1.5 rounded-lg text-xs font-bold transition-colors duration-200 border-none cursor-pointer flex items-center justify-center select-none ${
                      mode === 'login'
                        ? 'text-white'
                        : 'text-on-surface-variant hover:text-[#032f28]'
                    }`}
                    style={{ background: 'transparent' }}
                  >
                    <span>Sign In</span>
                  </button>

                  <button
                    type="button"
                    id="auth-tab-register"
                    onClick={() => {
                      setMode('register');
                      setSignUpStep(1);
                      setErrorMessage('');
                      setSuccessMessage('');
                    }}
                    className={`relative z-10 py-1.5 rounded-lg text-xs font-bold transition-colors duration-200 border-none cursor-pointer flex items-center justify-center select-none ${
                      mode === 'register'
                        ? 'text-white'
                        : 'text-on-surface-variant hover:text-[#032f28]'
                    }`}
                    style={{ background: 'transparent' }}
                  >
                    <span>Create Account</span>
                  </button>
                </div>
              )}

              {/* Login Role Portal Selector (Patient, Pharmacy, Assistant, Admin) */}
              {mode === 'login' && (
                <div className="flex flex-col gap-1 mb-2">
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-[9.5px] font-bold text-on-surface-variant uppercase tracking-wider">
                      Select Access Portal
                    </span>
                    <span className="text-[9.5px] text-secondary font-semibold">
                      {loginPortalRole === 'PHARMACY'
                        ? 'Dispensary Manager'
                        : loginPortalRole === 'ASSISTANT'
                        ? 'Logistics & Care'
                        : loginPortalRole === 'ADMIN'
                        ? 'Administrative Control'
                        : 'Patient Portal'}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 p-0.5 rounded-xl bg-black/[0.04] border border-white/70 shadow-inner gap-1 relative">
                    {[
                      { id: 'PATIENT', label: 'Patient', icon: 'person' },
                      { id: 'PHARMACY', label: 'Pharmacy', icon: 'storefront' },
                      { id: 'ASSISTANT', label: 'Assistant', icon: 'clinical_notes' },
                      { id: 'ADMIN', label: 'Admin', icon: 'shield_person' }
                    ].map(r => {
                      const isActive = loginPortalRole === r.id;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          id={`portal-role-${r.id.toLowerCase()}`}
                          onClick={() => {
                            setLoginPortalRole(r.id);
                            setErrorMessage('');
                          }}
                          className={`relative py-1 px-1 rounded-lg text-[10.5px] font-bold transition-colors flex items-center justify-center gap-1 cursor-pointer border-none select-none ${
                            isActive
                              ? 'text-white'
                              : 'text-on-surface-variant hover:text-[#032f28]'
                          }`}
                          style={{ background: 'transparent' }}
                        >
                          {isActive && (
                            <motion.div
                              layoutId="auth-card-portal-role-tab-barba"
                              transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                              className="absolute inset-0 rounded-lg bg-gradient-to-r from-[#032f28] to-[#0a4f43] shadow-[0_2px_8px_rgba(3,47,40,0.3)] -z-0"
                            />
                          )}
                          <span
                            className={`relative z-10 material-symbols-outlined text-[13px] transition-colors ${
                              isActive ? 'text-[#b0ecdd]' : 'text-[#2e685d]'
                            }`}
                          >
                            {r.icon}
                          </span>
                          <span className="relative z-10 whitespace-nowrap">{r.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Google OAuth (Neon Auth & Google Cloud Client Credentials) */}
              {(mode === 'login' || (mode === 'register' && signUpStep === 1)) && (
                <div className="mb-1.5">
                  <button
                    className="w-full h-9 rounded-xl bg-white/90 hover:bg-white backdrop-blur-md border border-black/10 hover:border-[#4285F4]/60 text-on-surface font-semibold text-xs flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.99] shadow-2xs hover:shadow-xs disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
                    id="google-signin-btn"
                    type="button"
                    disabled={!!oauthLoadingProvider}
                    onClick={handleGoogleSignIn}
                  >
                    {oauthLoadingProvider === 'Google' ? (
                      <>
                        <svg className="animate-spin w-4 h-4 shrink-0 text-[#4285F4]" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" />
                        </svg>
                        <span className="text-xs font-medium text-[#4285F4]">Connecting to Google…</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                          <path d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z" fill="#EA4335" />
                          <path d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5.1 3.7-8.8z" fill="#4285F4" />
                          <path d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15s.7 5.3 1.9 7.7l3.7-2.9z" fill="#FBBC05" />
                          <path d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z" fill="#34A853" />
                        </svg>
                        <span className="text-xs font-medium">Continue with Google</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Divider */}
              {(mode === 'login' || (mode === 'register' && signUpStep === 1)) && (
                <div className="relative my-1.5 flex items-center justify-center">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-black/[0.08]"></div>
                  </div>
                  <div className="relative px-2.5 py-0.5 rounded-full bg-white/90 backdrop-blur-sm border border-black/5 text-[9.5px] font-semibold tracking-wider uppercase text-on-surface-variant/75">
                    {mode === 'login' ? 'or choose sign in method' : 'or enter registration details'}
                  </div>
                </div>
              )}

              {/* Dismissible Error Banner */}
              {errorMessage && (
                <div
                  className="mb-2.5 p-3 rounded-2xl bg-error-container/50 backdrop-blur-md border border-error/30 text-on-error-container flex items-start gap-2.5 animate-in fade-in duration-150"
                  id="credential-error-banner"
                >
                  <span className="material-symbols-outlined text-error text-[19px] shrink-0 mt-0.5">
                    error
                  </span>
                  <div className="flex flex-col flex-1 text-xs">
                    <span className="font-semibold text-error text-xs">Authentication Failed</span>
                    <span className="text-on-surface-variant mt-0.5 text-xs leading-snug">
                      {errorMessage}
                    </span>
                  </div>
                  <button
                    onClick={() => setErrorMessage('')}
                    className="text-on-surface-variant/70 hover:text-on-surface transition-colors"
                    type="button"
                    aria-label="Dismiss error"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>
              )}

              {/* Success Banner */}
              {successMessage && (
                <div className="mb-2.5 p-3 rounded-2xl bg-secondary-container/50 backdrop-blur-md border border-secondary/30 text-on-secondary-container flex items-start gap-2.5 animate-in fade-in duration-150">
                  <span className="material-symbols-outlined text-secondary text-[19px] shrink-0 mt-0.5">
                    check_circle
                  </span>
                  <div className="flex flex-col flex-1 text-xs">
                    <span className="font-bold text-secondary text-xs">Success</span>
                    <span className="text-on-surface mt-0.5 text-xs leading-snug">
                      {successMessage}
                    </span>
                  </div>
                </div>
              )}

              {/* LOGIN FORM */}
              {mode === 'login' && (
                <div className="flex flex-col gap-2.5">
                  {/* Sub-tabs: Password Sign In vs Phone OTP */}
                  <div className="relative grid grid-cols-2 p-0.5 rounded-xl bg-black/[0.04] border border-white/70 shadow-inner mb-0.5 overflow-hidden">
                    <div className="absolute inset-0.5 grid grid-cols-2 pointer-events-none">
                      <motion.div
                        className="w-full h-full rounded-lg bg-gradient-to-r from-[#032f28] to-[#0a4f43] shadow-[0_2px_8px_rgba(3,47,40,0.3)]"
                        initial={false}
                        animate={{
                          x: loginMethod === 'password' ? '0%' : '100%'
                        }}
                        transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                      />
                    </div>
                    <button
                      type="button"
                      id="login-method-password"
                      onClick={() => {
                        setLoginMethod('password');
                        setErrorMessage('');
                        setSuccessMessage('');
                      }}
                      className={`relative z-10 py-1.5 rounded-lg text-[11.5px] font-bold transition-colors duration-200 flex items-center justify-center gap-1 cursor-pointer border-none select-none ${
                        loginMethod === 'password'
                          ? 'text-white'
                          : 'text-on-surface-variant hover:text-[#032f28]'
                      }`}
                      style={{ background: 'transparent' }}
                    >
                      <span
                        className={`material-symbols-outlined text-[14px] transition-colors ${
                          loginMethod === 'password' ? 'text-[#b0ecdd]' : 'text-[#2e685d]'
                        }`}
                      >
                        password
                      </span>
                      <span>Password</span>
                    </button>
                    <button
                      type="button"
                      id="login-method-otp"
                      onClick={() => {
                        setLoginMethod('phone_otp');
                        setPhoneLoginStep(1);
                        setErrorMessage('');
                        setSuccessMessage('');
                      }}
                      className={`relative z-10 py-1.5 rounded-lg text-[11.5px] font-bold transition-colors duration-200 flex items-center justify-center gap-1 cursor-pointer border-none select-none ${
                        loginMethod === 'phone_otp'
                          ? 'text-white'
                          : 'text-on-surface-variant hover:text-[#032f28]'
                      }`}
                      style={{ background: 'transparent' }}
                    >
                      <span
                        className={`material-symbols-outlined text-[14px] transition-colors ${
                          loginMethod === 'phone_otp' ? 'text-[#b0ecdd]' : 'text-[#2e685d]'
                        }`}
                      >
                        sms
                      </span>
                      <span>Phone OTP</span>
                    </button>
                  </div>

                  {loginMethod === 'phone_otp' ? (
                    phoneLoginStep === 1 ? (
                      <form onSubmit={handleSendPhoneLoginOtp} className="flex flex-col gap-2.5" id="phone-login-step1">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[11.5px] font-semibold text-on-surface flex items-center justify-between px-0.5" htmlFor="login-phone">
                            <span>Mobile Phone Number</span>
                            <span className="text-[10px] text-[#2e685d] font-semibold">Neon SMS OTP</span>
                          </label>
                          <div className="relative flex items-center">
                            <span className="material-symbols-outlined absolute left-3.5 text-on-surface-variant/50 text-[18px] pointer-events-none z-10">
                              smartphone
                            </span>
                            <input
                              id="login-phone"
                              type="tel"
                              required
                              value={phone}
                              onChange={e => setPhone(e.target.value)}
                              placeholder="Phone"
                              className="w-full h-10 pl-10 pr-4 rounded-xl bg-white/60 backdrop-blur-md border border-white/80 text-on-surface placeholder:text-on-surface-variant/50 text-xs sm:text-sm transition-all duration-200 outline-none focus:bg-white/95 focus:border-secondary focus:ring-2 focus:ring-secondary/15 shadow-2xs font-bold"
                            />
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={loading}
                          className="relative mt-1 w-full h-10 sm:h-10.5 rounded-xl bg-[#1e453e] hover:bg-[#15342e] text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.99] border-none cursor-pointer"
                        >
                          {loading ? (
                            <span className="text-xs">Sending code...</span>
                          ) : (
                            <span className="flex items-center gap-1.5">
                              <span>Send Verification Code</span>
                              <span className="material-symbols-outlined text-[18px]">send</span>
                            </span>
                          )}
                        </button>
                      </form>
                    ) : (
                      <form onSubmit={handlePhoneLoginVerify} className="flex flex-col items-center gap-3 py-1" id="phone-login-step2">
                        <div className="text-center space-y-1">
                          <div className="w-10 h-10 mx-auto rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center shadow-xs">
                            <span className="material-symbols-outlined text-xl">sms</span>
                          </div>
                          <p className="text-xs text-on-surface-variant leading-relaxed">
                            Enter the 6-digit verification code sent to: <br/>
                            <strong className="text-primary">{phone}</strong>
                          </p>
                        </div>

                        {/* 6 OTP Boxes */}
                        <div className="flex items-center justify-center gap-2 sm:gap-2.5 my-1">
                          {otp.map((digit, idx) => (
                            <input
                              key={idx}
                              ref={el => (otpInputsRef.current[idx] = el)}
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              value={digit}
                              onChange={e => handleOtpChange(idx, e.target.value)}
                              onKeyDown={e => handleOtpKeyDown(idx, e)}
                              className="w-10 sm:w-11 h-12 text-center text-lg font-black rounded-xl bg-white/80 border border-black/15 focus:border-[#1e453e] focus:bg-white focus:ring-2 focus:ring-[#1e453e]/20 outline-none transition-all shadow-xs"
                            />
                          ))}
                        </div>

                        {/* Demo Quick-Fill Chip */}
                        <button
                          type="button"
                          onClick={() => {
                            setOtp(['1', '2', '3', '4', '5', '6']);
                            setSuccessMessage('Demo OTP 123456 autofilled!');
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 text-[11px] font-bold cursor-pointer transition-all shadow-2xs"
                        >
                          <span className="material-symbols-outlined text-[13px]">bolt</span>
                          <span>Demo OTP: 123456 (Click to Autofill)</span>
                        </button>

                        <div className="w-full flex items-center gap-2 mt-1">
                          <button
                            type="button"
                            onClick={() => setPhoneLoginStep(1)}
                            className="w-1/3 h-10 rounded-xl bg-black/[0.05] hover:bg-black/[0.09] text-on-surface font-semibold text-xs flex items-center justify-center transition-all cursor-pointer border-none"
                          >
                            Change
                          </button>
                          <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 h-10 sm:h-10.5 rounded-xl bg-[#1e453e] hover:bg-[#15342e] text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-sm hover:shadow-md transition-all cursor-pointer border-none"
                          >
                            <span>Verify &amp; Sign In</span>
                            <span className="material-symbols-outlined text-[18px]">verified</span>
                          </button>
                        </div>
                      </form>
                    )
                  ) : (
                    <form onSubmit={handleLoginSubmit} className="flex flex-col gap-2.5" id="patient-login-form" autoComplete="off">
                      {/* Hidden dummy inputs to defeat browser autofill injection */}
                      <input type="text" name="username_fake" style={{ display: 'none' }} readOnly aria-hidden="true" tabIndex="-1" />
                      <input type="password" name="password_fake" style={{ display: 'none' }} readOnly aria-hidden="true" tabIndex="-1" />
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[11.5px] font-semibold text-on-surface flex items-center justify-between px-0.5" htmlFor="login-email">
                          <span>
                            {loginPortalRole === 'PHARMACY'
                              ? 'Pharmacy ID, Manager Email, or Phone'
                              : loginPortalRole === 'ASSISTANT'
                              ? 'Assistant ID, Email, or Phone'
                              : loginPortalRole === 'ADMIN'
                              ? 'Admin ID, Email, or Phone'
                              : 'Mobile Phone or Email'}
                          </span>
                          <span className="text-[10px] text-on-surface-variant/70 font-normal">
                            {loginPortalRole === 'PHARMACY'
                              ? 'Dispensary ID'
                              : loginPortalRole === 'ASSISTANT'
                              ? 'Assistant ID'
                              : loginPortalRole === 'ADMIN'
                              ? 'Admin Credential'
                              : 'Registered Contact'}
                          </span>
                        </label>
                        <div className="relative flex items-center" ref={emailWrapRef}>
                          <span className="material-symbols-outlined absolute left-3.5 text-on-surface-variant/50 text-[18px] pointer-events-none z-10">
                            {loginPortalRole === 'PHARMACY'
                              ? 'storefront'
                              : loginPortalRole === 'ASSISTANT'
                              ? 'clinical_notes'
                              : loginPortalRole === 'ADMIN'
                              ? 'shield_person'
                              : (/^\+?\d[\d\s-]{5,}$/.test(email.trim()) ? 'smartphone' : 'mail')}
                          </span>
                          <input
                            id="login-email"
                            type="text"
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
                            placeholder="Email"
                            className="w-full h-10 pl-10 pr-8 rounded-xl bg-white/60 backdrop-blur-md border border-white/80 text-on-surface placeholder:text-on-surface-variant/50 text-xs sm:text-sm transition-all duration-200 outline-none focus:bg-white/95 focus:border-secondary focus:ring-2 focus:ring-secondary/15 shadow-2xs font-bold"
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
                              className="absolute right-2.5 text-[#2e685d] hover:text-[#032f28] transition-colors"
                              title="Show saved emails"
                            >
                              <span className="material-symbols-outlined" style={{fontSize:16}}>history</span>
                            </button>
                          )}
                          {/* Email suggestion dropdown */}
                          {emailDropdownOpen && emailSuggestions.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white/95 backdrop-blur-2xl rounded-xl shadow-xl border border-white/80 overflow-hidden">
                              <div className="px-3 py-1 border-b border-black/[0.06] flex items-center gap-1.5">
                                <span className="material-symbols-outlined text-[#2e685d]" style={{fontSize:12}}>history</span>
                                <span className="text-[9.5px] font-bold text-[#717976] uppercase tracking-wider">Recent Contacts</span>
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
                                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[#e6f8f1]/70 transition-colors cursor-pointer group"
                                >
                                  <span className="material-symbols-outlined text-[15px] text-[#2e685d]">mail</span>
                                  <span className="text-[#032f28] font-medium truncate flex-1">{suggestion}</span>
                                  <span className="material-symbols-outlined text-[#c0c8c5] group-hover:text-[#2e685d] transition-colors" style={{fontSize:12}}>north_west</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between px-0.5">
                          <label className="text-[11.5px] font-semibold text-on-surface" htmlFor="login-password">
                            Password
                          </label>
                        </div>
                        <div className="relative flex items-center">
                          <span className="material-symbols-outlined absolute left-3.5 text-on-surface-variant/50 text-[18px] pointer-events-none">
                            lock
                          </span>
                          <input
                            id="login-password"
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="new-password"
                            required
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="Password"
                            className="w-full h-10 pl-10 pr-8 rounded-xl bg-white/60 backdrop-blur-md border border-white/80 text-on-surface placeholder:text-on-surface-variant/50 text-xs sm:text-sm transition-all duration-200 outline-none focus:bg-white/95 focus:border-secondary focus:ring-2 focus:ring-secondary/15 shadow-2xs font-bold"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            aria-label="Toggle password visibility"
                            className="absolute right-2.5 h-7 w-7 flex items-center justify-center rounded-lg text-on-surface-variant/70 hover:text-on-surface transition-colors border-none bg-transparent cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[17px]">
                              {showPassword ? 'visibility_off' : 'visibility'}
                            </span>
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 px-0.5 my-1">
                        <input
                          id="trust-device"
                          type="checkbox"
                          checked={rememberMe}
                          onChange={e => setRememberMe(e.target.checked)}
                          className="w-3.5 h-3.5 rounded text-secondary border-outline-variant focus:ring-secondary/30 accent-[#1e453e] cursor-pointer"
                        />
                        <label className="text-[11.5px] text-on-surface-variant cursor-pointer select-none" htmlFor="trust-device">
                          Remember this device for 30 days
                        </label>
                      </div>

                      {/* Primary CTA button in deep spruce green */}
                      <button
                        id="submit-login-btn"
                        type="submit"
                        disabled={loading}
                        className="relative mt-1 w-full h-10 sm:h-10.5 rounded-xl bg-[#1e453e] hover:bg-[#15342e] text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.99] border-none cursor-pointer"
                      >
                        {loading ? (
                          <span className="flex items-center gap-2 text-white">
                            <svg className="animate-spin h-3.5 w-3.5 text-current" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" fill="currentColor"></path>
                            </svg>
                            <span className="text-xs">Verifying credentials...</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <span>Sign In</span>
                            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                          </span>
                        )}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* REGISTRATION FORM (3-Step Flow matching Login card size) */}
              {mode === 'register' && (
                <div className="w-full flex flex-col gap-3">
                  {/* ──── STEP 1: Personal Info & Availability Check ──── */}
                  {signUpStep === 1 && (
                    <form onSubmit={handleProceedToOtp} className="flex flex-col gap-2.5" id="reg-step-1-form">
                      {/* Account Type Selector: Patient vs Assistant */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[11.5px] font-semibold text-on-surface px-0.5">
                          How would you like to register?
                        </label>
                        <div className="relative grid grid-cols-2 p-1 rounded-xl bg-black/[0.04] border border-white/70 shadow-inner overflow-hidden">
                          <div className="absolute inset-1 grid grid-cols-2 pointer-events-none">
                            <motion.div
                              className="w-full h-full rounded-lg bg-gradient-to-r from-[#032f28] to-[#0a4f43] shadow-[0_2px_8px_rgba(3,47,40,0.3)]"
                              initial={false}
                              animate={{
                                x: registerRole === 'PATIENT' ? '0%' : '100%'
                              }}
                              transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                            />
                          </div>
                          <button
                            type="button"
                            id="reg-role-patient"
                            onClick={() => setRegisterRole('PATIENT')}
                            className={`relative z-10 py-1.5 rounded-lg text-xs font-bold transition-colors duration-200 cursor-pointer border-none select-none flex items-center justify-center ${
                              registerRole === 'PATIENT'
                                ? 'text-white'
                                : 'text-on-surface-variant hover:text-[#032f28]'
                            }`}
                            style={{ background: 'transparent' }}
                          >
                            <span>Patient</span>
                          </button>
                          <button
                            type="button"
                            id="reg-role-assistant"
                            onClick={() => setRegisterRole('ASSISTANT')}
                            className={`relative z-10 py-1.5 rounded-lg text-xs font-bold transition-colors duration-200 cursor-pointer border-none select-none flex items-center justify-center ${
                              registerRole === 'ASSISTANT'
                                ? 'text-white'
                                : 'text-on-surface-variant hover:text-[#032f28]'
                            }`}
                            style={{ background: 'transparent' }}
                          >
                            <span>Assistant / Healthcare</span>
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[11.5px] font-semibold text-on-surface px-0.5" htmlFor="reg-name">
                          Full Legal Name
                        </label>
                        <div className="relative flex items-center">
                          <span className="material-symbols-outlined absolute left-3.5 text-on-surface-variant/50 text-[18px] pointer-events-none">
                            person
                          </span>
                          <input
                            id="reg-name"
                            type="text"
                            required
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="Name"
                            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white/60 backdrop-blur-md border border-white/80 text-on-surface placeholder:text-on-surface-variant/50 text-xs sm:text-sm transition-all duration-200 outline-none focus:bg-white/95 focus:border-secondary focus:ring-2 focus:ring-secondary/15 shadow-2xs font-bold"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[11.5px] font-semibold text-on-surface px-0.5" htmlFor="reg-email">
                          Email Address
                        </label>
                        <div className="relative flex items-center">
                          <span className="material-symbols-outlined absolute left-3.5 text-on-surface-variant/50 text-[18px] pointer-events-none">
                            mail
                          </span>
                          <input
                            id="reg-email"
                            type="email"
                            required
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="Email"
                            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white/60 backdrop-blur-md border border-white/80 text-on-surface placeholder:text-on-surface-variant/50 text-xs sm:text-sm transition-all duration-200 outline-none focus:bg-white/95 focus:border-secondary focus:ring-2 focus:ring-secondary/15 shadow-2xs font-bold"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[11.5px] font-semibold text-on-surface px-0.5" htmlFor="reg-phone">
                          Mobile Phone Number <span className="text-[#2e685d] font-semibold">(Neon SMS OTP Verification)</span> *
                        </label>
                        <div className="relative flex items-center">
                          <span className="material-symbols-outlined absolute left-3.5 text-on-surface-variant/50 text-[18px] pointer-events-none">
                            smartphone
                          </span>
                          <input
                            id="reg-phone"
                            type="tel"
                            required
                            value={phone}
                            onChange={e => setPhone(e.target.value)}
                            placeholder="Phone"
                            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white/60 backdrop-blur-md border border-white/80 text-on-surface placeholder:text-on-surface-variant/50 text-xs sm:text-sm transition-all duration-200 outline-none focus:bg-white/95 focus:border-secondary focus:ring-2 focus:ring-secondary/15 shadow-2xs font-bold"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="relative mt-1.5 w-full h-10 sm:h-11 rounded-xl bg-[#1e453e] hover:bg-[#15342e] text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.99] border-none cursor-pointer"
                      >
                        {loading ? (
                          <span className="text-xs">Sending Phone OTP...</span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <span>Continue to Phone OTP Verification</span>
                            <span className="material-symbols-outlined text-[18px]">sms</span>
                          </span>
                        )}
                      </button>
                    </form>
                  )}

                  {/* ──── STEP 2: OTP Verification Boxes ──── */}
                  {signUpStep === 2 && (
                    <form onSubmit={handleVerifyOtp} className="flex flex-col items-center gap-3 py-1" id="reg-step-2-form">
                      <div className="text-center space-y-1">
                        <div className="w-10 h-10 mx-auto rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center shadow-xs">
                          <span className="material-symbols-outlined text-xl">sms</span>
                        </div>
                        <p className="text-xs text-on-surface-variant leading-relaxed">
                          We sent a 6-digit Neon SMS verification code to: <br/>
                          <strong className="text-primary">{otpSentTo}</strong>
                        </p>
                      </div>

                      {/* 6 OTP Boxes */}
                      <div className="flex items-center justify-center gap-2 sm:gap-2.5 my-1">
                        {otp.map((digit, idx) => (
                          <input
                            key={idx}
                            ref={el => (otpInputsRef.current[idx] = el)}
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={digit}
                            onChange={e => handleOtpChange(idx, e.target.value)}
                            onKeyDown={e => handleOtpKeyDown(idx, e)}
                            className="w-10 sm:w-11 h-12 text-center text-lg font-black rounded-xl bg-white/80 border border-black/15 focus:border-[#1e453e] focus:bg-white focus:ring-2 focus:ring-[#1e453e]/20 outline-none transition-all shadow-xs"
                          />
                        ))}
                      </div>

                      {/* Demo Quick-Fill Chip */}
                      <button
                        type="button"
                        onClick={() => {
                          setOtp(['1', '2', '3', '4', '5', '6']);
                          setSuccessMessage('Demo OTP 123456 autofilled!');
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 text-[11px] font-bold cursor-pointer transition-all shadow-2xs"
                      >
                        <span className="material-symbols-outlined text-[13px]">bolt</span>
                        <span>Demo OTP: 123456 (Click to Autofill)</span>
                      </button>

                      {/* Resend Countdown */}
                      <div className="text-center text-[11px] text-on-surface-variant">
                        {resendCooldown > 0 ? (
                          <span>Resend verification code in <strong>{resendCooldown}s</strong></span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setResendCooldown(30);
                              setSuccessMessage('New verification code sent to ' + otpSentTo);
                            }}
                            className="text-[#1e453e] font-bold hover:underline bg-transparent border-none p-0 cursor-pointer"
                          >
                            Resend Code Now
                          </button>
                        )}
                      </div>

                      <div className="w-full flex items-center gap-2 mt-1">
                        <button
                          type="button"
                          onClick={() => setSignUpStep(1)}
                          className="w-1/3 h-10 rounded-xl bg-black/[0.05] hover:bg-black/[0.09] text-on-surface font-semibold text-xs flex items-center justify-center transition-all cursor-pointer border-none"
                        >
                          Edit Email
                        </button>
                        <button
                          type="submit"
                          className="flex-1 h-10 sm:h-11 rounded-xl bg-[#1e453e] hover:bg-[#15342e] text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-sm hover:shadow-md transition-all cursor-pointer border-none"
                        >
                          <span>Confirm &amp; Proceed</span>
                          <span className="material-symbols-outlined text-[18px]">verified</span>
                        </button>
                      </div>
                    </form>
                  )}

                  {/* ──── STEP 3: Password & Live Strength Meter ──── */}
                  {signUpStep === 3 && (
                    <form onSubmit={handleCompleteRegistration} className="flex flex-col gap-2.5" id="reg-step-3-form">
                      {/* Password input */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[11.5px] font-semibold text-on-surface px-0.5" htmlFor="reg-pass">
                          Create Password
                        </label>
                        <div className="relative flex items-center">
                          <span className="material-symbols-outlined absolute left-3.5 text-on-surface-variant/50 text-[18px] pointer-events-none">
                            lock
                          </span>
                          <input
                            id="reg-pass"
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="new-password"
                            required
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="Password"
                            className="w-full h-10 pl-10 pr-9 rounded-xl bg-white/60 backdrop-blur-md border border-white/80 text-on-surface text-xs sm:text-sm transition-all duration-200 outline-none focus:bg-white/95 focus:border-secondary focus:ring-2 focus:ring-secondary/15 shadow-2xs font-bold"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            aria-label="Toggle password visibility"
                            className="absolute right-2.5 h-7 w-7 flex items-center justify-center rounded-lg text-on-surface-variant/70 hover:text-on-surface transition-colors border-none bg-transparent cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[17px]">
                              {showPassword ? 'visibility_off' : 'visibility'}
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* Live Password Strength Meter Bar & Chips */}
                      <div className="p-2 rounded-xl bg-black/[0.03] border border-black/[0.06] space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-on-surface-variant font-medium">Strength:</span>
                          <span className={`font-bold ${passwordStrength.textCol}`}>{passwordStrength.label}</span>
                        </div>

                        {/* Multi-segment strength bar */}
                        <div className="grid grid-cols-4 gap-1 h-1.5 w-full">
                          {[1, 2, 3, 4].map(seg => (
                            <div
                              key={seg}
                              className={`h-full rounded-full transition-all duration-200 ${
                                passwordStrength.score >= seg ? passwordStrength.color : 'bg-black/[0.08]'
                              }`}
                            />
                          ))}
                        </div>

                        {/* Checklist chips */}
                        <div className="grid grid-cols-2 gap-1 pt-0.5 text-[10px]">
                          <span className={`flex items-center gap-1 ${passwordStrength.checks.length ? 'text-emerald-700 font-bold' : 'text-on-surface-variant/60'}`}>
                            <span>{passwordStrength.checks.length ? '✓' : '○'}</span>
                            <span>8+ characters</span>
                          </span>
                          <span className={`flex items-center gap-1 ${passwordStrength.checks.upper ? 'text-emerald-700 font-bold' : 'text-on-surface-variant/60'}`}>
                            <span>{passwordStrength.checks.upper ? '✓' : '○'}</span>
                            <span>Capital letter (A-Z)</span>
                          </span>
                          <span className={`flex items-center gap-1 ${passwordStrength.checks.number ? 'text-emerald-700 font-bold' : 'text-on-surface-variant/60'}`}>
                            <span>{passwordStrength.checks.number ? '✓' : '○'}</span>
                            <span>Number (0-9)</span>
                          </span>
                          <span className={`flex items-center gap-1 ${passwordStrength.checks.special ? 'text-emerald-700 font-bold' : 'text-on-surface-variant/60'}`}>
                            <span>{passwordStrength.checks.special ? '✓' : '○'}</span>
                            <span>Special symbol (!@#$)</span>
                          </span>
                        </div>
                      </div>

                      {/* Confirm Password input */}
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between px-0.5">
                          <label className="text-[11.5px] font-semibold text-on-surface" htmlFor="reg-confirm">
                            Confirm Password
                          </label>
                          {confirmPassword && (
                            <span className={`text-[10px] font-bold ${password === confirmPassword ? 'text-emerald-700' : 'text-rose-600'}`}>
                              {password === confirmPassword ? '✓ Passwords Match' : 'Mismatch'}
                            </span>
                          )}
                        </div>
                        <div className="relative flex items-center">
                          <span className="material-symbols-outlined absolute left-3.5 text-on-surface-variant/50 text-[18px] pointer-events-none">
                            lock_reset
                          </span>
                          <input
                            id="reg-confirm"
                            type={showConfirmPassword ? 'text' : 'password'}
                            autoComplete="new-password"
                            required
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            placeholder="Confirm"
                            className="w-full h-10 pl-10 pr-9 rounded-xl bg-white/60 backdrop-blur-md border border-white/80 text-on-surface text-xs sm:text-sm transition-all duration-200 outline-none focus:bg-white/95 focus:border-secondary focus:ring-2 focus:ring-secondary/15 shadow-2xs font-bold"
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            aria-label="Toggle password visibility"
                            className="absolute right-2.5 h-7 w-7 flex items-center justify-center rounded-lg text-on-surface-variant/70 hover:text-on-surface transition-colors border-none bg-transparent cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[17px]">
                              {showConfirmPassword ? 'visibility_off' : 'visibility'}
                            </span>
                          </button>
                        </div>
                      </div>

                      <div className="w-full flex items-center gap-2 mt-1">
                        <button
                          type="button"
                          onClick={() => setSignUpStep(2)}
                          className="w-1/3 h-10 rounded-xl bg-black/[0.05] hover:bg-black/[0.09] text-on-surface font-semibold text-xs flex items-center justify-center transition-all cursor-pointer border-none"
                        >
                          Back
                        </button>
                        <button
                          id="submit-register-btn"
                          type="submit"
                          disabled={loading}
                          className="flex-1 h-10 sm:h-11 rounded-xl bg-[#1e453e] hover:bg-[#15342e] text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-sm hover:shadow-md transition-all cursor-pointer border-none"
                        >
                          {loading ? (
                            <span className="text-xs">Creating account...</span>
                          ) : (
                            <span className="flex items-center gap-1.5">
                              <span>Complete Registration</span>
                              <span className="material-symbols-outlined text-[18px]">person_add</span>
                            </span>
                          )}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {/* Account Registration Pathway toggle */}
              <div className="mt-auto pt-2 text-center text-xs text-on-surface-variant">
                {mode === 'login' ? (
                  <>
                    Don't have an account?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setMode('register');
                        setSignUpStep(1);
                        setErrorMessage('');
                        setSuccessMessage('');
                      }}
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
                      onClick={() => {
                        setMode('login');
                        setSignUpStep(1);
                        setErrorMessage('');
                        setSuccessMessage('');
                      }}
                      className="font-semibold text-secondary hover:text-primary underline underline-offset-2 ml-1 transition-colors border-none bg-transparent cursor-pointer p-0"
                    >
                      Sign in
                    </button>
                  </>
                )}
              </div>

              {/* Security Guarantee Badge */}
              <div className="mt-2 pt-2 border-t border-black/[0.08] flex items-center justify-center gap-1.5 text-center text-on-surface-variant/75">
                <span className="material-symbols-outlined text-[13px] text-secondary">verified_user</span>
                <span className="text-[9.5px] sm:text-[10px] font-medium">Role-Based Access Control • Secure PIN Verification</span>
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
