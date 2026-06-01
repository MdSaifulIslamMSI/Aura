# Complete Legacy ICU Migration Inventory

Generated: 2026-06-01T12:30:54.376Z

Complete pre-migration inventory for legacy market-pack t() usage. Stable UI literals are ICU migration candidates. Dynamic lookups, runtime content, pack internals, and test harness calls remain explicit review buckets.

## Summary

- Source files scanned: 333
- Tracked files: 85
- Production files with stable literal UI copy: 54
- Production stable literal references: 2936
- Unique production stable IDs: 2647
- Dynamic lookup references requiring manual review: 32
- Runtime-content translation files: 18
- Legacy pack internal files: 21
- Test-harness literal references: 4
- Stable references with no English pack or call-site fallback: 0
- Parse errors: 0

## Migration Buckets

### Stable UI literals

These production references are eligible for reviewed ICU catalog migration.

| Risk | File | Stable refs | IDs | Dynamic refs | Signals |
| --- | --- | ---: | ---: | ---: | --- |
| high | `app/src/pages/Login/useLoginController.js` | 138 | 130 | 0 | stable-ui |
| high | `app/src/pages/Checkout/components/StepPayment.jsx` | 133 | 119 | 5 | stable-ui |
| high | `app/src/pages/Orders/index.jsx` | 105 | 102 | 1 | stable-ui |
| high | `app/src/pages/Checkout/index.jsx` | 103 | 92 | 0 | stable-ui |
| high | `app/src/pages/Profile/components/SettingsSection.jsx` | 65 | 64 | 0 | stable-ui |
| high | `app/src/pages/Login/LoginView.jsx` | 68 | 62 | 0 | stable-ui |
| high | `app/src/pages/Cart/index.jsx` | 43 | 42 | 1 | stable-ui |
| high | `app/src/pages/Checkout/components/OrderSummary.jsx` | 39 | 39 | 0 | stable-ui |
| high | `app/src/pages/MyListings/index.jsx` | 27 | 25 | 1 | stable-ui |
| high | `app/src/pages/SellerProfile/index.jsx` | 22 | 21 | 0 | stable-ui |
| high | `app/src/pages/Checkout/components/StepAddress.jsx` | 19 | 18 | 2 | stable-ui |
| high | `app/src/pages/Checkout/components/StepReview.jsx` | 14 | 14 | 0 | stable-ui |
| high | `app/src/components/shared/ProtectedRoute.jsx` | 10 | 10 | 0 | stable-ui |
| high | `app/src/pages/Checkout/components/StepDelivery.jsx` | 6 | 6 | 0 | stable-ui |
| high | `app/src/pages/Login/loginFlowHelpers.js` | 1 | 1 | 0 | stable-ui |
| medium | `app/src/pages/Admin/Dashboard.jsx` | 145 | 131 | 0 | runtime-content-nearby |
| medium | `app/src/pages/Profile/components/SupportSection.jsx` | 140 | 125 | 1 | runtime-content-nearby |
| medium | `app/src/pages/ListingDetail/index.jsx` | 119 | 112 | 0 | runtime-content-nearby |
| medium | `app/src/pages/Admin/Support.jsx` | 124 | 102 | 0 | runtime-content-nearby |
| medium | `app/src/pages/ProductDetails/index.jsx` | 103 | 95 | 0 | runtime-content-nearby |
| medium | `app/src/pages/Marketplace/index.jsx` | 83 | 83 | 6 | runtime-content-nearby |
| medium | `app/src/pages/Home/index.jsx` | 86 | 81 | 1 | stable-ui |
| medium | `app/src/components/shared/GlobalSearchBar.jsx` | 55 | 53 | 0 | runtime-content-nearby |
| medium | `app/src/components/layout/Navbar/index.jsx` | 72 | 46 | 0 | stable-ui |
| medium | `app/src/pages/ProductListing/index.jsx` | 45 | 43 | 1 | stable-ui |
| medium | `app/src/components/features/product/Filters/index.jsx` | 33 | 29 | 1 | stable-ui |
| medium | `app/src/components/features/product/ProductCard/index.jsx` | 27 | 19 | 0 | runtime-content-nearby |
| medium | `app/src/components/shared/VoiceSearch.jsx` | 15 | 14 | 0 | stable-ui |
| medium | `app/src/components/features/chat/MessageItem.jsx` | 5 | 5 | 0 | stable-ui |
| medium | `app/src/components/features/chat/ProductCardInline.jsx` | 2 | 2 | 0 | runtime-content-nearby |
| medium | `app/src/context/NotificationContext.jsx` | 1 | 1 | 0 | runtime-content-nearby |
| low | `app/src/pages/Sell/index.jsx` | 140 | 140 | 0 | stable-ui |
| low | `app/src/pages/Admin/Payments.jsx` | 101 | 98 | 0 | stable-ui |
| low | `app/src/pages/Admin/Users.jsx` | 111 | 95 | 1 | stable-ui |
| low | `app/src/pages/Admin/EmailOps.jsx` | 116 | 93 | 0 | stable-ui |
| low | `app/src/pages/Profile/index.jsx` | 86 | 86 | 0 | stable-ui |
| low | `app/src/pages/Admin/OrderList.jsx` | 72 | 64 | 0 | stable-ui |
| low | `app/src/pages/Admin/ProductEdit.jsx` | 62 | 59 | 0 | stable-ui |
| low | `app/src/pages/Admin/ProductList.jsx` | 57 | 54 | 0 | stable-ui |
| low | `app/src/pages/Profile/components/OverviewSection.jsx` | 50 | 50 | 0 | stable-ui |
| low | `app/src/pages/Admin/RefundLedger.jsx` | 46 | 46 | 0 | stable-ui |
| low | `app/src/pages/Profile/components/PersonalInfoSection.jsx` | 46 | 43 | 0 | stable-ui |
| low | `app/src/pages/Admin/ClientDiagnosticsPanel.jsx` | 36 | 36 | 1 | stable-ui |
| low | `app/src/pages/Profile/components/PaymentsSection.jsx` | 28 | 28 | 2 | stable-ui |
| low | `app/src/pages/Profile/components/RewardsSection.jsx` | 28 | 28 | 0 | stable-ui |
| low | `app/src/pages/BecomeSeller/index.jsx` | 21 | 21 | 0 | stable-ui |
| low | `app/src/pages/PriceAlerts/index.jsx` | 20 | 20 | 0 | stable-ui |
| low | `app/src/pages/Profile/components/AddressesSection.jsx` | 20 | 20 | 1 | stable-ui |
| low | `app/src/components/layout/Footer/index.jsx` | 16 | 15 | 0 | stable-ui |
| low | `app/src/pages/Profile/components/NotificationsSection.jsx` | 12 | 12 | 2 | stable-ui |
| low | `app/src/pages/Wishlist/index.jsx` | 8 | 8 | 1 | stable-ui |
| low | `app/src/pages/Profile/components/ListingsSection.jsx` | 6 | 6 | 0 | stable-ui |
| low | `app/src/components/shared/BackendStatusBanner.jsx` | 4 | 4 | 3 | stable-ui |
| low | `app/src/pages/Profile/components/ProfileShared.jsx` | 2 | 2 | 0 | stable-ui |

