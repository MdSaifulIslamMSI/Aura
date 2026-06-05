const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { requireSecurityDecision } = require('../middleware/requireSecurityDecision');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const {
    listAdminUsers,
    getAdminUserById,
    warnAdminUser,
    suspendAdminUser,
    dismissAdminUserWarning,
    reactivateAdminUser,
    deleteAdminUser,
} = require('../controllers/adminUserController');
const {
    adminUserListSchema,
    adminUserDetailSchema,
    adminWarnUserSchema,
    adminSuspendUserSchema,
    adminDismissWarningSchema,
    adminReactivateUserSchema,
    adminDeleteUserSchema,
} = require('../validators/adminUserValidators');

const auditAdminUserUpdate = requireSecurityDecision('admin.user.update', {
    resourceType: 'user',
    resourceIdParam: 'userId',
});
const auditAdminUserDelete = requireSecurityDecision('admin.user.delete', {
    resourceType: 'user',
    resourceIdParam: 'userId',
});

router.get('/', protect, admin, validate(adminUserListSchema), listAdminUsers);
router.get('/:userId', protect, admin, validate(adminUserDetailSchema), getAdminUserById);
router.post('/:userId/warn', protect, admin, validate(adminWarnUserSchema), auditAdminUserUpdate, sensitiveActions.adminUserMutation, warnAdminUser);
router.post('/:userId/suspend', protect, admin, validate(adminSuspendUserSchema), auditAdminUserUpdate, sensitiveActions.adminUserMutation, suspendAdminUser);
router.post('/:userId/dismiss-warning', protect, admin, validate(adminDismissWarningSchema), auditAdminUserUpdate, sensitiveActions.adminUserMutation, dismissAdminUserWarning);
router.post('/:userId/reactivate', protect, admin, validate(adminReactivateUserSchema), auditAdminUserUpdate, sensitiveActions.adminUserMutation, reactivateAdminUser);
router.post('/:userId/delete', protect, admin, validate(adminDeleteUserSchema), auditAdminUserDelete, sensitiveActions.adminUserMutation, deleteAdminUser);

module.exports = router;
