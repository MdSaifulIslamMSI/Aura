const PRIVACY_DATA_INVENTORY = [
    {
        domain: 'identity',
        models: ['User', 'BrowserSession', 'OtpSession'],
        personalData: ['name', 'email', 'phone', 'avatar', 'trustedDevices', 'recoveryCodeState'],
        exportable: true,
        erasable: true,
        retention: 'account_lifetime_plus_legal_hold',
    },
    {
        domain: 'commerce',
        models: ['Order', 'PaymentIntent', 'PaymentMethod', 'Cart'],
        personalData: ['addresses', 'paymentProviderReferences', 'orderHistory'],
        exportable: true,
        erasable: 'pseudonymize_when_legal_retention_applies',
        retention: 'tax_and_payment_retention_window',
    },
    {
        domain: 'support',
        models: ['SupportTicket', 'SupportMessage', 'Conversation'],
        personalData: ['messages', 'attachments', 'contactMetadata'],
        exportable: true,
        erasable: true,
        retention: 'support_retention_window',
    },
    {
        domain: 'observability',
        models: ['ClientDiagnostic', 'AdminNotification', 'AuthSecurityEventOutbox'],
        personalData: ['requestId', 'ipDerivedMetadata', 'userId', 'deviceMetadata'],
        exportable: false,
        erasable: 'aggregate_or_delete_by_subject_when_present',
        retention: 'short_operational_window',
    },
    {
        domain: 'ai_assistant',
        models: ['AssistantThread', 'AssistantThreadMessage', 'AssistantActionAudit'],
        personalData: ['messages', 'toolActionMetadata', 'productSnapshots'],
        exportable: true,
        erasable: true,
        retention: 'assistant_thread_retention_window',
    },
];

const listPrivacyDataInventory = () => PRIVACY_DATA_INVENTORY.map((entry) => ({ ...entry }));

module.exports = {
    PRIVACY_DATA_INVENTORY,
    listPrivacyDataInventory,
};
