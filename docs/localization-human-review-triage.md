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
- Actionable grouped queue entries: 2859
- Actionable affected locale/message pairs: 37384
- Native-review audit grouped entries: 2488
- Native-review audit affected locale/message pairs: 45145

Actionable queue entries are unresolved English fallback or safety-review items. Native-review audit entries are structurally valid promotions kept visible for locale signoff without blocking machine QA.

## Actionable Priorities

| Priority | Grouped entries | Affected pairs | Locale spread |
| --- | ---: | ---: | --- |
| critical | 987 | 16501 | ar 933, as 800, bn 791, de 960, es 941, fr 973, gu 824, hi 963, ja 959, kn 803, ml 804, mr 809, or 818, pa 816, pt 953, sa 804, te 803, ur 793, zh 954 |
| high | 218 | 887 | ar 78, as 4, bn 7, de 81, es 75, fr 82, gu 11, hi 209, ja 82, kn 12, ml 15, mr 12, or 19, pa 13, pt 76, sa 7, te 12, ur 13, zh 79 |
| medium | 1117 | 16573 | ar 1015, as 739, bn 735, de 1047, es 1048, fr 1057, gu 760, hi 1057, ja 1059, kn 740, ml 740, mr 741, or 751, pa 754, pt 1041, sa 749, te 742, ur 741, zh 1057 |
| low | 537 | 3423 | ar 412, as 1, bn 2, de 409, es 408, fr 415, gu 2, hi 529, ja 412, kn 2, ml 1, mr 2, or 2, pa 1, pt 408, sa 3, te 1, ur 2, zh 411 |

## Examples

