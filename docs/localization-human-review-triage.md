# Localization Human Review Triage

This report proves the large human-review queue is compressed without dropping any tracked locale/message pair. It does not certify native literary quality; it certifies catalog completeness, stable UI ownership, queue integrity, and review traceability.

## Machine Certification

- Stable UI candidates discovered: 417
- Uncovered stable UI candidates: 0
- Locale key coverage: 100% (103131/103131 required locale/message pairs)
- Required locales: 21
- Source message keys: 4911
- Missing locale/message pairs: 0
- Empty locale/message pairs: 0
- Duplicate review locale/id pairs: 0
- Grouped queue validation errors: 0

## Breakthrough Result

- Total tracked review pairs preserved: 92537
- Unique review locale/id pairs: 92537
- Actionable grouped queue entries: 3124
- Actionable affected locale/message pairs: 30592
- Native-review audit grouped entries: 3013
- Native-review audit affected locale/message pairs: 61945

Actionable queue entries are unresolved English fallback or safety-review items. Native-review audit entries are structurally valid promotions kept visible for locale signoff without blocking machine QA.

## Actionable Priorities

| Priority | Grouped entries | Affected pairs | Locale spread |
| --- | ---: | ---: | --- |
| critical | 1044 | 16042 | bn 779, hi 771, te 841, mr 842, ur 826, gu 855, pa 847, ml 840, kn 841, or 853, as 838, sa 845, es 840, fr 862, de 860, ar 777, ja 842, pt 1046, zh 837 |
| high | 273 | 492 | bn 10, hi 21, te 20, mr 15, ur 21, gu 14, pa 18, ml 26, kn 20, or 31, as 5, sa 10, es 2, fr 6, de 6, ar 2, ja 2, pt 262, zh 1 |
| medium | 1085 | 13223 | bn 672, hi 643, te 676, mr 678, ur 676, gu 700, pa 691, ml 678, kn 673, or 691, as 677, sa 693, es 680, fr 664, de 669, ar 665, ja 676, pt 1045, zh 676 |
| low | 722 | 835 | bn 3, hi 7, te 7, mr 3, ur 4, gu 4, pa 3, ml 3, kn 7, or 8, as 6, sa 8, es 10, fr 19, de 17, ar 1, ja 3, pt 720, zh 2 |

## Examples

| Priority | Risk | Affected pairs | Source message | Sample IDs |
| --- | --- | ---: | --- | --- |
| critical | high | 57 | Recheck your email and phone details, then request a new code. | auth.error.noAccountFound.hint, auth.error.noAccountFoundWithThisEmail.hint, auth.error.noAccountFoundWithThisPhone.hint |
| critical | high | 57 | Sign in for support | securePathDock.support.guest.title, support.jsx.text.sign.in.for.support, supportLauncher.guest.title |
| critical | high | 57 | We could not verify those account details for OTP. | auth.error.noAccountFound.detail, auth.error.noAccountFoundWithThisEmail.detail, auth.error.noAccountFoundWithThisPhone.detail |
| critical | high | 38 | Active incidents | status.incidents.active, support.jsx.prop.label.active.incidents |
| critical | high | 38 | Authorize the exact live domain in Firebase Authentication settings, or continue with email and OTP sign-in. | auth.error.illegalIframe.hint, auth.error.illegalUrlForNewIframe.hint |
| critical | high | 38 | Firebase rejected the current site host for popup-based sign-in. | auth.error.illegalIframe.detail, auth.error.illegalUrlForNewIframe.detail |
| critical | high | 38 | Frontier AI Layer | common.jsx.text.frontier.ai.layer.21e85bce, common.jsx.text.frontier.ai.layer.39f8bb96 |
| critical | high | 38 | Guest | assistant.context.guest, common.jsx.expression.guest.c539652f |
| high | high | 10 | Aura Catalog | listing.catalogTitleFull |
| high | high | 10 | Enter your password, verify the email code, then verify the phone code. Keep Aura Desktop open; the request expires after 10 minutes. | desktopLogin.handoff.stepsDetail |
| high | high | 9 | Aura never asks for your OTP outside this secure verification step. | login.trust.otp.default.2 |
| high | high | 9 | Keep all negotiation inside Aura chat. | listingDetail.safety.note4 |
| high | high | 9 | Negotiate, ask for proof, lock an offer, and move to live inspection without leaving Aura. | listingDetail.chat.threadBody |
| high | high | 9 | Reply to Aura Support and keep things moving... | profile.support.compose.replyPlaceholder |
| high | high | 9 | Start your negotiation in Aura chat. | listingDetail.chat.readyPreview |
| high | high | 9 | Tell Aura Support what happened | profile.support.compose.messageLabel |
| medium | low | 49 | Aura points | profile.heroMetric.points.label, profile.overview.stats.points, profile.tab.rewards |
| medium | medium | 38 | +{value} more | assistant.attachment.moreAudio, assistant.attachment.moreImages |
| medium | medium | 38 | Frequently Bought Together | product.jsx.prop.label.frequently.bought.together, recommendations.frequentlyBoughtTogether.title |
| medium | medium | 38 | Resolved | status.incident.resolved, status.incident.state.resolved |
| medium | low | 38 | Back to app | common.jsx.text.back.to.app, videoCall.backToApp.title |
| medium | low | 38 | Home | assistant.intent.navigation.home, mobileTabBar.home |
| medium | low | 38 | Later | desktopUpdate.later, mobileUpdate.later |
| medium | low | 38 | Open the focused commerce copilot | assistantLauncher.openCopilot.ariaLabel, assistantLauncher.openCopilot.title |
| low | low | 9 | Explore Aura | wishlist.explore |
| low | low | 9 | Aura evaluated a sign-in security signal. | profile.securityActivity.risk.body |
| low | low | 8 | Chat with Aura Support | profile.support.inbox.title |
| low | low | 8 | ID | admin.orders.table.id |
| low | low | 8 | Manual | admin.products.source.manual |
| low | low | 8 | sms | profile.settings.notifications.channel.sms |
| low | low | 7 | req-... | admin.diagnostics.filters.requestIdPlaceholder |
| low | low | 6 | Ref | admin.refunds.reference |

## Native Review Audit By Locale

| Locale | Affected pairs |
| --- | ---: |
| bn | 3243 |
| hi | 3265 |
| te | 3367 |
| mr | 3373 |
| ur | 3224 |
| gu | 3338 |
| pa | 3352 |
| ml | 3364 |
| kn | 3370 |
| or | 3328 |
| as | 3385 |
| sa | 3355 |
| es | 3379 |
| fr | 3360 |
| de | 3359 |
| ar | 3262 |
| ja | 3388 |
| pt | 1838 |
| zh | 3395 |

## Files

- Actionable queue: `app/src/i18n/quality/humanReviewQueue.json`
- Native review audit: `app/src/i18n/quality/nativeReviewAudit.json`
- Stable UI discovery report: `artifacts/i18n/discovered-stable-ui-text.json`
- Summary JSON: `artifacts/i18n/human-review-queue-summary.json`
