# Localization Human Review Triage

This report proves the large human-review queue is compressed without dropping any tracked locale/message pair. It does not certify native literary quality; it certifies catalog completeness, stable UI ownership, queue integrity, and review traceability.

## Machine Certification

- Stable UI candidates discovered: 425
- Uncovered stable UI candidates: 0
- Locale key coverage: 100% (98574/98574 required locale/message pairs)
- Required locales: 21
- Source message keys: 4694
- Missing locale/message pairs: 0
- Empty locale/message pairs: 0
- Duplicate review locale/id pairs: 0
- Grouped queue validation errors: 0

## Breakthrough Result

- Total tracked review pairs preserved: 88414
- Unique review locale/id pairs: 88414
- Actionable grouped queue entries: 3235
- Actionable affected locale/message pairs: 43753
- Native-review audit grouped entries: 2491
- Native-review audit affected locale/message pairs: 44661

Actionable queue entries are unresolved English fallback or safety-review items. Native-review audit entries are structurally valid promotions kept visible for locale signoff without blocking machine QA.

## Actionable Priorities

| Priority | Grouped entries | Affected pairs | Locale spread |
| --- | ---: | ---: | --- |
| critical | 1243 | 21471 | bn 1015, hi 1188, te 1074, mr 1080, ur 1060, gu 1095, pa 1089, ml 1075, kn 1074, or 1088, as 1073, sa 1077, es 1205, fr 1238, de 1225, ar 1152, ja 1226, pt 1216, zh 1221 |
| high | 211 | 875 | bn 9, hi 193, te 14, mr 14, ur 15, gu 13, pa 13, ml 17, kn 14, or 21, as 5, sa 8, es 74, fr 80, de 78, ar 76, ja 80, pt 74, zh 77 |
| medium | 1235 | 17978 | bn 812, hi 1127, te 819, mr 818, ur 817, gu 836, pa 830, ml 817, kn 817, or 827, as 816, sa 826, es 1126, fr 1110, de 1098, ar 1093, ja 1136, pt 1119, zh 1134 |
| low | 546 | 3429 | bn 2, hi 536, te 1, mr 2, ur 3, gu 3, pa 2, ml 1, kn 2, or 3, as 1, sa 3, es 407, fr 413, de 410, ar 411, ja 411, pt 408, zh 410 |

## Examples

| Priority | Risk | Affected pairs | Source message | Sample IDs |
| --- | --- | ---: | --- | --- |
| critical | high | 57 | Recheck your email and phone details, then request a new code. | auth.error.noAccountFound.hint, auth.error.noAccountFoundWithThisEmail.hint, auth.error.noAccountFoundWithThisPhone.hint |
| critical | high | 57 | Sign in for support | securePathDock.support.guest.title, support.jsx.text.sign.in.for.support, supportLauncher.guest.title |
| critical | high | 57 | We could not verify those account details for OTP. | auth.error.noAccountFound.detail, auth.error.noAccountFoundWithThisEmail.detail, auth.error.noAccountFoundWithThisPhone.detail |
| critical | high | 47 | Cancel | common.action.cancel, common.cancel, checkout.cancel, profile.payments.addCard.cancel, profile.personal.cancel |
| critical | high | 38 | Choose country code | login.country.panelLabel, login.country.panelTitle |
| critical | high | 38 | Confirm password | desktopLogin.field.confirmPassword, desktopLogin.placeholder.confirmPasswordShort |
| critical | high | 38 | Continue with Duo | desktopLogin.provider.duo, login.social.duo |
| critical | high | 38 | Enter your password | desktopLogin.placeholder.password, login.password.placeholder |
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
| medium | low | 38 | Back to app | common.jsx.text.back.to.app, videoCall.backToApp.title |
| medium | low | 38 | Home | assistant.intent.navigation.home, mobileTabBar.home |
| medium | low | 38 | Later | desktopUpdate.later, mobileUpdate.later |
| medium | low | 38 | Open the focused commerce copilot | assistantLauncher.openCopilot.ariaLabel, assistantLauncher.openCopilot.title |
| medium | low | 38 | Opening {page}. | assistant.action.navigation.openingPage, assistant.intent.voice.openingPage |
| medium | low | 38 | Share screen | common.jsx.expression.share.screen, videoCall.shareScreen.title |
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
| bn | 2652 |
| hi | 1446 |
| te | 2786 |
| mr | 2780 |
| ur | 2639 |
| gu | 2747 |
| pa | 2760 |
| ml | 2784 |
| kn | 2787 |
| or | 2755 |
| as | 2799 |
| sa | 2780 |
| es | 1882 |
| fr | 1853 |
| de | 1883 |
| ar | 1758 |
| ja | 1841 |
| pt | 1877 |
| zh | 1852 |

## Files

- Actionable queue: `app/src/i18n/quality/humanReviewQueue.json`
- Native review audit: `app/src/i18n/quality/nativeReviewAudit.json`
- Stable UI discovery report: `artifacts/i18n/discovered-stable-ui-text.json`
- Summary JSON: `artifacts/i18n/human-review-queue-summary.json`
