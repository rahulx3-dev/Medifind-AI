const prisma = require('../prisma');
const bcrypt = require('bcryptjs');
const { computeOpenStatus } = require('../utils/openHoursParser');

/**
 * GET /api/admin/users
 * Returns system users omitting password and hash fields.
 */
async function getAdminUsers(req, res) {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
        pharmacy: {
          select: {
            id: true,
            name: true
          }
        },
        assistantProfile: {
          select: {
            id: true,
            assistantType: true,
            verificationStatus: true,
            operatingCity: true,
            operatingRadiusKm: true,
            onboardingCompleted: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.json({
      success: true,
      count: users.length,
      users
    });
  } catch (err) {
    console.error('getAdminUsers error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve users.' });
  }
}

/**
 * GET /api/admin/pharmacies
 * Returns all pharmacies with manager contact, inventory count, and dynamic test fixture classification.
 * Derived dynamically from verificationStatus === 'TEST' (not forced for all records).
 */
async function getAdminPharmacies(req, res) {
  try {
    const pharmacies = await prisma.pharmacy.findMany({
      include: {
        manager: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        _count: {
          select: {
            inventory: true,
            orders: true
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    const enriched = pharmacies.map(p => {
      // Dynamic fixture classification derived from actual DB verificationStatus
      const isTestRecord = p.verificationStatus === 'TEST';
      const isParticipating = p.isVerified === true && p.verificationStatus === 'VERIFIED' && !isTestRecord;
      const participationStatus = isParticipating
        ? 'PARTICIPATING_REAL_PHARMACY'
        : isTestRecord
        ? 'TEST_FIXTURE'
        : 'UNVERIFIED_PENDING';
      const testDataNote = isTestRecord ? 'TEST DATA — NOT A PARTICIPATING PHARMACY' : null;

      const computedOpenStatus = computeOpenStatus(p.openingHours, p.isOpen);

      return {
        id: p.id,
        name: p.name,
        licenseNumber: p.licenseNumber,
        address: p.address,
        latitude: p.latitude,
        longitude: p.longitude,
        coordinatesAvailable: (p.latitude != null && p.longitude != null),
        phone: p.phone,
        isOpen: p.isOpen,
        is24x7: p.is24x7,
        isVerified: p.isVerified,
        verificationStatus: p.verificationStatus,
        isParticipating,
        participationStatus,
        dataSource: p.dataSource,
        googleMapsUrl: p.googleMapsUrl,
        emergencyAvailability: p.emergencyAvailability || false,
        deliveryAvailable: p.deliveryAvailable || false,
        rating: p.rating,
        openingHours: p.openingHours,
        computedOpenStatus,
        isTestRecord,
        testDataNote,
        inventoryCount: p._count?.inventory || 0,
        ordersCount: p._count?.orders || 0,
        manager: p.manager,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      };
    });

    return res.json({
      success: true,
      count: enriched.length,
      pharmacies: enriched
    });
  } catch (err) {
    console.error('getAdminPharmacies error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve pharmacies.' });
  }
}

/**
 * GET /api/admin/orders
 * Returns all system orders with patient, pharmacy, items, and status history.
 */
async function getAdminOrders(req, res) {
  try {
    const orders = await prisma.order.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        pharmacy: {
          select: {
            id: true,
            name: true,
            phone: true,
            address: true
          }
        },
        items: {
          include: {
            medicine: true
          }
        },
        statusHistory: {
          orderBy: { createdAt: 'asc' }
        },
        assistantTask: {
          select: {
            id: true,
            status: true,
            assistant: {
              select: {
                id: true,
                name: true,
                phone: true
              }
            }
          }
        },
        // Phase 5.5: Safe payment metadata for admin — no secrets, no card data
        payment: {
          select: {
            id: true,
            status: true,
            method: true,
            amount: true,
            currency: true,
            gateway: true,
            gatewayOrderId: true,
            gatewayPaymentId: true, // safe for admin audit
            paidAt: true,
            refundedAt: true,
            failureReason: true,
            createdAt: true
            // gatewaySignature: EXCLUDED — never expose to any portal
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const sanitizedOrders = orders.map(o => {
      const copy = { ...o };
      delete copy.verificationPin;
      return copy;
    });

    return res.json({
      success: true,
      count: sanitizedOrders.length,
      orders: sanitizedOrders
    });
  } catch (err) {
    console.error('getAdminOrders error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve orders.' });
  }
}

/**
 * GET /api/admin/emergency-requests
 * Emergency logistics & assistant tasks.
 * PRIVACY GUARD: Never exposes secret handoverPin or verificationPin.
 * Returns boolean flags: hasHandoverPin, hasVerificationPin, isVerified.
 */
async function getAdminEmergencyRequests(req, res) {
  try {
    // 1. Fetch assistant delivery tasks
    const tasks = await prisma.assistantTask.findMany({
      include: {
        order: {
          include: {
            pharmacy: {
              select: {
                id: true,
                name: true,
                phone: true,
                address: true
              }
            },
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true
              }
            },
            items: {
              include: {
                medicine: true
              }
            }
          }
        },
        assistant: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // 2. Fetch emergency classified orders
    const emergencyOrders = await prisma.order.findMany({
      where: {
        OR: [
          { orderType: 'EMERGENCY' },
          { items: { some: { medicine: { isEmergency: true } } } }
        ]
      },
      include: {
        pharmacy: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        },
        items: {
          include: {
            medicine: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Sanitize assistant tasks: strictly omit handoverPin and order.verificationPin
    const sanitizedTasks = tasks.map(task => ({
      id: task.id,
      orderId: task.orderId,
      orderNumber: task.order?.orderNumber,
      orderType: task.order?.orderType,
      status: task.status,
      deliveryAddress: task.deliveryAddress,
      deliveryNotes: task.deliveryNotes,
      hasHandoverPin: Boolean(task.handoverPin),
      hasVerificationPin: Boolean(task.order?.verificationPin),
      isVerified: task.status === 'CONFIRMED' || task.status === 'DELIVERED',
      acceptedAt: task.acceptedAt,
      collectedAt: task.collectedAt,
      deliveredAt: task.deliveredAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      assistant: task.assistant,
      patient: task.order?.user,
      pharmacy: task.order?.pharmacy,
      items: task.order?.items
    }));

    // Sanitize emergency orders: strictly omit verificationPin
    const sanitizedOrders = emergencyOrders.map(order => ({
      id: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      status: order.status,
      totalAmount: order.totalAmount,
      hasVerificationPin: Boolean(order.verificationPin),
      createdAt: order.createdAt,
      patient: order.user,
      pharmacy: order.pharmacy,
      items: order.items
    }));

    return res.json({
      success: true,
      tasksCount: sanitizedTasks.length,
      emergencyOrdersCount: sanitizedOrders.length,
      tasks: sanitizedTasks,
      emergencyOrders: sanitizedOrders
    });
  } catch (err) {
    console.error('getAdminEmergencyRequests error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve emergency requests.' });
  }
}

/**
 * GET /api/admin/activity
 * Aggregates recent records from OrderStatusHistory and Notification to form a unified activity timeline
 * without any new audit tables.
 */
async function getAdminActivity(req, res) {
  try {
    const [recentHistory, recentNotifications] = await Promise.all([
      prisma.orderStatusHistory.findMany({
        take: 30,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            include: {
              pharmacy: { select: { name: true } },
              user: { select: { name: true } }
            }
          }
        }
      }),
      prisma.notification.findMany({
        take: 30,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { name: true, role: true } }
        }
      })
    ]);

    const timeline = [];

    // Map OrderStatusHistory
    for (const h of recentHistory) {
      timeline.push({
        id: `osh-${h.id}`,
        type: 'ORDER_STATUS',
        title: `Order Status: ${h.status}`,
        description: h.comment || `Order updated to ${h.status}`,
        timestamp: h.createdAt,
        actor: h.order?.user?.name || 'System',
        target: h.order?.pharmacy?.name || 'Pharmacy',
        metadata: {
          orderId: h.orderId,
          status: h.status
        }
      });
    }

    // Map Notifications
    for (const n of recentNotifications) {
      timeline.push({
        id: `notif-${n.id}`,
        type: 'NOTIFICATION',
        title: n.title,
        description: n.message,
        timestamp: n.createdAt,
        actor: n.user?.name || 'System User',
        target: n.user?.role || 'Recipient',
        metadata: {
          notifType: n.type,
          linkUrl: n.linkUrl
        }
      });
    }

    // Sort descending by timestamp
    timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return res.json({
      success: true,
      count: timeline.length,
      activity: timeline.slice(0, 50)
    });
  } catch (err) {
    console.error('getAdminActivity error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve system activity.' });
  }
}

// POST /api/admin/alert-restock
// Send automated restock advisory & dispatch notification to the pharmacy manager
async function alertRestock(req, res) {
  try {
    const { pharmacyId, medicineId, note, targetUnits = 25 } = req.body;

    if (!pharmacyId || !medicineId) {
      return res.status(400).json({ success: false, error: 'pharmacyId and medicineId are required.' });
    }

    const [pharmacy, medicine, inventory] = await Promise.all([
      prisma.pharmacy.findUnique({
        where: { id: pharmacyId },
        include: { manager: true }
      }),
      prisma.medicine.findUnique({
        where: { id: medicineId }
      }),
      prisma.inventory.findUnique({
        where: { pharmacyId_medicineId: { pharmacyId, medicineId } }
      })
    ]);

    if (!pharmacy) {
      return res.status(404).json({ success: false, error: 'Pharmacy not found.' });
    }
    if (!medicine) {
      return res.status(404).json({ success: false, error: 'Medicine not found.' });
    }

    const currentStock = inventory ? (inventory.stock != null ? inventory.stock : 0) : 0;
    const isCritical = currentStock <= 5;
    const alertLevel = isCritical ? 'CRITICAL DEPLETION' : 'BUFFER REPLENISHMENT ADVISORY';

    // 1. Dispatch Notification to the Pharmacist (Manager)
    if (pharmacy.managerId) {
      await prisma.notification.create({
        data: {
          userId: pharmacy.managerId,
          title: `⚠️ ${alertLevel}: ${medicine.brandName}`,
          message: note || `System Administrator has issued an urgent restock advisory for ${medicine.brandName} (${medicine.genericName || medicine.category}). Current verified stock is ${currentStock} unit(s). Recommended minimum replenishment: ${targetUnits} units.`,
          type: 'PHARMACY',
          linkUrl: '/pharmacist-portal'
        }
      });
    }

    // 2. Also record an Admin audit notification
    await prisma.notification.create({
      data: {
        userId: req.user.id,
        title: `Restock Advisory Dispatched`,
        message: `Admin ${req.user.name} dispatched restock advisory to ${pharmacy.name} for ${medicine.brandName} (Stock: ${currentStock}).`,
        type: 'ADMIN',
        linkUrl: '/admin-dashboard'
      }
    });

    return res.json({
      success: true,
      message: `Restock advisory successfully dispatched to ${pharmacy.name}.`,
      alert: {
        pharmacyId,
        pharmacyName: pharmacy.name,
        medicineId,
        medicineName: medicine.brandName,
        currentStock,
        dispatchedAt: new Date()
      }
    });
  } catch (err) {
    console.error('alertRestock error:', err);
    return res.status(500).json({ success: false, error: 'Failed to dispatch restock advisory.' });
  }
}

// POST /api/admin/allocate-stock
// Emergency direct buffer replenishment by administrator
async function allocateStock(req, res) {
  try {
    const { pharmacyId, medicineId, additionalUnits = 20 } = req.body;
    if (!pharmacyId || !medicineId) {
      return res.status(400).json({ success: false, error: 'pharmacyId and medicineId are required.' });
    }

    const inv = await prisma.inventory.findUnique({
      where: { pharmacyId_medicineId: { pharmacyId, medicineId } }
    });

    const currentStock = inv ? (inv.stock != null ? inv.stock : 0) : 0;
    const newStock = currentStock + Number(additionalUnits);

    const updated = await prisma.inventory.upsert({
      where: { pharmacyId_medicineId: { pharmacyId, medicineId } },
      update: {
        stock: newStock,
        status: newStock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
        lastUpdated: new Date()
      },
      create: {
        pharmacyId,
        medicineId,
        stock: newStock,
        status: newStock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
        price: 50.0,
        batchNumber: `EMERGENCY-BUFFER-${Date.now()}`
      },
      include: { medicine: true, pharmacy: true }
    });

    // Notify pharmacy manager
    if (updated.pharmacy?.managerId) {
      await prisma.notification.create({
        data: {
          userId: updated.pharmacy.managerId,
          title: `Emergency Stock Injected: +${additionalUnits} units`,
          message: `Administrator injected emergency reserve buffer (+${additionalUnits} units) for ${updated.medicine.brandName}. New stock: ${newStock}.`,
          type: 'PHARMACY',
          linkUrl: '/pharmacist-portal'
        }
      });
    }

    return res.json({
      success: true,
      message: `Successfully allocated +${additionalUnits} units to ${updated.pharmacy.name}. New stock: ${newStock}.`,
      inventory: updated
    });
  } catch (err) {
    console.error('allocateStock error:', err);
    return res.status(500).json({ success: false, error: 'Failed to allocate emergency stock.' });
  }
}

/**
 * POST /api/admin/pharmacies
 * Create a new participating pharmacy with manager account and seeded catalog inventory.
 */
async function createAdminPharmacy(req, res) {
  try {
    const {
      name,
      address,
      phone,
      licenseNumber,
      openingHours,
      is24x7,
      deliveryAvailable,
      emergencyAvailability,
      latitude,
      longitude,
      managerEmail,
      managerPassword,
      managerName,
      managerPhone
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Pharmacy name is required.' });
    }
    if (!address || !address.trim()) {
      return res.status(400).json({ success: false, error: 'Address is required.' });
    }
    if (!phone || !phone.trim()) {
      return res.status(400).json({ success: false, error: 'Contact phone number is required.' });
    }
    if (!managerEmail || !managerEmail.trim() || !managerEmail.includes('@')) {
      return res.status(400).json({ success: false, error: 'A valid manager email address is required.' });
    }
    if (!managerPassword || managerPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Initial password must be at least 6 characters long.' });
    }

    const trimmedEmail = managerEmail.trim().toLowerCase();

    // Check if user already exists
    let managerUser = await prisma.user.findUnique({
      where: { email: trimmedEmail },
      include: { pharmacy: true }
    });

    if (managerUser) {
      if (managerUser.pharmacy) {
        return res.status(400).json({
          success: false,
          error: `User with email ${trimmedEmail} already manages pharmacy "${managerUser.pharmacy.name}". Use a unique email for each dispensary manager.`
        });
      }
      // If user exists without a pharmacy, promote/ensure role is PHARMACIST
      managerUser = await prisma.user.update({
        where: { id: managerUser.id },
        data: {
          role: 'PHARMACIST',
          name: managerName ? managerName.trim() : managerUser.name,
          phone: managerPhone ? managerPhone.trim() : managerUser.phone
        }
      });
    } else {
      const hashedPassword = await bcrypt.hash(managerPassword, 10);
      managerUser = await prisma.user.create({
        data: {
          email: trimmedEmail,
          password: hashedPassword,
          name: managerName ? managerName.trim() : `${name.trim()} Pharmacist`,
          phone: (managerPhone || phone).trim(),
          role: 'PHARMACIST'
        }
      });
    }

    // Default license number if not specified
    const finalLicense = licenseNumber && licenseNumber.trim()
      ? licenseNumber.trim()
      : `KL-ALPY-${Math.floor(10000 + Math.random() * 90000)}`;

    // Create Pharmacy
    const pharmacy = await prisma.pharmacy.create({
      data: {
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim(),
        licenseNumber: finalLicense,
        openingHours: openingHours && openingHours.trim() ? openingHours.trim() : '09:00–21:00',
        is24x7: Boolean(is24x7),
        isOpen: true,
        deliveryAvailable: Boolean(deliveryAvailable),
        emergencyAvailability: Boolean(emergencyAvailability),
        latitude: latitude != null && !isNaN(Number(latitude)) ? Number(latitude) : null,
        longitude: longitude != null && !isNaN(Number(longitude)) ? Number(longitude) : null,
        isVerified: true,
        verificationStatus: 'VERIFIED',
        dataSource: 'PHARMACY_PROVIDED',
        managerId: managerUser.id
      },
      include: {
        manager: {
          select: { id: true, name: true, email: true, phone: true, role: true }
        }
      }
    });

    // Seed initial catalogue medicines into this dispensary's inventory
    const catalogueMeds = await prisma.medicine.findMany({
      select: { id: true, isEmergency: true }
    });

    if (catalogueMeds.length > 0) {
      await prisma.inventory.createMany({
        data: catalogueMeds.map(m => ({
          pharmacyId: pharmacy.id,
          medicineId: m.id,
          stock: m.isEmergency ? 15 : 20,
          price: 45.0,
          status: 'AVAILABLE'
        })),
        skipDuplicates: true
      });
    }

    const computedOpenStatus = computeOpenStatus(pharmacy.openingHours, pharmacy.isOpen);

    return res.status(201).json({
      success: true,
      message: `Pharmacy "${pharmacy.name}" registered successfully.`,
      pharmacy: {
        ...pharmacy,
        computedOpenStatus,
        inventoryCount: catalogueMeds.length
      },
      credentials: {
        pharmacyId: pharmacy.id,
        managerEmail: managerUser.email,
        phone: pharmacy.phone,
        loginPortal: '/pharmacist'
      }
    });
  } catch (err) {
    console.error('createAdminPharmacy error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to create pharmacy.' });
  }
}

/**
 * PUT /api/admin/pharmacies/:id
 * Update an existing pharmacy and optionally update its manager details.
 */
async function updateAdminPharmacy(req, res) {
  try {
    const { id } = req.params;
    const {
      name,
      address,
      phone,
      licenseNumber,
      openingHours,
      isOpen,
      is24x7,
      deliveryAvailable,
      emergencyAvailability,
      latitude,
      longitude,
      managerEmail,
      managerPassword,
      managerName
    } = req.body;

    const existing = await prisma.pharmacy.findUnique({
      where: { id },
      include: { manager: true }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Pharmacy not found.' });
    }

    const pharmacyData = {};
    if (name !== undefined) pharmacyData.name = name.trim();
    if (address !== undefined) pharmacyData.address = address.trim();
    if (phone !== undefined) pharmacyData.phone = phone.trim();
    if (licenseNumber !== undefined) pharmacyData.licenseNumber = licenseNumber.trim();
    if (openingHours !== undefined) pharmacyData.openingHours = openingHours.trim();
    if (isOpen !== undefined) pharmacyData.isOpen = Boolean(isOpen);
    if (is24x7 !== undefined) pharmacyData.is24x7 = Boolean(is24x7);
    if (deliveryAvailable !== undefined) pharmacyData.deliveryAvailable = Boolean(deliveryAvailable);
    if (emergencyAvailability !== undefined) pharmacyData.emergencyAvailability = Boolean(emergencyAvailability);
    if (latitude !== undefined) pharmacyData.latitude = latitude != null && !isNaN(Number(latitude)) ? Number(latitude) : null;
    if (longitude !== undefined) pharmacyData.longitude = longitude != null && !isNaN(Number(longitude)) ? Number(longitude) : null;

    const updated = await prisma.pharmacy.update({
      where: { id },
      data: pharmacyData,
      include: {
        manager: {
          select: { id: true, name: true, email: true, phone: true }
        },
        _count: {
          select: { inventory: true, orders: true }
        }
      }
    });

    // Update manager user credentials if provided
    if (existing.managerId && (managerEmail || managerPassword || managerName)) {
      const userData = {};
      if (managerEmail && managerEmail.trim().includes('@')) userData.email = managerEmail.trim().toLowerCase();
      if (managerName && managerName.trim()) userData.name = managerName.trim();
      if (managerPassword && managerPassword.length >= 6) {
        userData.password = await bcrypt.hash(managerPassword, 10);
      }
      if (Object.keys(userData).length > 0) {
        await prisma.user.update({
          where: { id: existing.managerId },
          data: userData
        });
      }
    }

    const computedOpenStatus = computeOpenStatus(updated.openingHours, updated.isOpen);

    return res.json({
      success: true,
      message: `Pharmacy "${updated.name}" updated successfully.`,
      pharmacy: {
        ...updated,
        computedOpenStatus
      }
    });
  } catch (err) {
    console.error('updateAdminPharmacy error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to update pharmacy.' });
  }
}

/**
 * DELETE /api/admin/pharmacies/:id
 * Delete an existing pharmacy and associated inventories.
 */
async function deleteAdminPharmacy(req, res) {
  try {
    const { id } = req.params;

    const pharmacy = await prisma.pharmacy.findUnique({
      where: { id },
      include: { manager: true }
    });

    if (!pharmacy) {
      return res.status(404).json({ success: false, error: 'Pharmacy not found.' });
    }

    // Safely cleanup dependent records
    await prisma.$transaction(async (tx) => {
      // 1. Delete restock requests for this pharmacy
      await tx.restockRequest.deleteMany({ where: { pharmacyId: id } });

      // 2. Clear prescription clarifications
      if (tx.prescriptionClarification) {
        await tx.prescriptionClarification.deleteMany({ where: { pharmacyId: id } });
      }

      // 3. Clear clinical assistance assignments
      if (tx.clinicalAssistanceAssignment) {
        await tx.clinicalAssistanceAssignment.deleteMany({ where: { pharmacyId: id } });
      }

      // 4. Delete orders & order items if any
      const orders = await tx.order.findMany({ where: { pharmacyId: id }, select: { id: true } });
      if (orders.length > 0) {
        const orderIds = orders.map(o => o.id);
        await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
        await tx.order.deleteMany({ where: { pharmacyId: id } });
      }

      // 5. Delete inventories
      await tx.inventory.deleteMany({ where: { pharmacyId: id } });

      // 6. Delete pharmacy
      await tx.pharmacy.delete({ where: { id } });

      // 7. Delete pharmacist manager account
      if (pharmacy.managerId) {
        await tx.user.delete({ where: { id: pharmacy.managerId } }).catch(() => {});
      }
    });

    return res.json({
      success: true,
      message: `Pharmacy "${pharmacy.name}" and associated records deleted successfully.`
    });
  } catch (err) {
    console.error('deleteAdminPharmacy error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to delete pharmacy.' });
  }
}

/**
 * PUT /api/admin/assistants/:userId/verify
 * Allows administrators to verify and authorize delivery assistants and professionals.
 */
async function verifyAssistant(req, res) {
  try {
    const { userId } = req.params;
    const { status = 'APPROVED' } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { assistantProfile: true }
    });

    if (!user || user.role !== 'ASSISTANT') {
      return res.status(404).json({ success: false, error: 'Assistant user not found.' });
    }

    const profile = user.assistantProfile;
    if (!profile) {
      return res.status(404).json({ success: false, error: 'Assistant profile not found.' });
    }

    const updated = await prisma.assistantProfile.update({
      where: { id: profile.id },
      data: {
        verificationStatus: status,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
        updatedAt: new Date()
      }
    });

    return res.json({
      success: true,
      message: `Assistant ${user.name} verification status updated to ${status}.`,
      assistantProfile: updated
    });
  } catch (err) {
    console.error('verifyAssistant error:', err);
    return res.status(500).json({ success: false, error: 'Failed to verify assistant.' });
  }
}

module.exports = {
  getAdminUsers,
  getAdminPharmacies,
  createAdminPharmacy,
  updateAdminPharmacy,
  deleteAdminPharmacy,
  getAdminOrders,
  getAdminEmergencyRequests,
  getAdminActivity,
  alertRestock,
  allocateStock,
  verifyAssistant
};
