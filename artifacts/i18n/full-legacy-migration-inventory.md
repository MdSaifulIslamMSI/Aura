# Complete Legacy ICU Migration Inventory

Generated: 2026-07-22T07:26:28.345Z

Complete pre-migration inventory for legacy market-pack t() usage. Stable UI literals are ICU migration candidates. Dynamic lookups, runtime content, pack internals, and test harness calls remain explicit review buckets.

## Summary

- Source files scanned: 366
- Tracked files: 115
- Production files with stable literal UI copy: 83
- Production stable literal references: 3780
- Unique production stable IDs: 3421
- Dynamic lookup references requiring manual review: 14
- Runtime enum compatibility references: 1
- Runtime-content translation files: 18
- Runtime enum compatibility files: 1
- Legacy pack internal files: 21
- Test-harness literal references: 4
- Stable references with no English pack or call-site fallback: 0
- Parse errors: 0

## Migration Buckets

### Stable UI literals

These production references are eligible for reviewed ICU catalog migration.

| Risk | File | Stable refs | IDs | Dynamic refs | Signals |
| --- | --- | ---: | ---: | ---: | --- |
| high | `app/src/pages/Login/useLoginController.js` | 168 | 157 | 1 | stable-ui |
| high | `app/src/pages/Profile/components/SupportSection.jsx` | 149 | 134 | 0 | runtime-content-nearby |
| high | `app/src/pages/Checkout/components/StepPayment.jsx` | 151 | 133 | 0 | stable-ui |
| high | `app/src/pages/Profile/components/SettingsSection.jsx` | 135 | 132 | 0 | stable-ui |
| high | `app/src/pages/ListingDetail/index.jsx` | 123 | 116 | 0 | runtime-content-nearby |
| high | `app/src/pages/Orders/index.jsx` | 105 | 102 | 0 | stable-ui |
| high | `app/src/pages/Checkout/index.jsx` | 103 | 92 | 0 | stable-ui |
| high | `app/src/pages/Login/LoginView.jsx` | 69 | 65 | 0 | stable-ui |
| high | `app/src/pages/DesktopLogin/index.jsx` | 66 | 62 | 0 | stable-ui |
| high | `app/src/pages/ProductListing/index.jsx` | 53 | 51 | 1 | stable-ui |
| high | `app/src/pages/Cart/index.jsx` | 45 | 44 | 0 | stable-ui |
| high | `app/src/pages/Checkout/components/OrderSummary.jsx` | 43 | 43 | 0 | stable-ui |
| high | `app/src/pages/MissionControl/index.jsx` | 43 | 43 | 1 | runtime-content-nearby |
| high | `app/src/pages/VisualSearch/index.jsx` | 33 | 33 | 0 | stable-ui |
| high | `app/src/pages/Launch/index.jsx` | 31 | 31 | 0 | stable-ui |
| high | `app/src/components/features/chat/MultimodalDock.jsx` | 33 | 30 | 0 | stable-ui |
| high | `app/src/pages/Status/index.jsx` | 31 | 30 | 0 | stable-ui |
| high | `app/src/components/layout/Footer/index.jsx` | 30 | 29 | 0 | stable-ui |
| high | `app/src/pages/MyListings/index.jsx` | 30 | 28 | 0 | stable-ui |
| high | `app/src/pages/Checkout/components/StepAddress.jsx` | 23 | 22 | 0 | stable-ui |
| high | `app/src/pages/SellerProfile/index.jsx` | 22 | 21 | 0 | stable-ui |
| high | `app/src/components/features/auth/DesktopBrowserAuthShell.jsx` | 19 | 19 | 0 | stable-ui |
| high | `app/src/components/features/auth/AuraTrustedDeviceChallenge.jsx` | 17 | 17 | 0 | stable-ui |
| high | `app/src/components/shared/ProtectedRoute.jsx` | 17 | 17 | 0 | stable-ui |
| high | `app/src/pages/Bundles/index.jsx` | 17 | 17 | 0 | stable-ui |
| high | `app/src/pages/Contact/index.jsx` | 15 | 15 | 0 | stable-ui |
| high | `app/src/pages/Checkout/components/StepReview.jsx` | 14 | 14 | 0 | stable-ui |
| high | `app/src/pages/Login/BrandVisualPanel.jsx` | 12 | 12 | 0 | stable-ui |
| high | `app/src/pages/Login/CountryCodePicker.jsx` | 11 | 11 | 0 | stable-ui |
| high | `app/src/pages/Assistant/index.jsx` | 10 | 10 | 0 | stable-ui |
| high | `app/src/pages/Checkout/components/StepDelivery.jsx` | 10 | 10 | 0 | stable-ui |
| high | `app/src/pages/Status/Subscribe.jsx` | 8 | 8 | 0 | stable-ui |
| high | `app/src/pages/Status/IncidentDetail.jsx` | 7 | 7 | 0 | stable-ui |
| high | `app/src/pages/Profile/components/OrdersSection.jsx` | 6 | 6 | 0 | stable-ui |
| high | `app/src/App.jsx` | 4 | 4 | 0 | stable-ui |
| high | `app/src/pages/Status/History.jsx` | 4 | 4 | 0 | stable-ui |
| high | `app/src/pages/Login/loginFlowHelpers.js` | 1 | 1 | 0 | stable-ui |
| medium | `app/src/pages/Admin/Dashboard.jsx` | 146 | 132 | 0 | runtime-content-nearby |
| medium | `app/src/pages/Marketplace/index.jsx` | 127 | 126 | 0 | runtime-content-nearby |
| medium | `app/src/pages/Admin/Support.jsx` | 128 | 106 | 0 | runtime-content-nearby |
| medium | `app/src/pages/ProductDetails/index.jsx` | 108 | 98 | 0 | runtime-content-nearby |
| medium | `app/src/pages/Home/index.jsx` | 94 | 81 | 0 | stable-ui |
| medium | `app/src/components/shared/GlobalSearchBar.jsx` | 55 | 53 | 0 | runtime-content-nearby |
| medium | `app/src/components/layout/Navbar/index.jsx` | 75 | 49 | 1 | stable-ui |
| medium | `app/src/pages/AICompare/index.jsx` | 45 | 45 | 2 | stable-ui |
| medium | `app/src/components/features/product/Filters/index.jsx` | 38 | 34 | 0 | stable-ui |
| medium | `app/src/components/features/chat/MessageItem.jsx` | 29 | 29 | 5 | stable-ui |
| medium | `app/src/components/shared/VoiceSearch.jsx` | 21 | 20 | 0 | stable-ui |
| medium | `app/src/components/features/product/ProductCard/index.jsx` | 27 | 19 | 0 | runtime-content-nearby |
| medium | `app/src/components/features/chat/ProductCardInline.jsx` | 14 | 13 | 0 | runtime-content-nearby |
| medium | `app/src/pages/TradeIn/index.jsx` | 12 | 11 | 0 | runtime-content-nearby |
| medium | `app/src/context/NotificationContext.jsx` | 1 | 1 | 0 | runtime-content-nearby |
| low | `app/src/pages/Sell/index.jsx` | 140 | 140 | 0 | stable-ui |
| low | `app/src/pages/Profile/index.jsx` | 105 | 102 | 0 | stable-ui |
| low | `app/src/pages/Admin/Payments.jsx` | 102 | 99 | 0 | stable-ui |
| low | `app/src/pages/Admin/Users.jsx` | 116 | 96 | 0 | stable-ui |
| low | `app/src/pages/Admin/EmailOps.jsx` | 116 | 93 | 0 | stable-ui |
| low | `app/src/pages/Admin/OrderList.jsx` | 72 | 64 | 0 | stable-ui |
| low | `app/src/pages/Admin/ProductEdit.jsx` | 62 | 59 | 0 | stable-ui |
| low | `app/src/pages/Admin/ProductList.jsx` | 58 | 55 | 0 | stable-ui |
| low | `app/src/pages/Profile/components/OverviewSection.jsx` | 50 | 50 | 0 | stable-ui |
| low | `app/src/pages/Admin/RefundLedger.jsx` | 46 | 46 | 0 | stable-ui |
| low | `app/src/pages/Profile/components/PersonalInfoSection.jsx` | 46 | 43 | 0 | stable-ui |
| low | `app/src/pages/Profile/components/PaymentsSection.jsx` | 39 | 39 | 0 | stable-ui |
| low | `app/src/pages/Admin/ClientDiagnosticsPanel.jsx` | 42 | 38 | 0 | stable-ui |
| low | `app/src/pages/Profile/components/RewardsSection.jsx` | 28 | 28 | 0 | stable-ui |
| low | `app/src/pages/Profile/components/AddressesSection.jsx` | 23 | 23 | 0 | stable-ui |
| low | `app/src/pages/Profile/components/NotificationsSection.jsx` | 22 | 22 | 0 | stable-ui |
| low | `app/src/pages/BecomeSeller/index.jsx` | 21 | 21 | 0 | stable-ui |
| low | `app/src/pages/PriceAlerts/index.jsx` | 20 | 20 | 0 | stable-ui |
| low | `app/src/components/features/video/VideoCallOverlay.jsx` | 21 | 18 | 0 | stable-ui |
| low | `app/src/components/shared/BackendStatusBanner.jsx` | 13 | 13 | 0 | stable-ui |
| low | `app/src/pages/Wishlist/index.jsx` | 10 | 10 | 0 | stable-ui |
| low | `app/src/components/welcome/PremiumWelcomeCurtain.jsx` | 9 | 9 | 0 | stable-ui |
| low | `app/src/pages/Profile/components/AccountStatusBanner.jsx` | 9 | 8 | 0 | stable-ui |
| low | `app/src/components/shared/MobileUpdateBanner.jsx` | 8 | 7 | 0 | stable-ui |
| low | `app/src/pages/Profile/components/ListingsSection.jsx` | 6 | 6 | 0 | stable-ui |
| low | `app/src/components/layout/Navbar/NotificationDropdown.jsx` | 5 | 5 | 0 | stable-ui |
| low | `app/src/components/features/chat/ConfirmationCard.jsx` | 3 | 3 | 0 | stable-ui |
| low | `app/src/components/shared/AppErrorBoundary.jsx` | 3 | 3 | 0 | stable-ui |
| low | `app/src/main.jsx` | 3 | 3 | 0 | stable-ui |
| low | `app/src/components/shared/SectionErrorBoundary.jsx` | 2 | 2 | 0 | stable-ui |
| low | `app/src/pages/Profile/components/ProfileShared.jsx` | 2 | 2 | 0 | stable-ui |

### Dynamic lookups

These computed keys stay outside automatic migration until manually reviewed.

| File | Line | Reason |
| --- | ---: | --- |
| `app/src/components/features/chat/MessageItem.jsx` | 202 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/components/features/chat/MessageItem.jsx` | 308 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/components/features/chat/MessageItem.jsx` | 310 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/components/features/chat/MessageItem.jsx` | 311 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/components/features/chat/MessageItem.jsx` | 491 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/components/layout/Navbar/index.jsx` | 380 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/i18n/StableText.jsx` | 6 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/AICompare/index.jsx` | 89 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/AICompare/index.jsx` | 360 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/Login/useLoginController.js` | 519 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/pages/MissionControl/index.jsx` | 285 | StableText id is computed and requires manual review. |
| `app/src/pages/ProductListing/index.jsx` | 491 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/utils/authErrors.js` | 2147 | First t() argument is computed or interpolated and requires manual review. |
| `app/src/utils/supportArchitecture.js` | 148 | First t() argument is computed or interpolated and requires manual review. |

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

### Runtime enum compatibility

These files intentionally translate runtime enum values through reviewed prefixes while preserving humanized fallbacks for unknown backend values.

- `app/src/utils/enumLocalization.js`

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
