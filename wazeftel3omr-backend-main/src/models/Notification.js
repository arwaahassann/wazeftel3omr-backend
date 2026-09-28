const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      default: '',
    },
    message: {
      type: String,
      required: true,
      maxlength: [1000, 'رسالة الإشعار لا يمكن أن تتجاوز 1000 حرف'],
    },
    type: {
      type: String,
      enum: ['accepted', 'interview', 'rejected', 'reviewing', 'pending', 'new_job', 'system', 'message'],
      default: 'system',
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
    },
    application: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Application',
    },
    interviewDetails: {
      date: { type: String, default: '' },
      time: { type: String, default: '' },
      format: { type: String, default: 'in_person' },
      location: { type: String, default: '' },
      notes: { type: String, default: '' },
    },
    decisionMessage: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, isRead: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
