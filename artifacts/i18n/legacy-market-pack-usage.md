# Legacy Market-Pack Usage Report

Generated: 2026-07-17T06:57:23.798Z

This report separates reviewed ICU stable UI copy from the explicit compatibility surfaces that remain for computed keys, runtime content, legacy packs, and test harnesses.

## Summary

- Tracked files: 94
- Stable ICU hook files: 60
- Delegated stable ICU translator files: 2
- Migrated stable ICU message IDs observed across files: 2980
- Residual production legacy literal message IDs: 0
- Test-harness legacy literal message IDs: 4
- Production files with direct residual stable literals: 0
- Computed-key translator lookup files: 21
- Runtime enum compatibility files: 0
- High-risk files: 0
- Medium-risk files: 18
- Low-risk files: 76
- Dynamic runtime translation files: 18
- Legacy pack import files: 21

## Files

| Risk | File | ICU IDs | Residual legacy IDs | Signals |
| --- | --- | ---: | ---: | --- |
| medium | `app/src/pages/Profile/components/SupportSection.jsx` | 134 | 0 | useMarket, stable-icu-hook, computed-key-compatibility, runtime-translation |
| medium | `app/src/pages/Admin/Dashboard.jsx` | 132 | 0 | useMarket, stable-icu-hook, runtime-translation |
| medium | `app/src/pages/Marketplace/index.jsx` | 126 | 0 | useMarket, stable-icu-hook, computed-key-compatibility, runtime-translation |
| medium | `app/src/pages/ListingDetail/index.jsx` | 112 | 0 | useMarket, stable-icu-hook, runtime-translation |
| medium | `app/src/pages/Admin/Support.jsx` | 106 | 0 | useMarket, stable-icu-hook, computed-key-compatibility, runtime-translation |
| medium | `app/src/pages/ProductDetails/index.jsx` | 97 | 0 | useMarket, stable-icu-hook, runtime-translation |
| medium | `app/src/components/shared/GlobalSearchBar.jsx` | 53 | 0 | useMarket, stable-icu-hook, runtime-translation |
| medium | `app/src/components/features/product/ProductCard/index.jsx` | 19 | 0 | useMarket, stable-icu-hook, runtime-translation |
| medium | `app/src/components/features/chat/ProductCardInline.jsx` | 12 | 0 | useMarket, stable-icu-hook, computed-key-compatibility, runtime-translation |
| medium | `app/src/context/NotificationContext.jsx` | 1 | 0 | useMarket, stable-icu-hook, runtime-translation |
| medium | `app/src/pages/MissionControl/index.jsx` | 1 | 0 | useMarket, stable-icu-hook, runtime-translation |
| medium | `app/src/components/shared/MarketAutoLocalizer.jsx` | 0 | 0 | useMarket, runtime-translation |
| medium | `app/src/components/shared/MarketAutoLocalizer.test.jsx` | 0 | 0 | useMarket, runtime-translation, test-harness |
| medium | `app/src/context/MarketContext.jsx` | 0 | 0 | useMarket, runtime-translation |
| medium | `app/src/hooks/useDynamicTranslations.js` | 0 | 0 | useMarket, runtime-translation |
| medium | `app/src/hooks/useDynamicTranslations.test.js` | 0 | 0 | runtime-translation, test-harness |
| medium | `app/src/pages/TradeIn/index.jsx` | 0 | 0 | runtime-translation |
| medium | `app/src/services/runtimeTranslation.test.js` | 0 | 0 | runtime-translation, test-harness |
| low | `app/src/pages/Login/useLoginController.js` | 153 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Sell/index.jsx` | 140 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Checkout/components/StepPayment.jsx` | 133 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Orders/index.jsx` | 102 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Admin/Payments.jsx` | 99 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Admin/Users.jsx` | 96 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Profile/index.jsx` | 96 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Admin/EmailOps.jsx` | 93 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Checkout/index.jsx` | 92 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Profile/components/SettingsSection.jsx` | 82 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Home/index.jsx` | 81 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Login/LoginView.jsx` | 67 | 0 | delegated-stable-icu |
| low | `app/src/pages/Admin/OrderList.jsx` | 64 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Admin/ProductEdit.jsx` | 59 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Admin/ProductList.jsx` | 55 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/ProductListing/index.jsx` | 50 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Profile/components/OverviewSection.jsx` | 50 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/components/layout/Navbar/index.jsx` | 48 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Admin/RefundLedger.jsx` | 46 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Cart/index.jsx` | 44 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Checkout/components/OrderSummary.jsx` | 43 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Profile/components/PersonalInfoSection.jsx` | 43 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Profile/components/PaymentsSection.jsx` | 39 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Admin/ClientDiagnosticsPanel.jsx` | 38 | 0 | useMarket, stable-icu-hook |
| low | `app/src/components/features/product/Filters/index.jsx` | 34 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/MyListings/index.jsx` | 28 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Profile/components/RewardsSection.jsx` | 28 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/AICompare/index.jsx` | 26 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Profile/components/AddressesSection.jsx` | 23 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Checkout/components/StepAddress.jsx` | 22 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Profile/components/NotificationsSection.jsx` | 22 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/BecomeSeller/index.jsx` | 21 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/SellerProfile/index.jsx` | 21 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/PriceAlerts/index.jsx` | 20 | 0 | useMarket, stable-icu-hook |
| low | `app/src/components/features/chat/MessageItem.jsx` | 16 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/components/layout/Footer/index.jsx` | 15 | 0 | useMarket, stable-icu-hook |
| low | `app/src/components/shared/VoiceSearch.jsx` | 14 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Checkout/components/StepReview.jsx` | 14 | 0 | useMarket, stable-icu-hook |
| low | `app/src/components/shared/BackendStatusBanner.jsx` | 13 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/components/shared/ProtectedRoute.jsx` | 12 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Checkout/components/StepDelivery.jsx` | 10 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Wishlist/index.jsx` | 10 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/DesktopLogin/index.jsx` | 8 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Profile/components/ListingsSection.jsx` | 6 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/VisualSearch/index.jsx` | 4 | 0 | useMarket, stable-icu-hook |
| low | `app/src/components/welcome/PremiumWelcomeCurtain.jsx` | 3 | 0 | stable-icu-hook |
| low | `app/src/pages/Profile/components/ProfileShared.jsx` | 2 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Bundles/index.jsx` | 1 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Login/loginFlowHelpers.js` | 1 | 0 | delegated-stable-icu, computed-key-compatibility |
| low | `app/src/config/marketConfig.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/ar.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/as.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/bn.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/de.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/en.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/es.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/fr.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/gu.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/hi.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/ja.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/kn.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/ml.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/mr.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/or.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/pa.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/pt.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/sa.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/te.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/ur.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/config/marketMessagePacks/zh.js` | 0 | 0 | legacy-pack-import |
| low | `app/src/context/MarketContext.test.jsx` | 0 | 0 | useMarket, test-harness |
| low | `app/src/i18n/StableText.jsx` | 0 | 0 | stable-icu-hook, computed-key-compatibility |
| low | `app/src/i18n/useStableIcuMessages.js` | 0 | 0 | useMarket, stable-icu-hook |
| low | `app/src/utils/authErrors.js` | 0 | 0 | computed-key-compatibility |
| low | `app/src/utils/enumLocalization.js` | 0 | 0 | t() |
| low | `app/src/utils/supportArchitecture.js` | 0 | 0 | computed-key-compatibility |
