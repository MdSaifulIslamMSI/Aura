const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
    createSupportTicket,
    sendSupportMessage,
    getSupportTickets,
    getSupportTicketMessages,
    addSystemLogToTicket,
    adminGetTickets,
    adminUpdateTicketStatus,
} = require('../controllers/supportController');
const {
    createSupportTicketSchema,
    sendSupportMessageSchema,
    supportTicketQuerySchema,
    ticketIdParamSchema,
    adminUpdateTicketSchema,
} = require('../validators/supportValidators');

// --- User Routes ---
// Users (including suspended users allowed via 'protect') can access these endpoints
router.route('/')
    .post(protect, validate(createSupportTicketSchema), createSupportTicket)
    .get(protect, validate(supportTicketQuerySchema), getSupportTickets);

router.route('/:id/messages')
    .post(protect, validate(sendSupportMessageSchema), sendSupportMessage)
    .get(protect, validate(ticketIdParamSchema), getSupportTicketMessages);

// --- Admin Routes ---
router.route('/admin/all')
    .get(protect, admin, validate(supportTicketQuerySchema), adminGetTickets);

router.route('/:id/status')
    .patch(protect, admin, validate(adminUpdateTicketSchema), adminUpdateTicketStatus);

// Internal helper for logging system events
// No exported route, used programmatically by other controllers

module.exports = router;
