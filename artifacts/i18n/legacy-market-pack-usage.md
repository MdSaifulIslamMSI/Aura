# Legacy Market-Pack Usage Report

Generated: 2026-06-01T12:45:32.376Z

This report separates reviewed ICU stable UI copy from the explicit compatibility surfaces that remain for computed keys, runtime content, legacy packs, and test harnesses.

## Summary

- Tracked files: 86
- Stable ICU hook files: 53
- Delegated stable ICU translator files: 2
- Migrated stable ICU message IDs observed across files: 2714
- Residual legacy literal message IDs observed across files: 4
- Production files with direct residual stable literals: 0
- Computed-key translator lookup files: 28
- High-risk files: 1
- Medium-risk files: 18
- Low-risk files: 67
- Dynamic runtime translation files: 18
- Legacy pack import files: 21

## Files

| Risk | File | ICU IDs | Residual legacy IDs | Signals |
| --- | --- | ---: | ---: | --- |
| high | `app/src/context/MarketContext.test.jsx` | 0 | 4 | useMarket |
| medium | `app/src/pages/Admin/Dashboard.jsx` | 131 | 0 | useMarket, stable-icu-hook, runtime-translation |
| medium | `app/src/pages/Profile/components/SupportSection.jsx` | 125 | 0 | useMarket, stable-icu-hook, computed-key-compatibility, runtime-translation |
| medium | `app/src/pages/ListingDetail/index.jsx` | 112 | 0 | useMarket, stable-icu-hook, runtime-translation |
| medium | `app/src/pages/Admin/Support.jsx` | 102 | 0 | useMarket, stable-icu-hook, computed-key-compatibility, runtime-translation |
| medium | `app/src/pages/ProductDetails/index.jsx` | 95 | 0 | useMarket, stable-icu-hook, runtime-translation |
| medium | `app/src/pages/Marketplace/index.jsx` | 83 | 0 | useMarket, stable-icu-hook, computed-key-compatibility, runtime-translation |
| medium | `app/src/components/shared/GlobalSearchBar.jsx` | 53 | 0 | useMarket, stable-icu-hook, runtime-translation |
| medium | `app/src/components/features/product/ProductCard/index.jsx` | 19 | 0 | useMarket, stable-icu-hook, runtime-translation |
| medium | `app/src/components/features/chat/ProductCardInline.jsx` | 2 | 0 | useMarket, stable-icu-hook, runtime-translation |
| medium | `app/src/context/NotificationContext.jsx` | 1 | 0 | useMarket, stable-icu-hook, runtime-translation |
| medium | `app/src/components/shared/MarketAutoLocalizer.jsx` | 0 | 0 | useMarket, runtime-translation |
| medium | `app/src/components/shared/MarketAutoLocalizer.test.jsx` | 0 | 0 | useMarket, runtime-translation |
| medium | `app/src/context/MarketContext.jsx` | 0 | 0 | useMarket, runtime-translation |
| medium | `app/src/hooks/useDynamicTranslations.js` | 0 | 0 | useMarket, runtime-translation |
| medium | `app/src/hooks/useDynamicTranslations.test.js` | 0 | 0 | runtime-translation |
| medium | `app/src/pages/MissionControl/index.jsx` | 0 | 0 | useMarket, runtime-translation |
| medium | `app/src/pages/TradeIn/index.jsx` | 0 | 0 | runtime-translation |
| medium | `app/src/services/runtimeTranslation.test.js` | 0 | 0 | runtime-translation |
| low | `app/src/pages/Sell/index.jsx` | 140 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Login/useLoginController.js` | 130 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Checkout/components/StepPayment.jsx` | 119 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Orders/index.jsx` | 102 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Admin/Payments.jsx` | 98 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Admin/Users.jsx` | 95 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Admin/EmailOps.jsx` | 93 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Checkout/index.jsx` | 92 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Profile/index.jsx` | 86 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Home/index.jsx` | 81 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Admin/OrderList.jsx` | 64 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Profile/components/SettingsSection.jsx` | 64 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Login/LoginView.jsx` | 62 | 0 | delegated-stable-icu |
| low | `app/src/pages/Admin/ProductEdit.jsx` | 59 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Admin/ProductList.jsx` | 54 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Profile/components/OverviewSection.jsx` | 50 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/components/layout/Navbar/index.jsx` | 46 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Admin/RefundLedger.jsx` | 46 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/ProductListing/index.jsx` | 43 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Profile/components/PersonalInfoSection.jsx` | 43 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Cart/index.jsx` | 42 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Checkout/components/OrderSummary.jsx` | 39 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Admin/ClientDiagnosticsPanel.jsx` | 36 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/components/features/product/Filters/index.jsx` | 29 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Profile/components/PaymentsSection.jsx` | 28 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Profile/components/RewardsSection.jsx` | 28 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/MyListings/index.jsx` | 25 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/BecomeSeller/index.jsx` | 21 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/SellerProfile/index.jsx` | 21 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/PriceAlerts/index.jsx` | 20 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Profile/components/AddressesSection.jsx` | 20 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Checkout/components/StepAddress.jsx` | 18 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/components/layout/Footer/index.jsx` | 15 | 0 | useMarket, stable-icu-hook |
| low | `app/src/components/shared/VoiceSearch.jsx` | 14 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Checkout/components/StepReview.jsx` | 14 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Profile/components/NotificationsSection.jsx` | 12 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/components/shared/ProtectedRoute.jsx` | 10 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Wishlist/index.jsx` | 8 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Checkout/components/StepDelivery.jsx` | 6 | 0 | useMarket, stable-icu-hook |
| low | `app/src/pages/Profile/components/ListingsSection.jsx` | 6 | 0 | useMarket, stable-icu-hook |
| low | `app/src/components/features/chat/MessageItem.jsx` | 5 | 0 | useMarket, stable-icu-hook |
| low | `app/src/components/shared/BackendStatusBanner.jsx` | 4 | 0 | useMarket, stable-icu-hook, computed-key-compatibility |
| low | `app/src/pages/Profile/components/ProfileShared.jsx` | 2 | 0 | useMarket, stable-icu-hook |
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
| low | `app/src/i18n/useStableIcuMessages.js` | 0 | 0 | useMarket, stable-icu-hook |
| low | `app/src/utils/enumLocalization.js` | 0 | 0 | computed-key-compatibility |
