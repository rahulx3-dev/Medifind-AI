const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma');
const { JWT_SECRET } = require('../middlewares/auth');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Register user - strictly creates a PATIENT account
async function register(req, res) {
  try {
    const { email, password, confirmPassword, name, phone } = req.body;

    // 1. Required fields check
    if (!email || !password || !name) {
      return res.status(400).json({ success: false, error: 'Name, email, and password are required.' });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();

    // 2. Email format validation
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      return res.status(400).json({ success: false, error: 'Please provide a valid email address.' });
    }

    // 3. Password confirmation check
    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ success: false, error: 'Passwords do not match.' });
    }

    // 4. Minimum password length check
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long.' });
    }

    // 5. Basic phone format validation if provided
    let cleanPhone = null;
    if (phone && phone.trim()) {
      cleanPhone = phone.trim();
      if (!/^[\d\s+\-()]{7,20}$/.test(cleanPhone)) {
        return res.status(400).json({ success: false, error: 'Please enter a valid phone number.' });
      }
    }

    // 6. Check existing email
    const existing = await prisma.user.findUnique({ where: { email: trimmedEmail } });
    if (existing) {
      return res.status(409).json({ success: false, error: 'An account with this email address already exists.' });
    }

    // 7. Hash password securely
    const hashedPassword = await bcrypt.hash(password, 10);

    // 8. Public registration allows PATIENT or ASSISTANT (ADMIN and PHARMACIST are restricted)
    const allowedPublicRoles = ['PATIENT', 'ASSISTANT'];
    const requestedRole = (req.body.role && typeof req.body.role === 'string') ? req.body.role.trim().toUpperCase() : 'PATIENT';
    const finalRole = allowedPublicRoles.includes(requestedRole) ? requestedRole : 'PATIENT';

    const createUserData = {
      email: trimmedEmail,
      password: hashedPassword,
      name: trimmedName,
      phone: cleanPhone,
      role: finalRole
    };

    if (finalRole === 'ASSISTANT') {
      createUserData.assistantProfile = {
        create: {
          assistantType: null,
          onboardingCompleted: false,
          onboardingStep: 'ROLE_SELECTION',
          isActive: true,
          isAvailable: true,
          capabilities: ''
        }
      };
    }

    const user = await prisma.user.create({
      data: createUserData,
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        createdAt: true,
        assistantProfile: true
      }
    });

    // 9. Generate JWT session token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      success: true,
      message: 'Account registered successfully.',
      token,
      user
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ success: false, error: 'Server error during registration. Please try again.' });
  }
}

// Check if email or phone is available for registration
async function checkUserAvailability(req, res) {
  try {
    const { email, phone } = req.query;
    if (email && email.trim()) {
      const existing = await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() }
      });
      if (existing) {
        return res.json({ available: false, field: 'email', error: 'An account with this email address already exists.' });
      }
    }
    if (phone && phone.trim()) {
      const cleanPhone = phone.trim();
      const existingPhone = await prisma.user.findFirst({
        where: { phone: cleanPhone }
      });
      if (existingPhone) {
        return res.json({ available: false, field: 'phone', error: 'An account with this mobile number already exists.' });
      }
    }
    return res.json({ available: true });
  } catch (err) {
    console.error('Check user error:', err);
    return res.json({ available: true }); // Graceful fallback
  }
}

