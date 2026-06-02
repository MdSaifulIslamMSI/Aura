# Localization Human Review Triage

This report proves the large human-review queue is compressed without dropping any tracked locale/message pair. It does not certify native literary quality; it certifies catalog completeness, stable UI ownership, queue integrity, and review traceability.

## Machine Certification

- Stable UI candidates discovered: 416
- Uncovered stable UI candidates: 0
- Locale key coverage: 100% (83370/83370 required locale/message pairs)
- Required locales: 21
- Source message keys: 3970
- Missing locale/message pairs: 0
- Empty locale/message pairs: 0
- Duplicate review locale/id pairs: 0
- Grouped queue validation errors: 0

## Breakthrough Result

- Total tracked review pairs preserved: 74834
- Unique review locale/id pairs: 74834
- Actionable grouped queue entries: 2462
- Actionable affected locale/message pairs: 29689
- Native-review audit grouped entries: 2488
- Native-review audit affected locale/message pairs: 45145

Actionable queue entries are unresolved English fallback or safety-review items. Native-review audit entries are structurally valid promotions kept visible for locale signoff without blocking machine QA.

## Actionable Priorities

| Priority | Grouped entries | Affected pairs | Locale spread |
| --- | ---: | ---: | --- |
| critical | 808 | 13024 | ar 750, as 617, bn 608, de 777, es 758, fr 790, gu 641, hi 780, ja 776, kn 620, ml 621, mr 626, or 635, pa 633, pt 770, sa 621, te 620, ur 610, zh 771 |
| high | 218 | 887 | ar 78, as 4, bn 7, de 81, es 75, fr 82, gu 11, hi 209, ja 82, kn 12, ml 15, mr 12, or 19, pa 13, pt 76, sa 7, te 12, ur 13, zh 79 |
| medium | 899 | 12355 | ar 793, as 517, bn 513, de 825, es 826, fr 835, gu 538, hi 835, ja 837, kn 518, ml 518, mr 519, or 529, pa 532, pt 819, sa 527, te 520, ur 519, zh 835 |
| low | 537 | 3423 | ar 412, as 1, bn 2, de 409, es 408, fr 415, gu 2, hi 529, ja 412, kn 2, ml 1, mr 2, or 2, pa 1, pt 408, sa 3, te 1, ur 2, zh 411 |

## Examples