### Dynamic lookups

These computed keys stay outside automatic migration until manually reviewed.

| File | Line | Reason |
| --- | ---: | --- |
| `app/src/components/features/product/Filters/index.jsx` | 34 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/components/shared/BackendStatusBanner.jsx` | 285 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/components/shared/BackendStatusBanner.jsx` | 299 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/components/shared/BackendStatusBanner.jsx` | 312 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Admin/ClientDiagnosticsPanel.jsx` | 293 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Admin/Users.jsx` | 21 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Cart/index.jsx` | 49 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Checkout/components/StepAddress.jsx` | 73 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Checkout/components/StepAddress.jsx` | 148 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Checkout/components/StepPayment.jsx` | 393 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Checkout/components/StepPayment.jsx` | 439 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Checkout/components/StepPayment.jsx` | 443 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Checkout/components/StepPayment.jsx` | 576 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Checkout/components/StepPayment.jsx` | 577 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Home/index.jsx` | 227 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Marketplace/index.jsx` | 593 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Marketplace/index.jsx` | 598 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Marketplace/index.jsx` | 603 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Marketplace/index.jsx` | 607 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Marketplace/index.jsx` | 622 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Marketplace/index.jsx` | 626 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/MyListings/index.jsx` | 168 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Orders/index.jsx` | 57 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/ProductListing/index.jsx` | 63 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Profile/components/AddressesSection.jsx` | 13 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Profile/components/NotificationsSection.jsx` | 65 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Profile/components/NotificationsSection.jsx` | 66 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Profile/components/PaymentsSection.jsx` | 8 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Profile/components/PaymentsSection.jsx` | 50 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Profile/components/SupportSection.jsx` | 182 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Wishlist/index.jsx` | 11 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/utils/enumLocalization.js` | 40 | First t() argument is computed or interpolated and requires manual review. |

### Runtime content translation

These files intentionally translate user, seller, catalog, chat, support, or other runtime content through the dynamic translation path.

- `app/src/components/features/chat/ProductCardInline.jsx`
- `app/src/components/features/product/ProductCard/index.jsx`
- `app/src/components/shared/GlobalSearchBar.jsx`
- `app/src/components/shared/MarketAutoLocalizer.jsx`
- `app/src/components/shared/MarketAutoLocalizer.test.jsx`
- `app/src/context/MarketContext.jsx`
- `app/src/context/NotificationContext.jsx`
- `app/src/hooks/useDynamicTranslations.js`
- `app/src/hooks/useDynamicTranslations.test.js`
- `app/src/pages/Admin/Dashboard.jsx`
- `app/src/pages/Admin/Support.jsx`
- `app/src/pages/ListingDetail/index.jsx`
- `app/src/pages/Marketplace/index.jsx`
- `app/src/pages/MissionControl/index.jsx`
- `app/src/pages/ProductDetails/index.jsx`
- `app/src/pages/Profile/components/SupportSection.jsx`
- `app/src/pages/TradeIn/index.jsx`
- `app/src/services/runtimeTranslation.test.js`

### Legacy pack internals

These files remain compatibility inputs while stable UI call sites move to ICU catalogs.

- `app/src/config/marketConfig.js`
- `app/src/config/marketMessagePacks/ar.js`
- `app/src/config/marketMessagePacks/as.js`
- `app/src/config/marketMessagePacks/bn.js`
- `app/src/config/marketMessagePacks/de.js`
- `app/src/config/marketMessagePacks/en.js`
- `app/src/config/marketMessagePacks/es.js`
- `app/src/config/marketMessagePacks/fr.js`
- `app/src/config/marketMessagePacks/gu.js`
- `app/src/config/marketMessagePacks/hi.js`
- `app/src/config/marketMessagePacks/ja.js`
- `app/src/config/marketMessagePacks/kn.js`
- `app/src/config/marketMessagePacks/ml.js`
- `app/src/config/marketMessagePacks/mr.js`
- `app/src/config/marketMessagePacks/or.js`
- `app/src/config/marketMessagePacks/pa.js`
- `app/src/config/marketMessagePacks/pt.js`
- `app/src/config/marketMessagePacks/sa.js`
- `app/src/config/marketMessagePacks/te.js`
- `app/src/config/marketMessagePacks/ur.js`
- `app/src/config/marketMessagePacks/zh.js`

### Unresolved English defaults

Any entry here needs a manual English descriptor before migration can be considered complete.