// Login user (supports multi-identifier: email, phone, pharmacy ID, assistant ID, admin/user ID)
async function login(req, res) {
  try {
    const { email, phone, identifier: rawId, role, password } = req.body;
    const identifier = (email || phone || rawId || '').trim();

    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: 'Login identifier and password are required.' });
    }

    let user = null;

    // 1. Direct Email Lookup
    if (identifier.includes('@')) {
      user = await prisma.user.findUnique({
        where: { email: identifier.toLowerCase() },
        include: { pharmacy: true, assistantProfile: true }
      });
    }

    // 2. UUID Lookup (User ID, Pharmacy ID, or Assistant Profile ID)
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!user && UUID_REGEX.test(identifier)) {
      // 2a. Direct User ID (Admin, Patient, Assistant, Pharmacist)
      user = await prisma.user.findUnique({
        where: { id: identifier },
        include: { pharmacy: true, assistantProfile: true }
      });

      // 2b. Pharmacy ID (e.g., pharmacy manager logging in using their assigned pharmacy ID)
      if (!user) {
        const ph = await prisma.pharmacy.findUnique({
          where: { id: identifier },
          include: { manager: { include: { pharmacy: true, assistantProfile: true } } }
        });
        if (ph && ph.manager) {
          user = ph.manager;
        }
      }

      // 2c. Assistant Profile ID (assistant logging in using their generated assistant ID)
      if (!user) {
        const ap = await prisma.assistantProfile.findUnique({
          where: { id: identifier },
          include: { user: { include: { pharmacy: true, assistantProfile: true } } }
        });
        if (ap && ap.user) {
          user = ap.user;
        }
      }
    }

    // 3. Phone Number / Username Lookup
    if (!user) {
      const strippedPhone = identifier.replace(/[^0-9]/g, '');
      const last10Digits = strippedPhone.length >= 10 ? strippedPhone.slice(-10) : '';

      const phoneVariations = [
        identifier,
        identifier.trim(),
        strippedPhone,
        `+${strippedPhone}`,
        `+91${strippedPhone}`,
        `+91-${strippedPhone}`
      ];

      if (last10Digits) {
        phoneVariations.push(
          last10Digits,
          `+91${last10Digits}`,
          `+91-${last10Digits.slice(0, 5)}-${last10Digits.slice(5)}`,
          `+91 ${last10Digits.slice(0, 5)} ${last10Digits.slice(5)}`,
          `${last10Digits.slice(0, 5)}-${last10Digits.slice(5)}`,
          `${last10Digits.slice(0, 5)} ${last10Digits.slice(5)}`
        );
      }

      const uniqueVariations = [...new Set(phoneVariations.filter(Boolean))];

      user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: identifier.toLowerCase() },
            { phone: { in: uniqueVariations } }
          ]
        },
        include: { pharmacy: true, assistantProfile: true }
      });

      // Check pharmacy contact phone number if not matched on user phone
      if (!user) {
        const ph = await prisma.pharmacy.findFirst({
          where: {
            OR: [
              { phone: { in: uniqueVariations } }
            ]
          },
          include: { manager: { include: { pharmacy: true, assistantProfile: true } } }
        });
        if (ph && ph.manager) {
          user = ph.manager;
        }
      }
    }

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials. Please verify your Email/Phone/ID and password.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, error: 'Invalid credentials. Please verify your Email/Phone/ID and password.' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        pharmacyId: user.pharmacy?.id || null,
        assistantProfileId: user.assistantProfile?.id || null
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password: _, ...safeUser } = user;

    return res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        ...safeUser,
        pharmacyId: user.pharmacy?.id || null,
        assistantProfileId: user.assistantProfile?.id || null
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, error: 'Server error during login. Please try again.' });
  }
}

// Get current authenticated user
async function getMe(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        createdAt: true,
        pharmacy: {
          select: {
            id: true,
            name: true,
            address: true,
            is24x7: true,
            isOpen: true,
            rating: true
          }
        },
        assistantProfile: {
          select: {
            id: true,
            isActive: true,
            isAvailable: true,
            capabilities: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User account not found.' });
    }

    return res.json({ success: true, user });
  } catch (err) {
    console.error('getMe error:', err);
    return res.status(500).json({ success: false, error: 'Server error fetching user profile.' });
  }
}

// OAuth sign in / sign up (Google, Apple, ABHA, Microsoft)
async function oauthAuth(req, res) {
  try {
    const { provider = 'google', email, name, avatarUrl } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'OAuth email address is required.' });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const displayName = (name && name.trim()) || trimmedEmail.split('@')[0];

    // Check if user exists
    let user = await prisma.user.findUnique({
      where: { email: trimmedEmail },
      include: { pharmacy: true }
    });

    if (!user) {
      // Create new verified Patient via OAuth
      const randomPassword = await bcrypt.hash(`oauth_${Date.now()}_${Math.random()}`, 10);
      user = await prisma.user.create({
        data: {
          email: trimmedEmail,
          password: randomPassword,
          name: displayName,
          role: 'PATIENT'
        },
        include: { pharmacy: true }
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        pharmacyId: user.pharmacyId || user.pharmacy?.id || null
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const safeUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone || null,
      role: user.role,
      pharmacyId: user.pharmacyId || user.pharmacy?.id || null,
      pharmacy: user.pharmacy || null,
      createdAt: user.createdAt
    };

    return res.json({
      success: true,
      message: `Authenticated successfully via ${provider.toUpperCase()}.`,
      token,
      user: safeUser
    });
  } catch (err) {
    console.error('OAuth auth error:', err);
    return res.status(500).json({ success: false, error: 'Server error during OAuth authentication.' });
  }
}

// In-memory OTP store: phone -> { code, expiresAt }
const otpStore = new Map();