| Priority | Risk | Affected pairs | Source message | Sample IDs |
| --- | --- | ---: | --- | --- |
| critical | high | 18 | , this gateway can be the calm handoff layer above both live storefronts instead of a rough technical switchboard living inside one of them. | common.jsx.text.this.gateway.can.be.the.calm.handoff.f648ea99, common.jsx.text.this.gateway.can.be.the.calm.handoff.f648ea99, common.jsx.text.this.gateway.can.be.the.calm.handoff.f648ea99, common.jsx.text.this.gateway.can.be.the.calm.handoff.f648ea99, common.jsx.text.this.gateway.can.be.the.calm.handoff.f648ea99 | |
| critical | high | 19 | · Commit | common.jsx.text.commit.301904c6, common.jsx.text.commit.301904c6, common.jsx.text.commit.301904c6, common.jsx.text.commit.301904c6, common.jsx.text.commit.301904c6 | |
| critical | high | 18 | · Source | common.jsx.text.source.1a933962, common.jsx.text.source.1a933962, common.jsx.text.source.1a933962, common.jsx.text.source.1a933962, common.jsx.text.source.1a933962 | |
| critical | high | 7 | {category} picks sorted by live catalog signals, delivery, and price movement. | listing.categoryDeskBody, listing.categoryDeskBody, listing.categoryDeskBody, listing.categoryDeskBody, listing.categoryDeskBody | |
| critical | high | 4 | {code} applied | checkout.applied, checkout.applied, checkout.applied, checkout.applied | |
| critical | high | 7 | {connected} live calls are already connected across your support threads. | profile.support.arch.liveLanesBody, profile.support.arch.liveLanesBody, profile.support.arch.liveLanesBody, profile.support.arch.liveLanesBody, profile.support.arch.liveLanesBody | |
| critical | high | 7 | {count} active backup codes | profile.settings.security.recoveryCodesCount, profile.settings.security.recoveryCodesCount, profile.settings.security.recoveryCodesCount, profile.settings.security.recoveryCodesCount, profile.settings.security.recoveryCodesCount | |
| critical | high | 10 | {count} apps live{apps}{flows} | checkout.payment.rail.upiFormat, checkout.payment.rail.upiFormat, checkout.payment.rail.upiFormat, checkout.payment.rail.upiFormat, checkout.payment.rail.upiFormat | |
| high | high | 8 | 2-4 days | cart.defaultDeliveryWindow, cart.defaultDeliveryWindow, cart.defaultDeliveryWindow, cart.defaultDeliveryWindow, cart.defaultDeliveryWindow | |
| high | high | 1 | A live lane is active. | common.jsx.expression.a.live.lane.is.active.e6c9da1a | |
| high | high | 1 | A live lane is already active. | common.jsx.expression.a.live.lane.is.already.active.112f9357 | |
| high | high | 8 | active filters | listing.statsSignalsBody, listing.statsSignalsBody, listing.statsSignalsBody, listing.statsSignalsBody, listing.statsSignalsBody | |
| high | high | 1 | Active Orders | orders.summary.active.label | |
| high | high | 1 | Active route | common.jsx.text.active.route.adea24bd | |
| high | high | 8 | Additional payment verification was requested. | orders.payment.timeline.challengeBody, orders.payment.timeline.challengeBody, orders.payment.timeline.challengeBody, orders.payment.timeline.challengeBody, orders.payment.timeline.challengeBody | |
| high | high | 8 | All items ready | cart.allItemsReady, cart.allItemsReady, cart.allItemsReady, cart.allItemsReady, cart.allItemsReady | |
| medium | medium | 19 | : Rs | common.jsx.text.rs.81723069, common.jsx.text.rs.81723069, common.jsx.text.rs.81723069, common.jsx.text.rs.81723069, common.jsx.text.rs.81723069 | |
| medium | medium | 19 | ... | admin.shared.busy, admin.shared.busy, admin.shared.busy, admin.shared.busy, admin.shared.busy | |
| medium | medium | 19 | {bucket}: {value} | admin.dashboard.timelinePoint.title, admin.dashboard.timelinePoint.title, admin.dashboard.timelinePoint.title, admin.dashboard.timelinePoint.title, admin.dashboard.timelinePoint.title | |
| medium | medium | 4 | {category} lane | marketplace.hero.categoryLane, marketplace.hero.categoryLane, marketplace.hero.categoryLane, marketplace.hero.categoryLane | |
| medium | medium | 8 | {connected} connected and {queued} preparing or queued. | admin.support.arch.liveLanesBody, admin.support.arch.liveLanesBody, admin.support.arch.liveLanesBody, admin.support.arch.liveLanesBody, admin.support.arch.liveLanesBody | |
| medium | medium | 1 | {count} active | marketplace.filters.activeCount | |
| medium | medium | 11 | {count} AP | nav.auraPoints, nav.auraPoints, nav.auraPoints, nav.auraPoints, nav.auraPoints | |
| medium | medium | 8 | {count} critical unread | admin.dashboard.stats.criticalUnread, admin.dashboard.stats.criticalUnread, admin.dashboard.stats.criticalUnread, admin.dashboard.stats.criticalUnread, admin.dashboard.stats.criticalUnread | |
| low | low | 8 | A few account and checkout actions may take an extra moment while everything reconnects. | status.banner.warmingMessage, status.banner.warmingMessage, status.banner.warmingMessage, status.banner.warmingMessage, status.banner.warmingMessage | |
| low | low | 1 | Account standing | profile.overview.standing.label | |
| low | low | 8 | Account, checkout, or support actions are temporarily unavailable. Please try again in a moment. | status.banner.unavailableMessage, status.banner.unavailableMessage, status.banner.unavailableMessage, status.banner.unavailableMessage, status.banner.unavailableMessage | |
| low | low | 8 | Action completed | admin.users.action.completed, admin.users.action.completed, admin.users.action.completed, admin.users.action.completed, admin.users.action.completed | |
| low | low | 8 | Action failed | admin.users.error.actionFailed, admin.users.error.actionFailed, admin.users.error.actionFailed, admin.users.error.actionFailed, admin.users.error.actionFailed | |
| low | low | 8 | Action Power Map | admin.users.panels.actionPowerMap, admin.users.panels.actionPowerMap, admin.users.panels.actionPowerMap, admin.users.panels.actionPowerMap, admin.users.panels.actionPowerMap | |
| low | low | 4 | Actions | admin.shared.actions, admin.shared.actions, admin.shared.actions, admin.shared.actions | |
| low | low | 2 | Active Alerts | priceAlerts.active.title, priceAlerts.stats.active | |

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
