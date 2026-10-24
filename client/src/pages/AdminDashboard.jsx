import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { motion } from 'motion/react';
import ConfirmationDialog from '../components/ConfirmationDialog';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { broadcastUpdate, useRealtimeRefresh } from '../utils/realtimeUpdates';
import StatsBand from '../components/ui/StatsBand';
import { useAuth } from '../context/AuthContext';
import { usePortalGreeting } from '../utils/greetingUtils';
import FlowButton from '../components/FlowButton';
import RollingNumber from '../components/ui/RollingNumber';
import { AnimatedIcon } from '../components/ui/AnimatedStatCard';

/**
 * Interactive Admin KPI Card matching patient orders card:
 * - Hover elevation (-5px) & spring physics
 * - Dynamic diagonal sheen glare across the card
 * - Hover scale & micro-motion on AnimatedIcon
 * - Smoothly expanding bottom accent line
 */
function AdminKpiCard({
  title,
  value,
  subtitle,
  footer,
  icon,
  iconBg = '#e0f2eb',
  iconColor = '#032f28',
  accentColor = '#2e685d',
  isAlert = false,
  alertBorder = '#ffb4a8',
  alertBg = '#fff8f6',
  onClick,
  progressPercent
}) {
  const [isHovered, setIsHovered] = useState(false);
  const isClickable = Boolean(onClick);

  return (
    <motion.div
      onClick={onClick}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      whileHover={{
        y: -5,
        boxShadow: isAlert
          ? '0 12px 28px rgba(186,26,26,0.12), 0 2px 6px rgba(0,0,0,0.02)'
          : '0 12px 28px rgba(3,47,40,0.1), 0 2px 6px rgba(0,0,0,0.02)',
        borderColor: isAlert ? '#ba1a1a' : '#2e685d',
        transition: { type: 'spring', stiffness: 350, damping: 22 }
      }}
      whileTap={isClickable ? { scale: 0.98 } : undefined}
      style={{
        background: isAlert ? alertBg : '#ffffff',
        borderRadius: 18,
        padding: '1.2rem',
        border: isAlert ? `1.5px solid ${alertBorder}` : '1px solid #e0f2eb',
        boxShadow: isAlert ? '0 2px 8px rgba(186,26,26,0.06)' : '0 1px 4px rgba(3,47,40,0.04)',
        cursor: isClickable ? 'pointer' : 'default',
        position: 'relative',
        overflow: 'hidden',
        transition: 'border-color 0.25s ease, background-color 0.25s ease'
      }}
    >
      {/* Left Accent Bar matching patient orders card */}
      <motion.div
        initial={false}
        animate={{
          width: isHovered ? 6 : 4,
          opacity: isHovered ? 1 : 0.85
        }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          background: isAlert ? '#ba1a1a' : accentColor,
          zIndex: 4
        }}
      />

      {/* Interactive Sheen Glare across the card on hover */}
      <motion.div
        initial={false}
        animate={{
          x: isHovered ? '250%' : '-150%',
          opacity: isHovered ? 1 : 0
        }}
        transition={{ duration: 0.65, ease: 'easeInOut' }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '50%',
          height: '100%',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.65), transparent)',
          transform: 'skewX(-20deg)',
          pointerEvents: 'none',
          zIndex: 1
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', position: 'relative', zIndex: 2 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: isAlert ? '#ba1a1a' : '#2e685d' }}>
          {title}
        </span>
        <motion.div
          animate={{
            scale: isHovered ? 1.15 : 1,
            y: isHovered ? -2 : 0
          }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            background: iconBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: iconColor
          }}
        >
          <AnimatedIcon name={icon} isHovered={isHovered} size={18} color={iconColor} />
        </motion.div>
      </div>

      <div style={{ fontSize: 26, fontWeight: 800, color: isAlert ? '#93000a' : '#032f28', letterSpacing: '-0.02em', lineHeight: 1.15, position: 'relative', zIndex: 2 }}>
        {value}
      </div>

      <div style={{ fontSize: 11, fontWeight: 600, color: isAlert ? '#ba1a1a' : '#2e685d', marginTop: '0.4rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', position: 'relative', zIndex: 2 }}>
        {subtitle}
      </div>

      {progressPercent !== undefined && (
        <div style={{ height: 4, borderRadius: 99, background: '#e6f8f1', overflow: 'hidden', marginTop: '0.5rem', position: 'relative', zIndex: 2 }}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            style={{
              height: '100%',
              background: '#2e685d',
              borderRadius: 99
            }}
          />
        </div>
      )}

      {footer && (
        <div style={{ position: 'relative', zIndex: 2, marginTop: '0.45rem' }}>
          {footer}
        </div>
      )}

      {/* Animated Bottom Accent Line */}
      <motion.div
        initial={false}
        animate={{
          scaleX: isHovered ? 1 : 0.35,
          opacity: isHovered ? 1 : 0.6
        }}
        transition={{ duration: 0.3 }}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background: accentColor,
          transformOrigin: 'left center',
          zIndex: 3
        }}
      />
    </motion.div>
  );
}

/**
 * Interactive Administrative Action Hub Card matching patient orders card:
 * - Hover elevation (-4px), tactile spring physics & tap scale (0.96)
 * - Animated icon with spring micro-motion
 * - Diagonal sheen glare sweep
 * - Bottom accent glow bar & forward arrow nudge
 */
function AdminActionHubCard({
  icon,
  title,
  subtitle,
  badgeText,
  onClick,
  variant = 'default' // 'default' | 'accent' | 'dark'
}) {
  const [isHovered, setIsHovered] = useState(false);

  const isDark = variant === 'dark';
  const isAccent = variant === 'accent';

  return (
    <motion.button
      type="button"
      onClick={onClick}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      whileHover={{
        y: -4,
        boxShadow: isDark
          ? '0 12px 28px rgba(3,47,40,0.25)'
          : isAccent
            ? '0 12px 28px rgba(46,104,93,0.18)'
            : '0 10px 24px rgba(3,47,40,0.1)',
        borderColor: isDark ? '#1e453e' : '#2e685d',
        transition: { type: 'spring', stiffness: 350, damping: 22 }
      }}
      whileTap={{ scale: 0.96 }}
      style={{
        position: 'relative',
        padding: '1rem',
        borderRadius: 16,
        background: isDark
          ? 'linear-gradient(135deg, #032f28 0%, #1e453e 100%)'
          : isAccent
            ? 'linear-gradient(135deg, #e0f2eb 0%, #f0fdf8 100%)'
            : '#ffffff',
        border: isDark
          ? '1px solid #1e453e'
          : isAccent
            ? '1.5px solid #b0ecdd'
            : '1px solid #d5e6e0',
        color: isDark ? '#ffffff' : '#032f28',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '0.45rem',
        textAlign: 'left',
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(3,47,40,0.04)',
        transition: 'border-color 0.25s ease'
      }}
    >
      {/* Left Accent Bar matching patient orders card */}
      <motion.div
        initial={false}
        animate={{
          width: isHovered ? 6 : 4,
          opacity: isHovered ? 1 : 0.85
        }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          background: isDark ? '#34d399' : '#2e685d',
          zIndex: 4
        }}
      />

      {/* Sheen Glare across the button on hover */}
      <motion.div
        initial={false}
        animate={{
          x: isHovered ? '250%' : '-150%',
          opacity: isHovered ? 1 : 0
        }}
        transition={{ duration: 0.65, ease: 'easeInOut' }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '50%',
          height: '100%',
          background: isDark
            ? 'linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)'
            : 'linear-gradient(90deg, transparent, rgba(255,255,255,0.65), transparent)',
          transform: 'skewX(-20deg)',
          pointerEvents: 'none',
          zIndex: 1
        }}
      />

      <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 2 }}>
        <motion.div
          animate={{
            scale: isHovered ? 1.18 : 1,
            y: isHovered ? -2 : 0,
            rotate: isHovered ? [0, -6, 6, 0] : 0
          }}
          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
          style={{
            width: 36,
            height: 36,
            borderRadius: 11,
            background: isDark
              ? 'rgba(255,255,255,0.12)'
              : isAccent
                ? '#b0ecdd'
                : '#e0f2eb',
            color: isDark ? '#a7f3d0' : '#2e685d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
            {icon}
          </span>
        </motion.div>

        {badgeText && (
          <span style={{
            fontSize: 10.5,
            fontWeight: 800,
            padding: '2px 8px',
            borderRadius: 99,
            background: isDark ? '#059669' : '#2e685d',
            color: '#ffffff',
            letterSpacing: '0.02em'
          }}>
            {badgeText}
          </span>
        )}
      </div>

      <div style={{ position: 'relative', zIndex: 2, marginTop: '0.2rem' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: isDark ? '#ffffff' : '#032f28', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span>{title}</span>
          <motion.span
            animate={{ x: isHovered ? 3 : 0 }}
            className="material-symbols-outlined"
            style={{ fontSize: 15, opacity: 0.8 }}
          >
            arrow_forward
          </motion.span>
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: isDark ? '#a7f3d0' : '#717976', marginTop: 2, fontWeight: 500 }}>
            {subtitle}
          </div>
        )}
      </div>

      {/* Bottom accent glow bar */}
      <motion.div
        initial={false}
        animate={{
          scaleX: isHovered ? 1 : 0.3,
          opacity: isHovered ? 1 : 0.5
        }}
        transition={{ duration: 0.25 }}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background: isDark ? '#34d399' : '#2e685d',
          transformOrigin: 'left center',
          zIndex: 3
        }}
      />
    </motion.button>
  );
}

