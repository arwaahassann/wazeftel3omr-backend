const mongoose = require('mongoose');

const adminNotificationStateSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    notificationKey: {
      type: String,
      required: true,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

adminNotificationStateSchema.index({ admin: 1, notificationKey: 1 }, { unique: true });
adminNotificationStateSchema.index({ admin: 1, isDeleted: 1 });
adminNotificationStateSchema.index({ admin: 1, isDeleted: 1, notificationKey: 1 });

module.exports = mongoose.model('AdminNotificationState', adminNotificationStateSchema);
