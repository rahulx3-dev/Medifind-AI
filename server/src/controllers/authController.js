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

    // 8. Public registration ALWAYS creates role: 'PATIENT' (Security requirement)
    const user = await prisma.user.create({
      data: {
        email: trimmedEmail,
        password: hashedPassword,
        name: trimmedName,
        phone: cleanPhone,
        role: 'PATIENT'
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        createdAt: true
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

// Login user
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const trimmedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: trimmedEmail },
      include: {
        pharmacy: true
      }
    });

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        pharmacyId: user.pharmacy?.id || null
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password: _, ...safeUser } = user;

    return res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: safeUser
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

module.exports = {
  register,
  login,
  getMe,
  oauthAuth
};

