const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
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

router.get('/', protect, admin, validate(adminUserListSchema), listAdminUsers);
router.get('/:userId', protect, admin, validate(adminUserDetailSchema), getAdminUserById);
router.post('/:userId/warn', protect, admin, validate(adminWarnUserSchema), sensitiveActions.adminUserMutation, warnAdminUser);
router.post('/:userId/suspend', protect, admin, validate(adminSuspendUserSchema), sensitiveActions.adminUserMutation, suspendAdminUser);
router.post('/:userId/dismiss-warning', protect, admin, validate(adminDismissWarningSchema), sensitiveActions.adminUserMutation, dismissAdminUserWarning);
router.post('/:userId/reactivate', protect, admin, validate(adminReactivateUserSchema), sensitiveActions.adminUserMutation, reactivateAdminUser);
router.post('/:userId/delete', protect, admin, validate(adminDeleteUserSchema), sensitiveActions.adminUserMutation, deleteAdminUser);

module.exports = router;
