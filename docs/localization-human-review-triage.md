# Localization Human Review Triage

This report proves the large human-review queue is compressed without dropping any tracked locale/message pair. It does not certify native literary quality; it certifies catalog completeness, stable UI ownership, queue integrity, and review traceability.

## Machine Certification

- Stable UI candidates discovered: 423
- Uncovered stable UI candidates: 0
- Locale key coverage: 100% (102711/102711 required locale/message pairs)
- Required locales: 21
- Source message keys: 4891
- Missing locale/message pairs: 0
- Empty locale/message pairs: 0
- Duplicate review locale/id pairs: 0
- Grouped queue validation errors: 0

## Breakthrough Result

- Total tracked review pairs preserved: 92157
- Unique review locale/id pairs: 92157
- Actionable grouped queue entries: 3413
- Actionable affected locale/message pairs: 48187
- Native-review audit grouped entries: 2456
- Native-review audit affected locale/message pairs: 43970

Actionable queue entries are unresolved English fallback or safety-review items. Native-review audit entries are structurally valid promotions kept visible for locale signoff without blocking machine QA.

## Actionable Priorities

| Priority | Grouped entries | Affected pairs | Locale spread |
| --- | ---: | ---: | --- |
| critical | 1264 | 22056 | bn 1044, hi 1226, te 1103, mr 1109, ur 1089, gu 1123, pa 1117, ml 1104, kn 1103, or 1117, as 1102, sa 1106, es 1237, fr 1270, de 1257, ar 1186, ja 1260, pt 1248, zh 1255 |
| high | 205 | 867 | bn 9, hi 185, te 14, mr 14, ur 15, gu 13, pa 13, ml 17, kn 14, or 21, as 5, sa 8, es 74, fr 80, de 78, ar 76, ja 80, pt 74, zh 77 |
| medium | 1432 | 21891 | bn 1019, hi 1331, te 1026, mr 1025, ur 1024, gu 1043, pa 1037, ml 1024, kn 1024, or 1034, as 1023, sa 1033, es 1331, fr 1315, de 1302, ar 1298, ja 1341, pt 1322, zh 1339 |
| low | 512 | 3373 | bn 2, hi 499, te 1, mr 2, ur 2, gu 2, pa 1, ml 1, kn 1, or 2, as 1, sa 3, es 406, fr 412, de 408, ar 408, ja 408, pt 407, zh 407 |

## Examples

| Priority | Risk | Affected pairs | Source message | Sample IDs |
| --- | --- | ---: | --- | --- |
| critical | high | 76 | Retry | common.retry, orders.error.retry, profile.addresses.retry, profile.settings.notifications.retry |
| critical | high | 66 | Cancel | common.action.cancel, common.cancel, profile.sessions.cancel, checkout.cancel, profile.payments.addCard.cancel |
| critical | high | 57 | Recheck your email and phone details, then request a new code. | auth.error.noAccountFound.hint, auth.error.noAccountFoundWithThisEmail.hint, auth.error.noAccountFoundWithThisPhone.hint |
| critical | high | 57 | Sign in for support | securePathDock.support.guest.title, support.jsx.text.sign.in.for.support, supportLauncher.guest.title |
| critical | high | 57 | We could not verify those account details for OTP. | auth.error.noAccountFound.detail, auth.error.noAccountFoundWithThisEmail.detail, auth.error.noAccountFoundWithThisPhone.detail |
| critical | high | 39 | {count} active | profile.sessions.activeCount, profile.settings.devices.activeCount, marketplace.filters.activeCount |
| critical | high | 38 | Choose country code | login.country.panelLabel, login.country.panelTitle |
| critical | high | 38 | Confirm password | desktopLogin.field.confirmPassword, desktopLogin.placeholder.confirmPasswordShort |
| high | high | 10 | Aura Catalog | listing.catalogTitleFull |
| high | high | 9 | Aura never asks for your OTP outside this secure verification step. | login.trust.otp.default.2 |
| high | high | 9 | Keep all negotiation inside Aura chat. | listingDetail.safety.note4 |
| high | high | 9 | Negotiate, ask for proof, lock an offer, and move to live inspection without leaving Aura. | listingDetail.chat.threadBody |
| high | high | 9 | Reply to Aura Support and keep things moving... | profile.support.compose.replyPlaceholder |
| high | high | 9 | Start your negotiation in Aura chat. | listingDetail.chat.readyPreview |
| high | high | 9 | Tell Aura Support what happened | profile.support.compose.messageLabel |
| high | high | 9 | This thread is the shared record for you and Aura Support. No more disconnected alerts. | profile.support.thread.activeBody |
| medium | low | 49 | Aura points | profile.heroMetric.points.label, profile.overview.stats.points, profile.tab.rewards |
| medium | medium | 38 | Frequently Bought Together | product.jsx.prop.label.frequently.bought.together, recommendations.frequentlyBoughtTogether.title |
| medium | medium | 38 | Resolved | status.incident.resolved, status.incident.state.resolved |
| medium | low | 38 | Privacy controls | profile.privacy.title, profile.tab.privacy |
| medium | low | 38 | Returns and refunds | profile.overview.stats.pendingPostPurchase, profile.settings.notifications.returnRefundUpdates.label |
| medium | low | 38 | Sign out | admin.security.signOut, profile.sessions.signOut |
| medium | low | 38 | Try again | profile.marketplace.retry, profile.privacy.retry |
| medium | low | 38 | Back to app | common.jsx.text.back.to.app, videoCall.backToApp.title |
| low | low | 9 | Explore Aura | wishlist.explore |
| low | low | 9 | Dashboard Sync | admin.diagnostics.cards.dashboardSync |
| low | low | 9 | Ingested At | admin.diagnostics.meta.ingestedAt |
| low | low | 9 | admin | admin.shared.adminActor |
| low | low | 8 | A few account and checkout actions may take an extra moment while everything reconnects. | status.banner.warmingMessage |
| low | low | 8 | Account, checkout, or support actions are temporarily unavailable. Please try again in a moment. | status.banner.unavailableMessage |
| low | low | 8 | Action Power Map | admin.users.panels.actionPowerMap |
| low | low | 8 | Action completed | admin.users.action.completed |

## Native Review Audit By Locale

| Locale | Affected pairs |
| --- | ---: |
| bn | 2613 |
| hi | 1446 |
| te | 2747 |
| mr | 2741 |
| ur | 2601 |
| gu | 2710 |
| pa | 2723 |
| ml | 2745 |
| kn | 2749 |
| or | 2717 |
| as | 2760 |
| sa | 2741 |
| es | 1843 |
| fr | 1814 |
| de | 1846 |
| ar | 1719 |
| ja | 1802 |
| pt | 1840 |
| zh | 1813 |

## Files

- Actionable queue: `app/src/i18n/quality/humanReviewQueue.json`
- Native review audit: `app/src/i18n/quality/nativeReviewAudit.json`
- Stable UI discovery report: `artifacts/i18n/discovered-stable-ui-text.json`
- Summary JSON: `artifacts/i18n/human-review-queue-summary.json`
