import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import ConfirmationDialog from '../components/ConfirmationDialog';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';

function CounterPinVerificationView({
  order,
  pharmacy,
  counterPinDigits,
  setCounterPinDigits,
  onBack,
  onVerifyPin,
  onOpenDocModal
}) {
  const pinInputsRef = [React.useRef(null), React.useRef(null), React.useRef(null), React.useRef(null)];

  const handleDigitChange = (index, value) => {
    const val = value.replace(/[^0-9]/g, '').slice(-1);
    const newDigits = [...counterPinDigits];
    newDigits[index] = val;
    setCounterPinDigits(newDigits);

    if (val && index < 3) {
      pinInputsRef[index + 1].current?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !counterPinDigits[index] && index > 0) {
      pinInputsRef[index - 1].current?.focus();
    }
  };

  const combinedPin = counterPinDigits.join('');

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Top Context & Back Action */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            onClick={onBack}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: '#e6f8f1',
              color: '#032f28',
              border: '1px solid #c0c8c5',
              padding: '0.45rem 1rem',
              borderRadius: 99,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
            <span>Back to Reservation Queue</span>
          </button>
          <span style={{ color: '#c0c8c5' }}>•</span>
          <span style={{ fontSize: 12, color: '#414846', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 15, color: '#2e685d' }}>storefront</span>
            {pharmacy?.name || 'Assigned Pharmacy'} (Dispensary #{pharmacy?.id?.substring(0, 6) || '---'})
          </span>
        </div>

        {/* Quick Session Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#ffffff', padding: '0.35rem 0.85rem', borderRadius: 99, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', fontSize: 11 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#2e685d' }}></div>
          <span style={{ color: '#032f28', fontWeight: 600 }}>Verification Counter • Fast Dispense</span>
          <span style={{ color: '#c0c8c5' }}>|</span>
          <span style={{ background: '#1e453e', color: '#c1ebe1', padding: '0.1rem 0.45rem', borderRadius: 99, fontSize: 10, fontWeight: 700 }}>STOCK REGISTRY</span>
        </div>
      </div>

      {/* Order Header Card */}
      <section style={{
        background: '#ffffff',
        borderRadius: 24,
        padding: '1.75rem',
        boxShadow: '0 4px 20px rgba(3,47,40,0.06)',
        border: '1px solid #e0f2eb',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.25rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
              <span style={{ fontSize: 24, fontWeight: 800, color: '#032f28', letterSpacing: '-0.02em' }}>
                Order #{order.orderNumber || order.id?.slice(0, 10).toUpperCase()}
              </span>
              <span style={{
                background: '#b0ecdd',
                color: '#336c61',
                padding: '0.2rem 0.65rem',
                borderRadius: 99,
                fontSize: 11,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem'
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check_circle</span>
                {order.status.replace(/_/g, ' ')}
              </span>
              <span style={{
                background: '#d5e6e0',
                color: '#032f28',
                padding: '0.2rem 0.65rem',
                borderRadius: 99,
                fontSize: 11,
                fontWeight: 700
              }}>
                {order.paymentStatus || 'PAID'}
              </span>
            </div>
            <p style={{ fontSize: 12, color: '#717976', margin: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 15, color: '#2e685d' }}>schedule</span>
              Reserved: {new Date(order.createdAt).toLocaleString()}
            </p>
          </div>

          {/* Fulfillment Pill Well */}
          <div style={{ background: '#e6f8f1', padding: '0.75rem 1.25rem', borderRadius: 16, display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#d5e6e0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#032f28' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>person</span>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700 }}>Patient Record</span>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28' }}>{order.user?.name || 'Verified Patient'}</span>
              </div>
            </div>

            <div style={{ width: 1, height: 24, background: '#c0c8c5' }}></div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#b0ecdd', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#336c61' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>front_hand</span>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700 }}>Pickup Protocol</span>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28' }}>Counter Dispensation</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Working Grid: 7 cols left, 5 cols right */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '1.5rem', alignItems: 'start' }}>
        {/* Left Column: 7 cols */}
        <div style={{ gridColumn: 'span 7', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Allocated Prescription Items */}
          <section style={{ background: '#ffffff', borderRadius: 24, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 2px 8px rgba(3,47,40,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', borderBottom: '1px solid #e6f8f1', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 20 }}>medication</span>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#032f28', margin: 0 }}>Allocated Prescription Items</h3>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, background: '#e0f2eb', color: '#2e685d', padding: '0.2rem 0.6rem', borderRadius: 99 }}>
                {order.items?.length || 0} / {order.items?.length || 0} RESERVED
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {(order.items || []).map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    background: '#e6f8f1',
                    borderRadius: 16,
                    padding: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '1rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2e685d' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 24 }}>medication</span>
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#032f28' }}>
                        {item.medicine?.brandName || item.medicine?.name || item.name || 'Prescription Medicine'}
                      </div>
                      <div style={{ fontSize: 11, color: '#414846' }}>
                        Requested: <strong>{item.quantity} Units</strong> • {item.medicine?.dosageForm || 'Oral'}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#032f28' }}>
                      ₹{((item.price || 0) * (item.quantity || 1)).toFixed(2)}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#336c61', background: '#b0ecdd', padding: '0.1rem 0.45rem', borderRadius: 99 }}>
                      Verified
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Total Balance Row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1rem', background: '#e0f2eb', padding: '0.85rem 1.25rem', borderRadius: 16 }}>
              <div>
                <span style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', fontWeight: 700, color: '#414846' }}>Order Total (Taxes &amp; Dispense Fees Included)</span>
                <span style={{ fontSize: 11, color: '#2e685d', fontWeight: 600 }}>Prepaid Escrow via MediFind Pay</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: '#032f28' }}>₹{(order.totalAmount || 0).toFixed(2)} INR</span>
                <span style={{ marginLeft: '0.35rem', background: '#1e453e', color: '#c1ebe1', fontSize: 10, fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: 99 }}>
                  PAID
                </span>
              </div>
            </div>
          </section>

          {/* Prescription Context Card */}
          <section style={{ background: '#ffffff', borderRadius: 24, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 2px 8px rgba(3,47,40,0.04)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 20 }}>verified_user</span>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#032f28', margin: 0 }}>Prescription Authorization</h3>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, background: '#b0ecdd', color: '#336c61', padding: '0.2rem 0.65rem', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>task_alt</span>
                Document Screening: Completed
              </span>
            </div>

            <div style={{ background: '#e6f8f1', padding: '0.85rem 1rem', borderRadius: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
              <div>
                <span style={{ display: 'block', fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700 }}>Referenced e-Prescription</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#032f28', fontFamily: 'monospace' }}>RX-MF-{order.id.slice(0, 6).toUpperCase()}</span>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700 }}>Clinical Protocol</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#032f28' }}>Verified Kerala Dispensary</span>
              </div>
            </div>

            <button
              onClick={onOpenDocModal}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: '#e0f2eb',
                color: '#032f28',
                border: 'none',
                padding: '0.6rem 1.25rem',
                borderRadius: 99,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                width: 'fit-content'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>attachment</span>
              <span>View Prescription Document</span>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>open_in_new</span>
            </button>

            <div style={{ background: '#e0f2eb', padding: '0.75rem 1rem', borderRadius: 14, display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: 11, color: '#414846' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d', marginTop: 1 }}>info</span>
              <span>
                <strong>Mandatory Safety Notice:</strong> Automated screening cannot confirm authenticity. Manual verification by a licensed healthcare professional or pharmacist may be required prior to releasing prescription items.
              </span>
            </div>
          </section>
        </div>

        {/* Right Column: Counter PIN Verification (5 cols) */}
        <div style={{ gridColumn: 'span 5', position: 'sticky', top: 96 }}>
          <section style={{
            background: '#ffffff',
            borderRadius: 24,
            padding: '1.75rem',
            border: '2px solid #2e685d',
            boxShadow: '0 8px 32px rgba(3,47,40,0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem'
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#2e685d', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>pin</span>
                  Secure Hand-off
                </span>
                <span style={{ background: combinedPin.length === 4 ? '#b0ecdd' : '#e0f2eb', color: '#032f28', fontSize: 11, fontWeight: 700, padding: '0.15rem 0.55rem', borderRadius: 99 }}>
                  {combinedPin.length === 4 ? 'Ready to Verify' : 'Awaiting 4 Digits'}
                </span>
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#032f28', margin: '0 0 0.35rem 0' }}>
                Counter Pickup Verification
              </h2>
              <p style={{ fontSize: 12, color: '#414846', margin: 0, lineHeight: 1.5 }}>
                Enter the patient's 4-digit pickup PIN provided in their MediFind AI order confirmation.
              </p>
            </div>

            {/* 4 Digit Boxes */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', margin: '0.75rem 0' }}>
              {[0, 1, 2, 3].map(idx => (
                <input
                  key={idx}
                  ref={pinInputsRef[idx]}
                  type="text"
                  maxLength={1}
                  value={counterPinDigits[idx] || ''}
                  onChange={e => handleDigitChange(idx, e.target.value)}
                  onKeyDown={e => handleKeyDown(idx, e)}
                  style={{
                    width: 56,
                    height: 72,
                    borderRadius: 16,
                    textAlign: 'center',
                    fontSize: 28,
                    fontWeight: 800,
                    background: counterPinDigits[idx] ? '#b0ecdd' : '#e6f8f1',
                    color: '#032f28',
                    border: counterPinDigits[idx] ? '2px solid #2e685d' : '1px solid #c0c8c5',
                    outline: 'none',
                    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.04)',
                    transition: 'all 0.15s'
                  }}
                />
              ))}
            </div>

            {/* Dispensary Main Action Button */}
            <button
              onClick={() => onVerifyPin(order.id, combinedPin)}
              disabled={combinedPin.length < 4}
              style={{
                width: '100%',
                padding: '0.85rem 1.5rem',
                borderRadius: 99,
                background: combinedPin.length >= 4 ? '#032f28' : '#c0c8c5',
                color: '#ffffff',
                border: 'none',
                fontSize: 13,
                fontWeight: 700,
                cursor: combinedPin.length >= 4 ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: combinedPin.length >= 4 ? '0 4px 14px rgba(3,47,40,0.2)' : 'none',
                transition: 'all 0.2s'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>inventory_2</span>
              <span>Verify PIN &amp; Complete Dispensation</span>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
            </button>

            {/* Attestation Microcopy */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: '#717976', borderTop: '1px solid #e6f8f1', paddingTop: '0.75rem' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#2e685d' }}>encrypted</span>
                Hardware Keystore Verified
              </span>
              <span>Terminal #TR-819-A</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function PharmacistPortal({ currentTab, onTabChange }) {
  const { user } = useAuth();
  const [internalTab, setInternalTab] = useState('overview'); // 'overview' | 'inventory'
  const activeTab = currentTab !== undefined ? currentTab : internalTab;
  const setActiveTab = onTabChange || setInternalTab;
  const [orders, setOrders] = useState([]);
  const [pharmacy, setPharmacy] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pinInputMap, setPinInputMap] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [orderFilterTab, setOrderFilterTab] = useState('ALL');
  const [inventoryFilterTab, setInventoryFilterTab] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [updatingItemId, setUpdatingItemId] = useState(null);
  const [stockEditMap, setStockEditMap] = useState({});

  // Counter PIN Terminal (Stitch Screen cd3c9feb12e84af2962935316bf94d82)
  const [counterPinOrder, setCounterPinOrder] = useState(null);
  const [counterPinDigits, setCounterPinDigits] = useState(['', '', '', '']);
  const [showRxDocModal, setShowRxDocModal] = useState(false);

  // Inline feedback alert
  const [feedback, setFeedback] = useState({ show: false, message: '', type: 'success' });

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    variant: 'danger',
    onConfirm: () => {}
  });

  // Add medicine to inventory modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [availableMedicines, setAvailableMedicines] = useState([]);
  const [selectedMedicineId, setSelectedMedicineId] = useState('');
  const [newStock, setNewStock] = useState('10');
  const [newPrice, setNewPrice] = useState('50.00');
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  const showToast = (message, type = 'success') => {
    setFeedback({ show: true, message, type });
    setTimeout(() => setFeedback({ show: false, message: '', type: 'success' }), 4000);
  };

  useEffect(() => {
    fetchPharmacyAndOrders();
  }, [user]);

  async function fetchPharmacyAndOrders() {
    setLoading(true);
    const token = localStorage.getItem('medifind_token');

    try {
      // 1. Fetch managed pharmacy
      const pharRes = await fetch('/api/pharmacies/my-pharmacy', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const pharData = await pharRes.json();

      if (pharData.success && pharData.pharmacy) {
        setPharmacy(pharData.pharmacy);
        setInventory(pharData.pharmacy.inventory || []);
        // Initialize stock edits
        const edits = {};
        (pharData.pharmacy.inventory || []).forEach(item => {
          edits[item.id] = {
            stock: item.stock != null ? item.stock : 0,
            price: item.price != null ? item.price : 0
          };
        });
        setStockEditMap(edits);
      } else {
        setPharmacy(null);
        setInventory([]);
      }

      // 2. Fetch orders for this pharmacy
      const ordRes = await fetch('/api/orders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const ordData = await ordRes.json();
      if (ordData.success) {
        setOrders(ordData.orders || []);
      }
    } catch (err) {
      console.error('Error fetching pharmacist data:', err);
      showToast('Network error while refreshing records.', 'error');
    } finally {
      setLoading(false);
    }
  }

  // Load catalog medicines not currently in inventory
  const handleOpenAddModal = async () => {
    setShowAddModal(true);
    setAddError('');
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch('/api/medicines/search', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.medicines) {
        const currentMedIds = new Set(inventory.map(inv => inv.medicineId));
        const unadded = data.medicines.filter(m => !currentMedIds.has(m.id));
        setAvailableMedicines(unadded);
        if (unadded.length > 0) {
          setSelectedMedicineId(unadded[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load medicines catalog:', err);
      setAddError('Failed to load medicine catalogue.');
    }
  };

  const handleAddMedicineSubmit = async (e) => {
    e.preventDefault();
    if (!pharmacy || !selectedMedicineId) return;

    const stockVal = parseInt(newStock, 10);
    const priceVal = parseFloat(newPrice);

    if (isNaN(stockVal) || stockVal < 0) {
      setAddError('Stock must be a non-negative integer.');
      return;
    }
    if (isNaN(priceVal) || priceVal < 0) {
      setAddError('Price must be a valid non-negative number.');
      return;
    }

    setAddLoading(true);
    setAddError('');
    const token = localStorage.getItem('medifind_token');

    try {
      const res = await fetch(`/api/pharmacies/${pharmacy.id}/inventory`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          medicineId: selectedMedicineId,
          stock: stockVal,
          price: priceVal
        })
      });
      const data = await res.json();
      if (data.success) {
        setShowAddModal(false);
        showToast('Medicine added to inventory successfully.', 'success');
        fetchPharmacyAndOrders();
      } else {
        setAddError(data.error || 'Failed to add medicine.');
      }
    } catch (err) {
      setAddError('Network error adding medicine.');
    } finally {
      setAddLoading(false);
    }
  };

  const handleUpdateStatus = async (orderId, newStatus) => {
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Order status updated to ${newStatus.replace(/_/g, ' ')}`, 'success');
        fetchPharmacyAndOrders();
      } else {
        showToast(data.error || 'Failed to update order status.', 'error');
      }
    } catch (err) {
      console.error('Error updating order status:', err);
      showToast('Error communicating with server.', 'error');
    }
  };

  const handleVerifyPin = async (orderId, explicitPin = null) => {
    const pin = explicitPin || pinInputMap[orderId];
    if (!pin || pin.length < 4) {
      showToast('Please enter the customer 4-digit verification PIN', 'warning');
      return;
    }
    const token = localStorage.getItem('medifind_token');

    try {
      const res = await fetch(`/api/orders/${orderId}/verify-pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();
      if (data.success) {
        showToast('PIN verified! Prescription dispensed and completed.', 'success');
        setPinInputMap(prev => ({ ...prev, [orderId]: '' }));
        setCounterPinDigits(['', '', '', '']);
        setCounterPinOrder(null);
        fetchPharmacyAndOrders();
      } else {
        showToast(data.error || 'Incorrect customer PIN.', 'error');
      }
    } catch (err) {
      console.error('Error verifying PIN:', err);
      showToast('Error validating PIN.', 'error');
    }
  };

  const handleSaveStock = async (itemId, medicineId) => {
    if (!pharmacy) return;
    const token = localStorage.getItem('medifind_token');
    const edit = stockEditMap[itemId] || {};
    setUpdatingItemId(itemId);

    try {
      const res = await fetch(`/api/pharmacies/${pharmacy.id}/inventory`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          medicineId,
          stock: parseInt(edit.stock, 10),
          price: parseFloat(edit.price)
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Stock and price updated successfully.', 'success');
        fetchPharmacyAndOrders();
      } else {
        showToast(data.error || 'Failed to update stock.', 'error');
      }
    } catch (err) {
      console.error('Error updating stock:', err);
      showToast('Network error updating stock.', 'error');
    } finally {
      setUpdatingItemId(null);
    }
  };

  const handleTogglePharmacyStatus = async (field, value) => {
    if (!pharmacy) return;
    const token = localStorage.getItem('medifind_token');

    try {
      const res = await fetch(`/api/pharmacies/${pharmacy.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ [field]: value })
      });
      const data = await res.json();
      if (data.success) {
        setPharmacy(data.pharmacy);
        showToast(`Dispensary ${field === 'isOpen' ? 'operating state' : '24/7 status'} updated.`, 'success');
      }
    } catch (err) {
      console.error('Error toggling status:', err);
    }
  };

  // Metrics
  const pendingCount = orders.filter(o => o.status === 'PENDING').length;
  const confirmedCount = orders.filter(o => o.status === 'CONFIRMED').length;
  const readyCount = orders.filter(o => o.status === 'READY_FOR_PICKUP').length;
  const lowStockCount = inventory.filter(i => (i.stock || 0) <= 5).length;
  const activeCatalogueCount = inventory.length;

  // Filtered orders
  const filteredOrders = orders.filter(o => {
    if (orderFilterTab !== 'ALL' && o.status !== orderFilterTab) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const matchesRef = (o.id || '').toLowerCase().includes(q);
    const matchesUser = (o.user?.name || '').toLowerCase().includes(q);
    const matchesMeds = (o.items || []).some(item =>
      (item.medicine?.name || item.medicine?.brandName || '').toLowerCase().includes(q)
    );
    return matchesRef || matchesUser || matchesMeds;
  });

  // Filtered inventory
  const filteredInventory = inventory.filter(inv => {
    const stock = inv.stock != null ? inv.stock : 0;
    if (inventoryFilterTab === 'AVAILABLE' && stock <= 0) return false;
    if (inventoryFilterTab === 'LOW_STOCK' && (stock <= 0 || stock > 10)) return false;
    if (inventoryFilterTab === 'OUT_OF_STOCK' && stock > 0) return false;

    if (categoryFilter !== 'ALL') {
      const medCat = inv.category || inv.medicine?.category || '';
      if (!medCat.toLowerCase().includes(categoryFilter.toLowerCase())) return false;
    }

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const name = (inv.brandName || inv.medicine?.brandName || inv.medicine?.name || '').toLowerCase();
    const gen = (inv.genericName || inv.medicine?.genericName || '').toLowerCase();
    return name.includes(q) || gen.includes(q);
  });

  if (!loading && !pharmacy) {
    return (
      <div style={{ background: '#ecfdf7', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{
          background: '#ffffff',
          borderRadius: 24,
          padding: '3rem 2rem',
          maxWidth: 520,
          textAlign: 'center',
          boxShadow: '0 8px 32px rgba(3,47,40,0.08)',
          border: '1px solid #e0f2eb'
        }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#ffdad6', color: '#ba1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 32 }}>domain_disabled</span>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#032f28', margin: '0 0 0.5rem 0' }}>
            No Pharmacy Linked to This Account
          </h2>
          <p style={{ fontSize: 14, color: '#414846', lineHeight: 1.6, margin: '0 0 1.5rem 0' }}>
            Your pharmacist account ({user?.email || 'authenticated user'}) does not currently have an assigned pharmacy node in the registry. Please contact an administrator.
          </p>
        </div>
      </div>
    );
  }

  if (counterPinOrder) {
    return (
      <div style={{ background: '#ecfdf7', minHeight: '100vh', paddingBottom: '4rem' }}>
        {/* Toast Feedback */}
        {feedback.show && (
          <div style={{
            position: 'fixed',
            top: '5.5rem',
            right: '1.5rem',
            zIndex: 9999,
            background: feedback.type === 'error' ? '#ffdad6' : feedback.type === 'warning' ? '#ffdad4' : '#e0f2eb',
            color: feedback.type === 'error' ? '#ba1a1a' : feedback.type === 'warning' ? '#5a0100' : '#032f28',
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
              {feedback.type === 'error' ? 'error' : feedback.type === 'warning' ? 'warning' : 'check_circle'}
            </span>
            <span>{feedback.message}</span>
          </div>
        )}

        <CounterPinVerificationView
          order={counterPinOrder}
          pharmacy={pharmacy}
          counterPinDigits={counterPinDigits}
          setCounterPinDigits={setCounterPinDigits}
          onBack={() => {
            setCounterPinOrder(null);
            setCounterPinDigits(['', '', '', '']);
          }}
          onVerifyPin={handleVerifyPin}
          onOpenDocModal={() => setShowRxDocModal(true)}
        />

        {/* Prescription Doc Modal */}
        {showRxDocModal && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(3,47,40,0.4)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '1.5rem'
          }}>
            <div style={{
              background: '#ffffff',
              borderRadius: 24,
              padding: '2rem',
              maxWidth: 580,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 40px rgba(3,47,40,0.15)',
              border: '1px solid #e0f2eb'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 24 }}>document_scanner</span>
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: '#032f28', margin: 0 }}>Prescription Document Authorization</h3>
                </div>
                <button
                  onClick={() => setShowRxDocModal(false)}
                  style={{ background: '#e6f8f1', border: 'none', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#032f28', cursor: 'pointer' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
                </button>
              </div>

              <div style={{ background: '#e6f8f1', padding: '1rem', borderRadius: 16, marginBottom: '1rem' }}>
                <div style={{ fontSize: 12, color: '#414846', marginBottom: '0.35rem' }}>
                  <strong>Prescription Reference:</strong> RX-MF-{counterPinOrder.id.slice(0, 8).toUpperCase()}
                </div>
                <div style={{ fontSize: 12, color: '#414846', marginBottom: '0.35rem' }}>
                  <strong>Patient Name:</strong> {counterPinOrder.user?.name || 'Verified Patient'}
                </div>
                <div style={{ fontSize: 12, color: '#414846' }}>
                  <strong>Date Issued / Staged:</strong> {new Date(counterPinOrder.createdAt).toLocaleDateString()}
                </div>
              </div>

              {counterPinOrder.prescriptionUrl || counterPinOrder.prescription?.imageUrl ? (
                <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #c0c8c5', marginBottom: '1rem' }}>
                  <img
                    src={counterPinOrder.prescriptionUrl || counterPinOrder.prescription?.imageUrl}
                    alt="Prescription Scan"
                    style={{ width: '100%', maxHeight: 320, objectFit: 'contain', background: '#f5f5f5' }}
                  />
                </div>
              ) : (
                <div style={{ background: '#f8faf9', border: '1px dashed #c0c8c5', borderRadius: 16, padding: '1.5rem', textAlign: 'center', marginBottom: '1rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 36, color: '#2e685d', marginBottom: '0.5rem' }}>verified</span>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#032f28' }}>Digital Verified Prescription Record</div>
                  <div style={{ fontSize: 11, color: '#717976', marginTop: '0.25rem' }}>
                    Screened via MediFind AI Optical Classifier &amp; Verified by System Pharmacist.
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button
                  onClick={() => setShowRxDocModal(false)}
                  style={{
                    background: '#032f28',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 99,
                    padding: '0.6rem 1.5rem',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Close Document Viewer
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ background: '#ecfdf7', minHeight: '100vh', paddingBottom: '4rem' }}>
      {/* Toast Feedback */}
      {feedback.show && (
        <div style={{
          position: 'fixed',
          top: '5.5rem',
          right: '1.5rem',
          zIndex: 9999,
          background: feedback.type === 'error' ? '#ffdad6' : feedback.type === 'warning' ? '#ffdad4' : '#e0f2eb',
          color: feedback.type === 'error' ? '#ba1a1a' : feedback.type === 'warning' ? '#5a0100' : '#032f28',
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
            {feedback.type === 'error' ? 'error' : feedback.type === 'warning' ? 'warning' : 'check_circle'}
          </span>
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Dynamic Status Bar */}
      <div style={{ background: '#e0f2eb', borderBottom: '1px solid #d5e6e0', padding: '0.65rem 1.5rem' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: 12, color: '#414846' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#032f28', fontWeight: 700 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2e685d' }}></span>
              Inventory Sync Active
            </span>
            <span>—</span>
            <span>Dispenser Node #{pharmacy?.id?.substring(0, 6) || '819'}</span>
            <span style={{ color: '#717976' }}>•</span>
            <span style={{ color: '#2e685d', fontWeight: 600 }}>Stock Registry Verified</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{
              background: pharmacy?.isTestRecord ? '#d5e6e0' : '#b0ecdd',
              color: pharmacy?.isTestRecord ? '#414846' : '#032f28',
              padding: '0.2rem 0.65rem',
              borderRadius: 99,
              fontSize: 11,
              fontWeight: 700
            }}>
              {pharmacy?.isTestRecord ? 'TEST DATA — NOT A PARTICIPATING PHARMACY' : 'Participating Pharmacy'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '2rem 1.5rem' }}>
        {/* Top Header & Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.5rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <span style={{
                  background: '#b0ecdd',
                  color: '#336c61',
                  borderRadius: 99,
                  padding: '0.2rem 0.65rem',
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase'
                }}>
                  {pharmacy?.name || 'Local Community Dispensary'}
                </span>
                {pharmacy?.licenseNumber && (
                  <span style={{ fontSize: 12, color: '#717976' }}>
                    License #{pharmacy.licenseNumber}
                  </span>
                )}
                {((pharmacy?.isVerified || pharmacy?.verificationStatus === 'VERIFIED') && !pharmacy?.isTestRecord) ? (
                  <span style={{ fontSize: 11, color: '#2e685d', fontWeight: 700, background: '#e0f2eb', padding: '0.1rem 0.5rem', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 12 }}>verified</span>
                    Participating Pharmacy
                  </span>
                ) : (
                  <span style={{ fontSize: 10, color: '#92400e', fontWeight: 600, background: '#fef3c7', padding: '0.1rem 0.5rem', borderRadius: 99, border: '1px solid #fde68a' }}>
                    TEST DATA — NOT A PARTICIPATING PHARMACY
                  </span>
                )}
              </div>
              <h1 style={{ fontSize: 32, fontWeight: 700, color: '#032f28', margin: 0, letterSpacing: '-0.02em' }}>
                {activeTab === 'overview' ? 'Prescription Reservation Queue' : 'Dispensary Inventory Management'}
              </h1>
              <p style={{ fontSize: 15, color: '#414846', margin: '0.35rem 0 0 0' }}>
                {activeTab === 'overview'
                  ? 'Real-time patient intake review, counter PIN verification, and fulfillment management.'
                  : 'Manage stock quantities, clinical pricing, and inventory synchronization with MediFind AI.'}
              </p>
            </div>

            {/* Top Switcher & Action Cluster */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              {/* Tab Switcher Pills */}
              <div style={{ background: '#ffffff', padding: '0.3rem', borderRadius: 99, display: 'flex', gap: '0.3rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
                <button
                  onClick={() => setActiveTab('overview')}
                  style={{
                    background: activeTab === 'overview' ? '#032f28' : 'transparent',
                    color: activeTab === 'overview' ? '#ffffff' : '#414846',
                    border: 'none',
                    borderRadius: 99,
                    padding: '0.45rem 1rem',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>assignment</span>
                  <span>Reservations ({orders.length})</span>
                </button>
                <button
                  onClick={() => setActiveTab('inventory')}
                  style={{
                    background: activeTab === 'inventory' ? '#032f28' : 'transparent',
                    color: activeTab === 'inventory' ? '#ffffff' : '#414846',
                    border: 'none',
                    borderRadius: 99,
                    padding: '0.45rem 1rem',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>inventory_2</span>
                  <span>Inventory ({activeCatalogueCount})</span>
                </button>
              </div>

              {activeTab === 'inventory' ? (
                <button
                  onClick={handleOpenAddModal}
                  style={{
                    background: '#032f28',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 99,
                    padding: '0.65rem 1.25rem',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    boxShadow: '0 2px 6px rgba(3,47,40,0.2)'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add_circle</span>
                  <span>+ Add Medicine</span>
                </button>
              ) : (
                <button
                  onClick={fetchPharmacyAndOrders}
                  disabled={loading}
                  style={{
                    background: '#ffffff',
                    color: '#032f28',
                    border: '1px solid #c0c8c5',
                    borderRadius: 99,
                    padding: '0.65rem 1.15rem',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.7 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18, animation: loading ? 'spin 1s linear infinite' : 'none' }}>sync</span>
                  <span>{loading ? 'Refreshing...' : 'Refresh Queue'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Metric Bento Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginTop: '0.5rem' }}>
            {/* Card 1: Pending */}
            <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.25rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#717976', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Pending Review
                  </span>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#032f28', marginTop: '0.25rem' }}>
                    {pendingCount}
                  </div>
                </div>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#ffdad4', color: '#5a0100', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>assignment_late</span>
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#717976', marginTop: '0.75rem' }}>
                {pendingCount > 0 ? 'Requires clinical review' : 'No pending orders'}
              </div>
              <div style={{ position: 'absolute', bottom: 0, left: 0, height: 4, width: '60%', background: '#7e1208', borderRadius: 99 }}></div>
            </div>

            {/* Card 2: Confirmed Orders */}
            <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.25rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#717976', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Active Dispense
                  </span>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#032f28', marginTop: '0.25rem' }}>
                    {confirmedCount}
                  </div>
                </div>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#e0f2eb', color: '#2e685d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>inventory_2</span>
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#717976', marginTop: '0.75rem' }}>
                Preparing for customer handoff
              </div>
              <div style={{ position: 'absolute', bottom: 0, left: 0, height: 4, width: '80%', background: '#2e685d', borderRadius: 99 }}></div>
            </div>

            {/* Card 3: Ready for Pickup */}
            <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.25rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#717976', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Ready for Pickup
                  </span>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#032f28', marginTop: '0.25rem' }}>
                    {readyCount}
                  </div>
                </div>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#b0ecdd', color: '#336c61', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>verified</span>
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#717976', marginTop: '0.75rem' }}>
                Awaiting counter verification PIN
              </div>
              <div style={{ position: 'absolute', bottom: 0, left: 0, height: 4, width: '100%', background: '#b0ecdd', borderRadius: 99 }}></div>
            </div>

            {/* Card 4: Low Stock Alerts */}
            <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.25rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#717976', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Low-Stock Items
                  </span>
                  <div style={{ fontSize: 28, fontWeight: 700, color: lowStockCount > 0 ? '#ba1a1a' : '#032f28', marginTop: '0.25rem' }}>
                    {lowStockCount}
                  </div>
                </div>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#ffdad6', color: '#ba1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>warning</span>
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#717976', marginTop: '0.75rem' }}>
                Units below buffer threshold (≤5)
              </div>
              <div style={{ position: 'absolute', bottom: 0, left: 0, height: 4, width: '40%', background: '#ba1a1a', borderRadius: 99 }}></div>
            </div>
          </div>
        </div>

        {/* VIEW 1: RESERVATIONS QUEUE */}
        {activeTab === 'overview' && (
          <div>
            {/* Search & Status Filters */}
            <div style={{
              background: '#ffffff',
              borderRadius: 20,
              padding: '0.85rem 1.25rem',
              boxShadow: '0 1px 4px rgba(3,47,40,0.04)',
              border: '1px solid #e0f2eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '1rem',
              marginBottom: '1.5rem'
            }}>
              {/* Search Bar */}
              <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
                <span className="material-symbols-outlined" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#717976', fontSize: 18 }}>
                  search
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search order ref (#MF-...), customer name, or medicine..."
                  style={{
                    width: '100%',
                    padding: '0.65rem 1rem 0.65rem 2.65rem',
                    borderRadius: 99,
                    background: '#e6f8f1',
                    border: 'none',
                    fontSize: 13,
                    color: '#032f28',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Status Filter Tabs */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', overflowX: 'auto' }}>
                {[
                  { id: 'ALL', label: 'All' },
                  { id: 'PENDING', label: 'Pending' },
                  { id: 'CONFIRMED', label: 'Confirmed' },
                  { id: 'READY_FOR_PICKUP', label: 'Ready for Pickup' },
                  { id: 'COMPLETED', label: 'Completed' },
                  { id: 'REJECTED', label: 'Rejected' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setOrderFilterTab(tab.id)}
                    style={{
                      background: orderFilterTab === tab.id ? '#032f28' : '#e6f8f1',
                      color: orderFilterTab === tab.id ? '#ffffff' : '#414846',
                      border: 'none',
                      borderRadius: 99,
                      padding: '0.35rem 0.85rem',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Orders List */}
            {loading ? (
              <LoadingSkeleton variant="order-card" count={3} />
            ) : filteredOrders.length === 0 ? (
              <EmptyState
                icon="assignment_turned_in"
                title="No Reservations Found"
                description={searchQuery ? 'No orders match your search criteria.' : 'There are currently no prescription reservations in this filter.'}
                actionLabel={searchQuery ? 'Clear Search' : null}
                onAction={() => setSearchQuery('')}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {filteredOrders.map(order => {
                  const isPending = order.status === 'PENDING';
                  const isConfirmed = order.status === 'CONFIRMED';
                  const isReady = order.status === 'READY_FOR_PICKUP';
                  const isCompleted = order.status === 'COMPLETED';
                  const isRejected = order.status === 'REJECTED';

                  const stripeColor = isPending
                    ? '#7e1208'
                    : isConfirmed
                    ? '#2e685d'
                    : isReady
                    ? '#336c61'
                    : isCompleted
                    ? '#032f28'
                    : '#ba1a1a';

                  return (
                    <div
                      key={order.id}
                      style={{
                        background: '#ffffff',
                        borderRadius: 20,
                        border: '1px solid #e0f2eb',
                        boxShadow: '0 1px 4px rgba(3,47,40,0.04)',
                        padding: '1.5rem',
                        position: 'relative',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '1rem'
                      }}
                    >
                      {/* Left Status Bar */}
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, background: stripeColor }}></div>

                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', paddingLeft: '0.5rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                            <span style={{ fontSize: 16, fontWeight: 700, color: '#032f28' }}>
                              #{order.id.slice(0, 10).toUpperCase()}
                            </span>
                            <span style={{
                              background: isPending ? '#ffdad4' : isReady ? '#b0ecdd' : '#e0f2eb',
                              color: isPending ? '#5a0100' : isReady ? '#336c61' : '#2e685d',
                              borderRadius: 99,
                              padding: '0.2rem 0.65rem',
                              fontSize: 11,
                              fontWeight: 700
                            }}>
                              {order.status.replace(/_/g, ' ')}
                            </span>
                            <span style={{ background: '#d5e6e0', color: '#414846', borderRadius: 99, padding: '0.2rem 0.65rem', fontSize: 11, fontWeight: 600 }}>
                              {order.paymentMethod ? `${order.paymentMethod} • ${order.paymentStatus || 'PAID'}` : 'RESERVATION HOLD'}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 13, color: '#414846', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, color: '#0f1e1b' }}>
                              Patient: {order.user?.name || 'Verified Patient'}
                            </span>
                            <span>•</span>
                            <span>{new Date(order.createdAt).toLocaleString()}</span>
                            <span>•</span>
                            <span style={{ color: '#2e685d', fontWeight: 600 }}>
                              Total: ₹{(order.totalAmount || 0).toFixed(2)}
                            </span>
                          </div>
                        </div>

                        {/* Fulfillment Info */}
                        <div style={{
                          background: '#e6f8f1',
                          padding: '0.5rem 0.85rem',
                          borderRadius: 14,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          fontSize: 12,
                          color: '#032f28',
                          fontWeight: 600
                        }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>
                            {order.fulfillmentType === 'DELIVERY' ? 'electric_moped' : 'store'}
                          </span>
                          <span>
                            {order.fulfillmentType === 'DELIVERY' ? 'Assistant Delivery' : 'Pharmacy Counter Pickup'}
                          </span>
                        </div>
                      </div>

                      {/* Items Ordered */}
                      <div style={{ background: '#e6f8f1', padding: '0.85rem 1rem', borderRadius: 14, paddingLeft: '1.25rem' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#2e685d', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Prescription Items ({order.items?.length || 0}):
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                          {(order.items || []).map((it, idx) => (
                            <div
                              key={idx}
                              style={{
                                background: '#ffffff',
                                border: '1px solid #c0c8c5',
                                borderRadius: 99,
                                padding: '0.35rem 0.75rem',
                                fontSize: 12,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                              }}
                            >
                              <span style={{ fontWeight: 600, color: '#032f28' }}>
                                {it.medicine?.brandName || it.brandName || it.medicine?.name || it.name || 'Prescription Medicine'}
                              </span>
                              <span style={{ color: '#717976' }}>× {it.quantity}</span>
                              <span style={{ color: '#2e685d', fontWeight: 600 }}>₹{it.price || 0}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Action Controls */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingTop: '0.5rem',
                        borderTop: '1px solid #e0f2eb',
                        flexWrap: 'wrap',
                        gap: '0.75rem',
                        paddingLeft: '0.5rem'
                      }}>
                        <div style={{ fontSize: 12, color: '#717976' }}>
                          Ref ID: <span style={{ fontFamily: 'monospace' }}>{order.id}</span>
                        </div>

                        {/* Interactive Buttons by state */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {isPending && (
                            <>
                              <button
                                onClick={() => {
                                  setConfirmDialog({
                                    isOpen: true,
                                    title: 'Reject Reservation?',
                                    message: 'Are you sure you want to reject this reservation? The patient will be notified.',
                                    confirmLabel: 'Reject Order',
                                    variant: 'danger',
                                    onConfirm: () => handleUpdateStatus(order.id, 'REJECTED')
                                  });
                                }}
                                style={{
                                  background: '#ffdad6',
                                  color: '#ba1a1a',
                                  border: 'none',
                                  borderRadius: 99,
                                  padding: '0.45rem 1rem',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                              >
                                Reject
                              </button>
                              <button
                                onClick={() => {
                                  setConfirmDialog({
                                    isOpen: true,
                                    title: 'Accept & Stage Reservation?',
                                    message: `Confirm acceptance of prescription reservation #${order.id.slice(0, 8)}? Inventory stock will be earmarked for staging.`,
                                    confirmLabel: 'Accept & Stage',
                                    variant: 'primary',
                                    impactPoints: [
                                      'Prescription items will be earmarked in dispensary stock.',
                                      'Patient will receive notification to proceed with pickup schedule.'
                                    ],
                                    onConfirm: () => handleUpdateStatus(order.id, 'CONFIRMED')
                                  });
                                }}
                                style={{
                                  background: '#032f28',
                                  color: '#ffffff',
                                  border: 'none',
                                  borderRadius: 99,
                                  padding: '0.45rem 1.15rem',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.35rem'
                                }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>
                                <span>Accept &amp; Stage</span>
                              </button>
                            </>
                          )}

                          {isConfirmed && (
                            <button
                              onClick={() => {
                                setConfirmDialog({
                                  isOpen: true,
                                  title: 'Mark Order Ready for Pickup?',
                                  message: `Confirm that all medicines for reservation #${order.id.slice(0, 8)} are sealed and placed in the pickup bay?`,
                                  confirmLabel: 'Mark Ready',
                                  variant: 'primary',
                                  impactPoints: [
                                    'Patient 4-digit verification PIN will be activated.',
                                    'Status updates to Ready for Pickup across patient and admin portals.'
                                  ],
                                  onConfirm: () => handleUpdateStatus(order.id, 'READY_FOR_PICKUP')
                                });
                              }}
                              style={{
                                background: '#2e685d',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: 99,
                                padding: '0.45rem 1.15rem',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.35rem'
                              }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>verified</span>
                              <span>Mark Ready for Pickup</span>
                            </button>
                          )}

                          {isReady && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <input
                                type="text"
                                maxLength={6}
                                value={pinInputMap[order.id] || ''}
                                onChange={e => setPinInputMap(prev => ({ ...prev, [order.id]: e.target.value }))}
                                placeholder="Enter 4-digit PIN"
                                style={{
                                  width: 130,
                                  padding: '0.45rem 0.75rem',
                                  borderRadius: 99,
                                  border: '1px solid #c0c8c5',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  textAlign: 'center',
                                  letterSpacing: '0.1em'
                                }}
                              />
                              <button
                                onClick={() => {
                                  const pin = pinInputMap[order.id];
                                  if (!pin || pin.length < 4) {
                                    showToast('Please enter the customer 4-digit verification PIN', 'warning');
                                    return;
                                  }
                                  setConfirmDialog({
                                    isOpen: true,
                                    title: 'Complete Dispensation?',
                                    message: `Verify customer PIN "${pin}" and mark prescription #${order.id.slice(0, 8)} as dispensed and completed?`,
                                    confirmLabel: 'Verify & Dispense',
                                    variant: 'primary',
                                    impactPoints: [
                                      'Medicine physical handover will be registered in ledger.',
                                      'Order status will permanently transition to COMPLETED.'
                                    ],
                                    onConfirm: () => handleVerifyPin(order.id)
                                  });
                                }}
                                style={{
                                  background: '#032f28',
                                  color: '#ffffff',
                                  border: 'none',
                                  borderRadius: 99,
                                  padding: '0.45rem 1rem',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                              >
                                Verify PIN &amp; Dispense
                              </button>
                            </div>
                          )}

                          {(isReady || isConfirmed) && (
                            <button
                              onClick={() => {
                                setCounterPinOrder(order);
                                setCounterPinDigits(['', '', '', '']);
                              }}
                              style={{
                                background: '#e0f2eb',
                                color: '#032f28',
                                border: '1px solid #2e685d',
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
                              <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>dialpad</span>
                              <span>Counter PIN Terminal</span>
                            </button>
                          )}

                          {isCompleted && (
                            <span style={{ color: '#2e685d', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>
                              Dispensation Completed
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: DISPENSARY INVENTORY MANAGEMENT */}
        {activeTab === 'inventory' && (
          <div>
            {/* Filter Toolbar */}
            <div style={{
              background: '#ffffff',
              borderRadius: 20,
              padding: '0.85rem 1.25rem',
              boxShadow: '0 1px 4px rgba(3,47,40,0.04)',
              border: '1px solid #e0f2eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '1rem',
              marginBottom: '1.5rem'
            }}>
              {/* Search Bar */}
              <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
                <span className="material-symbols-outlined" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#717976', fontSize: 18 }}>
                  search
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search inventory by medicine name or generic..."
                  style={{
                    width: '100%',
                    padding: '0.65rem 1rem 0.65rem 2.65rem',
                    borderRadius: 99,
                    background: '#e6f8f1',
                    border: 'none',
                    fontSize: 13,
                    color: '#032f28',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Status Filter Pills */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', overflowX: 'auto' }}>
                {[
                  { id: 'ALL', label: `All (${inventory.length})` },
                  { id: 'AVAILABLE', label: 'Available' },
                  { id: 'LOW_STOCK', label: `Low Stock (${lowStockCount})` },
                  { id: 'OUT_OF_STOCK', label: 'Out of Stock' }
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => setInventoryFilterTab(p.id)}
                    style={{
                      background: inventoryFilterTab === p.id ? '#032f28' : '#e6f8f1',
                      color: inventoryFilterTab === p.id ? '#ffffff' : '#414846',
                      border: 'none',
                      borderRadius: 99,
                      padding: '0.35rem 0.85rem',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Inventory Table Container */}
            <div style={{
              background: '#ffffff',
              borderRadius: 20,
              boxShadow: '0 1px 4px rgba(3,47,40,0.04)',
              border: '1px solid #e0f2eb',
              overflow: 'hidden'
            }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#e0f2eb', color: '#414846', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <th style={{ padding: '0.85rem 1.25rem' }}>Medicine Details</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Category</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Current Stock</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Unit Price (₹)</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Stock Status</th>
                      <th style={{ padding: '0.85rem 1.25rem', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '3rem 1rem', color: '#2e685d' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                            <span className="material-symbols-outlined" style={{ animation: 'spin 1s linear infinite' }}>sync</span>
                            <span>Loading dispensary inventory...</span>
                          </div>
                        </td>
                      </tr>
                    ) : filteredInventory.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '3rem 1rem', color: '#717976' }}>
                          No medicines found in this filter. Click "+ Add Medicine" to stock new items.
                        </td>
                      </tr>
                    ) : (
                      filteredInventory.map(item => {
                        const med = item.medicine || {};
                        const edit = stockEditMap[item.id] || { stock: item.stock || 0, price: item.price || 0 };
                        const stockVal = item.stock != null ? item.stock : 0;
                        const isSaving = updatingItemId === item.id;

                        const isLow = stockVal > 0 && stockVal <= 5;
                        const isOut = stockVal <= 0;

                        return (
                          <tr key={item.id} style={{ borderBottom: '1px solid #e0f2eb' }}>
                            {/* Medicine Details */}
                            <td style={{ padding: '1rem 1.25rem' }}>
                              <div style={{ fontWeight: 700, color: '#032f28', fontSize: 14 }}>
                                {item.brandName || med.brandName || item.name || med.name || 'Prescription Medicine'}
                                {(item.strength || med.strength) ? ` (${item.strength || med.strength})` : ''}
                              </div>
                              <div style={{ fontSize: 12, color: '#717976', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                                <span>{item.genericName || med.genericName || 'Generic formulation'}</span>
                                {(item.dosageForm || med.dosageForm) && <span>• {item.dosageForm || med.dosageForm}</span>}
                              </div>
                            </td>

                            {/* Category */}
                            <td style={{ padding: '1rem' }}>
                              <span style={{
                                background: '#e6f8f1',
                                color: '#2e685d',
                                padding: '0.2rem 0.55rem',
                                borderRadius: 99,
                                fontSize: 11,
                                fontWeight: 600
                              }}>
                                {item.category || med.category || 'General'}
                              </span>
                            </td>

                            {/* Current Stock (Editable) */}
                            <td style={{ padding: '1rem' }}>
                              <input
                                type="number"
                                min={0}
                                value={edit.stock}
                                onChange={e => {
                                  const val = e.target.value;
                                  setStockEditMap(prev => ({
                                    ...prev,
                                    [item.id]: { ...prev[item.id], stock: val }
                                  }));
                                }}
                                style={{
                                  width: 80,
                                  padding: '0.35rem 0.5rem',
                                  borderRadius: 8,
                                  border: '1px solid #c0c8c5',
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: '#032f28'
                                }}
                              />
                            </td>

                            {/* Unit Price (Editable) */}
                            <td style={{ padding: '1rem' }}>
                              <input
                                type="number"
                                step="0.5"
                                min={0}
                                value={edit.price}
                                onChange={e => {
                                  const val = e.target.value;
                                  setStockEditMap(prev => ({
                                    ...prev,
                                    [item.id]: { ...prev[item.id], price: val }
                                  }));
                                }}
                                style={{
                                  width: 90,
                                  padding: '0.35rem 0.5rem',
                                  borderRadius: 8,
                                  border: '1px solid #c0c8c5',
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: '#032f28'
                                }}
                              />
                            </td>

                            {/* Stock Status Badge */}
                            <td style={{ padding: '1rem' }}>
                              <span style={{
                                background: isOut ? '#ffdad6' : isLow ? '#ffdad4' : '#e0f2eb',
                                color: isOut ? '#ba1a1a' : isLow ? '#7e1208' : '#2e685d',
                                padding: '0.2rem 0.65rem',
                                borderRadius: 99,
                                fontSize: 11,
                                fontWeight: 700
                              }}>
                                {isOut ? 'Out of Stock' : isLow ? 'Low Stock' : 'Available'}
                              </span>
                            </td>

                            {/* Action Button */}
                            <td style={{ padding: '1rem 1.25rem', textAlign: 'right' }}>
                              <button
                                onClick={() => handleSaveStock(item.id, item.medicineId)}
                                disabled={isSaving}
                                style={{
                                  background: '#032f28',
                                  color: '#ffffff',
                                  border: 'none',
                                  borderRadius: 99,
                                  padding: '0.4rem 0.85rem',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                              >
                                {isSaving ? 'Saving...' : 'Update'}
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Medicine Modal */}
      {showAddModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(3,47,40,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: '#ffffff', borderRadius: 24, width: '100%', maxWidth: 480, padding: '2rem', boxShadow: '0 24px 64px rgba(3,47,40,0.25)', border: '1px solid #e0f2eb' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#032f28', margin: 0 }}>
                Add Medicine to Inventory
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                style={{ background: '#e6f8f1', border: 'none', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#414846' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>

            {addError && (
              <div style={{ background: '#ffdad6', color: '#ba1a1a', padding: '0.65rem 1rem', borderRadius: 12, fontSize: 12, fontWeight: 600, marginBottom: '1rem' }}>
                {addError}
              </div>
            )}

            <form onSubmit={handleAddMedicineSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#414846', marginBottom: '0.35rem' }}>
                  Select Medicine from Catalogue
                </label>
                <select
                  value={selectedMedicineId}
                  onChange={e => setSelectedMedicineId(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: 12, border: '1px solid #c0c8c5', background: '#e6f8f1', fontSize: 13, color: '#032f28' }}
                >
                  {availableMedicines.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.brandName} ({m.genericName || m.category})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#414846', marginBottom: '0.35rem' }}>
                    Initial Stock
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={newStock}
                    onChange={e => setNewStock(e.target.value)}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: 12, border: '1px solid #c0c8c5', fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#414846', marginBottom: '0.35rem' }}>
                    Unit Price (₹)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    value={newPrice}
                    onChange={e => setNewPrice(e.target.value)}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: 12, border: '1px solid #c0c8c5', fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={{ background: '#e6f8f1', color: '#414846', border: 'none', borderRadius: 99, padding: '0.55rem 1.25rem', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  style={{ background: '#032f28', color: '#ffffff', border: 'none', borderRadius: 99, padding: '0.55rem 1.5rem', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  {addLoading ? 'Adding...' : 'Add to Inventory'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        impactPoints={confirmDialog.impactPoints || []}
        confirmLabel={confirmDialog.confirmLabel}
        variant={confirmDialog.variant}
        onConfirm={() => {
          confirmDialog.onConfirm();
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
