# Localization Human Review Triage

This report proves the large human-review queue is compressed without dropping any tracked locale/message pair. It does not certify native literary quality; it certifies catalog completeness, stable UI ownership, queue integrity, and review traceability.

## Machine Certification

- Stable UI candidates discovered: 425
- Uncovered stable UI candidates: 0
- Locale key coverage: 100% (97461/97461 required locale/message pairs)
- Required locales: 21
- Source message keys: 4641
- Missing locale/message pairs: 0
- Empty locale/message pairs: 0
- Duplicate review locale/id pairs: 0
- Grouped queue validation errors: 0

## Breakthrough Result

- Total tracked review pairs preserved: 87407
- Unique review locale/id pairs: 87407
- Actionable grouped queue entries: 3173
- Actionable affected locale/message pairs: 42108
- Native-review audit grouped entries: 2518
- Native-review audit affected locale/message pairs: 45299

Actionable queue entries are unresolved English fallback or safety-review items. Native-review audit entries are structurally valid promotions kept visible for locale signoff without blocking machine QA.

## Actionable Priorities

| Priority | Grouped entries | Affected pairs | Locale spread |
| --- | ---: | ---: | --- |
| critical | 1212 | 20636 | bn 972, hi 1140, te 1031, mr 1037, ur 1017, gu 1052, pa 1046, ml 1032, kn 1031, or 1045, as 1030, sa 1034, es 1161, fr 1193, de 1181, ar 1107, ja 1180, pt 1172, zh 1175 |
| high | 223 | 908 | bn 9, hi 206, te 14, mr 14, ur 15, gu 13, pa 13, ml 17, kn 14, or 21, as 5, sa 8, es 76, fr 83, de 81, ar 79, ja 83, pt 77, zh 80 |
| medium | 1191 | 17126 | bn 767, hi 1083, te 774, mr 773, ur 772, gu 791, pa 785, ml 772, kn 772, or 782, as 771, sa 781, es 1081, fr 1065, de 1053, ar 1048, ja 1092, pt 1074, zh 1090 |
| low | 547 | 3438 | bn 2, hi 537, te 1, mr 2, ur 3, gu 3, pa 2, ml 1, kn 2, or 3, as 1, sa 3, es 408, fr 415, de 411, ar 412, ja 412, pt 409, zh 411 |

## Examples

| Priority | Risk | Affected pairs | Source message | Sample IDs |
| --- | --- | ---: | --- | --- |
| critical | high | 57 | Recheck your email and phone details, then request a new code. | auth.error.noAccountFound.hint, auth.error.noAccountFoundWithThisEmail.hint, auth.error.noAccountFoundWithThisPhone.hint |
| critical | high | 57 | Sign in for support | securePathDock.support.guest.title, support.jsx.text.sign.in.for.support, supportLauncher.guest.title |
| critical | high | 57 | We could not verify those account details for OTP. | auth.error.noAccountFound.detail, auth.error.noAccountFoundWithThisEmail.detail, auth.error.noAccountFoundWithThisPhone.detail |
| critical | high | 38 | Owner Access | login.desktopOwnerAccess.button, login.desktopOwnerAccess.startedTitle |
| critical | high | 38 | Revoking... | common.revoking, profile.settings.devices.revokingOthers |
| critical | high | 38 | Account | auth.jsx.text.account, mobileTabBar.account |
| critical | high | 38 | Active incidents | status.incidents.active, support.jsx.prop.label.active.incidents |
| critical | high | 38 | Authorize the exact live domain in Firebase Authentication settings, or continue with email and OTP sign-in. | auth.error.illegalIframe.hint, auth.error.illegalUrlForNewIframe.hint |
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
| bn | 2687 |
| hi | 1471 |
| te | 2821 |
| mr | 2815 |
| ur | 2674 |
| gu | 2782 |
| pa | 2795 |
| ml | 2819 |
| kn | 2822 |
| or | 2790 |
| as | 2834 |
| sa | 2815 |
| es | 1915 |
| fr | 1885 |
| de | 1915 |
| ar | 1791 |
| ja | 1874 |
| pt | 1909 |
| zh | 1885 |

## Files

- Actionable queue: `app/src/i18n/quality/humanReviewQueue.json`
- Native review audit: `app/src/i18n/quality/nativeReviewAudit.json`
- Stable UI discovery report: `artifacts/i18n/discovered-stable-ui-text.json`
- Summary JSON: `artifacts/i18n/human-review-queue-summary.json`
