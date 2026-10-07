const prisma = require('../prisma');

const BLOCKED_ADDRESS_PATTERNS = [
  'test address',
  'apollo 24/7',
  'care & cure',
  '123 main st',
  'patient registered address',
  'placeholder',
  'sample address',
  'fake address'
];

/**
 * Validate address inputs and reject placeholders/empty strings.
 */
function validateAddressData({ addressLine1, city, state, postalCode, phone }) {
  if (!addressLine1 || typeof addressLine1 !== 'string' || addressLine1.trim().length < 5) {
    return 'Street / Address Line 1 must be at least 5 characters long.';
  }

  const lowerLine1 = addressLine1.toLowerCase().trim();
  for (const blocked of BLOCKED_ADDRESS_PATTERNS) {
    if (lowerLine1.includes(blocked)) {
      return 'Please provide a valid physical delivery address. Placeholder or test addresses are not accepted.';
    }
  }

  if (!city || typeof city !== 'string' || city.trim().length < 2) {
    return 'City is required and must be at least 2 characters.';
  }

  if (!state || typeof state !== 'string' || state.trim().length < 2) {
    return 'State is required.';
  }

  if (!postalCode || typeof postalCode !== 'string' || postalCode.trim().length < 4) {
    return 'A valid Postal / PIN code is required.';
  }

  if (phone && typeof phone === 'string' && phone.trim().length > 0 && phone.trim().length < 7) {
    return 'Phone number if provided must be at least 7 digits.';
  }

  return null;
}

/**
 * Formats a PatientAddress record into a human-readable single delivery address string.
 */
function formatAddressString(addr) {
  if (!addr) return '';
  const parts = [];
  if (addr.recipientName) parts.push(addr.recipientName);
  if (addr.addressLine1) parts.push(addr.addressLine1);
  if (addr.addressLine2) parts.push(addr.addressLine2);
  if (addr.landmark) parts.push(`Near ${addr.landmark}`);
  parts.push(`${addr.city}, ${addr.state} - ${addr.postalCode}`);
  if (addr.phone) parts.push(`Phone: ${addr.phone}`);
  return parts.join(', ');
}

// GET /api/addresses - List all addresses owned by current patient
async function getAddresses(req, res) {
  try {
    const userId = req.user.id;
    const addresses = await prisma.patientAddress.findMany({
      where: { userId },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    return res.json({
      success: true,
      count: addresses.length,
      addresses
    });
  } catch (err) {
    console.error('getAddresses error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve addresses.' });
  }
}

// GET /api/addresses/:id - Get address by ID (strictly owner-only)
async function getAddressById(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const address = await prisma.patientAddress.findUnique({
      where: { id }
    });

    if (!address) {
      return res.status(404).json({ success: false, error: 'Address not found.' });
    }

    if (address.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Access to this address is restricted.' });
    }

    return res.json({
      success: true,
      address,
      formattedAddress: formatAddressString(address)
    });
  } catch (err) {
    console.error('getAddressById error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve address.' });
  }
}

// POST /api/addresses - Create new patient address
async function createAddress(req, res) {
  try {
    const userId = req.user.id;
    const {
      label,
      recipientName,
      phone,
      addressLine1,
      addressLine2,
      landmark,
      city,
      state,
      postalCode,
      isDefault
    } = req.body;

    const validationError = validateAddressData({ addressLine1, city, state, postalCode, phone });
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    // Check existing addresses count to auto-set default if it's their first address
    const existingCount = await prisma.patientAddress.count({ where: { userId } });
    const makeDefault = Boolean(isDefault) || existingCount === 0;

    const newAddress = await prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.patientAddress.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false }
        });
      }

      return tx.patientAddress.create({
        data: {
          userId,
          label: (label && typeof label === 'string' && label.trim()) || 'Home',
          recipientName: recipientName ? recipientName.trim() : null,
          phone: phone ? phone.trim() : null,
          addressLine1: addressLine1.trim(),
          addressLine2: addressLine2 ? addressLine2.trim() : null,
          landmark: landmark ? landmark.trim() : null,
          city: city.trim(),
          state: state.trim(),
          postalCode: postalCode.trim(),
          isDefault: makeDefault
        }
      });
    });

    return res.status(201).json({
      success: true,
      message: 'Address saved successfully.',
      address: newAddress,
      formattedAddress: formatAddressString(newAddress)
    });
  } catch (err) {
    console.error('createAddress error:', err);
    return res.status(500).json({ success: false, error: 'Failed to save address.' });
  }
}

