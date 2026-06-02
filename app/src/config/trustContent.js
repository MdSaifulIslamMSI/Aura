import { defineMessages } from 'react-intl';

const TRUST_LAST_UPDATED = 'March 1, 2026';

const trustContentMessages = defineMessages({
  ContactTitle: { id: "trust.contact.title", defaultMessage: "Contact Aura Security and Support" },
  ContactSummary: { id: "trust.contact.summary", defaultMessage: "Reach the right team quickly for account security, order help, and marketplace issues." },
  ContactSection0Heading: { id: "trust.contact.sections.0.heading", defaultMessage: "Security Operations Desk" },
  ContactSection0Point0: { id: "trust.contact.sections.0.points.0", defaultMessage: "Report account takeover, suspicious OTP, or payment concerns immediately." },
  ContactSection0Point1: { id: "trust.contact.sections.0.points.1", defaultMessage: "High-priority incidents are triaged continuously by the security support channel." },
  ContactSection0Point2: { id: "trust.contact.sections.0.points.2", defaultMessage: "Use only official Aura channels listed here. We never ask OTP in chat or calls." },
  ContactSection1Heading: { id: "trust.contact.sections.1.heading", defaultMessage: "Support Channels" },
  ContactCtaLabel: { id: "trust.contact.cta.label", defaultMessage: "Open Security Policy" },
  AboutTitle: { id: "trust.about.title", defaultMessage: "About Aura Trust Standards" },
  AboutSummary: { id: "trust.about.summary", defaultMessage: "Aura combines marketplace speed with security-first controls across login, payments, and orders." },
  AboutSection0Heading: { id: "trust.about.sections.0.heading", defaultMessage: "Security by Design" },
  AboutSection0Point0: { id: "trust.about.sections.0.points.0", defaultMessage: "OTP login protections with lockout, purpose checks, and anti-replay controls." },
  AboutSection0Point1: { id: "trust.about.sections.0.points.1", defaultMessage: "Server-authoritative checkout and pricing validation before order confirmation." },
  AboutSection0Point2: { id: "trust.about.sections.0.points.2", defaultMessage: "Idempotent payment and order operations to protect from duplicate processing." },
  AboutSection1Heading: { id: "trust.about.sections.1.heading", defaultMessage: "Operational Reliability" },
  AboutSection1Point0: { id: "trust.about.sections.1.points.0", defaultMessage: "Durable order email queue with retries and failure audit trails." },
  AboutSection1Point1: { id: "trust.about.sections.1.points.1", defaultMessage: "Payment lifecycle tracking with reconciliation-ready event states." },
  AboutSection1Point2: { id: "trust.about.sections.1.points.2", defaultMessage: "Continuous monitoring via service health checks and platform telemetry." },
  AboutCtaLabel: { id: "trust.about.cta.label", defaultMessage: "Read Privacy Policy" },
  CareersTitle: { id: "trust.careers.title", defaultMessage: "Careers in Security and Platform Engineering" },
  CareersSummary: { id: "trust.careers.summary", defaultMessage: "Help build resilient commerce systems focused on trust, safety, and scale." },
  CareersSection0Heading: { id: "trust.careers.sections.0.heading", defaultMessage: "Core Focus Areas" },
  CareersSection0Point0: { id: "trust.careers.sections.0.points.0", defaultMessage: "Identity and account protection" },
  CareersSection0Point1: { id: "trust.careers.sections.0.points.1", defaultMessage: "Payments integrity and fraud controls" },
  CareersSection0Point2: { id: "trust.careers.sections.0.points.2", defaultMessage: "Marketplace policy enforcement and abuse detection" },
  CareersSection1Heading: { id: "trust.careers.sections.1.heading", defaultMessage: "Hiring Signals" },
  CareersSection1Point0: { id: "trust.careers.sections.1.points.0", defaultMessage: "Strong systems thinking and operational discipline" },
  CareersSection1Point1: { id: "trust.careers.sections.1.points.1", defaultMessage: "Secure coding and incident response readiness" },
  CareersSection1Point2: { id: "trust.careers.sections.1.points.2", defaultMessage: "Ownership mindset for reliability and customer trust" },
  CareersCtaLabel: { id: "trust.careers.cta.label", defaultMessage: "Contact Us" },
  StoriesTitle: { id: "trust.stories.title", defaultMessage: "Aura Stories: Trust and Reliability" },
  StoriesSummary: { id: "trust.stories.summary", defaultMessage: "Read how the platform ships security upgrades and customer safeguards." },
  StoriesSection0Heading: { id: "trust.stories.sections.0.heading", defaultMessage: "Recent Focus" },
  StoriesSection0Point0: { id: "trust.stories.sections.0.points.0", defaultMessage: "OTP email hardening and fail-closed delivery behavior." },
  StoriesSection0Point1: { id: "trust.stories.sections.0.points.1", defaultMessage: "Payment security integration with risk controls and audit trails." },
  StoriesSection0Point2: { id: "trust.stories.sections.0.points.2", defaultMessage: "Checkout reliability improvements with backend-authoritative quotes." },
  StoriesCtaLabel: { id: "trust.stories.cta.label", defaultMessage: "Go to Security" },
  PressTitle: { id: "trust.press.title", defaultMessage: "Press and Security Communications" },
  PressSummary: { id: "trust.press.summary", defaultMessage: "Official notices related to platform trust, compliance, and policy updates." },
  PressSection0Heading: { id: "trust.press.sections.0.heading", defaultMessage: "Media Guidance" },
  PressSection0Point0: { id: "trust.press.sections.0.points.0", defaultMessage: "Use only verified Aura channels for public statements." },
  PressSection0Point1: { id: "trust.press.sections.0.points.1", defaultMessage: "Security incident updates are communicated with validated timelines." },
  PressSection0Point2: { id: "trust.press.sections.0.points.2", defaultMessage: "Customer protection guidance is prioritized in all advisories." },
  PressCtaLabel: { id: "trust.press.cta.label", defaultMessage: "Read Terms" },
  CorporateTitle: { id: "trust.corporate.title", defaultMessage: "Corporate Information" },
  CorporateSummary: { id: "trust.corporate.summary", defaultMessage: "Organizational and compliance information supporting platform trust." },
  CorporateSection0Heading: { id: "trust.corporate.sections.0.heading", defaultMessage: "Governance Priorities" },
  CorporateSection0Point0: { id: "trust.corporate.sections.0.points.0", defaultMessage: "User safety and account integrity" },
  CorporateSection0Point1: { id: "trust.corporate.sections.0.points.1", defaultMessage: "Payment and order reliability" },
  CorporateSection0Point2: { id: "trust.corporate.sections.0.points.2", defaultMessage: "Transparent policy operations" },
  CorporateCtaLabel: { id: "trust.corporate.cta.label", defaultMessage: "Read EPR Compliance" },
  PaymentsTitle: { id: "trust.payments.title", defaultMessage: "Payments and Settlement Safeguards" },
  PaymentsSummary: { id: "trust.payments.summary", defaultMessage: "How Aura protects digital payment flows and fallback options." },
  PaymentsSection0Heading: { id: "trust.payments.sections.0.heading", defaultMessage: "Protection Layers" },
  PaymentsSection0Point0: { id: "trust.payments.sections.0.points.0", defaultMessage: "Server-side amount validation before order acceptance." },
  PaymentsSection0Point1: { id: "trust.payments.sections.0.points.1", defaultMessage: "Risk-aware payment controls and challenge support paths." },
  PaymentsSection0Point2: { id: "trust.payments.sections.0.points.2", defaultMessage: "Retry-safe idempotency protections on critical payment mutations." },
  PaymentsSection1Heading: { id: "trust.payments.sections.1.heading", defaultMessage: "Fallback and Recovery" },
  PaymentsSection1Point0: { id: "trust.payments.sections.1.points.0", defaultMessage: "COD fallback where applicable." },
  PaymentsSection1Point1: { id: "trust.payments.sections.1.points.1", defaultMessage: "Operational handling for failures, pending states, and retries." },
  PaymentsSection1Point2: { id: "trust.payments.sections.1.points.2", defaultMessage: "Audit-linked events for support investigations." },
  PaymentsCtaLabel: { id: "trust.payments.cta.label", defaultMessage: "Open Security Hub" },
  ShippingTitle: { id: "trust.shipping.title", defaultMessage: "Shipping and Delivery Assurance" },
  ShippingSummary: { id: "trust.shipping.summary", defaultMessage: "Delivery promises, slot behavior, and reliability expectations." },
  ShippingSection0Heading: { id: "trust.shipping.sections.0.heading", defaultMessage: "Delivery Commitments" },
  ShippingSection0Point0: { id: "trust.shipping.sections.0.points.0", defaultMessage: "Delivery options are validated during checkout quote." },
  ShippingSection0Point1: { id: "trust.shipping.sections.0.points.1", defaultMessage: "Address and slot selections are normalized server-side." },
  ShippingSection0Point2: { id: "trust.shipping.sections.0.points.2", defaultMessage: "Post-order tracking visibility is surfaced in order timelines." },
  ShippingCtaLabel: { id: "trust.shipping.cta.label", defaultMessage: "View Return Policy" },
  ReturnsTitle: { id: "trust.returns.title", defaultMessage: "Cancellation and Returns" },
  ReturnsSummary: { id: "trust.returns.summary", defaultMessage: "Return windows, cancellation behavior, and refund processing posture." },
  ReturnsSection0Heading: { id: "trust.returns.sections.0.heading", defaultMessage: "Policy Summary" },
  ReturnsSection0Point0: { id: "trust.returns.sections.0.points.0", defaultMessage: "Return eligibility depends on category and order state." },
  ReturnsSection0Point1: { id: "trust.returns.sections.0.points.1", defaultMessage: "Cancellation windows are visible in order workflows." },
  ReturnsSection0Point2: { id: "trust.returns.sections.0.points.2", defaultMessage: "Refund operations follow controlled payment-state transitions." },
  ReturnsCtaLabel: { id: "trust.returns.cta.label", defaultMessage: "Read Return Policy" },
  FaqTitle: { id: "trust.faq.title", defaultMessage: "Frequently Asked Questions" },
  FaqSummary: { id: "trust.faq.summary", defaultMessage: "Fast answers for account, checkout, payment, and security questions." },
  FaqSection0Heading: { id: "trust.faq.sections.0.heading", defaultMessage: "Top Questions" },
  FaqSection0Point0: { id: "trust.faq.sections.0.points.0", defaultMessage: "Why did I receive an OTP email?" },
  FaqSection0Point1: { id: "trust.faq.sections.0.points.1", defaultMessage: "How do I secure my account if OTP was not requested by me?" },
  FaqSection0Point2: { id: "trust.faq.sections.0.points.2", defaultMessage: "How do payment retries and fallback options work?" },
  FaqCtaLabel: { id: "trust.faq.cta.label", defaultMessage: "Contact Support" },
  ReportTitle: { id: "trust.report.title", defaultMessage: "Report Infringement and Abuse" },
  ReportSummary: { id: "trust.report.summary", defaultMessage: "Report policy violations, abuse, or suspicious marketplace activity." },
  ReportSection0Heading: { id: "trust.report.sections.0.heading", defaultMessage: "What to Include" },
  ReportSection0Point0: { id: "trust.report.sections.0.points.0", defaultMessage: "Listing links, order references, and timestamps." },
  ReportSection0Point1: { id: "trust.report.sections.0.points.1", defaultMessage: "Clear description of suspected violation." },
  ReportSection0Point2: { id: "trust.report.sections.0.points.2", defaultMessage: "Contact details for follow-up if required." },
  ReportCtaLabel: { id: "trust.report.cta.label", defaultMessage: "Go to Contact" },
  ReturnPolicyTitle: { id: "trust.return-policy.title", defaultMessage: "Return Policy" },
  ReturnPolicySummary: { id: "trust.return-policy.summary", defaultMessage: "Customer-friendly return guidance with consistency and compliance controls." },
  ReturnPolicySection0Heading: { id: "trust.return-policy.sections.0.heading", defaultMessage: "Eligibility Principles" },
  ReturnPolicySection0Point0: { id: "trust.return-policy.sections.0.points.0", defaultMessage: "Item condition and category rules determine eligibility." },
  ReturnPolicySection0Point1: { id: "trust.return-policy.sections.0.points.1", defaultMessage: "Time-bound windows are enforced by order state." },
  ReturnPolicySection0Point2: { id: "trust.return-policy.sections.0.points.2", defaultMessage: "Certain categories may have non-returnable constraints." },
  ReturnPolicyCtaLabel: { id: "trust.return-policy.cta.label", defaultMessage: "Cancellation & Returns" },
  TermsTitle: { id: "trust.terms.title", defaultMessage: "Terms of Use" },
  TermsSummary: { id: "trust.terms.summary", defaultMessage: "Platform terms for account usage, transactions, and marketplace conduct." },
  TermsSection0Heading: { id: "trust.terms.sections.0.heading", defaultMessage: "Core Terms" },
  TermsSection0Point0: { id: "trust.terms.sections.0.points.0", defaultMessage: "Use the platform only through authorized and lawful behavior." },
  TermsSection0Point1: { id: "trust.terms.sections.0.points.1", defaultMessage: "Do not attempt fraud, account abuse, or data misuse." },
  TermsSection0Point2: { id: "trust.terms.sections.0.points.2", defaultMessage: "Transactions are governed by checkout, payment, and policy controls." },
  TermsCtaLabel: { id: "trust.terms.cta.label", defaultMessage: "Read Privacy Policy" },
  SecurityTitle: { id: "trust.security.title", defaultMessage: "Security" },
  SecuritySummary: { id: "trust.security.summary", defaultMessage: "Aura security controls for account integrity, payments, and communications." },
  SecuritySection0Heading: { id: "trust.security.sections.0.heading", defaultMessage: "Account Protection" },
  SecuritySection0Point0: { id: "trust.security.sections.0.points.0", defaultMessage: "OTP checks include purpose validation, expiry windows, and anti-replay handling." },
  SecuritySection0Point1: { id: "trust.security.sections.0.points.1", defaultMessage: "Failed attempts trigger lockouts to reduce brute-force risk." },
  SecuritySection0Point2: { id: "trust.security.sections.0.points.2", defaultMessage: "Security notifications include request context and anti-phishing guidance." },
  SecuritySection1Heading: { id: "trust.security.sections.1.heading", defaultMessage: "Transaction Protection" },
  SecuritySection1Point0: { id: "trust.security.sections.1.points.0", defaultMessage: "Pricing and totals are validated server-side before order creation." },
  SecuritySection1Point1: { id: "trust.security.sections.1.points.1", defaultMessage: "Payment state is controlled by backend validations and idempotent operations." },
  SecuritySection1Point2: { id: "trust.security.sections.1.points.2", defaultMessage: "Order confirmation email delivery uses durable retry-safe processing." },
  SecuritySection2Heading: { id: "trust.security.sections.2.heading", defaultMessage: "Security Advice" },
  SecuritySection2Point0: { id: "trust.security.sections.2.points.0", defaultMessage: "Never share OTP codes with anyone." },
  SecuritySection2Point1: { id: "trust.security.sections.2.points.1", defaultMessage: "Reset your password immediately if you detect suspicious activity." },
  SecuritySection2Point2: { id: "trust.security.sections.2.points.2", defaultMessage: "Use only official Aura support channels." },
  SecurityCtaLabel: { id: "trust.security.cta.label", defaultMessage: "Contact Security Support" },
  PrivacyTitle: { id: "trust.privacy.title", defaultMessage: "Privacy Policy" },
  PrivacySummary: { id: "trust.privacy.summary", defaultMessage: "How Aura handles account and transaction data with security and purpose limits." },
  PrivacySection0Heading: { id: "trust.privacy.sections.0.heading", defaultMessage: "Privacy Commitments" },
  PrivacySection0Point0: { id: "trust.privacy.sections.0.points.0", defaultMessage: "Data is processed for account security, transaction reliability, and support." },
  PrivacySection0Point1: { id: "trust.privacy.sections.0.points.1", defaultMessage: "Sensitive fields are restricted from standard responses and logs." },
  PrivacySection0Point2: { id: "trust.privacy.sections.0.points.2", defaultMessage: "Operational events are retained for audit and abuse prevention." },
  PrivacyCtaLabel: { id: "trust.privacy.cta.label", defaultMessage: "Read Terms" },
  SitemapTitle: { id: "trust.sitemap.title", defaultMessage: "Sitemap" },
  SitemapSummary: { id: "trust.sitemap.summary", defaultMessage: "Quick links to key marketplace, account, and trust destinations." },
  SitemapSection0Heading: { id: "trust.sitemap.sections.0.heading", defaultMessage: "Key Routes" },
  SitemapCtaLabel: { id: "trust.sitemap.cta.label", defaultMessage: "Go to Marketplace" },
  EprTitle: { id: "trust.epr.title", defaultMessage: "EPR Compliance" },
  EprSummary: { id: "trust.epr.summary", defaultMessage: "Environmental responsibility and compliance orientation for marketplace operations." },
  EprSection0Heading: { id: "trust.epr.sections.0.heading", defaultMessage: "Compliance Highlights" },
  EprSection0Point0: { id: "trust.epr.sections.0.points.0", defaultMessage: "Policy-aligned disposal and recycling commitments." },
  EprSection0Point1: { id: "trust.epr.sections.0.points.1", defaultMessage: "Consumer awareness and support guidance." },
  EprSection0Point2: { id: "trust.epr.sections.0.points.2", defaultMessage: "Program updates reflected in legal and compliance content." },
  EprCtaLabel: { id: "trust.epr.cta.label", defaultMessage: "Back to Legal" },
});

