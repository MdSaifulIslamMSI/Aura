# Discovered Stable UI Text
Generated: 2026-09-11T20:12:19.472Z
## Summary
- Files scanned: 501
- Stable candidates: 418
- High risk: 146
- Medium risk: 28
- Low risk: 244
- Dynamic exclusions: 9
- False positives / non-production exclusions: 5833
- Parse errors: 0
## Stable Candidates
| Risk | Location | Classification | Text | Suggested ICU ID | Reason |
| --- | --- | --- | --- | --- | --- |
| high | `app/src/components/layout/Footer/index.jsx:59` | stable-ui-text | Payments | payment.object.property.name.payments | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/components/layout/Footer/index.jsx:61` | stable-ui-text | Cancellation & Returns | order.object.property.name.cancellation.returns | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/components/layout/Footer/index.jsx:66` | stable-ui-text | Return Policy | order.object.property.name.return.policy | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/components/layout/Footer/index.jsx:68` | stable-ui-text | Security | account.security.object.property.name.security | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/components/shared/AdminPremiumShell.jsx:37` | stable-ui-text | Payments | payment.object.property.label.payments | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/components/shared/AdminPremiumShell.jsx:38` | stable-ui-text | Refunds | payment.object.property.label.refunds | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:153` | stable-accessibility-text | Contact Aura Security and Support | account.security.accessibility.contact.aura.security.and.support | User-visible accessibility or assistive prop "title". | |
| high | `app/src/config/trustContent.js:154` | stable-ui-text | Reach the right team quickly for account security, order help, and marketplace issues. | order.object.property.summary.reach.the.right.team.quickly.for.account | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:157` | stable-ui-text | Security Operations Desk | account.security.object.property.heading.security.operations.desk | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:173` | stable-ui-text | Open Security Policy | account.security.object.property.label.open.security.policy | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:177` | stable-ui-text | Aura combines marketplace speed with security-first controls across login, payments, and orders. | payment.object.property.summary.aura.combines.marketplace.speed.with.security.first | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:180` | stable-ui-text | Security by Design | account.security.object.property.heading.security.by.design | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:199` | stable-accessibility-text | Careers in Security and Platform Engineering | account.security.accessibility.careers.in.security.and.platform.engineering | User-visible accessibility or assistive prop "title". | |
| high | `app/src/config/trustContent.js:223` | stable-ui-text | Read how the platform ships security upgrades and customer safeguards. | account.security.object.property.summary.read.how.the.platform.ships.security.upgrades | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:234` | stable-ui-text | Go to Security | account.security.object.property.label.go.to.security | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:237` | stable-accessibility-text | Press and Security Communications | account.security.accessibility.press.and.security.communications | User-visible accessibility or assistive prop "title". | |
| high | `app/src/config/trustContent.js:267` | stable-accessibility-text | Payments and Settlement Safeguards | payment.accessibility.payments.and.settlement.safeguards | User-visible accessibility or assistive prop "title". | |
| high | `app/src/config/trustContent.js:268` | stable-ui-text | How Aura protects digital payment flows and fallback options. | payment.object.property.summary.how.aura.protects.digital.payment.flows.and | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:287` | stable-ui-text | Open Security Hub | account.security.object.property.label.open.security.hub | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:302` | stable-ui-text | View Return Policy | order.object.property.label.view.return.policy | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:305` | stable-accessibility-text | Cancellation and Returns | order.accessibility.cancellation.and.returns | User-visible accessibility or assistive prop "title". | |
| high | `app/src/config/trustContent.js:306` | stable-ui-text | Return windows, cancellation behavior, and refund processing posture. | payment.object.property.summary.return.windows.cancellation.behavior.and.refund.processing | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:317` | stable-ui-text | Read Return Policy | order.object.property.label.read.return.policy | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:321` | stable-ui-text | Fast answers for account, checkout, payment, and security questions. | checkout.object.property.summary.fast.answers.for.account.checkout.payment.and | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:350` | stable-accessibility-text | Return Policy | order.accessibility.return.policy | User-visible accessibility or assistive prop "title". | |
| high | `app/src/config/trustContent.js:351` | stable-ui-text | Customer-friendly return guidance with consistency and compliance controls. | order.object.property.summary.customer.friendly.return.guidance.with.consistency.and | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:362` | stable-ui-text | Cancellation & Returns | order.object.property.label.cancellation.returns | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:380` | stable-accessibility-text | Security | account.security.accessibility.security | User-visible accessibility or assistive prop "title". | |
| high | `app/src/config/trustContent.js:381` | stable-ui-text | Aura security controls for account integrity, payments, and communications. | payment.object.property.summary.aura.security.controls.for.account.integrity.payments | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:400` | stable-ui-text | Security Advice | account.security.object.property.heading.security.advice | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:408` | stable-ui-text | Contact Security Support | account.security.object.property.label.contact.security.support | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/config/trustContent.js:412` | stable-ui-text | How Aura handles account and transaction data with security and purpose limits. | account.security.object.property.summary.how.aura.handles.account.and.transaction.data | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/Payments.jsx:26` | stable-ui-text | Settlement Amount | payment.object.property.label.settlement.amount | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/Payments.jsx:27` | stable-ui-text | Charge Amount | payment.object.property.label.charge.amount | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:41` | stable-ui-text | Auto | admin.object.property.label.auto | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:42` | stable-ui-text | Operational | admin.object.property.label.operational | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:43` | stable-ui-text | Degraded | admin.object.property.label.degraded | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:44` | stable-ui-text | Partial outage | admin.object.property.label.partial.outage | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:45` | stable-ui-text | Major outage | admin.object.property.label.major.outage | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:46` | stable-ui-text | Maintenance | admin.object.property.label.maintenance | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:57` | stable-ui-text | None | admin.object.property.label.none | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:58` | stable-ui-text | Minor | admin.object.property.label.minor | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:59` | stable-ui-text | Major | admin.object.property.label.major | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:60` | stable-ui-text | Critical | admin.object.property.label.critical | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:64` | stable-ui-text | Investigating | admin.object.property.label.investigating | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:65` | stable-ui-text | Identified | admin.object.property.label.identified | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:66` | stable-ui-text | Monitoring | admin.object.property.label.monitoring | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:67` | stable-ui-text | Resolved | admin.object.property.label.resolved | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:392` | stable-ui-text | Title | admin.jsx.prop.label.title | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:395` | stable-ui-text | Severity | admin.jsx.prop.label.severity | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:405` | stable-ui-text | Status | admin.jsx.prop.label.status | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:417` | stable-ui-text | Source | admin.jsx.prop.label.source | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:428` | stable-ui-text | Description | admin.jsx.prop.label.description | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Admin/StatusDashboard.jsx:470` | stable-ui-text | Title | admin.jsx.prop.label.title | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Checkout/components/StepPayment.jsx:73` | stable-ui-text | India | checkout.object.property.label.india | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Checkout/components/StepPayment.jsx:74` | stable-ui-text | United States | checkout.object.property.label.united.states | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Checkout/components/StepPayment.jsx:75` | stable-ui-text | United Kingdom | checkout.object.property.label.united.kingdom | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Checkout/components/StepPayment.jsx:76` | stable-ui-text | Germany | checkout.object.property.label.germany | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Checkout/components/StepPayment.jsx:77` | stable-ui-text | Australia | checkout.object.property.label.australia | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Checkout/components/StepPayment.jsx:78` | stable-ui-text | Canada | checkout.object.property.label.canada | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/pages/Checkout/components/StepPayment.jsx:79` | stable-ui-text | Japan | checkout.object.property.label.japan | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| high | `app/src/utils/authErrors.js:156` | stable-accessibility-text | Wrong Password | auth.accessibility.wrong.password | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:163` | stable-accessibility-text | Invalid Credentials | auth.accessibility.invalid.credentials | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:170` | stable-accessibility-text | Unable to Sign In | auth.accessibility.unable.to.sign.in | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:177` | stable-accessibility-text | Email Already Registered | auth.accessibility.email.already.registered | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:184` | stable-accessibility-text | Too Many Attempts | auth.accessibility.too.many.attempts | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:191` | stable-accessibility-text | Too Many Reset Attempts | auth.accessibility.too.many.reset.attempts | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:198` | stable-accessibility-text | Too Many Requests | auth.accessibility.too.many.requests | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:205` | stable-accessibility-text | Too Many Requests | auth.accessibility.too.many.requests | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:212` | stable-accessibility-text | Connection Problem | auth.accessibility.connection.problem | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:219` | stable-accessibility-text | Sign-In Cancelled | auth.accessibility.sign.in.cancelled | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:226` | stable-accessibility-text | Sign-In Cancelled | auth.accessibility.sign.in.cancelled | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:233` | stable-accessibility-text | Authentication Misconfigured | auth.accessibility.authentication.misconfigured | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:240` | stable-accessibility-text | Connection Problem | auth.accessibility.connection.problem | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:247` | stable-accessibility-text | Account Already Exists | auth.accessibility.account.already.exists | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:254` | stable-accessibility-text | Social Sign-In Failed | auth.accessibility.social.sign.in.failed | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:261` | stable-accessibility-text | Social Email Access Required | auth.accessibility.social.email.access.required | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:268` | stable-accessibility-text | Social Sign-In Needs Retry | auth.accessibility.social.sign.in.needs.retry | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:275` | stable-accessibility-text | Domain Not Authorized | auth.accessibility.domain.not.authorized | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:282` | stable-accessibility-text | Domain Not Authorized | auth.accessibility.domain.not.authorized | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:289` | stable-accessibility-text | Social Sign-In Disabled | auth.accessibility.social.sign.in.disabled | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:296` | stable-accessibility-text | Mobile Social Sign-In Not Ready | auth.accessibility.mobile.social.sign.in.not.ready | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:303` | stable-accessibility-text | Authentication Not Configured | auth.accessibility.authentication.not.configured | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:310` | stable-accessibility-text | Authentication Misconfigured | auth.accessibility.authentication.misconfigured | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:317` | stable-accessibility-text | Phone Verification Provider Unavailable | auth.accessibility.phone.verification.provider.unavailable | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:324` | stable-accessibility-text | Phone Verification Disabled | auth.accessibility.phone.verification.disabled | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:331` | stable-accessibility-text | Phone Verification Blocked | auth.accessibility.phone.verification.blocked | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:338` | stable-accessibility-text | Phone Verification Unavailable | auth.accessibility.phone.verification.unavailable | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:345` | stable-accessibility-text | Security Check Failed | auth.accessibility.security.check.failed | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:352` | stable-accessibility-text | Incorrect Code | auth.accessibility.incorrect.code | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:359` | stable-accessibility-text | Code Expired | auth.accessibility.code.expired | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:366` | stable-accessibility-text | Too Many OTP Requests | auth.accessibility.too.many.otp.requests | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:373` | stable-accessibility-text | Registered Phone Mismatch | auth.accessibility.registered.phone.mismatch | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:382` | stable-accessibility-text | Phone Verification Required | auth.accessibility.phone.verification.required | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:389` | stable-accessibility-text | Verified Phone Mismatch | auth.accessibility.verified.phone.mismatch | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:396` | stable-accessibility-text | Registered Phone Mismatch | auth.accessibility.registered.phone.mismatch | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:403` | stable-accessibility-text | Registered Email Mismatch | auth.accessibility.registered.email.mismatch | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:410` | stable-accessibility-text | Email Verification Required | auth.accessibility.email.verification.required | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:417` | stable-accessibility-text | Email Code Expired | auth.accessibility.email.code.expired | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:424` | stable-accessibility-text | Email Verification Required | auth.accessibility.email.verification.required | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:431` | stable-accessibility-text | Signup Verification Expired | auth.accessibility.signup.verification.expired | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:438` | stable-accessibility-text | Recovery Email Verification Required | auth.accessibility.recovery.email.verification.required | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:445` | stable-accessibility-text | Recovery Verification Expired | auth.accessibility.recovery.verification.expired | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:452` | stable-accessibility-text | Reset Verification Required | auth.accessibility.reset.verification.required | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:459` | stable-accessibility-text | Recovery Session Expired | auth.accessibility.recovery.session.expired | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:466` | stable-accessibility-text | Account Recovery Unavailable | auth.accessibility.account.recovery.unavailable | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:473` | stable-accessibility-text | Password Update Failed | auth.accessibility.password.update.failed | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:480` | stable-accessibility-text | Password Too Predictable | auth.accessibility.password.too.predictable | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:487` | stable-accessibility-text | Password Too Predictable | auth.accessibility.password.too.predictable | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:494` | stable-accessibility-text | Password Too Predictable | auth.accessibility.password.too.predictable | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:501` | stable-accessibility-text | Password Too Predictable | auth.accessibility.password.too.predictable | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:508` | stable-accessibility-text | Pending Signup Mismatch | auth.accessibility.pending.signup.mismatch | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:515` | stable-accessibility-text | Already Signed In | auth.accessibility.already.signed.in | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:522` | stable-accessibility-text | Account Not Ready | auth.accessibility.account.not.ready | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:529` | stable-accessibility-text | Verification Required | auth.accessibility.verification.required | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:536` | stable-accessibility-text | Verification Required | auth.accessibility.verification.required | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:543` | stable-accessibility-text | Verification Required | auth.accessibility.verification.required | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:550` | stable-accessibility-text | Email Already Registered | auth.accessibility.email.already.registered | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:557` | stable-accessibility-text | Phone Already Registered | auth.accessibility.phone.already.registered | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:564` | stable-accessibility-text | Incorrect Code | auth.accessibility.incorrect.code | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:571` | stable-accessibility-text | Code Expired | auth.accessibility.code.expired | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:578` | stable-accessibility-text | Session Mismatch | auth.accessibility.session.mismatch | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:585` | stable-accessibility-text | Phone Number Missing | auth.accessibility.phone.number.missing | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:592` | stable-accessibility-text | Incomplete Code | auth.accessibility.incomplete.code | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:599` | stable-accessibility-text | Account Temporarily Locked | auth.accessibility.account.temporarily.locked | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:607` | stable-accessibility-text | Password Too Short | auth.accessibility.password.too.short | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:614` | stable-accessibility-text | Passwords Don't Match | auth.accessibility.passwords.don.t.match | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:621` | stable-accessibility-text | Invalid Phone Number | auth.accessibility.invalid.phone.number | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:628` | stable-accessibility-text | Secure Sign-In Needs Retry | auth.accessibility.secure.sign.in.needs.retry | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:635` | stable-accessibility-text | Secure Sign-In Needs Retry | auth.accessibility.secure.sign.in.needs.retry | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:642` | stable-accessibility-text | Google Sign-In Failed | auth.accessibility.google.sign.in.failed | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:649` | stable-accessibility-text | Verification In Progress | auth.accessibility.verification.in.progress | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:656` | stable-accessibility-text | Couldn't Send Code | auth.accessibility.couldn.t.send.code | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:663` | stable-accessibility-text | Account Suspended | auth.accessibility.account.suspended | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:670` | stable-accessibility-text | Account Disabled | auth.accessibility.account.disabled | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:677` | stable-accessibility-text | Session Recovery Required | auth.accessibility.session.recovery.required | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:684` | stable-accessibility-text | Session Expired | auth.accessibility.session.expired | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:691` | stable-accessibility-text | Session Expired | auth.accessibility.session.expired | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:698` | stable-accessibility-text | Something Went Wrong | auth.accessibility.something.went.wrong | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:2899` | stable-accessibility-text | Code Sent! | auth.accessibility.code.sent | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:2903` | stable-accessibility-text | New Code Sent! | auth.accessibility.new.code.sent | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:2907` | stable-accessibility-text | Verified! | auth.accessibility.verified | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:2911` | stable-accessibility-text | Welcome Back! | auth.accessibility.welcome.back | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:2915` | stable-accessibility-text | Account Created! | auth.accessibility.account.created | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:2919` | stable-accessibility-text | Reset Email Sent! | auth.accessibility.reset.email.sent | User-visible accessibility or assistive prop "title". | |
| high | `app/src/utils/authErrors.js:2923` | stable-accessibility-text | Password Updated! | auth.accessibility.password.updated | User-visible accessibility or assistive prop "title". | |
| medium | `app/src/components/features/chat/MultimodalDock.jsx:261` | stable-ui-text | Cart | cart.jsx.text.cart | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| medium | `app/src/components/features/product/ProductCard/index.jsx:56` | stable-ui-text | Good Deal | product.object.property.label.good.deal | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| medium | `app/src/components/features/product/ProductCard/index.jsx:63` | stable-ui-text | Skip For Now | product.object.property.label.skip.for.now | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| medium | `app/src/components/layout/Navbar/NotificationDropdown.jsx:123` | stable-ui-text | Notifications | notification.jsx.text.notifications | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| medium | `app/src/components/shared/VoiceSearch.jsx:449` | stable-ui-text | Cart | cart.jsx.text.cart | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| medium | `app/src/config/trustContent.js:176` | stable-accessibility-text | About Aura Trust Standards | common.accessibility.about.aura.trust.standards | User-visible accessibility or assistive prop "title". | |
| medium | `app/src/config/trustContent.js:222` | stable-accessibility-text | Aura Stories: Trust and Reliability | common.accessibility.aura.stories.trust.and.reliability | User-visible accessibility or assistive prop "title". | |
| medium | `app/src/config/trustContent.js:252` | stable-accessibility-text | Corporate Information | common.accessibility.corporate.information | User-visible accessibility or assistive prop "title". | |
| medium | `app/src/config/trustContent.js:290` | stable-accessibility-text | Shipping and Delivery Assurance | common.accessibility.shipping.and.delivery.assurance | User-visible accessibility or assistive prop "title". | |
| medium | `app/src/config/trustContent.js:291` | stable-ui-text | Delivery promises, slot behavior, and reliability expectations. | common.object.property.summary.delivery.promises.slot.behavior.and.reliability.expectations | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| medium | `app/src/config/trustContent.js:294` | stable-ui-text | Delivery Commitments | common.object.property.heading.delivery.commitments | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| medium | `app/src/config/trustContent.js:320` | stable-accessibility-text | Frequently Asked Questions | common.accessibility.frequently.asked.questions | User-visible accessibility or assistive prop "title". | |
| medium | `app/src/config/trustContent.js:335` | stable-accessibility-text | Report Infringement and Abuse | common.accessibility.report.infringement.and.abuse | User-visible accessibility or assistive prop "title". | |
| medium | `app/src/config/trustContent.js:365` | stable-accessibility-text | Terms of Use | common.accessibility.terms.of.use | User-visible accessibility or assistive prop "title". | |
| medium | `app/src/config/trustContent.js:411` | stable-accessibility-text | Privacy Policy | common.accessibility.privacy.policy | User-visible accessibility or assistive prop "title". | |
| medium | `app/src/config/trustContent.js:426` | stable-accessibility-text | Sitemap | common.accessibility.sitemap | User-visible accessibility or assistive prop "title". | |
| medium | `app/src/config/trustContent.js:441` | stable-accessibility-text | EPR Compliance | common.accessibility.epr.compliance | User-visible accessibility or assistive prop "title". | |
| medium | `app/src/pages/Contact/index.jsx:109` | stable-ui-text | Aura could not finish resolving the commerce profile for this session. | profile.jsx.expression.aura.could.not.finish.resolving.the.commerce.493dfc | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| medium | `app/src/pages/Launch/index.jsx:372` | stable-ui-text | Profile updates and account posture consistency | profile.jsx.expression.profile.updates.and.account.posture.consistency.1a6d22 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| medium | `app/src/pages/MissionControl/index.jsx:303` | stable-ui-text | Optional image URL for visual search | search.jsx.expression.optional.image.url.for.visual.search | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| medium | `app/src/pages/ProductDetails/index.jsx:1634` | stable-ui-text | Frequently Bought Together | product.jsx.prop.label.frequently.bought.together.340cc3 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| medium | `app/src/pages/ProductDetails/index.jsx:1639` | stable-ui-text | Recently Viewed Recommendations | product.jsx.prop.label.recently.viewed.recommendations.6c4697 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| medium | `app/src/pages/Profile/index.jsx:125` | stable-ui-text | Home | profile.object.property.label.home | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| medium | `app/src/pages/Profile/index.jsx:126` | stable-ui-text | Work | profile.object.property.label.work | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| medium | `app/src/pages/Profile/index.jsx:127` | stable-ui-text | Other | profile.object.property.label.other | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| medium | `app/src/store/chatStore.js:186` | stable-ui-text | Ask about products, a cart review, support handoff, or a live app flow. I will keep the next step controlled. | support.object.property.text.ask.about.products.a.cart.review.support.a08711 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| medium | `app/src/utils/assistantCommands.js:10` | stable-ui-text | Cart | cart.object.property.label.cart | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| medium | `app/src/utils/commerceIntelligence.js:380` | stable-ui-text | Refine with visual search | search.object.property.label.refine.with.visual.search.783792 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/index.html:20` | stable-static-seo-template-text | Aura — Hybrid Marketplace | common.static.aura.hybrid.marketplace.0483ef | Static HTML, manifest, metadata, or template-facing text. | |
| low | `app/public/manifest.json:3` | stable-static-seo-template-text | Aura - Hybrid Marketplace | common.static.aura.hybrid.marketplace.4181cd | Static HTML, manifest, metadata, or template-facing text. | |
| low | `app/public/manifest.json:28` | stable-static-seo-template-text | Marketplace | common.static.marketplace | Static HTML, manifest, metadata, or template-facing text. | |
| low | `app/public/manifest.json:29` | stable-static-seo-template-text | Market | common.static.market | Static HTML, manifest, metadata, or template-facing text. | |
| low | `app/public/manifest.json:30` | stable-static-seo-template-text | Open Aura Marketplace. | common.static.open.aura.marketplace.8318fa | Static HTML, manifest, metadata, or template-facing text. | |
| low | `app/public/manifest.json:41` | stable-static-seo-template-text | Sell | common.static.sell | Static HTML, manifest, metadata, or template-facing text. | |
| low | `app/public/manifest.json:41` | stable-static-seo-template-text | Sell | common.static.sell | Static HTML, manifest, metadata, or template-facing text. | |
| low | `app/public/manifest.json:43` | stable-static-seo-template-text | Create a marketplace listing. | seller.static.create.a.marketplace.listing.c39fcf | Static HTML, manifest, metadata, or template-facing text. | |
| low | `app/public/manifest.json:54` | stable-static-seo-template-text | Orders | order.static.orders | Static HTML, manifest, metadata, or template-facing text. | |
| low | `app/public/manifest.json:54` | stable-static-seo-template-text | Orders | order.static.orders | Static HTML, manifest, metadata, or template-facing text. | |
| low | `app/public/manifest.json:56` | stable-static-seo-template-text | Review Aura orders. | order.static.review.aura.orders.90f498 | Static HTML, manifest, metadata, or template-facing text. | |
| low | `app/public/status-snapshot.html:6` | stable-static-seo-template-text | Aura Status Snapshot | common.static.aura.status.snapshot.65fe80 | Static HTML, manifest, metadata, or template-facing text. | |
| low | `app/src/components/features/chat/ConfirmationCard.jsx:29` | stable-ui-text | Please confirm before I continue. | common.jsx.expression.please.confirm.before.i.continue.ad6544 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/features/chat/ConfirmationCard.jsx:46` | stable-ui-text | Cancel | common.jsx.text.cancel | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/features/chat/MultimodalDock.jsx:97` | stable-ui-text | Open | common.jsx.text.open | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/features/chat/MultimodalDock.jsx:111` | stable-ui-text | Ready | common.jsx.expression.ready | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/features/chat/MultimodalDock.jsx:111` | stable-ui-text | Locked | common.jsx.expression.locked | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/features/chat/MultimodalDock.jsx:146` | stable-ui-text | Shopping flow | common.jsx.expression.shopping.flow.bd76f4 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/features/chat/MultimodalDock.jsx:198` | stable-ui-text | Launch with a clean voice prompt. | common.jsx.expression.launch.with.a.clean.voice.prompt.e5ca96 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/features/chat/MultimodalDock.jsx:254` | stable-ui-text | No explicit shopper brief yet. | common.jsx.expression.no.explicit.shopper.brief.yet.6b14c1 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/features/chat/MultimodalDock.jsx:264` | stable-ui-text | Intent | common.jsx.text.intent | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/features/chat/MultimodalDock.jsx:271` | stable-ui-text | Live | common.jsx.text.live | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/features/chat/MultimodalDock.jsx:284` | stable-ui-text | Session state updated. | common.jsx.expression.session.state.updated.bf88f8 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/features/chat/useAssistantController.js:704` | stable-ui-text | Okay, I will hold here. | common.object.property.text.okay.i.will.hold.here.f5c94e | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/features/video/VideoCallOverlay.jsx:310` | stable-ui-text | Voice call | common.jsx.expression.voice.call | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/features/video/VideoCallOverlay.jsx:310` | stable-ui-text | Video call | common.jsx.expression.video.call | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/features/video/VideoCallOverlay.jsx:363` | stable-ui-text | Back to app | common.jsx.text.back.to.app.167fc5 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/features/video/VideoCallOverlay.jsx:517` | stable-ui-text | Share screen | common.jsx.expression.share.screen.dfcc7b | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/features/video/VideoCallOverlay.jsx:580` | stable-ui-text | Back to app | common.jsx.text.back.to.app.167fc5 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Footer/index.jsx:51` | stable-ui-text | Contact Us | common.object.property.name.contact.us | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Footer/index.jsx:52` | stable-ui-text | About Us | common.object.property.name.about.us.21cdb0 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Footer/index.jsx:53` | stable-ui-text | Careers | common.object.property.name.careers.de32fa | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Footer/index.jsx:54` | stable-ui-text | Aura Stories | common.object.property.name.aura.stories.7ce2a4 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Footer/index.jsx:55` | stable-ui-text | Press | common.object.property.name.press.1dd64e | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Footer/index.jsx:56` | stable-ui-text | Corporate Information | common.object.property.name.corporate.information | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Footer/index.jsx:60` | stable-ui-text | Shipping | common.object.property.name.shipping | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Footer/index.jsx:62` | stable-ui-text | FAQ | common.object.property.name.faq.460d40 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Footer/index.jsx:63` | stable-ui-text | Report Infringement | common.object.property.name.report.infringement.f9aacb | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Footer/index.jsx:67` | stable-ui-text | Terms Of Use | common.object.property.name.terms.of.use.841091 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Footer/index.jsx:69` | stable-ui-text | Privacy | common.object.property.name.privacy.b55886 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Footer/index.jsx:70` | stable-ui-text | Sitemap | common.object.property.name.sitemap | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Footer/index.jsx:71` | stable-ui-text | EPR Compliance | common.object.property.name.epr.compliance | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Footer/index.jsx:177` | stable-ui-text | Healthy | common.accessibility.jsx.expression.healthy | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Footer/index.jsx:180` | stable-ui-text | Degraded | common.jsx.expression.degraded | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Footer/index.jsx:188` | stable-ui-text | Monitoring | common.jsx.expression.monitoring | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Navbar/index.jsx:133` | stable-ui-text | Live runtimes | common.jsx.text.live.runtimes | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Navbar/index.jsx:150` | stable-ui-text | Gateway | common.jsx.expression.gateway | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Navbar/index.jsx:150` | stable-ui-text | Switch | common.jsx.expression.switch.ecdce9 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Navbar/NotificationDropdown.jsx:144` | stable-ui-text | Close | notification.jsx.text.close | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Navbar/NotificationDropdown.jsx:155` | stable-ui-text | Loading logs... | notification.jsx.text.loading.logs | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/layout/Navbar/NotificationDropdown.jsx:209` | stable-ui-text | View details | notification.jsx.expression.view.details | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/shared/AdminPremiumShell.jsx:34` | stable-ui-text | Dashboard | admin.object.property.label.dashboard | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/shared/AdminPremiumShell.jsx:35` | stable-ui-text | Products | admin.object.property.label.products | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/shared/AdminPremiumShell.jsx:36` | stable-ui-text | Orders | order.object.property.label.orders | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/shared/AdminPremiumShell.jsx:39` | stable-ui-text | Email Ops | admin.object.property.label.email.ops | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/shared/AdminPremiumShell.jsx:40` | stable-ui-text | Users | admin.object.property.label.users | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/shared/AdminPremiumShell.jsx:41` | stable-ui-text | Support | support.object.property.label.support | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/shared/AdminPremiumShell.jsx:42` | stable-ui-text | Status | admin.object.property.label.status | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/shared/AppErrorBoundary.jsx:61` | stable-ui-text | Refresh Page | common.validation.jsx.text.refresh.page | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/shared/MobileUpdateBanner.jsx:96` | stable-ui-text | Update check needs another try | common.jsx.text.update.check.needs.another.try.86cb82 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/shared/VoiceSearch.jsx:433` | stable-ui-text | Shopping flow | search.jsx.expression.shopping.flow.f11768 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/components/shared/VoiceSearch.jsx:452` | stable-ui-text | Intent | search.jsx.text.intent | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/config/figmaTokens.js:4` | stable-ui-text | Neo Cyan | common.object.property.label.neo.cyan.3b258c | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/config/figmaTokens.js:5` | stable-ui-text | Violet Storm | common.object.property.label.violet.storm.34825a | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/config/figmaTokens.js:6` | stable-ui-text | Emerald Wave | common.object.property.label.emerald.wave.6621b3 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/config/figmaTokens.js:7` | stable-ui-text | Sunset Pulse | common.object.property.label.sunset.pulse.d8c898 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/config/figmaTokens.js:8` | stable-ui-text | Stylish White | common.object.property.label.stylish.white.6f37dc | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/config/figmaTokens.js:9` | stable-ui-text | Aqua Frost | common.object.property.label.aqua.frost.18ccfe | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/config/figmaTokens.js:10` | stable-ui-text | Ruby Flame | common.object.property.label.ruby.flame.cc45dd | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/config/figmaTokens.js:11` | stable-ui-text | Midnight Sapphire | common.object.property.label.midnight.sapphire.b08701 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/config/figmaTokens.js:12` | stable-ui-text | Golden Ember | common.object.property.label.golden.ember.2f1465 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/config/figmaTokens.js:13` | stable-ui-text | Monochrome Steel | common.object.property.label.monochrome.steel.7bfce1 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/config/marketConfig.js:10` | stable-ui-text | Pseudo locale | common.object.property.label.pseudo.locale.2a84f8 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/config/marketConfig.js:61` | stable-ui-text | English | common.object.property.label.english.9fc100 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/config/marketConfig.js:62` | stable-ui-text | Bengali | common.object.property.label.bengali.7e9faa | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | `app/src/config/marketConfig.js:63` | stable-ui-text | Hindi | common.object.property.label.hindi.fb01f2 | Stable user-visible UI text outside an ICU/FormatJS lookup. | |
| low | ... | ... | 168 more candidates in JSON report | ... | ... |