// PUT /api/addresses/:id - Update an address (strictly owner-only)
async function updateAddress(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const existing = await prisma.patientAddress.findUnique({
      where: { id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Address not found.' });
    }

    if (existing.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Cannot modify an address that does not belong to you.' });
    }

    const {
      label,
      recipientName,
      phone,
      addressLine1,
      addressLine2,
      landmark,
      city,
      state,
      postalCode,
      isDefault
    } = req.body;

    const validationError = validateAddressData({
      addressLine1: addressLine1 !== undefined ? addressLine1 : existing.addressLine1,
      city: city !== undefined ? city : existing.city,
      state: state !== undefined ? state : existing.state,
      postalCode: postalCode !== undefined ? postalCode : existing.postalCode,
      phone: phone !== undefined ? phone : existing.phone
    });

    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const updatedAddress = await prisma.$transaction(async (tx) => {
      if (isDefault === true) {
        await tx.patientAddress.updateMany({
          where: { userId, isDefault: true, id: { not: id } },
          data: { isDefault: false }
        });
      }

      return tx.patientAddress.update({
        where: { id },
        data: {
          label: label !== undefined ? String(label).trim() : existing.label,
          recipientName: recipientName !== undefined ? (recipientName ? String(recipientName).trim() : null) : existing.recipientName,
          phone: phone !== undefined ? (phone ? String(phone).trim() : null) : existing.phone,
          addressLine1: addressLine1 !== undefined ? String(addressLine1).trim() : existing.addressLine1,
          addressLine2: addressLine2 !== undefined ? (addressLine2 ? String(addressLine2).trim() : null) : existing.addressLine2,
          landmark: landmark !== undefined ? (landmark ? String(landmark).trim() : null) : existing.landmark,
          city: city !== undefined ? String(city).trim() : existing.city,
          state: state !== undefined ? String(state).trim() : existing.state,
          postalCode: postalCode !== undefined ? String(postalCode).trim() : existing.postalCode,
          isDefault: isDefault !== undefined ? Boolean(isDefault) : existing.isDefault
        }
      });
    });

    return res.json({
      success: true,
      message: 'Address updated successfully.',
      address: updatedAddress,
      formattedAddress: formatAddressString(updatedAddress)
    });
  } catch (err) {
    console.error('updateAddress error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update address.' });
  }
}

// DELETE /api/addresses/:id - Delete an address (strictly owner-only)
async function deleteAddress(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const existing = await prisma.patientAddress.findUnique({
      where: { id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Address not found.' });
    }

    if (existing.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Cannot delete an address that does not belong to you.' });
    }

    await prisma.patientAddress.delete({
      where: { id }
    });

    return res.json({
      success: true,
      message: 'Address removed successfully.'
    });
  } catch (err) {
    console.error('deleteAddress error:', err);
    return res.status(500).json({ success: false, error: 'Failed to delete address.' });
  }
}

// PUT /api/addresses/:id/default - Select / mark address as default (strictly owner-only)
async function setDefaultAddress(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const existing = await prisma.patientAddress.findUnique({
      where: { id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Address not found.' });
    }

    if (existing.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Cannot select an address that does not belong to you.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.patientAddress.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false }
      });

      return tx.patientAddress.update({
        where: { id },
        data: { isDefault: true }
      });
    });

    return res.json({
      success: true,
      message: 'Address set as primary default.',
      address: updated,
      formattedAddress: formatAddressString(updated)
    });
  } catch (err) {
    console.error('setDefaultAddress error:', err);
    return res.status(500).json({ success: false, error: 'Failed to set default address.' });
  }
}

module.exports = {
  validateAddressData,
  formatAddressString,
  getAddresses,
  getAddressById,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress
};