const getTrustMessagePrefix = (key = 'security') => key.replace(/(^|-)([a-z])/g, (_, _dash, char) => char.toUpperCase());

const formatTrustContentMessage = (intl, descriptorName, fallback) => {
  const descriptor = trustContentMessages[descriptorName];
  return descriptor && intl?.formatMessage ? intl.formatMessage(descriptor) : fallback;
};
export const trustContent = {
  contact: {
    title: 'Contact Aura Security and Support',
    summary: 'Reach the right team quickly for account security, order help, and marketplace issues.',
    sections: [
      {
        heading: 'Security Operations Desk',
        points: [
          'Report account takeover, suspicious OTP, or payment concerns immediately.',
          'High-priority incidents are triaged continuously by the security support channel.',
          'Use only official Aura channels listed here. We never ask OTP in chat or calls.',
        ],
      },
      {
        heading: 'Support Channels',
        points: [
          'Email: support@aura.shop',
          'Helpline: 1-800-AURA-01',
          'HQ: Aura Global HQ, Tower 7, Innovation District, Bangalore, 560001, India',
        ],
      },
    ],
    cta: { label: 'Open Security Policy', to: '/security' },
  },
  about: {
    title: 'About Aura Trust Standards',
    summary: 'Aura combines marketplace speed with security-first controls across login, payments, and orders.',
    sections: [
      {
        heading: 'Security by Design',
        points: [
          'OTP login protections with lockout, purpose checks, and anti-replay controls.',
          'Server-authoritative checkout and pricing validation before order confirmation.',
          'Idempotent payment and order operations to protect from duplicate processing.',
        ],
      },
      {
        heading: 'Operational Reliability',
        points: [
          'Durable order email queue with retries and failure audit trails.',
          'Payment lifecycle tracking with reconciliation-ready event states.',
          'Continuous monitoring via service health checks and platform telemetry.',
        ],
      },
    ],
    cta: { label: 'Read Privacy Policy', to: '/privacy' },
  },
  careers: {
    title: 'Careers in Security and Platform Engineering',
    summary: 'Help build resilient commerce systems focused on trust, safety, and scale.',
    sections: [
      {
        heading: 'Core Focus Areas',
        points: [
          'Identity and account protection',
          'Payments integrity and fraud controls',
          'Marketplace policy enforcement and abuse detection',
        ],
      },
      {
        heading: 'Hiring Signals',
        points: [
          'Strong systems thinking and operational discipline',
          'Secure coding and incident response readiness',
          'Ownership mindset for reliability and customer trust',
        ],
      },
    ],
    cta: { label: 'Contact Us', to: '/contact' },
  },
  stories: {
    title: 'Aura Stories: Trust and Reliability',
    summary: 'Read how the platform ships security upgrades and customer safeguards.',
    sections: [
      {
        heading: 'Recent Focus',
        points: [
          'OTP email hardening and fail-closed delivery behavior.',
          'Payment security integration with risk controls and audit trails.',
          'Checkout reliability improvements with backend-authoritative quotes.',
        ],
      },
    ],
    cta: { label: 'Go to Security', to: '/security' },
  },
  press: {
    title: 'Press and Security Communications',
    summary: 'Official notices related to platform trust, compliance, and policy updates.',
    sections: [
      {
        heading: 'Media Guidance',
        points: [
          'Use only verified Aura channels for public statements.',
          'Security incident updates are communicated with validated timelines.',
          'Customer protection guidance is prioritized in all advisories.',
        ],
      },
    ],
    cta: { label: 'Read Terms', to: '/terms' },
  },
  corporate: {
    title: 'Corporate Information',
    summary: 'Organizational and compliance information supporting platform trust.',
    sections: [
      {
        heading: 'Governance Priorities',
        points: [
          'User safety and account integrity',
          'Payment and order reliability',
          'Transparent policy operations',
        ],
      },
    ],
    cta: { label: 'Read EPR Compliance', to: '/epr' },
  },
  payments: {
    title: 'Payments and Settlement Safeguards',
    summary: 'How Aura protects digital payment flows and fallback options.',
    sections: [
      {
        heading: 'Protection Layers',
        points: [
          'Server-side amount validation before order acceptance.',
          'Risk-aware payment controls and challenge support paths.',
          'Retry-safe idempotency protections on critical payment mutations.',
        ],
      },
      {
        heading: 'Fallback and Recovery',
        points: [
          'COD fallback where applicable.',
          'Operational handling for failures, pending states, and retries.',
          'Audit-linked events for support investigations.',
        ],
      },
    ],
    cta: { label: 'Open Security Hub', to: '/security' },
  },
  shipping: {
    title: 'Shipping and Delivery Assurance',
    summary: 'Delivery promises, slot behavior, and reliability expectations.',
    sections: [
      {
        heading: 'Delivery Commitments',
        points: [
          'Delivery options are validated during checkout quote.',
          'Address and slot selections are normalized server-side.',
          'Post-order tracking visibility is surfaced in order timelines.',
        ],
      },
    ],
    cta: { label: 'View Return Policy', to: '/return-policy' },
  },
  returns: {
    title: 'Cancellation and Returns',
    summary: 'Return windows, cancellation behavior, and refund processing posture.',
    sections: [
      {
        heading: 'Policy Summary',
        points: [
          'Return eligibility depends on category and order state.',
          'Cancellation windows are visible in order workflows.',
          'Refund operations follow controlled payment-state transitions.',
        ],
      },
    ],
    cta: { label: 'Read Return Policy', to: '/return-policy' },
  },
  faq: {
    title: 'Frequently Asked Questions',
    summary: 'Fast answers for account, checkout, payment, and security questions.',
    sections: [
      {
        heading: 'Top Questions',
        points: [
          'Why did I receive an OTP email?',
          'How do I secure my account if OTP was not requested by me?',
          'How do payment retries and fallback options work?',
        ],
      },
    ],
    cta: { label: 'Contact Support', to: '/contact' },
  },
  report: {
    title: 'Report Infringement and Abuse',
    summary: 'Report policy violations, abuse, or suspicious marketplace activity.',
    sections: [
      {
        heading: 'What to Include',
        points: [
          'Listing links, order references, and timestamps.',
          'Clear description of suspected violation.',
          'Contact details for follow-up if required.',
        ],
      },
    ],
    cta: { label: 'Go to Contact', to: '/contact' },
  },
  'return-policy': {
    title: 'Return Policy',
    summary: 'Customer-friendly return guidance with consistency and compliance controls.',
    sections: [
      {
        heading: 'Eligibility Principles',
        points: [
          'Item condition and category rules determine eligibility.',
          'Time-bound windows are enforced by order state.',
          'Certain categories may have non-returnable constraints.',
        ],
      },
    ],
    cta: { label: 'Cancellation & Returns', to: '/returns' },
  },
  terms: {
    title: 'Terms of Use',
    summary: 'Platform terms for account usage, transactions, and marketplace conduct.',
    sections: [
      {
        heading: 'Core Terms',
        points: [
          'Use the platform only through authorized and lawful behavior.',
          'Do not attempt fraud, account abuse, or data misuse.',
          'Transactions are governed by checkout, payment, and policy controls.',
        ],
      },
    ],
    cta: { label: 'Read Privacy Policy', to: '/privacy' },
  },
  security: {
    title: 'Security',
    summary: 'Aura security controls for account integrity, payments, and communications.',
    sections: [
      {
        heading: 'Account Protection',
        points: [
          'OTP checks include purpose validation, expiry windows, and anti-replay handling.',
          'Failed attempts trigger lockouts to reduce brute-force risk.',
          'Security notifications include request context and anti-phishing guidance.',
        ],
      },
      {
        heading: 'Transaction Protection',
        points: [
          'Pricing and totals are validated server-side before order creation.',
          'Payment state is controlled by backend validations and idempotent operations.',
          'Order confirmation email delivery uses durable retry-safe processing.',
        ],
      },
      {
        heading: 'Security Advice',
        points: [
          'Never share OTP codes with anyone.',
          'Reset your password immediately if you detect suspicious activity.',
          'Use only official Aura support channels.',
        ],
      },
    ],
    cta: { label: 'Contact Security Support', to: '/contact' },
  },
  privacy: {
    title: 'Privacy Policy',
    summary: 'How Aura handles account and transaction data with security and purpose limits.',
    sections: [
      {
        heading: 'Privacy Commitments',
        points: [
          'Data is processed for account security, transaction reliability, and support.',
          'Sensitive fields are restricted from standard responses and logs.',
          'Operational events are retained for audit and abuse prevention.',
        ],
      },
    ],
    cta: { label: 'Read Terms', to: '/terms' },
  },
  sitemap: {
    title: 'Sitemap',
    summary: 'Quick links to key marketplace, account, and trust destinations.',
    sections: [
      {
        heading: 'Key Routes',
        points: [
          '/marketplace, /products, /checkout, /orders',
          '/profile, /my-listings, /price-alerts',
          '/security, /privacy, /terms, /contact',
        ],
      },
    ],
    cta: { label: 'Go to Marketplace', to: '/marketplace' },
  },
  epr: {
    title: 'EPR Compliance',
    summary: 'Environmental responsibility and compliance orientation for marketplace operations.',
    sections: [
      {
        heading: 'Compliance Highlights',
        points: [
          'Policy-aligned disposal and recycling commitments.',
          'Consumer awareness and support guidance.',
          'Program updates reflected in legal and compliance content.',
        ],
      },
    ],
    cta: { label: 'Back to Legal', to: '/terms' },
  },
};

