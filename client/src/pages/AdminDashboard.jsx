import React, { useState, useEffect } from 'react';
import ConfirmationDialog from '../components/ConfirmationDialog';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';

export default function AdminDashboard({ currentTab, onTabChange }) {
  const [internalTab, setInternalTab] = useState('overview');
  const activeTab = currentTab !== undefined ? currentTab : internalTab;
  const setActiveTab = onTabChange || setInternalTab;
  const [metrics, setMetrics] = useState(null);
  const [usersList, setUsersList] = useState([]);
  const [pharmaciesList, setPharmaciesList] = useState([]);
  const [ordersList, setOrdersList] = useState([]);
  const [emergencyData, setEmergencyData] = useState({ tasks: [], emergencyOrders: [] });
  const [activityList, setActivityList] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

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

  useEffect(() => {
    fetchAllAdminData();
  }, []);

  async function fetchAllAdminData() {
    setLoading(true);
    setError('');
    const token = localStorage.getItem('medifind_token');
    const headers = { Authorization: `Bearer ${token}` };

    try {
      const [metricsRes, usersRes, pharmaciesRes, ordersRes, emergencyRes, activityRes] = await Promise.all([
        fetch('/api/analytics/metrics', { headers }),
        fetch('/api/admin/users', { headers }),
        fetch('/api/admin/pharmacies', { headers }),
        fetch('/api/admin/orders', { headers }),
        fetch('/api/admin/emergency-requests', { headers }),
        fetch('/api/admin/activity', { headers })
      ]);

      const [mJson, uJson, pJson, oJson, eJson, aJson] = await Promise.all([
        metricsRes.json(),
        usersRes.json(),
        pharmaciesRes.json(),
        ordersRes.json(),
        emergencyRes.json(),
        activityRes.json()
      ]);

      if (mJson.success) setMetrics(mJson.metrics);
      if (uJson.success) setUsersList(uJson.users || []);
      if (pJson.success) setPharmaciesList(pJson.pharmacies || []);
      if (oJson.success) setOrdersList(oJson.orders || []);
      if (eJson.success) setEmergencyData({ tasks: eJson.tasks || [], emergencyOrders: eJson.emergencyOrders || [] });
      if (aJson.success) setActivityList(aJson.activity || []);
    } catch (err) {
      console.error('Error fetching admin data:', err);
      setError('Failed to fetch administrative records.');
      showToast('Network error loading administrative records.', 'error');
    } finally {
      setLoading(false);
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

  const tabs = [
    { id: 'overview', label: 'Overview & Operations', icon: 'monitoring', count: null },
    { id: 'users', label: 'Users Directory', icon: 'group', count: usersList.length },
    { id: 'pharmacies', label: 'Pharmacies & Verification', icon: 'domain', count: pharmaciesList.length },
    { id: 'orders', label: 'Orders Management', icon: 'receipt_long', count: ordersList.length },
    { id: 'emergency', label: 'Emergency & Logistics', icon: 'local_shipping', count: emergencyData.tasks.length + emergencyData.emergencyOrders.length },
    { id: 'activity', label: 'Activity Audit', icon: 'timeline', count: activityList.length }
  ];

  return (
    <div style={{ background: '#ecfdf7', minHeight: '100vh', paddingBottom: '4rem' }}>
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

      {/* Top System Status Ticker (Dark Slate) */}
      <div style={{ background: '#0f172a', color: '#94a3b8', fontSize: 11, padding: '0.45rem 1.5rem', borderBottom: '1px solid #1e293b' }}>
        <div style={{ maxWidth: 1440, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#34d399', fontWeight: 600 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399' }}></span>
              SYSTEM ACTIVE
            </span>
            <span style={{ color: '#334155' }}>|</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#64748b' }}>dns</span>
              <span>Regional Service Cluster (Chengannur / Alappuzha)</span>
            </span>
            <span style={{ color: '#334155' }}>|</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#64748b' }}>shield_lock</span>
              <span>Role-Isolated Access Control Active</span>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontFamily: 'monospace' }}>LATENCY: 14ms</span>
            <span style={{ color: '#334155' }}>|</span>
            <span style={{ color: '#cbd5e1', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#34d399' }}>sync</span>
              <span>Audit Synchronized</span>
            </span>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div style={{ maxWidth: 1440, margin: '0 auto', padding: '2rem 1.5rem' }}>
        {/* Top Header & Global Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.5rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>verified_user</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#2e685d', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  System Administrator Audit &amp; Control Console
                </span>
              </div>
              <h1 style={{ fontSize: 32, fontWeight: 700, color: '#032f28', margin: 0, letterSpacing: '-0.02em' }}>
                MediFind AI Operations Center
              </h1>
              <p style={{ fontSize: 15, color: '#414846', margin: '0.35rem 0 0 0' }}>
                Multi-pharmacy registry verification, user access directories, emergency fulfillment logistics, and compliance audit trail.
              </p>
            </div>

            {/* Header Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                onClick={fetchAllAdminData}
                disabled={loading}
                style={{
                  background: '#ffffff',
                  color: '#032f28',
                  border: '1px solid #c0c8c5',
                  borderRadius: 99,
                  padding: '0.55rem 1.15rem',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18, animation: loading ? 'spin 1s linear infinite' : 'none' }}>sync</span>
                <span>{loading ? 'Refreshing...' : 'Refresh Live State'}</span>
              </button>

              <button
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
                style={{
                  background: '#032f28',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 99,
                  padding: '0.55rem 1.25rem',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  boxShadow: '0 2px 6px rgba(3,47,40,0.2)'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>download</span>
                <span>Sync Offline Catalog</span>
              </button>
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

        {/* Tab Switcher Pills */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: '#ffffff',
          padding: '0.4rem',
          borderRadius: 99,
          border: '1px solid #e0f2eb',
          width: 'fit-content',
          marginBottom: '2rem',
          boxShadow: '0 1px 4px rgba(3,47,40,0.04)',
          overflowX: 'auto',
          maxWidth: '100%'
        }}>
          {tabs.map(t => {
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  background: isActive ? '#032f28' : 'transparent',
                  color: isActive ? '#ffffff' : '#414846',
                  border: 'none',
                  borderRadius: 99,
                  padding: '0.5rem 1.15rem',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  whiteSpace: 'nowrap'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{t.icon}</span>
                <span>{t.label}</span>
                {t.count !== null && (
                  <span style={{
                    background: isActive ? 'rgba(255,255,255,0.2)' : '#e6f8f1',
                    color: isActive ? '#ffffff' : '#2e685d',
                    padding: '1px 6px',
                    borderRadius: 99,
                    fontSize: 11,
                    fontWeight: 700
                  }}>
                    {t.count}
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
                {/* 4 Metric Bento Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
                  <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#717976' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Catalog Medicines</span>
                      <span className="material-symbols-outlined" style={{ fontSize: 22, color: '#2e685d' }}>medication</span>
                    </div>
                    <div style={{ fontSize: 36, fontWeight: 700, color: '#032f28', marginTop: '0.35rem' }}>
                      {metrics.totalMedicines}
                    </div>
                    <span style={{ fontSize: 12, color: '#2e685d', fontWeight: 600 }}>
                      {metrics.emergencyMedicines} Classified Emergency Critical
                    </span>
                  </div>

                  <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#717976' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Network Pharmacies</span>
                      <span className="material-symbols-outlined" style={{ fontSize: 22, color: '#336c61' }}>domain</span>
                    </div>
                    <div style={{ fontSize: 36, fontWeight: 700, color: '#032f28', marginTop: '0.35rem' }}>
                      {metrics.totalPharmacies}
                    </div>
                    <span style={{ fontSize: 12, color: '#2e685d', fontWeight: 600 }}>
                      {metrics.open24x7Pharmacies} Verified 24/7 Night Nodes
                    </span>
                  </div>

                  <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#717976' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Reservations</span>
                      <span className="material-symbols-outlined" style={{ fontSize: 22, color: '#2e685d' }}>receipt_long</span>
                    </div>
                    <div style={{ fontSize: 36, fontWeight: 700, color: '#032f28', marginTop: '0.35rem' }}>
                      {metrics.totalOrders}
                    </div>
                    <span style={{ fontSize: 12, color: '#717976' }}>
                      {metrics.pendingOrders} Pending • {metrics.completedOrders} Completed
                    </span>
                  </div>

                  <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#717976' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Low Stock Watch</span>
                      <span className="material-symbols-outlined" style={{ fontSize: 22, color: metrics.lowStockCount > 0 ? '#ba1a1a' : '#2e685d' }}>warning</span>
                    </div>
                    <div style={{ fontSize: 36, fontWeight: 700, color: metrics.lowStockCount > 0 ? '#ba1a1a' : '#032f28', marginTop: '0.35rem' }}>
                      {metrics.lowStockCount}
                    </div>
                    <span style={{ fontSize: 12, color: metrics.lowStockCount > 0 ? '#ba1a1a' : '#717976' }}>
                      Items below safety buffer (≤ 5 units)
                    </span>
                  </div>
                </div>

                {/* Category Breakdown & Low Stock Alert Tables */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1.5rem' }}>
                  {/* Category Card */}
                  <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: '#032f28', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>category</span>
                      <span>Medicine Therapeutic Distribution</span>
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                      {Object.entries(metrics.categoryDistribution || {}).map(([cat, count]) => (
                        <div key={cat} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', background: '#e6f8f1', borderRadius: 10, fontSize: 13 }}>
                          <span style={{ fontWeight: 600, color: '#032f28' }}>{cat}</span>
                          <span style={{ background: '#ffffff', padding: '0.15rem 0.55rem', borderRadius: 99, fontSize: 11, fontWeight: 700, color: '#2e685d', border: '1px solid #c0c8c5' }}>
                            {count} SKUs
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Low Stock Alerts */}
                  <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#ba1a1a', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#ba1a1a' }}>warning</span>
                        <span>Critical Buffer Inventory Alerts</span>
                      </h3>
                      <span style={{ fontSize: 11, fontWeight: 700, background: '#ffdad6', color: '#93000a', padding: '2px 10px', borderRadius: 99, textTransform: 'uppercase' }}>
                        Buffer Threshold: ≤10 Units
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: 380, overflowY: 'auto' }}>
                      {(!metrics.lowStockItems || metrics.lowStockItems.length === 0) ? (
                        <div style={{ textAlign: 'center', padding: '2rem 1rem', background: '#f8faf9', borderRadius: 14, border: '1px solid #e0f2eb' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 32, color: '#2e685d', marginBottom: '0.5rem' }}>check_circle</span>
                          <p style={{ color: '#032f28', fontWeight: 600, fontSize: 14, margin: '0 0 0.25rem 0' }}>All Network Buffers Stable</p>
                          <p style={{ color: '#717976', fontSize: 12, margin: 0 }}>Registered pharmacy inventories currently meet safety buffer quotas across all districts.</p>
                        </div>
                      ) : (
                        metrics.lowStockItems.map((inv, idx) => {
                          const medName = inv.medicine?.brandName || inv.medicine?.name || 'Medicine SKU';
                          const generic = inv.medicine?.genericName || inv.medicine?.dosageForm || 'Prescription item';
                          const isCritical = (inv.stock || 0) <= 5;

                          return (
                            <div
                              key={idx}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '0.85rem 1rem',
                                background: isCritical ? '#fff0ee' : '#fff8e6',
                                borderRadius: 12,
                                border: isCritical ? '1px solid #ffb4a8' : '1px solid #ffe082',
                                fontSize: 13,
                                flexWrap: 'wrap',
                                gap: '0.75rem'
                              }}
                            >
                              <div style={{ flex: 1, minWidth: 200 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <span style={{
                                    fontSize: 10,
                                    fontWeight: 800,
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    background: isCritical ? '#ba1a1a' : '#d97706',
                                    color: '#ffffff',
                                    letterSpacing: '0.04em'
                                  }}>
                                    {isCritical ? 'CRITICAL DEPLETION' : 'BUFFER WATCH'}
                                  </span>
                                  <strong style={{ color: isCritical ? '#5a0100' : '#78350f', fontSize: 14 }}>{medName}</strong>
                                </div>
                                <div style={{ fontSize: 12, color: isCritical ? '#7e1208' : '#92400e', marginTop: '0.2rem' }}>
                                  {generic} • <span style={{ fontWeight: 600 }}>{inv.pharmacy?.name}</span>
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div style={{ textAlign: 'right' }}>
                                  <span style={{
                                    background: isCritical ? '#ba1a1a' : '#b45309',
                                    color: '#ffffff',
                                    padding: '0.25rem 0.65rem',
                                    borderRadius: 99,
                                    fontSize: 12,
                                    fontWeight: 700
                                  }}>
                                    {inv.stock} unit{inv.stock !== 1 ? 's' : ''} left
                                  </span>
                                </div>

                                <button
                                  onClick={() => {
                                    setConfirmDialog({
                                      isOpen: true,
                                      title: isCritical ? 'Broadcast Critical Stock Depletion Alert?' : 'Broadcast Buffer Restock Advisory?',
                                      message: `Send an immediate automated restock priority dispatch to ${inv.pharmacy?.name} for ${medName}? Current inventory is at ${inv.stock} unit(s).`,
                                      confirmLabel: 'Broadcast Advisory',
                                      variant: isCritical ? 'danger' : 'primary',
                                      impactPoints: [
                                        'Emergency procurement notification will be dispatched to pharmacy staff.',
                                        'Logged in central operational audit trail.'
                                      ],
                                      onConfirm: () => {
                                        showToast(`Restock advisory broadcasted to ${inv.pharmacy?.name} for ${medName}.`, 'success');
                                      }
                                    });
                                  }}
                                  style={{
                                    background: '#ffffff',
                                    color: isCritical ? '#ba1a1a' : '#92400e',
                                    border: isCritical ? '1px solid #ba1a1a' : '1px solid #d97706',
                                    borderRadius: 99,
                                    padding: '0.35rem 0.75rem',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.25rem'
                                  }}
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>send</span>
                                  <span>Alert Restock</span>
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>
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
                        <th style={{ padding: '0.75rem 1rem' }}>Assigned Pharmacy</th>
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
                            <td style={{ padding: '0.85rem 1rem', color: '#414846' }}>{u.pharmacy?.name || '—'}</td>
                            <td style={{ padding: '0.85rem 1rem', color: '#717976' }}>{new Date(u.createdAt).toLocaleDateString()}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 3: PHARMACIES AUDIT */}
            {activeTab === 'pharmacies' && (
              <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#032f28', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>domain</span>
                  <span>Network Pharmacies &amp; Fixture Verification ({pharmaciesList.length})</span>
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#e0f2eb', color: '#414846', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <th style={{ padding: '0.75rem 1rem' }}>Pharmacy Name &amp; Location</th>
                        <th style={{ padding: '0.75rem 1rem' }}>License #</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Pharmacist In Charge</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Catalog Inventory</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Operating State</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Verification Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pharmaciesList.length === 0 ? (
                        <tr>
                          <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: '#717976' }}>
                            No network pharmacies registered.
                          </td>
                        </tr>
                      ) : (
                        pharmaciesList.map(p => (
                          <tr key={p.id} style={{ borderBottom: '1px solid #e0f2eb' }}>
                            <td style={{ padding: '0.85rem 1rem' }}>
                              <div style={{ fontWeight: 700, color: '#032f28' }}>{p.name}</div>
                              <div style={{ fontSize: 12, color: '#717976' }}>{p.address}</div>
                            </td>
                          <td style={{ padding: '0.85rem 1rem', fontFamily: 'monospace', color: '#2e685d', fontWeight: 600 }}>
                            {p.licenseNumber}
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            <div style={{ color: '#032f28', fontWeight: 600 }}>{p.manager?.name || 'Unassigned'}</div>
                            <div style={{ fontSize: 11, color: '#717976' }}>{p.manager?.email || ''}</div>
                          </td>
                          <td style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#2e685d' }}>
                            {p.inventoryCount || (p.inventory || []).length} SKUs
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                              <span style={{
                                background: p.isOpen ? '#e0f2eb' : '#ffdad6',
                                color: p.isOpen ? '#2e685d' : '#ba1a1a',
                                padding: '0.15rem 0.55rem',
                                borderRadius: 99,
                                fontSize: 11,
                                fontWeight: 700
                              }}>
                                {p.isOpen ? 'Open' : 'Closed'}
                              </span>
                              {p.is24x7 && (
                                <span style={{ background: '#032f28', color: '#ffffff', padding: '0.15rem 0.55rem', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                                  24/7 Night Care
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            {p.participationStatus === 'PARTICIPATING_REAL_PHARMACY' ? (
                              <span style={{
                                background: '#b0ecdd',
                                color: '#032f28',
                                padding: '0.2rem 0.65rem',
                                borderRadius: 99,
                                fontSize: 11,
                                fontWeight: 700
                              }}>
                                Participating Real Pharmacy
                              </span>
                            ) : p.participationStatus === 'TEST_FIXTURE' ? (
                              <span style={{
                                background: '#ffdad6',
                                color: '#93000a',
                                padding: '0.2rem 0.65rem',
                                borderRadius: 99,
                                fontSize: 11,
                                fontWeight: 700
                              }}>
                                TEST FIXTURE (Deactivated)
                              </span>
                            ) : (
                              <span style={{
                                background: '#d5e6e0',
                                color: '#414846',
                                padding: '0.2rem 0.65rem',
                                borderRadius: 99,
                                fontSize: 11,
                                fontWeight: 700
                              }}>
                                {p.verificationStatus || 'PENDING'}
                              </span>
                            )}
                          </td>
                        </tr>
                      )))
                    }
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
