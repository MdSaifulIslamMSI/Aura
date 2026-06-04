# Localization Human Review Triage

This report proves the large human-review queue is compressed without dropping any tracked locale/message pair. It does not certify native literary quality; it certifies catalog completeness, stable UI ownership, queue integrity, and review traceability.

## Machine Certification

- Stable UI candidates discovered: 419
- Uncovered stable UI candidates: 0
- Locale key coverage: 100% (92484/92484 required locale/message pairs)
- Required locales: 21
- Source message keys: 4404
- Missing locale/message pairs: 0
- Empty locale/message pairs: 0
- Duplicate review locale/id pairs: 0
- Grouped queue validation errors: 0

## Breakthrough Result

- Total tracked review pairs preserved: 83080
- Unique review locale/id pairs: 83080
- Actionable grouped queue entries: 2954
- Actionable affected locale/message pairs: 37895
- Native-review audit grouped entries: 2488
- Native-review audit affected locale/message pairs: 45185

Actionable queue entries are unresolved English fallback or safety-review items. Native-review audit entries are structurally valid promotions kept visible for locale signoff without blocking machine QA.

## Actionable Priorities

| Priority | Grouped entries | Affected pairs | Locale spread |
| --- | ---: | ---: | --- |
| critical | 1016 | 16922 | bn 816, hi 980, te 828, mr 834, ur 817, gu 849, pa 843, ml 829, kn 828, or 842, as 827, sa 831, es 959, fr 991, de 978, ar 951, ja 977, pt 970, zh 972 |
| high | 230 | 947 | bn 10, hi 212, te 15, mr 15, ur 17, gu 14, pa 14, ml 18, kn 15, or 23, as 5, sa 8, es 79, fr 86, de 85, ar 82, ja 86, pt 80, zh 83 |
| medium | 1161 | 16588 | bn 736, hi 1053, te 743, mr 742, ur 741, gu 760, pa 754, ml 741, kn 741, or 751, as 740, sa 750, es 1050, fr 1059, de 1047, ar 1017, ja 1061, pt 1043, zh 1059 |
| low | 547 | 3438 | bn 2, hi 537, te 1, mr 2, ur 3, gu 3, pa 2, ml 1, kn 2, or 3, as 1, sa 3, es 408, fr 415, de 411, ar 412, ja 412, pt 409, zh 411 |

## Examples

| Priority | Risk | Affected pairs | Source message | Sample IDs |
| --- | --- | ---: | --- | --- |
| critical | high | 57 | Recheck your email and phone details, then request a new code. | auth.error.noAccountFound.hint, auth.error.noAccountFoundWithThisEmail.hint, auth.error.noAccountFoundWithThisPhone.hint |
| critical | high | 57 | Sign in for support | securePathDock.support.guest.title, support.jsx.text.sign.in.for.support, supportLauncher.guest.title |
| critical | high | 57 | We could not verify those account details for OTP. | auth.error.noAccountFound.detail, auth.error.noAccountFoundWithThisEmail.detail, auth.error.noAccountFoundWithThisPhone.detail |
| critical | high | 38 | Account | auth.jsx.text.account, mobileTabBar.account |
| critical | high | 38 | Active incidents | status.incidents.active, support.jsx.prop.label.active.incidents |
| critical | high | 38 | Authorize the exact live domain in Firebase Authentication settings, or continue with email and OTP sign-in. | auth.error.illegalIframe.hint, auth.error.illegalUrlForNewIframe.hint |
| critical | high | 38 | Firebase rejected the current site host for popup-based sign-in. | auth.error.illegalIframe.detail, auth.error.illegalUrlForNewIframe.detail |
| critical | high | 38 | Frontier AI Layer | common.jsx.text.frontier.ai.layer.21e85bce, common.jsx.text.frontier.ai.layer.39f8bb96 |
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
| bn | 2691 |
| hi | 1473 |
| te | 2817 |
| mr | 2811 |
| ur | 2677 |
| gu | 2778 |
| pa | 2791 |
| ml | 2815 |
| kn | 2818 |
| or | 2785 |
| as | 2831 |
| sa | 2812 |
| es | 1908 |
| fr | 1853 |
| de | 1883 |
| ar | 1793 |
| ja | 1868 |
| pt | 1902 |
| zh | 1879 |

## Files

- Actionable queue: `app/src/i18n/quality/humanReviewQueue.json`
- Native review audit: `app/src/i18n/quality/nativeReviewAudit.json`
- Stable UI discovery report: `artifacts/i18n/discovered-stable-ui-text.json`
- Summary JSON: `artifacts/i18n/human-review-queue-summary.json`
