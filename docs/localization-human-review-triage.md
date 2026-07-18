# Localization Human Review Triage

This report proves the large human-review queue is compressed without dropping any tracked locale/message pair. It does not certify native literary quality; it certifies catalog completeness, stable UI ownership, queue integrity, and review traceability.

## Machine Certification

- Stable UI candidates discovered: 425
- Uncovered stable UI candidates: 0
- Locale key coverage: 100% (96852/96852 required locale/message pairs)
- Required locales: 21
- Source message keys: 4612
- Missing locale/message pairs: 0
- Empty locale/message pairs: 0
- Duplicate review locale/id pairs: 0
- Grouped queue validation errors: 0

## Breakthrough Result

- Total tracked review pairs preserved: 86856
- Unique review locale/id pairs: 86856
- Actionable grouped queue entries: 3166
- Actionable affected locale/message pairs: 42157
- Native-review audit grouped entries: 2489
- Native-review audit affected locale/message pairs: 44699

Actionable queue entries are unresolved English fallback or safety-review items. Native-review audit entries are structurally valid promotions kept visible for locale signoff without blocking machine QA.

## Actionable Priorities

| Priority | Grouped entries | Affected pairs | Locale spread |
| --- | ---: | ---: | --- |
| critical | 1214 | 20701 | bn 975, hi 1144, te 1034, mr 1040, ur 1020, gu 1055, pa 1049, ml 1035, kn 1034, or 1048, as 1033, sa 1037, es 1165, fr 1197, de 1185, ar 1111, ja 1184, pt 1176, zh 1179 |
| high | 213 | 880 | bn 9, hi 195, te 14, mr 14, ur 15, gu 13, pa 13, ml 17, kn 14, or 21, as 5, sa 8, es 74, fr 80, de 78, ar 77, ja 81, pt 74, zh 78 |
| medium | 1192 | 17145 | bn 768, hi 1084, te 775, mr 774, ur 773, gu 792, pa 786, ml 773, kn 773, or 783, as 772, sa 782, es 1082, fr 1066, de 1054, ar 1049, ja 1093, pt 1075, zh 1091 |
| low | 547 | 3431 | bn 2, hi 537, te 1, mr 2, ur 3, gu 3, pa 2, ml 1, kn 2, or 3, as 1, sa 3, es 407, fr 414, de 410, ar 411, ja 411, pt 408, zh 410 |

## Examples

| Priority | Risk | Affected pairs | Source message | Sample IDs |
| --- | --- | ---: | --- | --- |
| critical | high | 57 | Recheck your email and phone details, then request a new code. | auth.error.noAccountFound.hint, auth.error.noAccountFoundWithThisEmail.hint, auth.error.noAccountFoundWithThisPhone.hint |
| critical | high | 57 | Sign in for support | securePathDock.support.guest.title, support.jsx.text.sign.in.for.support, supportLauncher.guest.title |
| critical | high | 57 | We could not verify those account details for OTP. | auth.error.noAccountFound.detail, auth.error.noAccountFoundWithThisEmail.detail, auth.error.noAccountFoundWithThisPhone.detail |
| critical | high | 38 | Enter your password | desktopLogin.placeholder.password, login.password.placeholder |
| critical | high | 38 | Owner Access | login.desktopOwnerAccess.button, login.desktopOwnerAccess.startedTitle |
| critical | high | 38 | Revoking... | common.revoking, profile.settings.devices.revokingOthers |
| critical | high | 38 | Secure sign-in | auth.trustedDevice.eyebrow.public, login.secureSignIn |
| critical | high | 38 | Active incidents | status.incidents.active, support.jsx.prop.label.active.incidents |
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
| bn | 2654 |
| hi | 1448 |
| te | 2788 |
| mr | 2782 |
| ur | 2641 |
| gu | 2749 |
| pa | 2762 |
| ml | 2786 |
| kn | 2789 |
| or | 2757 |
| as | 2801 |
| sa | 2782 |
| es | 1884 |
| fr | 1855 |
| de | 1885 |
| ar | 1760 |
| ja | 1843 |
| pt | 1879 |
| zh | 1854 |

## Files

- Actionable queue: `app/src/i18n/quality/humanReviewQueue.json`
- Native review audit: `app/src/i18n/quality/nativeReviewAudit.json`
- Stable UI discovery report: `artifacts/i18n/discovered-stable-ui-text.json`
- Summary JSON: `artifacts/i18n/human-review-queue-summary.json`