| Priority | Risk | Affected pairs | Source message | Sample IDs |
| --- | --- | ---: | --- | --- |
| critical | high | 19 | - {name} | checkout.payment.currency.option.name, checkout.payment.currency.option.name, checkout.payment.currency.option.name, checkout.payment.currency.option.name, checkout.payment.currency.option.name |
| critical | high | 19 | {method} required | auth.jsx.expression.method.required, auth.jsx.expression.method.required, auth.jsx.expression.method.required, auth.jsx.expression.method.required, auth.jsx.expression.method.required |
| critical | high | 19 | {selectedKey} activated | admin.feedback.activated, admin.feedback.activated, admin.feedback.activated, admin.feedback.activated, admin.feedback.activated |
| critical | high | 19 | {selectedKey} deactivated | admin.feedback.deactivated, admin.feedback.deactivated, admin.feedback.deactivated, admin.feedback.deactivated, admin.feedback.deactivated |
| critical | high | 19 | {selectedKey} expiry extended | admin.feedback.expiry.extended, admin.feedback.expiry.extended, admin.feedback.expiry.extended, admin.feedback.expiry.extended, admin.feedback.expiry.extended |
| critical | high | 19 | {selectedKey} message updated | admin.feedback.message.updated, admin.feedback.message.updated, admin.feedback.message.updated, admin.feedback.message.updated, admin.feedback.message.updated |
| critical | high | 19 | \| Expires | admin.jsx.text.expires, admin.jsx.text.expires, admin.jsx.text.expires, admin.jsx.text.expires, admin.jsx.text.expires |
| critical | high | 19 | 90d uptime | admin.jsx.prop.label.90d.uptime, admin.jsx.prop.label.90d.uptime, admin.jsx.prop.label.90d.uptime, admin.jsx.prop.label.90d.uptime, admin.jsx.prop.label.90d.uptime |
| high | high | 8 | 2-4 days | cart.defaultDeliveryWindow, cart.defaultDeliveryWindow, cart.defaultDeliveryWindow, cart.defaultDeliveryWindow, cart.defaultDeliveryWindow |
| high | high | 1 | A live lane is active. | common.jsx.expression.a.live.lane.is.active.e6c9da1a |
| high | high | 1 | A live lane is already active. | common.jsx.expression.a.live.lane.is.already.active.112f9357 |
| high | high | 8 | active filters | listing.statsSignalsBody, listing.statsSignalsBody, listing.statsSignalsBody, listing.statsSignalsBody, listing.statsSignalsBody |
| high | high | 1 | Active Orders | orders.summary.active.label |
| high | high | 1 | Active route | common.jsx.text.active.route.adea24bd |
| high | high | 8 | Additional payment verification was requested. | orders.payment.timeline.challengeBody, orders.payment.timeline.challengeBody, orders.payment.timeline.challengeBody, orders.payment.timeline.challengeBody, orders.payment.timeline.challengeBody |
| high | high | 8 | All items ready | cart.allItemsReady, cart.allItemsReady, cart.allItemsReady, cart.allItemsReady, cart.allItemsReady |
| medium | medium | 19 |  - {value} ms response | status.response.msSuffix, status.response.msSuffix, status.response.msSuffix, status.response.msSuffix, status.response.msSuffix |
| medium | medium | 19 |  - Uptime since monitoring began: {uptime} | status.uptime.sinceMonitoringBeganSuffix, status.uptime.sinceMonitoringBeganSuffix, status.uptime.sinceMonitoringBeganSuffix, status.uptime.sinceMonitoringBeganSuffix, status.uptime.sinceMonitoringBeganSuffix |
| medium | medium | 19 | , {value} minutes downtime | status.uptime.downtimeMinutes, status.uptime.downtimeMinutes, status.uptime.downtimeMinutes, status.uptime.downtimeMinutes, status.uptime.downtimeMinutes |
| medium | medium | 19 | ({label}) | profile.payments.addBank.saved.option, profile.payments.addBank.saved.option, profile.payments.addBank.saved.option, profile.payments.addBank.saved.option, profile.payments.addBank.saved.option |
| medium | medium | 19 | {count} components | status.components.count, status.components.count, status.components.count, status.components.count, status.components.count |
| medium | medium | 19 | {dateLabel}: {label}, {uptime}{downtime} | status.uptime.dayStatusLabel, status.uptime.dayStatusLabel, status.uptime.dayStatusLabel, status.uptime.dayStatusLabel, status.uptime.dayStatusLabel |
| medium | medium | 19 | {dateLabel}: No monitoring data for this day | status.uptime.dayNoDataLabel, status.uptime.dayNoDataLabel, status.uptime.dayNoDataLabel, status.uptime.dayNoDataLabel, status.uptime.dayNoDataLabel |
| medium | medium | 19 | {name} 90 day uptime | status.uptime.ninetyDayLabel, status.uptime.ninetyDayLabel, status.uptime.ninetyDayLabel, status.uptime.ninetyDayLabel, status.uptime.ninetyDayLabel |
| low | low | 8 | A few account and checkout actions may take an extra moment while everything reconnects. | status.banner.warmingMessage, status.banner.warmingMessage, status.banner.warmingMessage, status.banner.warmingMessage, status.banner.warmingMessage |
| low | low | 1 | Account standing | profile.overview.standing.label |
| low | low | 8 | Account, checkout, or support actions are temporarily unavailable. Please try again in a moment. | status.banner.unavailableMessage, status.banner.unavailableMessage, status.banner.unavailableMessage, status.banner.unavailableMessage, status.banner.unavailableMessage |
| low | low | 8 | Action completed | admin.users.action.completed, admin.users.action.completed, admin.users.action.completed, admin.users.action.completed, admin.users.action.completed |
| low | low | 8 | Action failed | admin.users.error.actionFailed, admin.users.error.actionFailed, admin.users.error.actionFailed, admin.users.error.actionFailed, admin.users.error.actionFailed |
| low | low | 8 | Action Power Map | admin.users.panels.actionPowerMap, admin.users.panels.actionPowerMap, admin.users.panels.actionPowerMap, admin.users.panels.actionPowerMap, admin.users.panels.actionPowerMap |
| low | low | 4 | Actions | admin.shared.actions, admin.shared.actions, admin.shared.actions, admin.shared.actions |
| low | low | 2 | Active Alerts | priceAlerts.active.title, priceAlerts.stats.active |

## Native Review Audit By Locale

| Locale | Affected pairs |
| --- | ---: |
| ar | 1788 |
| as | 2831 |
| bn | 2691 |
| de | 1878 |
| es | 1903 |
| fr | 1848 |
| gu | 2778 |
| hi | 1468 |
| ja | 1863 |
| kn | 2818 |
| ml | 2815 |
| mr | 2811 |
| or | 2785 |
| pa | 2791 |
| pt | 1897 |
| sa | 2812 |
| te | 2817 |
| ur | 2677 |
| zh | 1874 |

## Files

- Actionable queue: `app/src/i18n/quality/humanReviewQueue.json`
- Native review audit: `app/src/i18n/quality/nativeReviewAudit.json`
- Stable UI discovery report: `artifacts/i18n/discovered-stable-ui-text.json`
- Summary JSON: `artifacts/i18n/human-review-queue-summary.json`
