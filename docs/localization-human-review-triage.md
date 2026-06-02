# Localization Human Review Triage

This report proves the large human-review queue is compressed without dropping any tracked locale/message pair. It does not certify native literary quality; it certifies catalog completeness, stable UI ownership, queue integrity, and review traceability.

## Machine Certification

- Stable UI candidates discovered: 419
- Uncovered stable UI candidates: 0
- Locale key coverage: 100% (91875/91875 required locale/message pairs)
- Required locales: 21
- Source message keys: 4375
- Missing locale/message pairs: 0
- Empty locale/message pairs: 0
- Duplicate review locale/id pairs: 0
- Grouped queue validation errors: 0

## Breakthrough Result

- Total tracked review pairs preserved: 82529
- Unique review locale/id pairs: 82529
- Actionable grouped queue entries: 2930
- Actionable affected locale/message pairs: 37384
- Native-review audit grouped entries: 2488
- Native-review audit affected locale/message pairs: 45145

Actionable queue entries are unresolved English fallback or safety-review items. Native-review audit entries are structurally valid promotions kept visible for locale signoff without blocking machine QA.

## Actionable Priorities

| Priority | Grouped entries | Affected pairs | Locale spread |
| --- | ---: | ---: | --- |
| critical | 1000 | 16574 | bn 796, hi 964, te 808, mr 814, ur 797, gu 829, pa 823, ml 809, kn 808, or 822, as 807, sa 811, es 943, fr 975, de 962, ar 935, ja 961, pt 954, zh 956 |
| high | 230 | 947 | bn 10, hi 212, te 15, mr 15, ur 17, gu 14, pa 14, ml 18, kn 15, or 23, as 5, sa 8, es 79, fr 86, de 85, ar 82, ja 86, pt 80, zh 83 |
| medium | 1152 | 16417 | bn 727, hi 1044, te 734, mr 733, ur 732, gu 751, pa 745, ml 732, kn 732, or 742, as 731, sa 741, es 1041, fr 1050, de 1038, ar 1008, ja 1052, pt 1034, zh 1050 |
| low | 548 | 3446 | bn 2, hi 538, te 1, mr 2, ur 3, gu 3, pa 2, ml 1, kn 2, or 3, as 1, sa 3, es 409, fr 416, de 412, ar 413, ja 413, pt 410, zh 412 |

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
| hi | 1468 |
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
| es | 1903 |
| fr | 1848 |
| de | 1878 |
| ar | 1788 |
| ja | 1863 |
| pt | 1897 |
| zh | 1874 |

## Files

- Actionable queue: `app/src/i18n/quality/humanReviewQueue.json`
- Native review audit: `app/src/i18n/quality/nativeReviewAudit.json`
- Stable UI discovery report: `artifacts/i18n/discovered-stable-ui-text.json`
- Summary JSON: `artifacts/i18n/human-review-queue-summary.json`
