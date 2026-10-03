# Localization Human Review Triage

This report proves the large human-review queue is compressed without dropping any tracked locale/message pair. It does not certify native literary quality; it certifies catalog completeness, stable UI ownership, queue integrity, and review traceability.

## Machine Certification

- Stable UI candidates discovered: 425
- Uncovered stable UI candidates: 0
- Locale key coverage: 100% (104412/104412 required locale/message pairs)
- Required locales: 21
- Source message keys: 4972
- Missing locale/message pairs: 0
- Empty locale/message pairs: 0
- Duplicate review locale/id pairs: 0
- Grouped queue validation errors: 0

## Breakthrough Result

- Total tracked review pairs preserved: 93696
- Unique review locale/id pairs: 93696
- Actionable grouped queue entries: 1765
- Actionable affected locale/message pairs: 29618
- Native-review audit grouped entries: 3063
- Native-review audit affected locale/message pairs: 64078

Actionable queue entries are unresolved English fallback or safety-review items. Native-review audit entries are structurally valid promotions kept visible for locale signoff without blocking machine QA.

## Actionable Priorities

| Priority | Grouped entries | Affected pairs | Locale spread |
| --- | ---: | ---: | --- |
| critical | 904 | 16368 | bn 809, hi 793, te 871, mr 872, ur 856, gu 885, pa 876, ml 870, kn 871, or 883, as 868, sa 875, es 870, fr 891, de 889, ar 807, ja 856, pt 875, zh 851 |
| high | 46 | 217 | bn 9, hi 20, te 19, mr 14, ur 20, gu 13, pa 18, ml 25, kn 19, or 30, as 4, sa 9, es 1, fr 6, de 6, ar 1, ja 1, pt 2 |
| medium | 769 | 12917 | bn 681, hi 633, te 685, mr 687, ur 685, gu 709, pa 700, ml 687, kn 682, or 700, as 686, sa 702, es 689, fr 673, de 678, ar 674, ja 643, pt 679, zh 644 |
| low | 46 | 116 | bn 3, hi 2, te 7, mr 3, ur 4, gu 4, pa 3, ml 3, kn 7, or 8, as 6, sa 8, es 10, fr 19, de 17, ar 1, ja 2, pt 8, zh 1 |

## Examples

| Priority | Risk | Affected pairs | Source message | Sample IDs |
| --- | --- | ---: | --- | --- |
| critical | high | 57 | Recheck your email and phone details, then request a new code. | auth.error.noAccountFound.hint, auth.error.noAccountFoundWithThisEmail.hint, auth.error.noAccountFoundWithThisPhone.hint |
| critical | high | 57 | Sign in for support | securePathDock.support.guest.title, support.jsx.text.sign.in.for.support, supportLauncher.guest.title |
| critical | high | 57 | We could not verify those account details for OTP. | auth.error.noAccountFound.detail, auth.error.noAccountFoundWithThisEmail.detail, auth.error.noAccountFoundWithThisPhone.detail |
| critical | high | 38 | Invoice | orders.actions.invoice, orders.invoice.title |
| critical | high | 38 | Active incidents | status.incidents.active, support.jsx.prop.label.active.incidents |
| critical | high | 38 | Authorize the exact live domain in Firebase Authentication settings, or continue with email and OTP sign-in. | auth.error.illegalIframe.hint, auth.error.illegalUrlForNewIframe.hint |
| critical | high | 38 | Firebase rejected the current site host for popup-based sign-in. | auth.error.illegalIframe.detail, auth.error.illegalUrlForNewIframe.detail |
| critical | high | 38 | Frontier AI Layer | common.jsx.text.frontier.ai.layer.21e85bce, common.jsx.text.frontier.ai.layer.39f8bb96 |
| high | high | 9 | Aura Support can move this same thread into voice or video without losing the written history or the resolution summary. | profile.support.arch.defaultBody |
| high | high | 9 | Aura never asks for your OTP outside this secure verification step. | login.trust.otp.default.2 |
| high | high | 9 | Enter your password, verify the email code, then verify the phone code. Keep Aura Desktop open; the request expires after 10 minutes. | desktopLogin.handoff.stepsDetail |
| high | high | 9 | Keep all negotiation inside Aura chat. | listingDetail.safety.note4 |
| high | high | 9 | Negotiate, ask for proof, lock an offer, and move to live inspection without leaving Aura. | listingDetail.chat.threadBody |
| high | high | 9 | Reply to Aura Support and keep things moving... | profile.support.compose.replyPlaceholder |
| high | high | 9 | Start your negotiation in Aura chat. | listingDetail.chat.readyPreview |
| high | high | 9 | Tell Aura Support what happened | profile.support.compose.messageLabel |
| medium | low | 57 | Update check needs another try | common.jsx.text.update.check.needs.another.try, desktopUpdate.error.title, mobileUpdate.checkFailedTitle |
| medium | low | 50 | Aura points | profile.heroMetric.points.label, profile.overview.stats.points, profile.tab.rewards |
| medium | medium | 38 | +{value} more | assistant.attachment.moreAudio, assistant.attachment.moreImages |
| medium | medium | 38 | Frequently Bought Together | product.jsx.prop.label.frequently.bought.together, recommendations.frequentlyBoughtTogether.title |
| medium | medium | 38 | Resolved | status.incident.resolved, status.incident.state.resolved |
| medium | low | 38 | Back to app | common.jsx.text.back.to.app, videoCall.backToApp.title |
| medium | low | 38 | Home | assistant.intent.navigation.home, mobileTabBar.home |
| medium | low | 38 | Later | desktopUpdate.later, mobileUpdate.later |
| low | low | 9 | Explore Aura | wishlist.explore |
| low | low | 8 | Aura evaluated a sign-in security signal. | profile.securityActivity.risk.body |
| low | low | 8 | Chat with Aura Support | profile.support.inbox.title |
| low | low | 7 | ID | admin.orders.table.id |
| low | low | 7 | sms | profile.settings.notifications.channel.sms |
| low | low | 6 | req-... | admin.diagnostics.filters.requestIdPlaceholder |
| low | low | 5 | For warnings and suspensions, Aura now opens a real moderation support case so the user can appeal and the admin team can resolve it in one thread. | admin.users.copy.appealCase |
| low | low | 5 | Manual | admin.products.source.manual |

## Native Review Audit By Locale

| Locale | Affected pairs |
| --- | ---: |
| bn | 3266 |
| hi | 3320 |
| te | 3390 |
| mr | 3396 |
| ur | 3247 |
| gu | 3361 |
| pa | 3375 |
| ml | 3387 |
| kn | 3393 |
| or | 3351 |
| as | 3408 |
| sa | 3378 |
| es | 3402 |
| fr | 3383 |
| de | 3382 |
| ar | 3285 |
| ja | 3470 |
| pt | 3408 |
| zh | 3476 |

## Files

- Actionable queue: `app/src/i18n/quality/humanReviewQueue.json`
- Native review audit: `app/src/i18n/quality/nativeReviewAudit.json`
- Stable UI discovery report: `artifacts/i18n/discovered-stable-ui-text.json`
- Summary JSON: `artifacts/i18n/human-review-queue-summary.json`