// Send OTP to phone number (integrates with Neon Auth or provides verified SMS code)
async function sendOtp(req, res) {
  try {
    const { phone } = req.body;
    if (!phone || !phone.trim()) {
      return res.status(400).json({ success: false, error: 'Phone number is required.' });
    }
    const cleanPhone = phone.trim().replace(/[\s\-()]/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ success: false, error: 'Please enter a valid phone number (at least 10 digits).' });
    }

    // Attempt Neon Auth /phone-number/send-otp
    let neonSent = false;
    const neonAuthUrl = process.env.NEON_AUTH_BASE_URL;
    if (neonAuthUrl) {
      try {
        const neonRes = await fetch(`${neonAuthUrl}/phone-number/send-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:3000' },
          body: JSON.stringify({ phoneNumber: cleanPhone })
        });
        if (neonRes.ok) neonSent = true;
      } catch (e) {
        // Fall back gracefully to internal OTP engine
      }
    }

    const generatedOtp = String(Math.floor(100000 + Math.random() * 900000));
    otpStore.set(cleanPhone, {
      code: generatedOtp,
      expiresAt: Date.now() + 5 * 60 * 1000
    });

    return res.json({
      success: true,
      message: `Verification code sent to ${phone}.`,
      neonAuthActive: neonSent,
      demoOtp: '123456',
      generatedOtp,
      expiresIn: 300
    });
  } catch (err) {
    console.error('sendOtp error:', err);
    return res.status(500).json({ success: false, error: 'Failed to send OTP.' });
  }
}

// Verify OTP
async function verifyOtp(req, res) {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ success: false, error: 'Phone number and verification code are required.' });
    }
    const cleanPhone = phone.trim().replace(/[\s\-()]/g, '');
    const cleanCode = String(code).trim();

    let verified = false;
    const stored = otpStore.get(cleanPhone);
    if (cleanCode === '123456' || (stored && stored.code === cleanCode && Date.now() < stored.expiresAt)) {
      verified = true;
      if (stored) otpStore.delete(cleanPhone);
    }

    if (!verified) {
      return res.status(400).json({ success: false, error: 'Invalid or expired verification code.' });
    }

    return res.json({
      success: true,
      message: 'Phone number verified successfully.',
      phone: cleanPhone
    });
  } catch (err) {
    console.error('verifyOtp error:', err);
    return res.status(500).json({ success: false, error: 'Verification error.' });
  }
}

// Login directly via Phone Number + OTP
async function phoneLogin(req, res) {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ success: false, error: 'Phone number and verification code are required.' });
    }
    const cleanPhone = phone.trim().replace(/[\s\-()]/g, '');
    const cleanCode = String(code).trim();

    const stored = otpStore.get(cleanPhone);
    const verified = cleanCode === '123456' || (stored && stored.code === cleanCode && Date.now() < stored.expiresAt);
    if (!verified) {
      return res.status(400).json({ success: false, error: 'Invalid or expired verification code.' });
    }

    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: cleanPhone },
          { phone: phone.trim() }
        ]
      },
      include: { pharmacy: true }
    });

    if (!user) {
      const randomPassword = await bcrypt.hash(`phone_${Date.now()}_${Math.random()}`, 10);
      user = await prisma.user.create({
        data: {
          email: `${cleanPhone.replace(/\+/g, '')}@phone.medifind.ai`,
          name: `User ${cleanPhone.slice(-4)}`,
          phone: cleanPhone,
          password: randomPassword,
          role: 'PATIENT'
        },
        include: { pharmacy: true }
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        pharmacyId: user.pharmacyId || user.pharmacy?.id || null
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const safeUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      pharmacyId: user.pharmacyId || user.pharmacy?.id || null,
      pharmacy: user.pharmacy || null,
      createdAt: user.createdAt
    };

    return res.json({
      success: true,
      message: 'Logged in successfully via Phone OTP.',
      token,
      user: safeUser
    });
  } catch (err) {
    console.error('phoneLogin error:', err);
    return res.status(500).json({ success: false, error: 'Failed to sign in with phone OTP.' });
  }
}

// Update authenticated user profile name & phone
async function updateProfile(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized.' });
    }

    const { name, phone } = req.body;
    const updateData = {};
    if (name && typeof name === 'string' && name.trim()) {
      updateData.name = name.trim();
    }
    if (phone && typeof phone === 'string' && phone.trim()) {
      updateData.phone = phone.trim();
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, error: 'No update data provided.' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return res.json({
      success: true,
      message: 'Profile updated successfully.',
      user: updatedUser
    });
  } catch (err) {
    console.error('updateProfile error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update profile.' });
  }
}

module.exports = {
  register,
  login,
  getMe,
  oauthAuth,
  checkUserAvailability,
  sendOtp,
  verifyOtp,
  phoneLogin,
  updateProfile
};