export default function AdminDashboard({ currentTab, onTabChange }) {
  const { user } = useAuth();
  const { firstName: adminFirstName, timeGreet: adminTimeGreet, icon: adminGreetIcon } = usePortalGreeting(user, 'ADMIN');
  const [internalTab, setInternalTab] = useState('overview');
  const activeTab = currentTab !== undefined ? currentTab : internalTab;
  const setActiveTab = onTabChange || setInternalTab;
  const [metrics, setMetrics] = useState(null);
  const [usersList, setUsersList] = useState([]);
  const [pharmaciesList, setPharmaciesList] = useState([]);
  const [ordersList, setOrdersList] = useState([]);
  const [emergencyData, setEmergencyData] = useState({ tasks: [], emergencyOrders: [] });
  const [activityList, setActivityList] = useState([]);
  const [verificationsList, setVerificationsList] = useState([]);
  const [appointmentsList, setAppointmentsList] = useState([]);
  const [verificationFilter, setVerificationFilter] = useState('ALL');
  const [selectedApp, setSelectedApp] = useState(null);
  const [actionReason, setActionReason] = useState('');
  const [approvalServices, setApprovalServices] = useState([]);
  const [reviewChecklist, setReviewChecklist] = useState({
    identityVerified: false,
    councilActive: false,
    qualificationValid: false,
    scopeAppropriate: false
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [detectingGpsPharmacy, setDetectingGpsPharmacy] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());

  // Toast feedback
  const [feedback, setFeedback] = useState({ show: false, message: '', type: 'success' });

  // Confirmation dialog
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    variant: 'primary',
    impactPoints: [],
    onConfirm: () => {}
  });

  const showToast = (message, type = 'success') => {
    setFeedback({ show: true, message, type });
    setTimeout(() => setFeedback({ show: false, message: '', type: 'success' }), 4000);
  };

  // Critical Buffer restock alerts & emergency buffer allocation state
  const [dispatchedAlerts, setDispatchedAlerts] = useState({});
  const [alertingId, setAlertingId] = useState(null);
  const [allocatingId, setAllocatingId] = useState(null);
  const [allocateModalItem, setAllocateModalItem] = useState(null);
  const [allocateUnits, setAllocateUnits] = useState(25);

  // Pharmacy Management Modal State
  const [pharmacyModal, setPharmacyModal] = useState({
    isOpen: false,
    mode: 'create', // 'create' | 'edit'
    submitting: false,
    data: null,
    form: {
      name: '',
      address: '',
      phone: '',
      licenseNumber: '',
      managerName: '',
      managerEmail: '',
      managerPhone: '',
      managerPassword: '',
      openingHours: '09:30–20:00',
      is24x7: false,
      deliveryAvailable: true,
      emergencyAvailability: true,
      latitude: '9.2435',
      longitude: '76.5381'
    }
  });

  const handleOpenAddPharmacy = () => {
    setPharmacyModal({
      isOpen: true,
      mode: 'create',
      submitting: false,
      data: null,
      form: {
        name: '',
        address: '',
        phone: '',
        licenseNumber: `KL-ALP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        managerName: '',
        managerEmail: '',
        managerPhone: '',
        managerPassword: '',
        openingHours: '09:30–20:00',
        is24x7: false,
        deliveryAvailable: true,
        emergencyAvailability: true,
        latitude: '9.2435',
        longitude: '76.5381'
      }
    });
  };

  const handleOpenEditPharmacy = (p) => {
    setPharmacyModal({
      isOpen: true,
      mode: 'edit',
      submitting: false,
      data: p,
      form: {
        name: p.name || '',
        address: p.address || '',
        phone: p.phone || '',
        licenseNumber: p.licenseNumber || '',
        managerName: p.manager?.name || '',
        managerEmail: p.manager?.email || '',
        managerPhone: p.manager?.phone || p.phone || '',
        managerPassword: '',
        openingHours: p.openingHours || '09:30–20:00',
        is24x7: Boolean(p.is24x7),
        deliveryAvailable: Boolean(p.deliveryAvailable),
        emergencyAvailability: Boolean(p.emergencyAvailability),
        latitude: String(p.latitude || '9.2435'),
        longitude: String(p.longitude || '76.5381')
      }
    });
  };

  const handleSavePharmacy = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setPharmacyModal(prev => ({ ...prev, submitting: true }));
    const token = localStorage.getItem('medifind_token');
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

    try {
      const isCreate = pharmacyModal.mode === 'create';
      const url = isCreate ? '/api/admin/pharmacies' : `/api/admin/pharmacies/${pharmacyModal.data.id}`;
      const method = isCreate ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(pharmacyModal.form)
      });
      const data = await res.json();

      if (data.success) {
        showToast(
          isCreate
            ? `Pharmacy '${data.pharmacy.name}' registered! Pharmacy ID: ${data.pharmacy.id}`
            : `Pharmacy '${data.pharmacy.name}' details successfully updated.`,
          'success'
        );
        broadcastUpdate('pharmacies');
        setPharmacyModal(prev => ({ ...prev, isOpen: false, submitting: false }));
        fetchAllAdminData(true);
      } else {
        showToast(data.error || 'Failed to save pharmacy.', 'error');
        setPharmacyModal(prev => ({ ...prev, submitting: false }));
      }
    } catch (err) {
      console.error('Error saving pharmacy:', err);
      showToast('Network error saving pharmacy details.', 'error');
      setPharmacyModal(prev => ({ ...prev, submitting: false }));
    }
  };

  const handleDeletePharmacy = (p) => {
    setConfirmDialog({
      isOpen: true,
      title: `Delete Pharmacy — ${p.name}`,
      message: `Are you sure you want to delete ${p.name}? All linked inventory records, orders, and manager accounts will be permanently deregistered.`,
      variant: 'danger',
      confirmLabel: 'Permanently Delete Pharmacy',
      impactPoints: [
        'Dispensary portal credentials will be revoked immediately',
        'Catalog inventory will be decommissioned',
        'Active routing will no longer select this facility'
      ],
      onConfirm: async () => {
        const token = localStorage.getItem('medifind_token');
        try {
          const res = await fetch(`/api/admin/pharmacies/${p.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
          });
          const data = await res.json();
          if (data.success) {
            showToast(`Pharmacy '${p.name}' was removed from the network.`, 'success');
            broadcastUpdate('pharmacies');
            fetchAllAdminData(true);
          } else {
            showToast(data.error || 'Failed to delete pharmacy.', 'error');
          }
        } catch (err) {
          console.error('Error deleting pharmacy:', err);
          showToast('Failed to delete pharmacy due to network error.', 'error');
        }
      }
    });
  };

  const handleVerifyAssistant = async (userId, userName) => {
    try {
      const token = localStorage.getItem('medifind_token');
      const res = await fetch(`/api/admin/assistants/${userId}/verify`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: 'APPROVED' })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Assistant ${userName} verified & authorized for live dispatch!`, 'success');
        fetchAllAdminData(true);
      } else {
        showToast(data.error || 'Failed to verify assistant.', 'error');
      }
    } catch (err) {
      showToast('Error verifying assistant.', 'error');
    }
  };

  const handleDispatchRestockAdvisory = async (inv, isCritical) => {
    const medName = inv.medicine?.brandName || inv.medicine?.name || 'Medicine SKU';
    const pharmacyName = inv.pharmacy?.name || 'Partner Pharmacy';
    const invKey = `${inv.pharmacyId}-${inv.medicineId}`;
    setAlertingId(invKey);
    const token = localStorage.getItem('medifind_token');

    try {
      const res = await fetch('/api/admin/alert-restock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          pharmacyId: inv.pharmacyId,
          medicineId: inv.medicineId,
          targetUnits: 25,
          note: isCritical
            ? `EMERGENCY ALERT: Stock depleted to ${inv.stock || 0} unit(s). Immediate priority restock required.`
            : `Safety Buffer Advisory: Current stock is ${inv.stock || 0} unit(s). Recommended minimum replenishment: 25 units.`
        })
      });

      const data = await res.json();
      if (data.success) {
        setDispatchedAlerts(prev => ({
          ...prev,
          [invKey]: {
            dispatched: true,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        }));
        showToast(`Advisory dispatched to ${pharmacyName} for ${medName}. Manager alerted.`, 'success');
        broadcastUpdate('inventory');
        fetchAllAdminData(true);
      } else {
        showToast(data.error || 'Failed to dispatch restock advisory.', 'error');
      }
    } catch (err) {
      console.error('Error dispatching alert:', err);
      showToast('Network error dispatching restock advisory.', 'error');
    } finally {
      setAlertingId(null);
    }
  };

  const handleAllocateEmergencyStock = async (inv, units) => {
    const medName = inv.medicine?.brandName || inv.medicine?.name || 'Medicine SKU';
    const pharmacyName = inv.pharmacy?.name || 'Partner Pharmacy';
    const invKey = `${inv.pharmacyId}-${inv.medicineId}`;
    setAllocatingId(invKey);
    const token = localStorage.getItem('medifind_token');

    try {
      const res = await fetch('/api/admin/allocate-stock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          pharmacyId: inv.pharmacyId,
          medicineId: inv.medicineId,
          additionalUnits: Number(units) || 25
        })
      });

      const data = await res.json();
      if (data.success) {
        showToast(`Emergency allocation complete: +${units} units of ${medName} injected to ${pharmacyName}.`, 'success');
        broadcastUpdate('inventory');
        setAllocateModalItem(null);
        fetchAllAdminData(true);
      } else {
        showToast(data.error || 'Failed to allocate stock.', 'error');
      }
    } catch (err) {
      console.error('Error allocating stock:', err);
      showToast('Network error allocating buffer stock.', 'error');
    } finally {
      setAllocatingId(null);
    }
  };

  useEffect(() => {
    fetchAllAdminData();
  }, []);

  // Real-time automatic background refresh (heartbeat + event triggers)
  useRealtimeRefresh({
    onRefresh: () => {
      fetchAllAdminData(true);
    },
    interval: 15000
  });

  async function fetchAllAdminData(isBackground = false) {
    if (!isBackground && !metrics) {
      setLoading(true);
      setError('');
    }
    const token = localStorage.getItem('medifind_token');
    const headers = { Authorization: `Bearer ${token}` };

    try {
      const [metricsRes, usersRes, pharmaciesRes, ordersRes, emergencyRes, activityRes, verifRes, aptRes] = await Promise.all([
        fetch('/api/analytics/metrics', { headers }),
        fetch('/api/admin/users', { headers }),
        fetch('/api/admin/pharmacies', { headers }),
        fetch('/api/admin/orders', { headers }),
        fetch('/api/admin/emergency-requests', { headers }),
        fetch('/api/admin/activity', { headers }),
        fetch('/api/admin/verifications', { headers }),
        fetch('/api/appointments/admin/all', { headers })
      ]);

      const [mJson, uJson, pJson, oJson, eJson, aJson, vJson, aptJson] = await Promise.all([
        metricsRes.json(),
        usersRes.json(),
        pharmaciesRes.json(),
        ordersRes.json(),
        emergencyRes.json(),
        activityRes.json(),
        verifRes.json(),
        aptRes.json()
      ]);

      if (mJson.success) setMetrics(mJson.metrics);
      if (uJson.success) setUsersList(uJson.users || []);
      if (pJson.success) setPharmaciesList(pJson.pharmacies || []);
      if (oJson.success) setOrdersList(oJson.orders || []);
      if (eJson.success) setEmergencyData({ tasks: eJson.tasks || [], emergencyOrders: eJson.emergencyOrders || [] });
      if (aJson.success) setActivityList(aJson.activity || []);
      if (vJson.success) setVerificationsList(vJson.applications || []);
      if (aptJson.success) setAppointmentsList(aptJson.appointments || []);
      setLastRefreshed(new Date());
    } catch (err) {
      if (!isBackground) {
        console.error('Error fetching admin data:', err);
        setError('Failed to fetch administrative records.');
        showToast('Network error loading administrative records.', 'error');
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }

  const handleOfflineBackupSync = async () => {
    setSyncStatus('Downloading full offline dataset bundle...');
    try {
      const res = await fetch('/api/analytics/offline-catalog');
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('medifind_offline_bundle', JSON.stringify(data));
        setSyncStatus(`Successfully cached ${data.datasetSize} medicines & ${data.pharmacyCount} pharmacies for offline fallback.`);
        showToast('Offline emergency catalogue synchronized.', 'success');
        setTimeout(() => setSyncStatus(''), 4000);
      }
    } catch (e) {
      setSyncStatus('Sync failed.');
      showToast('Failed to download offline catalog.', 'error');
    }
  };

  const handleDownloadDoc = async (docId, fileName) => {
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/admin/verifications/documents/${docId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        showToast('Failed to download verification document.', 'error');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || `document-${docId}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      showToast('Network error downloading document.', 'error');
    }
  };

  const handleStartReview = async (appId) => {
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/admin/verifications/${appId}/start-review`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        showToast('Application moved to UNDER_REVIEW.', 'success');
        fetchAllAdminData(true);
        if (selectedApp && selectedApp.id === appId) {
          setSelectedApp(data.application);
        }
      } else {
        showToast(data.error || 'Failed to start review.', 'error');
      }
    } catch (e) {
      showToast('Error communicating with server.', 'error');
    }
  };

  const handleRequestCorrections = async (appId) => {
    if (!actionReason || actionReason.trim().length < 5) {
      showToast('Please provide a specific reason (at least 5 characters) for requesting corrections.', 'warning');
      return;
    }
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/admin/verifications/${appId}/request-corrections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason: actionReason.trim() })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Correction request dispatched to applicant.', 'success');
        setActionReason('');
        fetchAllAdminData(true);
        if (selectedApp && selectedApp.id === appId) {
          setSelectedApp(data.application);
        }
      } else {
        showToast(data.error || 'Failed to request corrections.', 'error');
      }
    } catch (e) {
      showToast('Error communicating with server.', 'error');
    }
  };

  const handleApproveApplication = async (appId) => {
    if (!approvalServices || approvalServices.length === 0) {
      showToast('Please select at least one individually approved service category.', 'warning');
      return;
    }
    if (!reviewChecklist.idVerified || !reviewChecklist.councilActive || !reviewChecklist.qualificationValid || !reviewChecklist.scopeAppropriate) {
      showToast('All 4 verification checklist criteria must be verified and checked before approving.', 'warning');
      return;
    }
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/admin/verifications/${appId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          approvedServices: approvalServices,
          notes: actionReason,
          reviewChecklist
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Professional application successfully APPROVED!', 'success');
        setActionReason('');
        fetchAllAdminData(true);
        if (selectedApp && selectedApp.id === appId) {
          setSelectedApp(data.application);
        }
      } else {
        showToast(data.error || 'Failed to approve application.', 'error');
      }
    } catch (e) {
      showToast('Error communicating with server.', 'error');
    }
  };

  const handleRestoreProfessional = async (appId) => {
    if (!actionReason || actionReason.trim().length < 5) {
      showToast('Please provide an explanation (at least 5 characters) for restoring access.', 'warning');
      return;
    }
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/admin/verifications/${appId}/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason: actionReason.trim() })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Professional account access successfully RESTORED!', 'success');
        setActionReason('');
        fetchAllAdminData(true);
        if (selectedApp && selectedApp.id === appId) {
          setSelectedApp(data.application);
        }
      } else {
        showToast(data.error || 'Failed to restore professional account.', 'error');
      }
    } catch (e) {
      showToast('Error communicating with server.', 'error');
    }
  };

  const handleRejectApplication = async (appId) => {
    if (!actionReason || actionReason.trim().length < 5) {
      showToast('Please provide an explanation (at least 5 characters) for the rejection.', 'warning');
      return;
    }
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/admin/verifications/${appId}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason: actionReason.trim() })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Application marked as REJECTED.', 'success');
        setActionReason('');
        fetchAllAdminData(true);
        if (selectedApp && selectedApp.id === appId) {
          setSelectedApp(data.application);
        }
      } else {
        showToast(data.error || 'Failed to reject application.', 'error');
      }
    } catch (e) {
      showToast('Error communicating with server.', 'error');
    }
  };

  const handleSuspendProfessional = async (appId) => {
    if (!actionReason || actionReason.trim().length < 5) {
      showToast('Please provide a reason (at least 5 characters) for the suspension.', 'warning');
      return;
    }
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/admin/verifications/${appId}/suspend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason: actionReason.trim() })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Professional account SUSPENDED.', 'success');
        setActionReason('');
        fetchAllAdminData(true);
        if (selectedApp && selectedApp.id === appId) {
          setSelectedApp(data.application);
        }
      } else {
        showToast(data.error || 'Failed to suspend professional.', 'error');
      }
    } catch (e) {
      showToast('Error communicating with server.', 'error');
    }
  };

  const pendingVerificationsCount = verificationsList.filter(v =>
    v.verificationStatus === 'PENDING' || v.verificationStatus === 'UNDER_REVIEW' || v.verificationStatus === 'NEEDS_CORRECTION'
  ).length;

  const tabs = [
    { id: 'overview', label: 'Overview & Operations', icon: 'monitoring', count: null },
    { id: 'verifications', label: 'Professional Verifications', icon: 'verified_user', count: pendingVerificationsCount },
    { id: 'users', label: 'Users Directory', icon: 'group', count: usersList.length },
    { id: 'pharmacies', label: 'Pharmacies & Verification', icon: 'domain', count: pharmaciesList.length },
    { id: 'orders', label: 'Orders Management', icon: 'receipt_long', count: ordersList.length },
    { id: 'appointments', label: 'Clinical Appointments', icon: 'medical_services', count: appointmentsList.length },
    { id: 'emergency', label: 'Emergency & Logistics', icon: 'local_shipping', count: emergencyData.tasks.length + emergencyData.emergencyOrders.length },
    { id: 'activity', label: 'Activity Audit', icon: 'timeline', count: activityList.length }
  ];

  return (
    <div className="portal-page" style={{ minHeight: '100vh', paddingBottom: '4rem' }}>
      {/* Toast Feedback */}
      {feedback.show && (
        <div style={{
          position: 'fixed',
          top: '5.5rem',
          right: '1.5rem',
          zIndex: 9999,
          background: feedback.type === 'error' ? '#ffdad6' : '#e0f2eb',
          color: feedback.type === 'error' ? '#ba1a1a' : '#032f28',
          border: `1px solid ${feedback.type === 'error' ? '#ba1a1a' : '#2e685d'}`,
          borderRadius: 14,
          padding: '0.75rem 1.25rem',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.65rem',
          fontSize: 13,
          fontWeight: 600
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            {feedback.type === 'error' ? 'error' : 'check_circle'}
          </span>
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Main Container */}
      <div style={{ maxWidth: 1440, margin: '0 auto', padding: '1.5rem 1.5rem 2rem' }}>
        {/* Top Header & Global Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.5rem' }}>
            <div>
              <h1 style={{ fontSize: 32, fontWeight: 700, color: '#032f28', margin: 0, letterSpacing: '-0.02em' }}>
                MediFind AI Operations Center
              </h1>
              <p style={{ fontSize: 15, color: '#414846', margin: '0.35rem 0 0 0' }}>
                Multi-pharmacy registry verification, user access directories, emergency fulfillment logistics, and compliance audit trail.
              </p>
            </div>

            {/* Header Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <FlowButton
                variant="outline"
                size="md"
                onClick={fetchAllAdminData}
                disabled={loading}
                loading={loading}
              >
                Refresh Live State
              </FlowButton>

              <FlowButton
                variant="primary"
                size="md"
                onClick={() => {
                  setConfirmDialog({
                    isOpen: true,
                    title: 'Synchronize Offline Catalog Cache?',
                    message: 'Download and rebuild the full local offline dataset bundle for offline emergency fallback?',
                    confirmLabel: 'Sync Catalog',
                    variant: 'primary',
                    impactPoints: [
                      'Current client cache will be updated with the latest catalog snapshot.',
                      'Allows continued search and triage during network connectivity interruptions.'
                    ],
                    onConfirm: handleOfflineBackupSync
                  });
                }}
              >
                Sync Offline Catalog
              </FlowButton>
            </div>
          </div>

          {/* Offline Sync Banner if active */}
          {syncStatus && (
            <div style={{ background: '#e0f2eb', border: '1px solid #b0ecdd', padding: '0.75rem 1.25rem', borderRadius: 14, color: '#032f28', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>check_circle</span>
              <span>{syncStatus}</span>
            </div>
          )}

          {error && (
            <div style={{ background: '#ffdad6', border: '1px solid #ffb4a8', padding: '0.75rem 1.25rem', borderRadius: 14, color: '#ba1a1a', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>error</span>
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Tab Switcher Pills with Barba Sliding Active Pill */}
        <div
          className="relative flex items-center gap-1.5 p-1.5 rounded-full overflow-x-auto max-w-full mb-8 shadow-xs"
          style={{
            background: '#ffffff',
            border: '1px solid #e0f2eb',
            width: 'fit-content'
          }}
        >
          {tabs.map(t => {
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`relative px-4 py-2 rounded-full text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer focus:outline-none select-none ${
                  isActive ? 'text-white' : 'text-[#414846] hover:text-[#032f28]'
                }`}
                style={{ border: 'none', background: 'transparent' }}
              >
                {isActive && (
                  <motion.div
                    layoutId="admin-dashboard-active-tab-barba"
                    transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                    className="absolute inset-0 rounded-full bg-gradient-to-r from-[#032f28] to-[#0a4f43] shadow-[0_2px_10px_rgba(3,47,40,0.3)] -z-0"
                  />
                )}
                <span
                  className={`relative z-10 material-symbols-outlined text-[17px] transition-colors ${
                    isActive ? 'text-[#b0ecdd]' : 'text-[#2e685d]'
                  }`}
                >
                  {t.icon}
                </span>
                <span className="relative z-10 whitespace-nowrap">
                  {t.label}
                </span>
                {t.count !== null && (
                  <span
                    className={`relative z-10 px-2 py-0.5 rounded-full text-[11px] font-bold transition-colors inline-flex items-center gap-1 ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-[#e6f8f1] text-[#2e685d]'
                    }`}
                  >
                    <RollingNumber value={t.count} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* TAB CONTENTS */}
        {loading ? (
          <LoadingSkeleton variant="order-card" count={3} />
        ) : (
          <div>
            {/* TAB 1: OVERVIEW & METRICS */}
            {activeTab === 'overview' && !metrics && error && (
              <ErrorState
                title="Failed to Load Operations Center Records"
                message={error}
                onRetry={fetchAllAdminData}
                retryText="Retry Operations Sync"
                className="my-4"
              />
            )}
            {activeTab === 'overview' && metrics && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {/* Executive Mission Telemetry Banner */}
                <div style={{
                  background: '#ffffff',
                  borderRadius: 16,
                  padding: '1.25rem 1.5rem',
                  border: '1px solid #e0f2eb',
                  boxShadow: '0 2px 8px rgba(3,47,40,0.04)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '1rem'
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        background: '#e0f2eb',
                        color: '#032f28',
                        padding: '0.2rem 0.65rem',
                        borderRadius: 99,
                        fontSize: 11,
                        fontWeight: 700
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }}></span>
                        LIVE TELEMETRY
                      </span>
                      <span style={{ color: '#c0c8c5' }}>•</span>
                      <span style={{ fontSize: 12, color: '#414846', fontWeight: 600 }}>
                        Chengannur Operations Node
                      </span>
                    </div>
                    <h2 style={{ fontSize: 20, fontWeight: 800, color: '#032f28', margin: 0, letterSpacing: '-0.02em' }}>
                      Executive Operations &amp; Dispensary Telemetry
                    </h2>
                    <p style={{ fontSize: 13, color: '#52605b', margin: '0.2rem 0 0 0' }}>
                      Live verified metrics calculated directly from database records. Zero simulated data.
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => fetchAllAdminData(false)}
                      disabled={loading}
                      style={{
                        background: '#f8fafc',
                        border: '1px solid #d5e6e0',
                        borderRadius: 12,
                        padding: '0.45rem 0.85rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#032f28',
                        transition: 'all 0.15s ease'
                      }}
                      title="Click to refresh live database metrics"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d', animation: loading ? 'spin 1s linear infinite' : 'none' }}>sync</span>
                      <span>{loading ? 'Refreshing...' : `Synced ${lastRefreshed ? lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Live'}`}</span>
                    </button>
                  </div>
                </div>

                {/* 5-Card Unified Executive KPI Command Matrix (Interactive with Sheen & Physics) */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '0.85rem'
                }}>
                  {/* KPI 1: Network Nodes */}
                  <AdminKpiCard
                    title="Network Nodes"
                    value={<RollingNumber value={metrics.totalPharmacies || 0} refreshKey={metrics?.totalPharmacies} />}
                    subtitle={<><RollingNumber value={metrics.open24x7Pharmacies || 0} /> Verified 24/7 Night Nodes</>}
                    footer={
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: 10.5, color: '#717976' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#2e685d' }}>verified</span>
                        <span>Chengannur Accredited</span>
                      </div>
                    }
                    icon="domain"
                    iconBg="#e0f2eb"
                    iconColor="#032f28"
                    accentColor="#2e685d"
                    onClick={() => setActiveTab('pharmacies')}
                  />

                  {/* KPI 2: Order Fulfillment Velocity */}
                  <AdminKpiCard
                    title="Fulfillment Rate"
                    value={
                      <RollingNumber
                        value={metrics.fulfillmentRate !== undefined ? metrics.fulfillmentRate : (metrics.totalOrders > 0 ? Math.round(((metrics.completedOrders || 0) / metrics.totalOrders) * 100) : 100)}
                        suffix="%"
                        refreshKey={metrics?.fulfillmentRate}
                      />
                    }
                    subtitle={<><RollingNumber value={metrics.totalOrders || 0} /> Total Reservations</>}
                    progressPercent={metrics.fulfillmentRate || 80}
                    footer={
                      <div style={{ fontSize: 10.5, color: '#717976', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <RollingNumber value={metrics.completedOrders || 0} /> done • <RollingNumber value={(metrics.pendingOrders || 0) + (metrics.readyOrders || 0)} /> active
                      </div>
                    }
                    icon="receipt_long"
                    iconBg="#e0f2eb"
                    iconColor="#032f28"
                    accentColor="#2e685d"
                    onClick={() => setActiveTab('orders')}
                  />

                  {/* KPI 3: Verified User Accounts */}
                  <AdminKpiCard
                    title="User Accounts"
                    value={<RollingNumber value={metrics.totalUsers || usersList.length || 0} refreshKey={metrics?.totalUsers || usersList.length} />}
                    subtitle={<><RollingNumber value={usersList.filter(u => u.role === 'PATIENT').length} /> Patients Registered</>}
                    footer={
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: 10.5, color: '#717976', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span><RollingNumber value={usersList.filter(u => u.role === 'PHARMACIST').length} /> Pharm</span>
                        <span>•</span>
                        <span><RollingNumber value={usersList.filter(u => u.role === 'ASSISTANT').length} /> Assist</span>
                      </div>
                    }
                    icon="group"
                    iconBg="#e0f2eb"
                    iconColor="#032f28"
                    accentColor="#2e685d"
                    onClick={() => setActiveTab('users')}
                  />

                  {/* KPI 4: Catalog Formulary Medicines */}
                  <AdminKpiCard
                    title="Formulary Catalog"
                    value={
                      <>
                        <RollingNumber value={metrics.totalMedicines || 0} refreshKey={metrics?.totalMedicines} /> <span style={{ fontSize: 14, fontWeight: 600, color: '#717976' }}>SKUs</span>
                      </>
                    }
                    subtitle={<><RollingNumber value={metrics.emergencyMedicines || 0} /> Critical Emergency SKUs</>}
                    footer={
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: 10.5, color: '#717976' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#2e685d' }}>task_alt</span>
                        <span>CDSCO Validated</span>
                      </div>
                    }
                    icon="medication"
                    iconBg="#e0f2eb"
                    iconColor="#032f28"
                    accentColor="#2e685d"
                    onClick={() => setActiveTab('medicines')}
                  />

                  {/* KPI 5: Buffer Safety Watch */}
                  <AdminKpiCard
                    title="Buffer Safety Watch"
                    value={<RollingNumber value={metrics.lowStockCount || 0} refreshKey={metrics?.lowStockCount} />}
                    subtitle={(metrics.lowStockCount || 0) > 0 ? `${metrics.lowStockCount} below buffer (≤10)` : 'All dispensary buffers stable'}
                    footer={
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: 10.5, color: (metrics.lowStockCount || 0) > 0 ? '#ba1a1a' : '#717976' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 13, color: (metrics.lowStockCount || 0) > 0 ? '#ba1a1a' : '#2e685d' }}>
                          {(metrics.lowStockCount || 0) > 0 ? 'priority_high' : 'check_circle'}
                        </span>
                        <span>{(metrics.lowStockCount || 0) > 0 ? 'Restock Advised' : 'No Stockouts'}</span>
                      </div>
                    }
                    icon={(metrics.lowStockCount || 0) > 0 ? 'warning' : 'inventory_2'}
                    iconBg={(metrics.lowStockCount || 0) > 0 ? '#ffdad6' : '#e0f2eb'}
                    iconColor={(metrics.lowStockCount || 0) > 0 ? '#ba1a1a' : '#032f28'}
                    accentColor={(metrics.lowStockCount || 0) > 0 ? '#ba1a1a' : '#2e685d'}
                    isAlert={(metrics.lowStockCount || 0) > 0}
                    onClick={() => {
                      setActiveTab('medicines');
                      setSearchTerm('buffer');
                    }}
                  />
                </div>

                {/* 2-Column Responsive Command Workspace */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                  gap: '1.5rem',
                  alignItems: 'start'
                }}>
                  {/* Left Column: Critical Buffer Inventory Alerts (Scrollable, matches right column height) */}
                  <div style={{
                    background: '#ffffff',
                    borderRadius: 20,
                    padding: '1.5rem',
                    border: '1px solid #e0f2eb',
                    boxShadow: '0 2px 8px rgba(3,47,40,0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    maxHeight: 520,
                    height: '100%'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem', flexShrink: 0 }}>
                      <div>
                        <h3 style={{ fontSize: 17, fontWeight: 700, color: '#ba1a1a', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#ba1a1a' }}>warning</span>
                          <span>Critical Buffer Inventory Alerts</span>
                        </h3>
                        <p style={{ fontSize: 12.5, color: '#52605b', margin: '0.2rem 0 0 0' }}>
                          Active inventory monitoring below safety quotas. Send automated advisories or execute emergency allocations.
                        </p>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, background: '#ffdad6', color: '#93000a', padding: '3px 10px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Buffer: ≤10 Units
                        </span>
                        {metrics.lowStockItems && metrics.lowStockItems.length > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#ba1a1a', background: '#fff0ee', padding: '3px 10px', borderRadius: 99, border: '1px solid #ffb4a8' }}>
                            {metrics.lowStockItems.length} SKUs Need Attention
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.65rem',
                      overflowY: 'auto',
                      flex: 1,
                      paddingRight: '0.4rem'
                    }}>
                      {(!metrics.lowStockItems || metrics.lowStockItems.length === 0) ? (
                        <div style={{ textAlign: 'center', padding: '2.5rem 1rem', background: '#f8faf9', borderRadius: 16, border: '1px solid #e0f2eb' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 36, color: '#2e685d', marginBottom: '0.5rem' }}>check_circle</span>
                          <p style={{ color: '#032f28', fontWeight: 700, fontSize: 15, margin: '0 0 0.25rem 0' }}>All Network Buffers Stable</p>
                          <p style={{ color: '#717976', fontSize: 13, margin: 0 }}>Registered pharmacy inventories currently meet safety buffer quotas across all active regional nodes.</p>
                        </div>
                      ) : (
                        metrics.lowStockItems.map((inv, idx) => {
                          const medName = inv.medicine?.brandName || inv.medicine?.name || 'Medicine SKU';
                          const generic = inv.medicine?.genericName || inv.medicine?.dosageForm || 'Prescription item';
                          const isCritical = (inv.stock || 0) <= 5;
                          const invKey = `${inv.pharmacyId}-${inv.medicineId}`;
                          const isDispatched = dispatchedAlerts[invKey];
                          const isAlerting = alertingId === invKey;
                          const isAllocating = allocatingId === invKey;

                          return (
                            <div
                              key={idx}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '0.75rem 1rem',
                                background: isCritical ? '#fff0ee' : '#fff8e6',
                                borderRadius: 12,
                                border: isCritical ? '1px solid #ffb4a8' : '1px solid #ffe082',
                                fontSize: 12.5,
                                flexWrap: 'wrap',
                                gap: '0.75rem',
                                transition: 'all 0.2s ease'
                              }}
                            >
                            <div style={{ flex: 1, minWidth: 260 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                <span style={{
                                  fontSize: 10,
                                  fontWeight: 800,
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                  background: isCritical ? '#ba1a1a' : '#d97706',
                                  color: '#ffffff',
                                  letterSpacing: '0.05em'
                                }}>
                                  {isCritical ? 'CRITICAL DEPLETION' : 'BUFFER WATCH'}
                                </span>
                                <strong style={{ color: isCritical ? '#5a0100' : '#78350f', fontSize: 15 }}>
                                  {medName}
                                </strong>
                                {inv.medicine?.isEmergencyCritical && (
                                  <span style={{ fontSize: 10, fontWeight: 700, background: '#ba1a1a', color: '#ffffff', padding: '1px 6px', borderRadius: 4 }}>
                                    LIFE SAVING
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: isCritical ? '#7e1208' : '#92400e', marginTop: '0.25rem' }}>
                                {generic} • <span style={{ fontWeight: 600 }}>{inv.pharmacy?.name}</span>
                                {inv.pharmacy?.phone && ` (${inv.pharmacy.phone})`}
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
                              <div style={{ textAlign: 'right' }}>
                                <span style={{
                                  background: isCritical ? '#ba1a1a' : '#b45309',
                                  color: '#ffffff',
                                  padding: '0.35rem 0.85rem',
                                  borderRadius: 99,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.35rem'
                                }}>
                                  <span style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: '50%',
                                    backgroundColor: '#ffffff',
                                    display: 'inline-block'
                                  }} />
                                  {inv.stock} unit{inv.stock !== 1 ? 's' : ''} left
                                </span>
                              </div>

                              {/* Alert Dispatched Status Badge */}
                              {isDispatched && (
                                <span style={{
                                  background: '#e0f2eb',
                                  color: '#2e685d',
                                  border: '1px solid #2e685d',
                                  padding: '0.35rem 0.75rem',
                                  borderRadius: 99,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.35rem'
                                }}>
                                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check_circle</span>
                                  <span>Advisory Sent ({isDispatched.time})</span>
                                </span>
                              )}

                              {/* Action 1: Functional Alert Restock Button */}
                              <button
                                disabled={isAlerting}
                                onClick={() => {
                                  setConfirmDialog({
                                    isOpen: true,
                                    title: isCritical ? 'Broadcast Priority Emergency Restock Alert?' : 'Dispatch Buffer Replenishment Advisory?',
                                    message: `Dispatch an immediate real-time advisory notification to the pharmacy manager of ${inv.pharmacy?.name} for ${medName}? Current verified stock is ${inv.stock || 0} unit(s).`,
                                    confirmLabel: isAlerting ? 'Dispatching...' : 'Dispatch Restock Advisory',
                                    variant: isCritical ? 'danger' : 'primary',
                                    impactPoints: [
                                      `Automated real-time notification sent to manager of ${inv.pharmacy?.name}.`,
                                      'Official entry recorded in MediFind operations audit log.',
                                      'Prompts pharmacist to confirm emergency wholesaler re-order.'
                                    ],
                                    onConfirm: () => {
                                      handleDispatchRestockAdvisory(inv, isCritical);
                                    }
                                  });
                                }}
                                style={{
                                  background: isCritical ? '#ba1a1a' : '#ffffff',
                                  color: isCritical ? '#ffffff' : '#92400e',
                                  border: isCritical ? '1px solid #ba1a1a' : '1px solid #d97706',
                                  borderRadius: 99,
                                  padding: '0.4rem 0.95rem',
                                  fontSize: 12,
                                  fontWeight: 700,
                                  cursor: isAlerting ? 'not-allowed' : 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.35rem',
                                  boxShadow: isCritical ? '0 1px 4px rgba(186,26,26,0.2)' : 'none',
                                  opacity: isAlerting ? 0.7 : 1,
                                  transition: 'all 0.2s ease'
                                }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                                  {isAlerting ? 'sync' : 'notification_important'}
                                </span>
                                <span>{isAlerting ? 'Dispatching...' : 'Alert Restock'}</span>
                              </button>

                              {/* Action 2: Emergency Allocate Buffer Stock */}
                              <button
                                disabled={isAllocating}
                                onClick={() => {
                                  setAllocateModalItem(inv);
                                  setAllocateUnits(25);
                                }}
                                style={{
                                  background: '#ffffff',
                                  color: '#2e685d',
                                  border: '1px solid #2e685d',
                                  borderRadius: 99,
                                  padding: '0.4rem 0.95rem',
                                  fontSize: 12,
                                  fontWeight: 700,
                                  cursor: isAllocating ? 'not-allowed' : 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.35rem',
                                  transition: 'all 0.2s ease'
                                }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>add_box</span>
                                <span>{isAllocating ? 'Allocating...' : 'Allocate Buffer'}</span>
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Right Column: Platform Intelligence & Rapid Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {/* Quick Operations Action Launcher */}
                  <div style={{
                    background: '#ffffff',
                    borderRadius: 20,
                    padding: '1.5rem',
                    border: '1px solid #e0f2eb',
                    boxShadow: '0 2px 8px rgba(3,47,40,0.04)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '1rem' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>bolt</span>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#032f28', margin: 0 }}>
                        Administrative Action Hub
                      </h3>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
                      <AdminActionHubCard
                        icon="add_business"
                        title="Register Pharmacy"
                        subtitle="Accredit new local dispensary"
                        variant="accent"
                        onClick={handleOpenAddPharmacy}
                      />

                      <AdminActionHubCard
                        icon="verified_user"
                        title="Verifications"
                        subtitle="Credentials & identity review"
                        badgeText={pendingVerificationsCount > 0 ? `${pendingVerificationsCount} Pending` : null}
                        variant="default"
                        onClick={() => setActiveTab('verifications')}
                      />

                      <AdminActionHubCard
                        icon="receipt_long"
                        title="Orders Ledger"
                        subtitle="Live dispensing audit track"
                        variant="default"
                        onClick={() => setActiveTab('orders')}
                      />

                      <AdminActionHubCard
                        icon="cloud_download"
                        title="Sync Offline Data"
                        subtitle="Rebuild emergency local catalog"
                        variant="dark"
                        onClick={handleOfflineBackupSync}
                      />
                    </div>
                  </div>

                  {/* Live System Activity Stream */}
                  <div style={{
                    background: '#ffffff',
                    borderRadius: 20,
                    padding: '1.5rem',
                    border: '1px solid #e0f2eb',
                    boxShadow: '0 2px 8px rgba(3,47,40,0.04)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>timeline</span>
                        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#032f28', margin: 0 }}>
                          Live Platform Activity Stream
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('activity')}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#2e685d',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                          padding: 0
                        }}
                      >
                        View All ({activityList.length}) →
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                      {activityList.length === 0 ? (
                        <p style={{ color: '#717976', fontSize: 12, margin: 0 }}>No recent activity records found.</p>
                      ) : (
                        activityList.slice(0, 4).map(act => (
                          <div
                            key={act.id}
                            style={{
                              padding: '0.65rem 0.85rem',
                              background: '#f8fafc',
                              border: '1px solid #e0f2eb',
                              borderRadius: 12,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '0.75rem'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
                              <span style={{
                                background: '#e0f2eb',
                                color: '#2e685d',
                                padding: '0.1rem 0.45rem',
                                borderRadius: 99,
                                fontSize: 10,
                                fontWeight: 700,
                                whiteSpace: 'nowrap'
                              }}>
                                {act.type}
                              </span>
                              <span style={{ fontSize: 12, fontWeight: 600, color: '#032f28', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                                {act.title}
                              </span>
                            </div>
                            <span style={{ fontSize: 11, color: '#717976', whiteSpace: 'nowrap' }}>
                              {new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

            {/* TAB: HEALTHCARE PROFESSIONAL VERIFICATIONS */}
            {activeTab === 'verifications' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{
                  background: '#ffffff',
                  borderRadius: 20,
                  padding: '1.75rem',
                  border: '1px solid #e0f2eb',
                  boxShadow: '0 1px 4px rgba(3,47,40,0.04)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>verified_user</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#2e685d', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Council Credentialing &amp; Scope Review
                        </span>
                      </div>
                      <h3 style={{ fontSize: 20, fontWeight: 700, color: '#032f28', margin: 0 }}>
                        Healthcare Professional Verification Queue ({verificationsList.length})
                      </h3>
                      <p style={{ fontSize: 13, color: '#414846', margin: '0.25rem 0 0 0' }}>
                        Review applicant credentials, state nursing council registrations, and authorize clinical scopes. Unapproved professionals cannot receive clinical tasks.
                      </p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <input
                        type="text"
                        placeholder="Search"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{
                          padding: '0.55rem 1rem',
                          borderRadius: 99,
                          border: '1px solid #c0c8c5',
                          fontSize: 13,
                          width: 280,
                          background: '#f8fafc'
                        }}
                      />
                    </div>
                  </div>

                  {/* Filter Pills */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                    {['ALL', 'PENDING', 'UNDER_REVIEW', 'NEEDS_CORRECTION', 'APPROVED', 'REJECTED', 'SUSPENDED'].map(f => {
                      const count = f === 'ALL'
                        ? verificationsList.length
                        : verificationsList.filter(v => v.verificationStatus === f).length;
                      const isActive = verificationFilter === f;
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setVerificationFilter(f)}
                          style={{
                            background: isActive ? '#032f28' : '#e6f8f1',
                            color: isActive ? '#ffffff' : '#032f28',
                            border: 'none',
                            borderRadius: 99,
                            padding: '0.35rem 0.85rem',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.35rem'
                          }}
                        >
                          <span>{f.replace(/_/g, ' ')}</span>
                          <span style={{
                            background: isActive ? 'rgba(255,255,255,0.25)' : '#ffffff',
                            color: isActive ? '#ffffff' : '#2e685d',
                            padding: '1px 6px',
                            borderRadius: 99,
                            fontSize: 10,
                            fontWeight: 800
                          }}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Applications Queue Table */}
                  {(() => {
                    const filteredApps = verificationsList.filter(app => {
                      const matchesStatus = verificationFilter === 'ALL' || app.verificationStatus === verificationFilter;
                      const matchesSearch = !searchTerm.trim() || (
                        (app.name && app.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
                        (app.email && app.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
                        (app.registrationNumber && app.registrationNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
                        (app.professionTitle && app.professionTitle.toLowerCase().includes(searchTerm.toLowerCase()))
                      );
                      return matchesStatus && matchesSearch;
                    });

                    if (filteredApps.length === 0) {
                      return (
                        <div style={{ textAlign: 'center', padding: '3rem 1rem', background: '#f8fafc', borderRadius: 16, border: '1px solid #e0f2eb' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 36, color: '#2e685d', marginBottom: '0.5rem' }}>assignment_turned_in</span>
                          <p style={{ color: '#032f28', fontWeight: 700, fontSize: 15, margin: '0 0 0.25rem 0' }}>No Applications Matching Filter</p>
                          <p style={{ color: '#717976', fontSize: 13, margin: 0 }}>
                            {verificationFilter === 'ALL' ? 'No healthcare professional applications have been filed yet.' : `No applications found with status '${verificationFilter}'.`}
                          </p>
                        </div>
                      );
                    }

                    return (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                          <thead>
                            <tr style={{ background: '#e0f2eb', color: '#414846', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              <th style={{ padding: '0.75rem 1rem' }}>Applicant Name &amp; Contact</th>
                              <th style={{ padding: '0.75rem 1rem' }}>Profession &amp; Council License</th>
                              <th style={{ padding: '0.75rem 1rem' }}>Qualifications &amp; Exp</th>
                              <th style={{ padding: '0.75rem 1rem' }}>Requested Scopes</th>
                              <th style={{ padding: '0.75rem 1rem' }}>Docs</th>
                              <th style={{ padding: '0.75rem 1rem' }}>Application Status</th>
                              <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredApps.map(app => {
                              const statusBg =
                                app.verificationStatus === 'APPROVED' ? '#b0ecdd' :
                                app.verificationStatus === 'UNDER_REVIEW' ? '#d0e1fd' :
                                app.verificationStatus === 'NEEDS_CORRECTION' ? '#ffebd2' :
                                app.verificationStatus === 'REJECTED' ? '#ffdad6' :
                                app.verificationStatus === 'SUSPENDED' ? '#fecdd3' : '#fff8f6';
                              const statusColor =
                                app.verificationStatus === 'APPROVED' ? '#00201b' :
                                app.verificationStatus === 'UNDER_REVIEW' ? '#003366' :
                                app.verificationStatus === 'NEEDS_CORRECTION' ? '#8a4b00' :
                                app.verificationStatus === 'REJECTED' ? '#ba1a1a' :
                                app.verificationStatus === 'SUSPENDED' ? '#9f1239' : '#5a0100';

                              return (
                                <tr key={app.id} style={{ borderBottom: '1px solid #e0f2eb' }}>
                                  <td style={{ padding: '0.85rem 1rem' }}>
                                    <div style={{ fontWeight: 700, color: '#032f28' }}>{app.name}</div>
                                    <div style={{ fontSize: 12, color: '#414846' }}>{app.email}</div>
                                    <div style={{ fontSize: 11, color: '#717976' }}>{app.phone || 'Phone not set'}</div>
                                  </td>

                                  <td style={{ padding: '0.85rem 1rem' }}>
                                    <div style={{ fontWeight: 600, color: '#032f28' }}>{app.professionTitle || 'Healthcare Worker'}</div>
                                    <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#2e685d', fontWeight: 700, marginTop: 2 }}>
                                      Reg: {app.registrationNumber || 'Not submitted'}
                                    </div>
                                    {app.issuingAuthority && (
                                      <div style={{ fontSize: 11, color: '#717976' }}>{app.issuingAuthority}</div>
                                    )}
                                  </td>

                                  <td style={{ padding: '0.85rem 1rem' }}>
                                    <div style={{ color: '#032f28', fontWeight: 600 }}>{app.qualifications || 'N/A'}</div>
                                    <div style={{ fontSize: 11, color: '#717976' }}>
                                      {app.yearsOfExperience != null ? `${app.yearsOfExperience} years experience` : 'Experience not set'}
                                    </div>
                                    <div style={{ fontSize: 11, color: '#717976' }}>
                                      {app.operatingCity || 'Chengannur'} ({app.operatingRadiusKm || 10} km)
                                    </div>
                                  </td>

                                  <td style={{ padding: '0.85rem 1rem' }}>
                                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', maxWidth: 220 }}>
                                      {(app.serviceAreasApplied || []).map(s => (
                                        <span key={s} style={{ background: '#e0f2eb', color: '#2e685d', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                                          {s.replace(/_/g, ' ')}
                                        </span>
                                      ))}
                                    </div>
                                    {app.verificationStatus === 'APPROVED' && app.approvedServices?.length > 0 && (
                                      <div style={{ fontSize: 10, color: '#00201b', fontWeight: 700, marginTop: 4 }}>
                                        Approved: {app.approvedServices.join(', ')}
                                      </div>
                                    )}
                                  </td>

                                  <td style={{ padding: '0.85rem 1rem' }}>
                                    <span style={{
                                      background: (app.documents || []).length > 0 ? '#e0f2eb' : '#ffdad6',
                                      color: (app.documents || []).length > 0 ? '#2e685d' : '#ba1a1a',
                                      padding: '0.2rem 0.55rem',
                                      borderRadius: 99,
                                      fontSize: 11,
                                      fontWeight: 700
                                    }}>
                                      {(app.documents || []).length} Doc(s)
                                    </span>
                                  </td>

                                  <td style={{ padding: '0.85rem 1rem' }}>
                                    <span style={{
                                      background: statusBg,
                                      color: statusColor,
                                      padding: '0.25rem 0.65rem',
                                      borderRadius: 99,
                                      fontSize: 11,
                                      fontWeight: 700,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.25rem'
                                    }}>
                                      {app.verificationStatus}
                                    </span>
                                    {app.submittedAt && (
                                      <div style={{ fontSize: 10, color: '#717976', marginTop: 3 }}>
                                        Filed: {new Date(app.submittedAt).toLocaleDateString()}
                                      </div>
                                    )}
                                  </td>

                                  <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedApp(app);
                                        setApprovalServices(app.serviceAreasApplied || []);
                                        setActionReason('');
                                        setReviewChecklist({
                                          identityVerified: false,
                                          councilActive: false,
                                          qualificationValid: false,
                                          scopeAppropriate: false
                                        });
                                      }}
                                      style={{
                                        background: '#032f28',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: 99,
                                        padding: '0.45rem 1rem',
                                        fontSize: 12,
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.35rem'
                                      }}
                                    >
                                      <span>Review &amp; Verify</span>
                                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chevron_right</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Verification Detail & Review Action Modal */}
            {selectedApp && typeof document !== 'undefined' && ReactDOM.createPortal(
              <div style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(3,47,40,0.5)',
                zIndex: 10000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1.5rem',
                backdropFilter: 'blur(3px)'
              }}>
                <div style={{
                  background: '#ffffff',
                  borderRadius: 24,
                  maxWidth: 820,
                  width: '100%',
                  maxHeight: '92vh',
                  overflowY: 'auto',
                  padding: '2rem',
                  boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1.25rem'
                }}>
                  {/* Modal Header */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', borderBottom: '1px solid #e0f2eb', paddingBottom: '1rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                        <span style={{
                          background: '#032f28',
                          color: '#ffffff',
                          padding: '0.2rem 0.65rem',
                          borderRadius: 99,
                          fontSize: 11,
                          fontWeight: 700
                        }}>
                          STATUS: {selectedApp.verificationStatus}
                        </span>
                        <span style={{ fontSize: 12, color: '#717976' }}>Application ID: {selectedApp.id.slice(0, 8)}</span>
                      </div>
                      <h2 style={{ fontSize: 24, fontWeight: 800, color: '#032f28', margin: 0 }}>
                        {selectedApp.name} — {selectedApp.professionTitle}
                      </h2>
                      <div style={{ fontSize: 13, color: '#414846', marginTop: 2 }}>
                        {selectedApp.email} • {selectedApp.phone || 'Phone not provided'}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedApp(null)}
                      style={{
                        background: '#f8fafc',
                        border: '1px solid #c0c8c5',
                        borderRadius: '50%',
                        width: 36,
                        height: 36,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        color: '#414846'
                      }}
                    >
                      <span className="material-symbols-outlined">close</span>
                    </button>
                  </div>

                  {/* Profile Credentials Summary */}
                  <div style={{
                    background: '#f8fafc',
                    borderRadius: 16,
                    padding: '1.25rem',
                    border: '1px solid #e0f2eb',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '1rem',
                    fontSize: 13
                  }}>
                    <div>
                      <span style={{ color: '#717976', fontSize: 11, textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Council License Number</span>
                      <strong style={{ color: '#032f28', fontFamily: 'monospace', fontSize: 14 }}>{selectedApp.registrationNumber || 'Not provided'}</strong>
                    </div>
                    <div>
                      <span style={{ color: '#717976', fontSize: 11, textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Issuing Regulatory Body</span>
                      <strong style={{ color: '#032f28' }}>{selectedApp.issuingAuthority || 'State Nursing Board'}</strong>
                    </div>
                    <div>
                      <span style={{ color: '#717976', fontSize: 11, textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Qualifications &amp; Degrees</span>
                      <strong style={{ color: '#032f28' }}>{selectedApp.qualifications || 'None stated'}</strong>
                    </div>
                    <div>
                      <span style={{ color: '#717976', fontSize: 11, textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Clinical Experience</span>
                      <strong style={{ color: '#032f28' }}>{selectedApp.yearsOfExperience != null ? `${selectedApp.yearsOfExperience} Years` : 'Unspecified'}</strong>
                    </div>
                    <div>
                      <span style={{ color: '#717976', fontSize: 11, textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Operating Territory</span>
                      <strong style={{ color: '#032f28' }}>{selectedApp.operatingCity || 'Chengannur'} ({selectedApp.operatingRadiusKm || 10} km)</strong>
                    </div>
                    <div>
                      <span style={{ color: '#717976', fontSize: 11, textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Applicant Truth Declaration</span>
                      <strong style={{ color: selectedApp.declarationAccepted ? '#2e685d' : '#ba1a1a' }}>
                        {selectedApp.declarationAccepted ? '✓ Declared Truthful' : '✗ Declaration Missing'}
                      </strong>
                    </div>
                  </div>

                  {selectedApp.bio && (
                    <div style={{ fontSize: 13, color: '#414846', background: '#ffffff', border: '1px solid #e0f2eb', borderRadius: 12, padding: '0.75rem 1rem' }}>
                      <strong style={{ color: '#032f28' }}>Professional Bio:</strong> {selectedApp.bio}
                    </div>
                  )}

                  {/* Supporting Documents Section */}
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: '#032f28', margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>folder</span>
                      <span>Submitted Verification Documents ({(selectedApp.documents || []).length})</span>
                    </h3>
                    <p style={{ fontSize: 12, color: '#717976', margin: '0 0 0.75rem 0' }}>
                      Documents are protected and served exclusively through authenticated, admin-authorized endpoints.
                    </p>

                    {(selectedApp.documents || []).length === 0 ? (
                      <div style={{ padding: '1rem', background: '#fff8f6', border: '1px solid #ffdad6', borderRadius: 12, color: '#ba1a1a', fontSize: 12, fontWeight: 600 }}>
                        No supporting verification documents uploaded. Cannot approve without authentic certificates.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {selectedApp.documents.map(doc => (
                          <div
                            key={doc.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0.75rem 1rem',
                              background: '#f8fafc',
                              border: '1px solid #e0f2eb',
                              borderRadius: 12,
                              fontSize: 13
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 22, color: '#2e685d' }}>
                                {doc.mimeType?.includes('pdf') ? 'picture_as_pdf' : 'image'}
                              </span>
                              <div>
                                <div style={{ fontWeight: 700, color: '#032f28' }}>
                                  {doc.documentType?.replace(/_/g, ' ')}
                                </div>
                                <div style={{ fontSize: 11, color: '#717976' }}>
                                  {doc.originalFileName} • {(doc.fileSize / 1024).toFixed(1)} KB • {new Date(doc.uploadedAt).toLocaleDateString()}
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleDownloadDoc(doc.id, doc.originalFileName)}
                              style={{
                                background: '#ffffff',
                                color: '#032f28',
                                border: '1px solid #c0c8c5',
                                borderRadius: 99,
                                padding: '0.35rem 0.85rem',
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem'
                              }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>visibility</span>
                              <span>Preview / Download</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Verification Review Checklist */}
                  <div style={{ background: '#e6f8f1', padding: '1rem', borderRadius: 16, border: '1px solid #d5e6e0' }}>
                    <h4 style={{ fontSize: 13, fontWeight: 700, color: '#032f28', margin: '0 0 0.5rem 0', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Administrator Verification Checklist
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.5rem', fontSize: 12 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={reviewChecklist.identityVerified}
                          onChange={e => setReviewChecklist({ ...reviewChecklist, identityVerified: e.target.checked })}
                          style={{ accentColor: '#032f28' }}
                        />
                        <span>Official ID verified against applicant details</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={reviewChecklist.councilActive}
                          onChange={e => setReviewChecklist({ ...reviewChecklist, councilActive: e.target.checked })}
                          style={{ accentColor: '#032f28' }}
                        />
                        <span>Council registration validated on active state registry</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={reviewChecklist.qualificationValid}
                          onChange={e => setReviewChecklist({ ...reviewChecklist, qualificationValid: e.target.checked })}
                          style={{ accentColor: '#032f28' }}
                        />
                        <span>Nursing degree / diploma authenticated</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={reviewChecklist.scopeAppropriate}
                          onChange={e => setReviewChecklist({ ...reviewChecklist, scopeAppropriate: e.target.checked })}
                          style={{ accentColor: '#032f28' }}
                        />
                        <span>Approved scopes match certified training</span>
                      </label>
                    </div>
                  </div>

                  {/* Service-Specific Approval Selector */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <label style={{ fontSize: 13, fontWeight: 700, color: '#032f28' }}>
                        Service-Specific Clinical Scope Approval
                      </label>
                      <span style={{ fontSize: 11, color: '#ba1a1a', fontWeight: 600 }}>
                        High-risk invasive procedures prohibited
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {['NURSING_VISIT', 'VITAL_SIGN_MEASUREMENT', 'POST_HOSPITAL_CARE', 'WOUND_CARE_ASSISTANCE', 'HOME_NURSING_SUPPORT'].map(svc => {
                        const isChecked = approvalServices.includes(svc);
                        return (
                          <label
                            key={svc}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.4rem',
                              padding: '0.35rem 0.75rem',
                              borderRadius: 99,
                              background: isChecked ? '#b0ecdd' : '#f8fafc',
                              border: isChecked ? '1px solid #336c61' : '1px solid #c0c8c5',
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: 'pointer'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setApprovalServices(prev =>
                                  isChecked ? prev.filter(s => s !== svc) : [...prev, svc]
                                );
                              }}
                              style={{ accentColor: '#032f28' }}
                            />
                            <span>{svc.replace(/_/g, ' ')}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Review Notes / Reason Input */}
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>
                      Review Decision Reason / Correction Notes (Required for Corrections, Rejection, or Suspension)
                    </label>
                    <textarea
                      rows={2}
                      value={actionReason}
                      onChange={e => setActionReason(e.target.value)}
                      placeholder="Notes"
                      style={{
                        width: '100%',
                        padding: '0.65rem 0.85rem',
                        borderRadius: 12,
                        border: '1px solid #c0c8c5',
                        fontSize: 13
                      }}
                    />
                  </div>

                  {/* Decision Action Buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid #e0f2eb' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {selectedApp.verificationStatus === 'PENDING' && (
                        <button
                          type="button"
                          onClick={() => handleStartReview(selectedApp.id)}
                          style={{
                            background: '#0284c7',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 99,
                            padding: '0.55rem 1.15rem',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          Start Formal Review
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDialog({
                            isOpen: true,
                            title: 'Request Corrections from Applicant?',
                            message: `Request applicant ${selectedApp.name} to correct their submission? Reason: "${actionReason}"`,
                            confirmLabel: 'Dispatch Correction Request',
                            variant: 'primary',
                            impactPoints: [
                              'Application will move to NEEDS_CORRECTION.',
                              'Applicant will be notified to update information or upload replacement certificates.'
                            ],
                            onConfirm: () => handleRequestCorrections(selectedApp.id)
                          });
                        }}
                        style={{
                          background: '#f59e0b',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 99,
                          padding: '0.55rem 1.15rem',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        Request Corrections
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDialog({
                            isOpen: true,
                            title: 'Reject Professional Application?',
                            message: `Reject the application submitted by ${selectedApp.name}? Explanation: "${actionReason}"`,
                            confirmLabel: 'Confirm Rejection',
                            variant: 'danger',
                            impactPoints: [
                              'Application status will transition to REJECTED.',
                              'Applicant will be provided with the stated explanation.'
                            ],
                            onConfirm: () => handleRejectApplication(selectedApp.id)
                          });
                        }}
                        style={{
                          background: '#ba1a1a',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 99,
                          padding: '0.55rem 1.15rem',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        Reject Application
                      </button>

                      {selectedApp.verificationStatus === 'APPROVED' && (
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDialog({
                              isOpen: true,
                              title: 'Suspend Professional Account?',
                              message: `Suspend healthcare professional ${selectedApp.name}? Reason: "${actionReason}"`,
                              confirmLabel: 'Confirm Suspension',
                              variant: 'danger',
                              impactPoints: [
                                'Account status will transition to SUSPENDED.',
                                'All active capabilities and task access will be revoked immediately.'
                              ],
                              onConfirm: () => handleSuspendProfessional(selectedApp.id)
                            });
                          }}
                          style={{
                            background: '#881337',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 99,
                            padding: '0.55rem 1.15rem',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          Suspend Account
                        </button>
                      )}

                      {selectedApp.verificationStatus === 'SUSPENDED' && (
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDialog({
                              isOpen: true,
                              title: 'Restore Professional Account Access?',
                              message: `Restore healthcare professional ${selectedApp.name}? Reason: "${actionReason}"`,
                              confirmLabel: 'Confirm Restoration',
                              variant: 'primary',
                              impactPoints: [
                                'Account status will transition back to APPROVED.',
                                'Approved clinical services and capabilities will be restored immediately.'
                              ],
                              onConfirm: () => handleRestoreProfessional(selectedApp.id)
                            });
                          }}
                          style={{
                            background: '#047857',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 99,
                            padding: '0.55rem 1.15rem',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          Restore Access
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDialog({
                          isOpen: true,
                          title: 'Approve Healthcare Professional Application?',
                          message: `Authorize ${selectedApp.name} for ${approvalServices.length} clinical service category(s)?`,
                          confirmLabel: 'Approve & Activate Scope',
                          variant: 'primary',
                          impactPoints: [
                            `Approved Categories: ${approvalServices.join(', ')}`,
                            'Documents will be marked VERIFIED in central audit trail.',
                            'A notification will be dispatched to the professional.'
                          ],
                          onConfirm: () => handleApproveApplication(selectedApp.id)
                        });
                      }}
                      style={{
                        background: '#032f28',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: 99,
                        padding: '0.65rem 1.5rem',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        boxShadow: '0 2px 8px rgba(3,47,40,0.2)'
                      }}
                    >
                      Approve Application
                    </button>
                  </div>

                  {/* Prior Review Logs / Audit Trail */}
                  {(selectedApp.reviewLogs || []).length > 0 && (
                    <div style={{ marginTop: '0.75rem', borderTop: '1px solid #e0f2eb', paddingTop: '1rem' }}>
                      <h4 style={{ fontSize: 13, fontWeight: 700, color: '#032f28', margin: '0 0 0.5rem 0' }}>
                        Application Review Audit Trail ({(selectedApp.reviewLogs || []).length})
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: 180, overflowY: 'auto' }}>
                        {selectedApp.reviewLogs.map(log => (
                          <div
                            key={log.id}
                            style={{
                              padding: '0.5rem 0.75rem',
                              background: '#f8fafc',
                              borderRadius: 8,
                              border: '1px solid #e0f2eb',
                              fontSize: 11,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between'
                            }}
                          >
                            <div>
                              <strong style={{ color: '#032f28' }}>{log.action}</strong> ({log.previousStatus} → {log.newStatus}) by {log.adminName}
                              {log.reason && <div style={{ color: '#414846', marginTop: 2 }}>"{log.reason}"</div>}
                            </div>
                            <span style={{ color: '#717976', whiteSpace: 'nowrap' }}>
                              {new Date(log.createdAt).toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>,
              document.body
            )}

            {/* TAB 2: USERS DIRECTORY */}
            {activeTab === 'users' && (
              <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#032f28', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>group</span>
                  <span>Registered Platform Users ({usersList.length})</span>
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#e0f2eb', color: '#414846', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <th style={{ padding: '0.75rem 1rem' }}>User Name</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Email Address</th>
                        <th style={{ padding: '0.75rem 1rem' }}>System Role</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Phone</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Verification &amp; Dispatch Status</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Registered On</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usersList.length === 0 ? (
                        <tr>
                          <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: '#717976' }}>
                            No registered users found.
                          </td>
                        </tr>
                      ) : (
                        usersList.map(u => (
                          <tr key={u.id} style={{ borderBottom: '1px solid #e0f2eb' }}>
                            <td style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#032f28' }}>{u.name}</td>
                            <td style={{ padding: '0.85rem 1rem', color: '#414846' }}>{u.email}</td>
                            <td style={{ padding: '0.85rem 1rem' }}>
                              <span style={{
                                background: u.role === 'ADMIN' ? '#ffdad4' : u.role === 'PHARMACIST' ? '#b0ecdd' : '#e0f2eb',
                                color: u.role === 'ADMIN' ? '#5a0100' : u.role === 'PHARMACIST' ? '#336c61' : '#2e685d',
                                padding: '0.2rem 0.6rem',
                                borderRadius: 99,
                                fontSize: 11,
                                fontWeight: 700
                              }}>
                                {u.role}
                              </span>
                            </td>
                            <td style={{ padding: '0.85rem 1rem', color: '#717976' }}>{u.phone || 'N/A'}</td>
                            <td style={{ padding: '0.85rem 1rem' }}>
                              {u.role === 'ASSISTANT' ? (
                                u.assistantProfile?.verificationStatus === 'APPROVED' ? (
                                  <span style={{
                                    background: '#dcfce7',
                                    color: '#166534',
                                    border: '1px solid #86efac',
                                    padding: '0.2rem 0.65rem',
                                    borderRadius: 99,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.25rem'
                                  }}>
                                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>verified</span>
                                    <span>Approved</span>
                                  </span>
                                ) : (
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                                    <span style={{
                                      background: '#fef3c7',
                                      color: '#92400e',
                                      border: '1px solid #fde68a',
                                      padding: '0.2rem 0.65rem',
                                      borderRadius: 99,
                                      fontSize: 11,
                                      fontWeight: 700
                                    }}>
                                      Pending Review
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleVerifyAssistant(u.id, u.name)}
                                      style={{
                                        padding: '0.25rem 0.65rem',
                                        borderRadius: 99,
                                        background: '#032f28',
                                        color: '#ffffff',
                                        border: 'none',
                                        fontSize: 11,
                                        fontWeight: 800,
                                        cursor: 'pointer',
                                        boxShadow: '0 1px 3px rgba(3,47,40,0.2)'
                                      }}
                                    >
                                      Verify &amp; Clear
                                    </button>
                                  </div>
                                )
                              ) : (
                                <span style={{ color: '#414846', fontSize: 12 }}>
                                  {u.pharmacy?.name ? `Dispensary: ${u.pharmacy.name}` : 'Active Account'}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '0.85rem 1rem', color: '#717976' }}>{new Date(u.createdAt).toLocaleDateString()}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 3: PHARMACIES AUDIT & MANAGEMENT */}
            {activeTab === 'pharmacies' && (
              <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: '#032f28', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>domain</span>
                      <span>Network Pharmacies &amp; Dispensary Management ({pharmaciesList.length})</span>
                    </h3>
                    <p style={{ margin: '0.2rem 0 0 0', fontSize: 12, color: '#717976' }}>
                      Manage licensed dispensaries, operating hours, portal credentials, and inventory stock.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenAddPharmacy}
                    style={{
                      padding: '0.55rem 1.15rem',
                      borderRadius: 99,
                      border: 'none',
                      background: '#2e685d',
                      color: '#ffffff',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      boxShadow: '0 2px 6px rgba(46,104,93,0.2)'
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add_business</span>
                    <span>Add New Pharmacy</span>
                  </button>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#e0f2eb', color: '#414846', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <th style={{ padding: '0.75rem 1rem' }}>Pharmacy Name &amp; Location</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Pharmacy ID &amp; Credentials</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Pharmacist In Charge</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Operating Hours &amp; Live State</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Catalog Inventory</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pharmaciesList.length === 0 ? (
                        <tr>
                          <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: '#717976' }}>
                            No network pharmacies registered. Click "Add New Pharmacy" to register a licensed facility.
                          </td>
                        </tr>
                      ) : (
                        pharmaciesList.map(p => {
                          const isOpenNow = p.computedOpenStatus?.isCurrentlyOpen ?? p.isOpen;
                          return (
                            <tr key={p.id} style={{ borderBottom: '1px solid #e0f2eb' }}>
                              <td style={{ padding: '0.85rem 1rem' }}>
                                <div style={{ fontWeight: 700, color: '#032f28' }}>{p.name}</div>
                                <div style={{ fontSize: 12, color: '#717976' }}>{p.address}</div>
                                <div style={{ fontSize: 11, color: '#2e685d', marginTop: 2 }}>
                                  Lic: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{p.licenseNumber}</span>
                                </div>
                              </td>
                              <td style={{ padding: '0.85rem 1rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#032f28', fontWeight: 600 }} title="Pharmacy ID for portal login">
                                    {p.id.slice(0, 14)}...
                                  </span>
                                  <button
                                    type="button"
                                    title="Copy full Pharmacy ID"
                                    onClick={() => {
                                      navigator.clipboard?.writeText(p.id);
                                      showToast(`Copied Pharmacy ID: ${p.id}`, 'success');
                                    }}
                                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, color: '#2e685d', display: 'flex', alignItems: 'center' }}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>content_copy</span>
                                  </button>
                                </div>
                                <div style={{ fontSize: 11, color: '#52605b' }}>Phone: {p.phone || p.manager?.phone || 'N/A'}</div>
                                <div style={{ fontSize: 11, color: '#717976' }}>Email: {p.manager?.email || 'N/A'}</div>
                              </td>
                              <td style={{ padding: '0.85rem 1rem' }}>
                                <div style={{ color: '#032f28', fontWeight: 600 }}>{p.manager?.name || 'Unassigned'}</div>
                                <div style={{ fontSize: 11, color: '#717976' }}>Role: Pharmacist Manager</div>
                              </td>
                              <td style={{ padding: '0.85rem 1rem' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                    <span style={{
                                      background: isOpenNow ? '#e0f2eb' : '#ffdad6',
                                      color: isOpenNow ? '#2e685d' : '#ba1a1a',
                                      padding: '0.2rem 0.65rem',
                                      borderRadius: 99,
                                      fontSize: 11,
                                      fontWeight: 700,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.3rem'
                                    }}>
                                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: isOpenNow ? '#2e685d' : '#ba1a1a' }}></span>
                                      {isOpenNow ? 'Open Now' : 'Closed'}
                                    </span>
                                    {p.is24x7 && (
                                      <span style={{ background: '#032f28', color: '#ffffff', padding: '0.15rem 0.55rem', borderRadius: 99, fontSize: 10, fontWeight: 700 }}>
                                        24/7 Care
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 11, color: '#52605b', fontWeight: 600 }}>
                                    {p.computedOpenStatus ? (
                                      isOpenNow
                                        ? `Closes at ${p.computedOpenStatus.closesAt} (${p.computedOpenStatus.timeRemainingFormatted} left)`
                                        : `Opens at ${p.computedOpenStatus.opensAt} (in ${p.computedOpenStatus.timeRemainingFormatted})`
                                    ) : (
                                      `Hours: ${p.openingHours || '09:30–20:00'}`
                                    )}
                                  </div>
                                  <div style={{ fontSize: 10, color: '#717976' }}>
                                    Timing: {p.openingHours || '09:30–20:00'}
                                  </div>
                                </div>
                              </td>
                              <td style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#2e685d' }}>
                                <div>{p.inventoryCount || (p.inventory || []).length} SKUs</div>
                                <div style={{ fontSize: 11, color: '#717976', fontWeight: 500 }}>
                                  {p.deliveryAvailable ? '🛵 Delivery' : '🏢 Pickup only'}
                                </div>
                              </td>
                              <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                                <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditPharmacy(p)}
                                    title="Edit Pharmacy Details & Hours"
                                    style={{
                                      padding: '0.35rem 0.65rem',
                                      borderRadius: 8,
                                      border: '1px solid #c2dbd3',
                                      background: '#f2fbf7',
                                      color: '#032f28',
                                      fontSize: 12,
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.2rem'
                                    }}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>edit</span>
                                    <span>Edit</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeletePharmacy(p)}
                                    title="Delete Pharmacy From Network"
                                    style={{
                                      padding: '0.35rem 0.65rem',
                                      borderRadius: 8,
                                      border: '1px solid #ffdad6',
                                      background: '#fff8f7',
                                      color: '#ba1a1a',
                                      fontSize: 12,
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.2rem'
                                    }}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>delete</span>
                                    <span>Delete</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 4: ORDERS MANAGEMENT */}
            {activeTab === 'orders' && (
              <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#032f28', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>receipt_long</span>
                  <span>System-Wide Order Tracking &amp; Handoff State ({ordersList.length})</span>
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#e0f2eb', color: '#414846', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <th style={{ padding: '0.75rem 1rem' }}>Order Ref</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Patient Name</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Dispensary</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Items</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Total Amount</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Payment Status</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Workflow Status</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Placed At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordersList.length === 0 ? (
                        <tr>
                          <td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: '#717976' }}>
                            No orders recorded in the system.
                          </td>
                        </tr>
                      ) : (
                        ordersList.map(o => (
                          <tr key={o.id} style={{ borderBottom: '1px solid #e0f2eb' }}>
                          <td style={{ padding: '0.85rem 1rem', fontFamily: 'monospace', fontWeight: 700, color: '#032f28' }}>
                            #{o.orderNumber || o.id.slice(0, 8).toUpperCase()}
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            <div style={{ fontWeight: 600, color: '#032f28' }}>{o.user?.name || 'Patient'}</div>
                            <div style={{ fontSize: 11, color: '#717976' }}>{o.user?.phone || ''}</div>
                          </td>
                          <td style={{ padding: '0.85rem 1rem', color: '#414846' }}>{o.pharmacy?.name}</td>
                          <td style={{ padding: '0.85rem 1rem', color: '#717976' }}>
                            {o.items?.map(it => `${it.medicine?.brandName || it.medicine?.name || 'Item'} (${it.quantity})`).join(', ')}
                          </td>
                          <td style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#032f28' }}>
                            ₹{o.totalAmount}
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            <span style={{
                              background: '#e0f2eb',
                              color: '#2e685d',
                              padding: '0.15rem 0.55rem',
                              borderRadius: 99,
                              fontSize: 11,
                              fontWeight: 700
                            }}>
                              {o.payment?.status || o.paymentStatus || 'PAID'}
                            </span>
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            <span style={{
                              background: o.status === 'COMPLETED' ? '#e0f2eb' : o.status === 'PENDING' ? '#ffdad4' : '#b0ecdd',
                              color: o.status === 'COMPLETED' ? '#2e685d' : o.status === 'PENDING' ? '#5a0100' : '#336c61',
                              padding: '0.15rem 0.6rem',
                              borderRadius: 99,
                              fontSize: 11,
                              fontWeight: 700
                            }}>
                              {o.status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td style={{ padding: '0.85rem 1rem', color: '#717976', fontSize: 12 }}>
                            {new Date(o.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      )))
                    }
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 5: EMERGENCY & LOGISTICS */}
            {activeTab === 'emergency' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{
                  background: '#e6f8f1',
                  border: '1px solid #d5e6e0',
                  padding: '0.85rem 1.25rem',
                  borderRadius: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: 13,
                  color: '#032f28'
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>security</span>
                  <span><strong>Privacy Isolation Active:</strong> Recipient 4-digit handover PINs and patient passwords are isolated and excluded from administrative queries to maintain handover integrity.</span>
                </div>

                <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#032f28', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>local_shipping</span>
                    <span>Assistant Delivery Dispatch Ledger ({emergencyData.tasks.length})</span>
                  </h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#e0f2eb', color: '#414846', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          <th style={{ padding: '0.75rem 1rem' }}>Task Ref</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Order Ref</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Assigned Assistant</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Patient Destination</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Dispensary Origin</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Handover PIN State</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Fulfillment State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emergencyData.tasks.length === 0 ? (
                          <tr>
                            <td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: '#717976' }}>
                              No assistant dispatch tasks active or recorded.
                            </td>
                          </tr>
                        ) : (
                          emergencyData.tasks.map(t => (
                            <tr key={t.id} style={{ borderBottom: '1px solid #e0f2eb' }}>
                            <td style={{ padding: '0.85rem 1rem', fontFamily: 'monospace', color: '#717976' }}>
                              #{t.id.slice(0, 8).toUpperCase()}
                            </td>
                            <td style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#032f28' }}>
                              #{t.orderNumber || (t.orderId ? t.orderId.slice(0, 8).toUpperCase() : 'N/A')}
                            </td>
                            <td style={{ padding: '0.85rem 1rem' }}>
                              {t.assistant ? (
                                <div>
                                  <div style={{ fontWeight: 600, color: '#032f28' }}>{t.assistant.name}</div>
                                  <div style={{ fontSize: 11, color: '#717976' }}>{t.assistant.phone}</div>
                                </div>
                              ) : (
                                <span style={{ color: '#2e685d', fontWeight: 600 }}>Unassigned (Available)</span>
                              )}
                            </td>
                            <td style={{ padding: '0.85rem 1rem', color: '#414846' }}>{t.patient?.name || 'Verified Patient'}</td>
                            <td style={{ padding: '0.85rem 1rem', color: '#414846' }}>{t.pharmacy?.name || 'Pharmacy Node'}</td>
                            <td style={{ padding: '0.85rem 1rem' }}>
                              <span style={{
                                background: t.hasHandoverPin ? '#e0f2eb' : '#ffdad6',
                                color: t.hasHandoverPin ? '#2e685d' : '#ba1a1a',
                                padding: '0.15rem 0.55rem',
                                borderRadius: 99,
                                fontSize: 11,
                                fontWeight: 700
                              }}>
                                {t.hasHandoverPin ? 'Configured (Role-Restricted)' : 'Awaiting PIN'}
                              </span>
                            </td>
                            <td style={{ padding: '0.85rem 1rem' }}>
                              <span style={{
                                background: '#b0ecdd',
                                color: '#336c61',
                                padding: '0.15rem 0.6rem',
                                borderRadius: 99,
                                fontSize: 11,
                                fontWeight: 700
                              }}>
                                {t.status}
                              </span>
                            </td>
                          </tr>
                        )))
                      }
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: CLINICAL APPOINTMENTS */}
            {activeTab === 'appointments' && (
              <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#032f28', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>medical_services</span>
                    <span>Patient Healthcare Appointments &amp; Clinical Audit ({appointmentsList.length})</span>
                  </h3>
                </div>

                {appointmentsList.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#717976', fontSize: 13 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 36, color: '#c0c8c5', display: 'block', marginBottom: '0.5rem' }}>event_busy</span>
                    No clinical healthcare appointments have been requested yet.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e0f2eb', textAlign: 'left', color: '#414846' }}>
                          <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Reference</th>
                          <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Patient</th>
                          <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Practitioner</th>
                          <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Service Scope</th>
                          <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Date &amp; Slot</th>
                          <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Fee</th>
                          <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {appointmentsList.map(apt => (
                          <tr key={apt.id} style={{ borderBottom: '1px solid #f0fdf7' }}>
                            <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontWeight: 700, color: '#032f28' }}>
                              {apt.appointmentNumber}
                            </td>
                            <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#032f28' }}>
                              {apt.patient?.name}
                            </td>
                            <td style={{ padding: '0.75rem 1rem' }}>
                              <div style={{ fontWeight: 600, color: '#032f28' }}>{apt.professional?.name}</div>
                              <div style={{ fontSize: 11, color: '#2e685d' }}>{apt.professional?.assistantProfile?.professionTitle}</div>
                            </td>
                            <td style={{ padding: '0.75rem 1rem', color: '#032f28', fontWeight: 600 }}>
                              {apt.serviceType}
                            </td>
                            <td style={{ padding: '0.75rem 1rem', color: '#414846' }}>
                              <div>{apt.scheduledDate}</div>
                              <div style={{ fontSize: 11, color: '#717976' }}>{apt.timeSlot}</div>
                            </td>
                            <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#032f28' }}>
                              ₹{apt.feeAmount}
                            </td>
                            <td style={{ padding: '0.75rem 1rem' }}>
                              <span style={{
                                padding: '0.2rem 0.65rem',
                                borderRadius: 99,
                                fontSize: 11,
                                fontWeight: 800,
                                background: apt.status === 'COMPLETED' ? '#dcfce7' : apt.status === 'ACCEPTED' ? '#e0f2fe' : apt.status === 'IN_PROGRESS' ? '#bbf7d0' : apt.status === 'REQUESTED' ? '#fef3c7' : '#fee2e2',
                                color: apt.status === 'COMPLETED' ? '#166534' : apt.status === 'ACCEPTED' ? '#0369a1' : apt.status === 'IN_PROGRESS' ? '#15803d' : apt.status === 'REQUESTED' ? '#92400e' : '#b91c1c'
                              }}>
                                {apt.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TAB 6: ACTIVITY TIMELINE */}
            {activeTab === 'activity' && (
              <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#032f28', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>timeline</span>
                  <span>Compliance Activity Feed &amp; Audit Stream ({activityList.length} events)</span>
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: 600, overflowY: 'auto' }}>
                  {activityList.length === 0 ? (
                    <p style={{ color: '#717976', fontSize: 13 }}>No recent activity records found.</p>
                  ) : (
                    activityList.map(act => (
                      <div
                        key={act.id}
                        style={{
                          padding: '0.85rem 1.25rem',
                          background: '#f8fafc',
                          border: '1px solid #e0f2eb',
                          borderRadius: 14,
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: '1rem'
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{
                              background: '#e0f2eb',
                              color: '#2e685d',
                              padding: '0.15rem 0.55rem',
                              borderRadius: 99,
                              fontSize: 11,
                              fontWeight: 700
                            }}>
                              {act.type}
                            </span>
                            <span style={{ fontWeight: 700, color: '#032f28', fontSize: 14 }}>
                              {act.title}
                            </span>
                          </div>
                          <div style={{ fontSize: 13, color: '#414846', marginTop: '0.25rem' }}>
                            {act.description}
                          </div>
                          <div style={{ fontSize: 12, color: '#717976', marginTop: '0.25rem' }}>
                            Actor: <strong style={{ color: '#032f28' }}>{act.actor}</strong> {act.target && `• Target: ${act.target}`}
                          </div>
                        </div>

                        <div style={{ fontSize: 12, color: '#717976', whiteSpace: 'nowrap' }}>
                          {new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Emergency Buffer Direct Allocation Modal */}
      {allocateModalItem && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(3, 47, 40, 0.45)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 20,
            maxWidth: 480,
            width: '100%',
            padding: '1.75rem',
            border: '1px solid #e0f2eb',
            boxShadow: '0 20px 40px rgba(3,47,40,0.15)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#2e685d', marginBottom: '0.5rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 24 }}>add_box</span>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#032f28' }}>
                Emergency Buffer Stock Injection
              </h3>
            </div>
            <p style={{ fontSize: 13, color: '#52605b', margin: '0 0 1.25rem 0' }}>
              Directly allocate reserve inventory into live network stock for this pharmacy node.
            </p>

            <div style={{ background: '#f8faf9', padding: '1rem', borderRadius: 12, border: '1px solid #e0f2eb', marginBottom: '1.25rem' }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#032f28' }}>
                {allocateModalItem.medicine?.brandName || allocateModalItem.medicine?.name}
              </div>
              <div style={{ fontSize: 12, color: '#52605b', marginTop: '0.2rem' }}>
                {allocateModalItem.medicine?.genericName} • Node: <strong>{allocateModalItem.pharmacy?.name}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #e0f2eb' }}>
                <span style={{ fontSize: 12, color: '#717976' }}>Current On-Hand Stock:</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#ba1a1a' }}>{allocateModalItem.stock || 0} unit(s)</span>
              </div>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Units to Allocate
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {[10, 25, 50, 100].map(amt => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setAllocateUnits(amt)}
                    style={{
                      flex: 1,
                      padding: '0.45rem',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      border: allocateUnits === amt ? '2px solid #2e685d' : '1px solid #c0c8c5',
                      background: allocateUnits === amt ? '#e0f2eb' : '#ffffff',
                      color: allocateUnits === amt ? '#032f28' : '#52605b',
                      cursor: 'pointer'
                    }}
                  >
                    +{amt}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min="1"
                max="1000"
                value={allocateUnits}
                onChange={e => setAllocateUnits(Math.max(1, parseInt(e.target.value) || 1))}
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  borderRadius: 10,
                  border: '1px solid #c0c8c5',
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#032f28',
                  outline: 'none'
                }}
              />
              <div style={{ fontSize: 12, color: '#2e685d', fontWeight: 600, marginTop: '0.5rem' }}>
                Projected New Stock: {(allocateModalItem.stock || 0) + allocateUnits} units (Status: AVAILABLE)
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setAllocateModalItem(null)}
                style={{
                  padding: '0.55rem 1rem',
                  borderRadius: 99,
                  border: '1px solid #c0c8c5',
                  background: '#ffffff',
                  color: '#52605b',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(allocatingId)}
                onClick={() => handleAllocateEmergencyStock(allocateModalItem, allocateUnits)}
                style={{
                  padding: '0.55rem 1.25rem',
                  borderRadius: 99,
                  border: 'none',
                  background: '#2e685d',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: allocatingId ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>bolt</span>
                <span>{allocatingId ? 'Injecting Stock...' : 'Confirm Injection'}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Add / Edit Pharmacy Modal */}
      {pharmacyModal.isOpen && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(3, 47, 40, 0.45)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1.25rem',
          overflowY: 'auto'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 20,
            maxWidth: 680,
            width: '100%',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid #e0f2eb',
            boxShadow: '0 24px 48px rgba(3,47,40,0.18)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid #e0f2eb',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f8faf9'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 24, color: '#2e685d' }}>
                  {pharmacyModal.mode === 'create' ? 'add_business' : 'edit_document'}
                </span>
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#032f28' }}>
                    {pharmacyModal.mode === 'create' ? 'Register New Network Pharmacy' : `Edit ${pharmacyModal.data?.name || 'Pharmacy'}`}
                  </h3>
                  <p style={{ margin: 0, fontSize: 12, color: '#717976' }}>
                    {pharmacyModal.mode === 'create'
                      ? 'Creates a dispensary node, assigns a manager, and provisions catalog inventory.'
                      : 'Update dispensary details, operating hours, and manager credentials.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPharmacyModal(prev => ({ ...prev, isOpen: false }))}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: '#717976',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0.25rem'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22 }}>close</span>
              </button>
            </div>

            <form onSubmit={handleSavePharmacy} style={{ overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Section 1: Basic Information */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#2e685d', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>store</span>
                  <span>Dispensary Details</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '0.85rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#032f28', marginBottom: '0.3rem' }}>
                      Pharmacy Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Pharmacy"
                      value={pharmacyModal.form.name}
                      onChange={e => setPharmacyModal(prev => ({ ...prev, form: { ...prev.form, name: e.target.value } }))}
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.8rem',
                        borderRadius: 8,
                        border: '1px solid #c0c8c5',
                        fontSize: 13,
                        color: '#032f28',
                        fontWeight: 700,
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#032f28', marginBottom: '0.3rem' }}>
                      Drug License Number *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="License"
                      value={pharmacyModal.form.licenseNumber}
                      onChange={e => setPharmacyModal(prev => ({ ...prev, form: { ...prev.form, licenseNumber: e.target.value } }))}
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.8rem',
                        borderRadius: 8,
                        border: '1px solid #c0c8c5',
                        fontSize: 13,
                        color: '#032f28',
                        fontWeight: 700,
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#032f28', marginBottom: '0.3rem' }}>
                      Physical Address &amp; Locality *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Address"
                      value={pharmacyModal.form.address}
                      onChange={e => setPharmacyModal(prev => ({ ...prev, form: { ...prev.form, address: e.target.value } }))}
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.8rem',
                        borderRadius: 8,
                        border: '1px solid #c0c8c5',
                        fontSize: 13,
                        color: '#032f28',
                        fontWeight: 700,
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#032f28', marginBottom: '0.3rem' }}>
                      Contact Phone Number *
                    </label>
                    <input
                      type="tel"
                      required
                      placeholder="Phone"
                      value={pharmacyModal.form.phone}
                      onChange={e => setPharmacyModal(prev => ({ ...prev, form: { ...prev.form, phone: e.target.value } }))}
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.8rem',
                        borderRadius: 8,
                        border: '1px solid #c0c8c5',
                        fontSize: 13,
                        color: '#032f28',
                        fontWeight: 700,
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#032f28', marginBottom: '0.3rem' }}>
                      Operating Hours (e.g. 09:30–20:00) *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Hours"
                      value={pharmacyModal.form.openingHours}
                      onChange={e => setPharmacyModal(prev => ({ ...prev, form: { ...prev.form, openingHours: e.target.value } }))}
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.8rem',
                        borderRadius: 8,
                        border: '1px solid #c0c8c5',
                        fontSize: 13,
                        color: '#032f28',
                        fontWeight: 700,
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Pharmacist In Charge / Manager Portal Credentials */}
              <div style={{ background: '#f5faf8', padding: '1rem', borderRadius: 12, border: '1px solid #d5e9e2' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#032f28', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>badge</span>
                  <span>Pharmacist Manager &amp; Portal Login</span>
                </div>
                <p style={{ margin: '0 0 0.85rem 0', fontSize: 11, color: '#52605b' }}>
                  Used by the pharmacist to log in at <code>/login</code> (using Pharmacy ID, Email, or Phone) and update stock at <code>/pharmacist</code>.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#032f28', marginBottom: '0.25rem' }}>
                      Manager Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Name"
                      value={pharmacyModal.form.managerName}
                      onChange={e => setPharmacyModal(prev => ({ ...prev, form: { ...prev.form, managerName: e.target.value } }))}
                      style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: 8, border: '1px solid #c0c8c5', fontSize: 13, background: '#ffffff', boxSizing: 'border-box', fontWeight: 700, color: '#032f28' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#032f28', marginBottom: '0.25rem' }}>
                      Login Email *
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="Email"
                      value={pharmacyModal.form.managerEmail}
                      onChange={e => setPharmacyModal(prev => ({ ...prev, form: { ...prev.form, managerEmail: e.target.value } }))}
                      style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: 8, border: '1px solid #c0c8c5', fontSize: 13, background: '#ffffff', boxSizing: 'border-box', fontWeight: 700, color: '#032f28' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#032f28', marginBottom: '0.25rem' }}>
                      Manager Phone
                    </label>
                    <input
                      type="tel"
                      placeholder="Phone"
                      value={pharmacyModal.form.managerPhone}
                      onChange={e => setPharmacyModal(prev => ({ ...prev, form: { ...prev.form, managerPhone: e.target.value } }))}
                      style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: 8, border: '1px solid #c0c8c5', fontSize: 13, background: '#ffffff', boxSizing: 'border-box', fontWeight: 700, color: '#032f28' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#032f28', marginBottom: '0.25rem' }}>
                      {pharmacyModal.mode === 'create' ? 'Portal Password *' : 'Change Password (Optional)'}
                    </label>
                    <input
                      type="password"
                      required={pharmacyModal.mode === 'create'}
                      placeholder="Password"
                      value={pharmacyModal.form.managerPassword}
                      onChange={e => setPharmacyModal(prev => ({ ...prev, form: { ...prev.form, managerPassword: e.target.value } }))}
                      style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: 8, border: '1px solid #c0c8c5', fontSize: 13, background: '#ffffff', boxSizing: 'border-box', fontWeight: 700, color: '#032f28' }}
                    />
                  </div>
                </div>
              </div>

              {/* Section 3: Geolocation and Operating Capabilities */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#2e685d', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>pin_drop</span>
                    <span>Location Coordinates &amp; Map Registry</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {/* Auto-detect GPS */}
                    <button
                      type="button"
                      disabled={detectingGpsPharmacy}
                      onClick={() => {
                        if (!navigator.geolocation) {
                          showToast('Geolocation not supported by browser', 'error');
                          return;
                        }
                        setDetectingGpsPharmacy(true);
                        navigator.geolocation.getCurrentPosition(
                          (pos) => {
                            const { latitude, longitude } = pos.coords;
                            setPharmacyModal(prev => ({
                              ...prev,
                              form: {
                                ...prev.form,
                                latitude: latitude.toFixed(6),
                                longitude: longitude.toFixed(6)
                              }
                            }));
                            setDetectingGpsPharmacy(false);
                            showToast(`GPS Coordinates detected: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, 'success');
                          },
                          (err) => {
                            setDetectingGpsPharmacy(false);
                            showToast('Could not fetch GPS. Please select town preset or enter coordinates.', 'info');
                          },
                          { enableHighAccuracy: true, timeout: 6000 }
                        );
                      }}
                      style={{
                        padding: '5px 12px',
                        borderRadius: 99,
                        border: 'none',
                        background: detectingGpsPharmacy
                          ? 'linear-gradient(135deg, #1e453e 0%, #2e685d 100%)'
                          : 'linear-gradient(135deg, #032f28 0%, #1e453e 100%)',
                        color: '#ffffff',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: detectingGpsPharmacy ? 'wait' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        boxShadow: '0 2px 6px rgba(3, 47, 40, 0.2)',
                        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                        opacity: detectingGpsPharmacy ? 0.85 : 1
                      }}
                      title="Use live GPS of dispensary"
                    >
                      {detectingGpsPharmacy ? (
                        <>
                          <span className="material-symbols-outlined animate-spin" style={{ fontSize: 13, color: '#34d399' }}>progress_activity</span>
                          <span>Detecting GPS...</span>
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#34d399' }}>my_location</span>
                          <span>Auto-Detect GPS</span>
                        </>
                      )}
                    </button>

                    {/* Town Preset Quick Selector */}
                    <select
                      onChange={e => {
                        const presets = [
                          { name: 'Chengannur Town', lat: '9.3170', lon: '76.6145' },
                          { name: 'Kallissery', lat: '9.3250', lon: '76.6200' },
                          { name: 'Pandanad', lat: '9.3320', lon: '76.5980' },
                          { name: 'Budhanoor', lat: '9.3080', lon: '76.5620' },
                          { name: 'Ala', lat: '9.3020', lon: '76.6180' },
                          { name: 'Mannar', lat: '9.3120', lon: '76.5380' },
                          { name: 'Mavelikara', lat: '9.2650', lon: '76.5510' },
                          { name: 'Haripad', lat: '9.2350', lon: '76.4700' },
                          { name: 'Kayamkulam', lat: '9.1720', lon: '76.5000' },
                          { name: 'Thiruvalla', lat: '9.3830', lon: '76.5740' },
                          { name: 'Kozhencherry', lat: '9.3410', lon: '76.7110' },
                          { name: 'Aranmula', lat: '9.3070', lon: '76.6850' },
                          { name: 'Adoor', lat: '9.1530', lon: '76.7330' }
                        ];
                        const found = presets.find(p => p.name === e.target.value);
                        if (found) {
                          setPharmacyModal(prev => ({
                            ...prev,
                            form: {
                              ...prev.form,
                              latitude: found.lat,
                              longitude: found.lon,
                              address: prev.form.address ? prev.form.address : `${found.name}, Kerala`
                            }
                          }));
                          showToast(`Applied ${found.name} map coordinates (${found.lat}, ${found.lon})`, 'info');
                        }
                      }}
                      style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: 6,
                        border: '1px solid #c0c8c5',
                        background: '#ffffff',
                        fontSize: 11,
                        color: '#032f28',
                        fontWeight: 600
                      }}
                    >
                      <option value="">-- Apply Town Preset --</option>
                      <option value="Chengannur Town">📍 Chengannur Town</option>
                      <option value="Mavelikara">📍 Mavelikara Town</option>
                      <option value="Haripad">📍 Haripad Town</option>
                      <option value="Thiruvalla">📍 Thiruvalla Town</option>
                      <option value="Kallissery">📍 Kallissery</option>
                      <option value="Pandanad">📍 Pandanad</option>
                      <option value="Mannar">📍 Mannar</option>
                      <option value="Adoor">📍 Adoor</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '0.85rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#032f28', marginBottom: '0.25rem' }}>
                      Latitude (Decimal GPS) *
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      placeholder="Latitude"
                      value={pharmacyModal.form.latitude}
                      onChange={e => setPharmacyModal(prev => ({ ...prev, form: { ...prev.form, latitude: e.target.value } }))}
                      style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: 8, border: '1px solid #c0c8c5', fontSize: 13, boxSizing: 'border-box', fontWeight: 700, color: '#032f28' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#032f28', marginBottom: '0.25rem' }}>
                      Longitude (Decimal GPS) *
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      placeholder="Longitude"
                      value={pharmacyModal.form.longitude}
                      onChange={e => setPharmacyModal(prev => ({ ...prev, form: { ...prev.form, longitude: e.target.value } }))}
                      style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: 8, border: '1px solid #c0c8c5', fontSize: 13, boxSizing: 'border-box', fontWeight: 700, color: '#032f28' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: 13, color: '#032f28', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={pharmacyModal.form.is24x7}
                      onChange={e => setPharmacyModal(prev => ({ ...prev, form: { ...prev.form, is24x7: e.target.checked } }))}
                      style={{ width: 16, height: 16, accentColor: '#2e685d' }}
                    />
                    <span>24/7 Night Care Operations</span>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: 13, color: '#032f28', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={pharmacyModal.form.deliveryAvailable}
                      onChange={e => setPharmacyModal(prev => ({ ...prev, form: { ...prev.form, deliveryAvailable: e.target.checked } }))}
                      style={{ width: 16, height: 16, accentColor: '#2e685d' }}
                    />
                    <span>Home Delivery Available</span>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: 13, color: '#032f28', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={pharmacyModal.form.emergencyAvailability}
                      onChange={e => setPharmacyModal(prev => ({ ...prev, form: { ...prev.form, emergencyAvailability: e.target.checked } }))}
                      style={{ width: 16, height: 16, accentColor: '#2e685d' }}
                    />
                    <span>Priority Emergency Reserve Buffer</span>
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '1rem', borderTop: '1px solid #e0f2eb' }}>
                <button
                  type="button"
                  onClick={() => setPharmacyModal(prev => ({ ...prev, isOpen: false }))}
                  style={{
                    padding: '0.6rem 1.15rem',
                    borderRadius: 99,
                    border: '1px solid #c0c8c5',
                    background: '#ffffff',
                    color: '#52605b',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pharmacyModal.submitting}
                  style={{
                    padding: '0.6rem 1.35rem',
                    borderRadius: 99,
                    border: 'none',
                    background: '#2e685d',
                    color: '#ffffff',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: pharmacyModal.submitting ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    boxShadow: '0 2px 6px rgba(46,104,93,0.2)'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    {pharmacyModal.submitting ? 'sync' : 'check'}
                  </span>
                  <span>{pharmacyModal.submitting ? 'Saving Pharmacy...' : pharmacyModal.mode === 'create' ? 'Register & Provision Stock' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* High-Stakes Action Confirmation Modal */}
      <ConfirmationDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        impactPoints={confirmDialog.impactPoints || []}
        confirmText={confirmDialog.confirmLabel || confirmDialog.confirmText}
        cancelText={confirmDialog.cancelLabel || confirmDialog.cancelText}
        isDestructive={confirmDialog.variant === 'danger' || confirmDialog.isDestructive}
        onConfirm={() => {
          confirmDialog.onConfirm();
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
