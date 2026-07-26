# Localization Human Review Triage

This report proves the large human-review queue is compressed without dropping any tracked locale/message pair. It does not certify native literary quality; it certifies catalog completeness, stable UI ownership, queue integrity, and review traceability.

## Machine Certification

- Stable UI candidates discovered: 425
- Uncovered stable UI candidates: 0
- Locale key coverage: 100% (99393/99393 required locale/message pairs)
- Required locales: 21
- Source message keys: 4733
- Missing locale/message pairs: 0
- Empty locale/message pairs: 0
- Duplicate review locale/id pairs: 0
- Grouped queue validation errors: 0

## Breakthrough Result

- Total tracked review pairs preserved: 89155
- Unique review locale/id pairs: 89155
- Actionable grouped queue entries: 3265
- Actionable affected locale/message pairs: 44733
- Native-review audit grouped entries: 2477
- Native-review audit affected locale/message pairs: 44422

Actionable queue entries are unresolved English fallback or safety-review items. Native-review audit entries are structurally valid promotions kept visible for locale signoff without blocking machine QA.

## Actionable Priorities

| Priority | Grouped entries | Affected pairs | Locale spread |
| --- | ---: | ---: | --- |
| critical | 1242 | 21507 | bn 1017, hi 1190, te 1076, mr 1082, ur 1062, gu 1096, pa 1090, ml 1077, kn 1076, or 1090, as 1075, sa 1079, es 1207, fr 1240, de 1227, ar 1154, ja 1228, pt 1218, zh 1223 |
| high | 211 | 875 | bn 9, hi 193, te 14, mr 14, ur 15, gu 13, pa 13, ml 17, kn 14, or 21, as 5, sa 8, es 74, fr 80, de 78, ar 76, ja 80, pt 74, zh 77 |
| medium | 1282 | 18945 | bn 863, hi 1177, te 870, mr 869, ur 868, gu 887, pa 881, ml 868, kn 868, or 878, as 867, sa 877, es 1177, fr 1161, de 1149, ar 1144, ja 1187, pt 1169, zh 1185 |
| low | 530 | 3406 | bn 2, hi 519, te 1, mr 2, ur 2, gu 2, pa 1, ml 1, kn 1, or 2, as 1, sa 3, es 407, fr 413, de 409, ar 411, ja 411, pt 408, zh 410 |

## Examples

| Priority | Risk | Affected pairs | Source message | Sample IDs |
| --- | --- | ---: | --- | --- |
| critical | high | 66 | Cancel | common.action.cancel, common.cancel, profile.sessions.cancel, checkout.cancel, profile.payments.addCard.cancel |
| critical | high | 57 | Recheck your email and phone details, then request a new code. | auth.error.noAccountFound.hint, auth.error.noAccountFoundWithThisEmail.hint, auth.error.noAccountFoundWithThisPhone.hint |
| critical | high | 57 | Sign in for support | securePathDock.support.guest.title, support.jsx.text.sign.in.for.support, supportLauncher.guest.title |
| critical | high | 57 | We could not verify those account details for OTP. | auth.error.noAccountFound.detail, auth.error.noAccountFoundWithThisEmail.detail, auth.error.noAccountFoundWithThisPhone.detail |
| critical | high | 39 | {count} active | profile.sessions.activeCount, profile.settings.devices.activeCount, marketplace.filters.activeCount |
| critical | high | 38 | Choose country code | login.country.panelLabel, login.country.panelTitle |
| critical | high | 38 | Confirm password | desktopLogin.field.confirmPassword, desktopLogin.placeholder.confirmPasswordShort |
| critical | high | 38 | Continue with Duo | desktopLogin.provider.duo, login.social.duo |
| high | high | 10 | Aura Catalog | listing.catalogTitleFull |
| high | high | 9 | Aura never asks for your OTP outside this secure verification step. | login.trust.otp.default.2 |
| high | high | 9 | Keep all negotiation inside Aura chat. | listingDetail.safety.note4 |
| high | high | 9 | Negotiate, ask for proof, lock an offer, and move to live inspection without leaving Aura. | listingDetail.chat.threadBody |
| high | high | 9 | Reply to Aura Support and keep things moving... | profile.support.compose.replyPlaceholder |
| high | high | 9 | Start your negotiation in Aura chat. | listingDetail.chat.readyPreview |
| high | high | 9 | Tell Aura Support what happened | profile.support.compose.messageLabel |
| high | high | 9 | This thread is the shared record for you and Aura Support. No more disconnected alerts. | profile.support.thread.activeBody |
| medium | medium | 38 | Frequently Bought Together | product.jsx.prop.label.frequently.bought.together, recommendations.frequentlyBoughtTogether.title |
| medium | medium | 38 | Resolved | status.incident.resolved, status.incident.state.resolved |
| medium | low | 38 | Sign out | admin.security.signOut, profile.sessions.signOut |
| medium | low | 38 | Back to app | common.jsx.text.back.to.app, videoCall.backToApp.title |
| medium | low | 38 | Home | assistant.intent.navigation.home, mobileTabBar.home |
| medium | low | 38 | Later | desktopUpdate.later, mobileUpdate.later |
| medium | low | 38 | Open the focused commerce copilot | assistantLauncher.openCopilot.ariaLabel, assistantLauncher.openCopilot.title |
| medium | low | 38 | Opening {page}. | assistant.action.navigation.openingPage, assistant.intent.voice.openingPage |
| low | low | 9 | Explore Aura | wishlist.explore |
| low | low | 9 | Dashboard Sync | admin.diagnostics.cards.dashboardSync |
| low | low | 9 | Ingested At | admin.diagnostics.meta.ingestedAt |
| low | low | 9 | Processing | admin.email.processing, admin.email.status.processing, profile.overview.orders.status.processing |
| low | low | 9 | admin | admin.shared.adminActor |
| low | low | 8 | A few account and checkout actions may take an extra moment while everything reconnects. | status.banner.warmingMessage |
| low | low | 8 | Account, checkout, or support actions are temporarily unavailable. Please try again in a moment. | status.banner.unavailableMessage |
| low | low | 8 | Action Power Map | admin.users.panels.actionPowerMap |

## Native Review Audit By Locale

| Locale | Affected pairs |
| --- | ---: |
| bn | 2638 |
| hi | 1450 |
| te | 2772 |
| mr | 2766 |
| ur | 2626 |
| gu | 2735 |
| pa | 2748 |
| ml | 2770 |
| kn | 2774 |
| or | 2742 |
| as | 2785 |
| sa | 2766 |
| es | 1868 |
| fr | 1839 |
| de | 1870 |
| ar | 1744 |
| ja | 1827 |
| pt | 1864 |
| zh | 1838 |

## Files

- Actionable queue: `app/src/i18n/quality/humanReviewQueue.json`
- Native review audit: `app/src/i18n/quality/nativeReviewAudit.json`
- Stable UI discovery report: `artifacts/i18n/discovered-stable-ui-text.json`
- Summary JSON: `artifacts/i18n/human-review-queue-summary.json`
