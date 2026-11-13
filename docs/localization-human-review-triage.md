# Localization Human Review Triage

This report proves the large human-review queue is compressed without dropping any tracked locale/message pair. It does not certify native literary quality; it certifies catalog completeness, stable UI ownership, queue integrity, and review traceability.

## Machine Certification

- Stable UI candidates discovered: 398
- Uncovered stable UI candidates: 0
- Locale key coverage: 100% (105882/105882 required locale/message pairs)
- Required locales: 21
- Source message keys: 5042
- Missing locale/message pairs: 0
- Empty locale/message pairs: 0
- Duplicate review locale/id pairs: 0
- Grouped queue validation errors: 0

## Breakthrough Result

- Total tracked review pairs preserved: 90542
- Unique review locale/id pairs: 90542
- Actionable grouped queue entries: 128
- Actionable affected locale/message pairs: 1022
- Native-review audit grouped entries: 4471
- Native-review audit affected locale/message pairs: 89520

Actionable queue entries are unresolved English fallback or safety-review items. Native-review audit entries are structurally valid promotions kept visible for locale signoff without blocking machine QA.

## Actionable Priorities

| Priority | Grouped entries | Affected pairs | Locale spread |
| --- | ---: | ---: | --- |
| critical | 39 | 436 | bn 20, hi 20, te 22, mr 22, ur 22, gu 22, pa 22, ml 20, kn 22, or 22, as 20, sa 20, es 31, fr 31, de 30, ar 20, ja 22, pt 28, zh 20 |
| high | 10 | 16 | te 1, ml 1, kn 1, es 1, fr 3, de 5, ar 1, ja 1, pt 2 |
| medium | 48 | 513 | bn 25, hi 23, te 27, mr 25, ur 27, gu 26, pa 26, ml 25, kn 26, or 26, as 25, sa 26, es 30, fr 33, de 39, ar 23, ja 27, pt 29, zh 25 |
| low | 31 | 57 | te 1, ur 1, gu 1, kn 1, or 1, es 9, fr 15, de 21, ja 1, pt 5, zh 1 |

## Examples

| Priority | Risk | Affected pairs | Source message | Sample IDs |
| --- | --- | ---: | --- | --- |
| critical | high | 38 | you@example.com | desktopLogin.placeholder.email, login.placeholder.email |
| critical | high | 38 | n/a | admin.awsControl.value.notAvailableShort, admin.jsx.expression.n.a |
| critical | high | 38 | support@aura.shop | support.jsx.text.support.aura.shop.6e88e9bf, support.jsx.text.support.aura.shop.859c28ac |
| critical | high | 24 | UPI | checkout.payment.upiTitle, profile.payments.type.upi |
| critical | high | 19 | {sign} {amount} | checkout.paymentAdjustment.amount |
| critical | high | 19 | - {name} | checkout.payment.currency.option.name |
| critical | high | 19 | CLI | common.jsx.text.cli.d8cfa7cf |
| critical | high | 19 | CVV | checkout.jsx.text.cvv |
| high | high | 6 | AR | login.brand.initials |
| high | high | 2 | Status | orders.filters.status |
| high | high | 1 | Item | orders.invoice.item |
| high | high | 1 | Aura Status | common.jsx.text.aura.status.e81a8e71 |
| high | high | 1 | Aura Terminal | common.jsx.text.aura.terminal.2fded973 |
| high | high | 1 | Bangalore, 560001, India | common.jsx.text.bangalore.560001.india.029e9526 |
| high | high | 1 | Budget ( | common.jsx.text.budget.c9a30fc0 |
| high | high | 1 | Median | search.jsx.text.median.1e89a3f6 |
| medium | medium | 19 | ... | admin.shared.busy |
| medium | medium | 19 | N/A | compare.spec.notAvailable |
| medium | medium | 19 | {min} - {max} | filters.chip.price |
| medium | medium | 19 | {providerName} · {providerModel} | assistant.grounding.providerModel |
| medium | medium | 19 | ({label}) | profile.payments.addBank.saved.option |
| medium | medium | 19 | {dateLabel}: {label}, {uptime}{downtime} | status.uptime.dayStatusLabel |
| medium | medium | 19 | \| **** {last4} | profile.payments.method.last4Suffix |
| medium | medium | 19 | \| {brand} | profile.payments.method.brandSuffix |
| low | low | 7 | ID | admin.orders.table.id |
| low | low | 3 | Normal | profile.support.priority.normal |
| low | low | 3 | China | common.object.property.label.china |
| low | low | 3 | Hindi | common.object.property.label.hindi |
| low | low | 3 | Malayalam | common.object.property.label.malayalam |
| low | low | 3 | Odia | common.object.property.label.odia |
| low | low | 3 | Urdu | common.object.property.label.urdu |
| low | low | 2 | Action | admin.email.table.action, admin.users.timeline.action |

## Native Review Audit By Locale

| Locale | Affected pairs |
| --- | ---: |
| bn | 3683 |
| hi | 3685 |
| te | 4991 |
| mr | 4995 |
| ur | 3678 |
| gu | 4993 |
| pa | 4994 |
| ml | 4996 |
| kn | 4992 |
| or | 4993 |
| as | 4997 |
| sa | 4996 |
| es | 4971 |
| fr | 4960 |
| de | 4947 |
| ar | 3684 |
| ja | 4991 |
| pt | 4978 |
| zh | 4996 |

## Files

- Actionable queue: `app/src/i18n/quality/humanReviewQueue.json`
- Native review audit: `app/src/i18n/quality/nativeReviewAudit.json`
- Stable UI discovery report: `artifacts/i18n/discovered-stable-ui-text.json`
- Summary JSON: `artifacts/i18n/human-review-queue-summary.json`
