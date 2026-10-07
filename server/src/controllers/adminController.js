const prisma = require('../prisma');

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

module.exports = {
  getAdminUsers,
  getAdminPharmacies,
  getAdminOrders,
  getAdminEmergencyRequests,
  getAdminActivity
};
