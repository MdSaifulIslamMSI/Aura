const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
    createSupportTicket,
    sendSupportMessage,
    getSupportTickets,
    getSupportTicketMessages,
    requestSupportLiveCall,
    addSystemLogToTicket,
    adminGetTickets,
    adminUpdateTicketStatus,
    startSupportLiveCallSession,
    joinSupportLiveCallSession,
    connectSupportLiveCallSession,
    endSupportLiveCallSession,
} = require('../controllers/supportController');
const {
    createSupportTicketSchema,
    sendSupportMessageSchema,
    supportTicketQuerySchema,
    ticketIdParamSchema,
    adminUpdateTicketSchema,
    requestSupportLiveCallSchema,
    supportLiveCallActionSchema,
} = require('../validators/supportValidators');

// --- User Routes ---
// Users (including suspended users allowed via 'protect') can access these endpoints
router.route('/')
    .post(protect, validate(createSupportTicketSchema), createSupportTicket)
    .get(protect, validate(supportTicketQuerySchema), getSupportTickets);

router.route('/:id/messages')
    .post(protect, validate(sendSupportMessageSchema), sendSupportMessage)
    .get(protect, validate(ticketIdParamSchema), getSupportTicketMessages);

router.route('/:id/video/request')
    .post(protect, validate(requestSupportLiveCallSchema), requestSupportLiveCall);

router.route('/:id/video/start')
    .post(protect, admin, validate(ticketIdParamSchema), startSupportLiveCallSession);

router.route('/:id/video/join')
    .post(protect, validate(supportLiveCallActionSchema), joinSupportLiveCallSession);

router.route('/:id/video/connected')
    .post(protect, validate(supportLiveCallActionSchema), connectSupportLiveCallSession);

router.route('/:id/video/end')
    .post(protect, validate(supportLiveCallActionSchema), endSupportLiveCallSession);

// --- Admin Routes ---
router.route('/admin/all')
    .get(protect, admin, validate(supportTicketQuerySchema), adminGetTickets);

router.route('/:id/status')
    .patch(protect, admin, validate(adminUpdateTicketSchema), adminUpdateTicketStatus);

// Internal helper for logging system events
// No exported route, used programmatically by other controllers

module.exports = router;
