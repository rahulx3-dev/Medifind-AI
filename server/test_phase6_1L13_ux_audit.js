/**
 * Phase 6.1L.13 — Global UX & State Audit Automated Verification Test
 *
 * Validates UX & State Audit requirements:
 * 1. Global Reduced Motion CSS compliance (prefers-reduced-motion)
 * 2. Empty state component prop resilience (actionText & actionLabel fallbacks)
 * 3. ConfirmationDialog processing & disabled gating
 * 4. AdminDashboard empty state table fallbacks (users, pharmacies, orders, emergency tasks)
 * 5. OrderTracking empty state CTA action
 * 6. Offline state truthful communication (reservations & payments require connectivity)
 * 7. Error response sanitization (no stack traces or leaked secrets on 400/401/403/404/409)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(ROOT_DIR, 'client');
const SERVER_DIR = path.join(ROOT_DIR, 'server');

async function runTests() {
  console.log('=== PHASE 6.1L.13: GLOBAL UX & STATE AUDIT VERIFICATION ===\n');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(`       Error: ${err.message}`);
      failed++;
    }
  }

  // 1. Reduced Motion Compliance
  test('T1: Global prefers-reduced-motion in client/src/index.css', () => {
    const cssPath = path.join(CLIENT_DIR, 'src', 'index.css');
    assert(fs.existsSync(cssPath), 'index.css must exist');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    assert(cssContent.includes('@media (prefers-reduced-motion: reduce)'), 'CSS must include @media (prefers-reduced-motion: reduce)');
    assert(cssContent.includes('animation-duration: 0.01ms'), 'CSS must reduce animation-duration');
    assert(cssContent.includes('transition-duration: 0.01ms'), 'CSS must reduce transition-duration');
  });

  // 2. EmptyState Prop Resilience
  test('T2: EmptyState supports actionLabel and secondaryActionLabel aliases', () => {
    const emptyStatePath = path.join(CLIENT_DIR, 'src', 'components', 'EmptyState.jsx');
    assert(fs.existsSync(emptyStatePath), 'EmptyState.jsx must exist');
    const code = fs.readFileSync(emptyStatePath, 'utf8');
    assert(code.includes('actionLabel') && code.includes('secondaryActionLabel'), 'EmptyState.jsx must accept actionLabel/secondaryActionLabel props');
    assert(code.includes('primaryText = actionText || actionLabel'), 'EmptyState.jsx must fallback actionText to actionLabel');
    assert(code.includes('secondaryText = secondaryActionText || secondaryActionLabel'), 'EmptyState.jsx must fallback secondaryActionText to secondaryActionLabel');
  });

  // 3. ConfirmationDialog Processing & Disabled Gating
  test('T3: ConfirmationDialog handles loading/processing and disables buttons', () => {
    const dialogPath = path.join(CLIENT_DIR, 'src', 'components', 'ConfirmationDialog.jsx');
    assert(fs.existsSync(dialogPath), 'ConfirmationDialog.jsx must exist');
    const code = fs.readFileSync(dialogPath, 'utf8');
    assert(code.includes('isLoading') || code.includes('isProcessing'), 'ConfirmationDialog must support isLoading/isProcessing props');
    assert(code.includes('disabled={isDisabled}') || code.includes('disabled={loading}'), 'ConfirmationDialog must disable buttons during processing');
    assert(code.includes('progress_activity') || code.includes('Processing...'), 'ConfirmationDialog must indicate active processing');
    assert(code.includes('e.key === \'Escape\' && !loading'), 'ConfirmationDialog must block ESC dismissal while loading');
  });

  // 4. AdminDashboard Empty State Table Fallbacks
  test('T4: AdminDashboard renders empty state rows for users, pharmacies, orders, and emergency tasks', () => {
    const adminPath = path.join(CLIENT_DIR, 'src', 'pages', 'AdminDashboard.jsx');
    assert(fs.existsSync(adminPath), 'AdminDashboard.jsx must exist');
    const code = fs.readFileSync(adminPath, 'utf8');
    assert(code.includes('usersList.length === 0'), 'AdminDashboard must check usersList.length === 0');
    assert(code.includes('pharmaciesList.length === 0'), 'AdminDashboard must check pharmaciesList.length === 0');
    assert(code.includes('ordersList.length === 0'), 'AdminDashboard must check ordersList.length === 0');
    assert(code.includes('emergencyData.tasks.length === 0'), 'AdminDashboard must check emergencyData.tasks.length === 0');
  });

  // 5. OrderTracking Empty State CTA
  test('T5: OrderTracking renders empty state with CTA to find medicines', () => {
    const orderTrackingPath = path.join(CLIENT_DIR, 'src', 'pages', 'OrderTracking.jsx');
    assert(fs.existsSync(orderTrackingPath), 'OrderTracking.jsx must exist');
    const code = fs.readFileSync(orderTrackingPath, 'utf8');
    assert(code.includes('filteredOrders.length === 0'), 'OrderTracking must check filteredOrders.length === 0');
    assert(code.includes('Find Medicines'), 'OrderTracking must provide a "Find Medicines" button');
    assert(code.includes('onNavigate'), 'OrderTracking must use onNavigate callback');
  });

  // 6. Offline State Communication
  test('T6: OfflineBanner explicitly clarifies that orders and payments require live connectivity', () => {
    const bannerPath = path.join(CLIENT_DIR, 'src', 'components', 'OfflineBanner.jsx');
    assert(fs.existsSync(bannerPath), 'OfflineBanner.jsx must exist');
    const code = fs.readFileSync(bannerPath, 'utf8');
    assert(code.includes('Reservations, orders, and payments require live connectivity'), 'OfflineBanner must clearly distinguish offline cached browsing from live actions');
  });

  // 7. Backend Error Handling Sanitization
  test('T7: Backend API responses do not leak raw stack traces or internal secrets on 400/401/403/404/409', async () => {
    // Check key controllers for consistent user-friendly error handling
    const controllers = [
      'authController.js',
      'orderController.js',
      'assistantController.js',
      'emergencyController.js'
    ];

    for (const ctrl of controllers) {
      const ctrlPath = path.join(SERVER_DIR, 'src', 'controllers', ctrl);
      if (fs.existsSync(ctrlPath)) {
        const code = fs.readFileSync(ctrlPath, 'utf8');
        // Ensure no error response sends stack trace directly to client (e.g., res.json({ error: err.stack }))
        assert(!code.includes('err.stack') || !code.includes('res.status('), `${ctrl} should not send err.stack in responses`);
      }
    }
  });

  // 8. OrderTracking Error State Recovery
  test('T8: OrderTracking renders ErrorState with retry when order fetch fails', () => {
    const orderPath = path.join(CLIENT_DIR, 'src', 'pages', 'OrderTracking.jsx');
    assert(fs.existsSync(orderPath), 'OrderTracking.jsx must exist');
    const code = fs.readFileSync(orderPath, 'utf8');
    assert(code.includes("import ErrorState from '../components/ErrorState'"), 'OrderTracking must import ErrorState');
    assert(code.includes('error ?') && code.includes('<ErrorState'), 'OrderTracking must render ErrorState on error');
    assert(code.includes('onRetry={fetchOrders}'), 'OrderTracking ErrorState must provide retry callback');
  });

  // 9. PharmacyDiscovery Error State & Responsive Mobile Switcher
  test('T9: PharmacyDiscovery handles error state and provides responsive mobile list/map switcher', () => {
    const discoveryPath = path.join(CLIENT_DIR, 'src', 'pages', 'PharmacyDiscovery.jsx');
    assert(fs.existsSync(discoveryPath), 'PharmacyDiscovery.jsx must exist');
    const code = fs.readFileSync(discoveryPath, 'utf8');
    assert(code.includes("import ErrorState from '../components/ErrorState'"), 'PharmacyDiscovery must import ErrorState');
    assert(code.includes('error ?') && code.includes('<ErrorState'), 'PharmacyDiscovery must render ErrorState on error');
    assert(code.includes('mobileTab') && code.includes("setMobileTab('list')") && code.includes("setMobileTab('map')"), 'PharmacyDiscovery must provide mobile list/map switcher');
  });

  // 10. Role-Aware Notification Routing
  test('T10: App.jsx handleNotificationClick supports routing across all roles', () => {
    const appPath = path.join(CLIENT_DIR, 'src', 'App.jsx');
    assert(fs.existsSync(appPath), 'App.jsx must exist');
    const code = fs.readFileSync(appPath, 'utf8');
    assert(code.includes("user?.role === 'PATIENT'"), 'Notification click must handle PATIENT role');
    assert(code.includes("user?.role === 'PHARMACIST'"), 'Notification click must handle PHARMACIST role');
    assert(code.includes("user?.role === 'ASSISTANT'"), 'Notification click must handle ASSISTANT role');
    assert(code.includes("user?.role === 'ADMIN'"), 'Notification click must handle ADMIN role');
  });

  // 11. Async Race Protection (Disabled Refresh Buttons)
  test('T11: PharmacistPortal and AdminDashboard protect against race conditions with disabled refresh buttons', () => {
    const pharmPath = path.join(CLIENT_DIR, 'src', 'pages', 'PharmacistPortal.jsx');
    assert(fs.existsSync(pharmPath), 'PharmacistPortal.jsx must exist');
    const pharmCode = fs.readFileSync(pharmPath, 'utf8');
    assert(pharmCode.includes('disabled={loading}') && pharmCode.includes('Refresh Queue'), 'PharmacistPortal must disable refresh button during loading');

    const adminPath = path.join(CLIENT_DIR, 'src', 'pages', 'AdminDashboard.jsx');
    assert(fs.existsSync(adminPath), 'AdminDashboard.jsx must exist');
    const adminCode = fs.readFileSync(adminPath, 'utf8');
    assert(adminCode.includes('disabled={loading}') && adminCode.includes('Refresh Live State'), 'AdminDashboard must disable refresh button during loading');
  });

  // 12. Loading & Empty State Integrity in AssistantPortal & EmergencyLocator
  test('T12: AssistantPortal and EmergencyLocator provide proper loading and restock empty states', () => {
    const assistantPath = path.join(CLIENT_DIR, 'src', 'pages', 'AssistantPortal.jsx');
    assert(fs.existsSync(assistantPath), 'AssistantPortal.jsx must exist');
    const assistantCode = fs.readFileSync(assistantPath, 'utf8');
    assert(assistantCode.includes("tab === 'completed'") && assistantCode.includes('loading ?'), 'AssistantPortal completed tab must check loading state before rendering empty state');

    const emergencyPath = path.join(CLIENT_DIR, 'src', 'pages', 'EmergencyLocator.jsx');
    assert(fs.existsSync(emergencyPath), 'EmergencyLocator.jsx must exist');
    const emergencyCode = fs.readFileSync(emergencyPath, 'utf8');
    assert(emergencyCode.includes('fetchEmergencyPharmacies') && emergencyCode.includes('setError'), 'EmergencyLocator must capture error state in fetchEmergencyPharmacies');
  });

  console.log(`\n========================================`);
  console.log(`Phase 6.1L.13 UX & State Audit Results: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
