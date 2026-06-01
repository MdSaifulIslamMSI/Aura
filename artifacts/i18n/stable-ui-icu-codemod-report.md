# Stable UI ICU Codemod Report

Generated: 2026-06-01T14:50:32.611Z

Mode: dry-run

Safe stable-UI ICU codemod. Literal calls are routed through useStableIcuMessages(); computed keys remain delegated to the legacy translator and are reported for manual review.

## Summary

- Stable production IDs: 2748
- Files changed: 0
- Already-migrated files: 52
- Hook bindings migrated: 0
- Dynamic lookups held for manual review: 0
- Delegated translator files: 2
- Skipped files: 0

## Files

| File | Hook bindings | Dynamic lookups retained |
| --- | ---: | ---: |

## Already Migrated

- `app/src/pages/Checkout/components/StepPayment.jsx`
- `app/src/pages/Login/useLoginController.js`
- `app/src/pages/Orders/index.jsx`
- `app/src/pages/Checkout/index.jsx`
- `app/src/pages/Profile/components/SettingsSection.jsx`
- `app/src/pages/Cart/index.jsx`
- `app/src/pages/Checkout/components/OrderSummary.jsx`
- `app/src/pages/MyListings/index.jsx`
- `app/src/pages/Checkout/components/StepAddress.jsx`
- `app/src/pages/SellerProfile/index.jsx`
- `app/src/pages/Checkout/components/StepReview.jsx`
- `app/src/components/shared/ProtectedRoute.jsx`
- `app/src/pages/Checkout/components/StepDelivery.jsx`
- `app/src/pages/Admin/Dashboard.jsx`
- `app/src/pages/Profile/components/SupportSection.jsx`
- `app/src/pages/Marketplace/index.jsx`
- `app/src/pages/ListingDetail/index.jsx`
- `app/src/pages/Admin/Support.jsx`
- `app/src/pages/ProductDetails/index.jsx`
- `app/src/pages/Home/index.jsx`
- `app/src/components/shared/GlobalSearchBar.jsx`
- `app/src/pages/ProductListing/index.jsx`
- `app/src/components/layout/Navbar/index.jsx`
- `app/src/components/features/product/Filters/index.jsx`
- `app/src/components/features/product/ProductCard/index.jsx`
- `app/src/components/shared/VoiceSearch.jsx`
- `app/src/components/features/chat/MessageItem.jsx`
- `app/src/components/features/chat/ProductCardInline.jsx`
- `app/src/context/NotificationContext.jsx`
- `app/src/pages/Sell/index.jsx`
- `app/src/pages/Admin/Payments.jsx`
- `app/src/pages/Admin/Users.jsx`
- `app/src/pages/Admin/EmailOps.jsx`
- `app/src/pages/Profile/index.jsx`
- `app/src/pages/Admin/OrderList.jsx`
- `app/src/pages/Admin/ProductEdit.jsx`
- `app/src/pages/Admin/ProductList.jsx`
- `app/src/pages/Profile/components/OverviewSection.jsx`
- `app/src/pages/Admin/RefundLedger.jsx`
- `app/src/pages/Profile/components/PersonalInfoSection.jsx`
- `app/src/pages/Profile/components/PaymentsSection.jsx`
- `app/src/pages/Admin/ClientDiagnosticsPanel.jsx`
- `app/src/pages/Profile/components/RewardsSection.jsx`
- `app/src/pages/Profile/components/AddressesSection.jsx`
- `app/src/pages/Profile/components/NotificationsSection.jsx`
- `app/src/pages/BecomeSeller/index.jsx`
- `app/src/pages/PriceAlerts/index.jsx`
- `app/src/components/layout/Footer/index.jsx`
- `app/src/components/shared/BackendStatusBanner.jsx`
- `app/src/pages/Wishlist/index.jsx`
- `app/src/pages/Profile/components/ListingsSection.jsx`
- `app/src/pages/Profile/components/ProfileShared.jsx`

## Delegated Translators

- `app/src/pages/Login/LoginView.jsx`: No direct useMarket() t destructuring found. Translator is supplied by the migrated caller and remains tracked for review.
- `app/src/pages/Login/loginFlowHelpers.js`: No direct useMarket() t destructuring found. Translator is supplied by the migrated caller and remains tracked for review.

## Unexplained Skips
