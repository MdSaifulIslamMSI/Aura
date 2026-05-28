# Payment Production Readiness Checklist

Manual gates before live mode:

- Processor account created.
- Hyperswitch merchant/profile configured.
- Hosted checkout or provider tokenization reviewed.
- Webhook URLs registered.
- Webhook signing secret stored in the approved secrets manager.
- PCI scope reviewed; app does not collect raw card numbers or CVV.
- Legal/tax review completed.
- Refund policy approved.
- Chargeback/dispute process defined.
- High-value refund approval process enabled.
- Monitoring dashboards checked.
- Alerts connected to on-call channel.
- Backup and restore tested.
- Reconciliation process tested.
- Staging smoke test passed.
- Live mode manually approved.

Do not enable `PAYMENT_MODE=live` until every item is complete.