export const trustRouteToKey = {
  '/trust': 'security',
  '/contact': 'contact',
  '/about': 'about',
  '/careers': 'careers',
  '/stories': 'stories',
  '/press': 'press',
  '/corporate': 'corporate',
  '/payments': 'payments',
  '/shipping': 'shipping',
  '/returns': 'returns',
  '/faq': 'faq',
  '/report': 'report',
  '/return-policy': 'return-policy',
  '/terms': 'terms',
  '/security': 'security',
  '/privacy': 'privacy',
  '/sitemap': 'sitemap',
  '/epr': 'epr',
};

export const trustRoutes = Object.keys(trustRouteToKey);

export const getTrustPageContent = (key = 'security', intl) => {
  const resolvedKey = trustContent[key] ? key : 'security';
  const content = trustContent[resolvedKey];
  const prefix = getTrustMessagePrefix(resolvedKey);

  if (!intl?.formatMessage) {
    return content;
  }

  return {
    ...content,
    title: formatTrustContentMessage(intl, `${prefix}Title`, content.title),
    summary: formatTrustContentMessage(intl, `${prefix}Summary`, content.summary),
    sections: content.sections.map((section, sectionIndex) => ({
      ...section,
      heading: formatTrustContentMessage(intl, `${prefix}Section${sectionIndex}Heading`, section.heading),
      points: section.points.map((point, pointIndex) => formatTrustContentMessage(
        intl,
        `${prefix}Section${sectionIndex}Point${pointIndex}`,
        point,
      )),
    })),
    cta: content.cta ? {
      ...content.cta,
      label: formatTrustContentMessage(intl, `${prefix}CtaLabel`, content.cta.label),
    } : content.cta,
  };
};

export const trustMeta = {
  lastUpdated: TRUST_LAST_UPDATED,
};
