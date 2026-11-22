const AdminNotificationState = require('../models/AdminNotificationState');

const resetAdminNotificationState = (type, entityId) => (
  AdminNotificationState.updateMany(
    { notificationKey: `${type}:${entityId}` },
    { $set: { isRead: false, isDeleted: false } }
  )
);

module.exports = resetAdminNotificationState;
