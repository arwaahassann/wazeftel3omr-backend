const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    application: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
    },
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    senderRole: {
      type: String,
      enum: ['employer', 'job_seeker', 'admin'],
      required: true,
    },
    content: {
      type: String,
      required: [true, 'نص الرسالة مطلوب'],
      maxlength: [2000, 'الرسالة لا تتجاوز 2000 حرف'],
      trim: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// 🚀 فهارس فائقة السرعة لتحميل المحادثات في أجزاء من الميلي ثانية
messageSchema.index({ application: 1, createdAt: 1 });
messageSchema.index({ sender: 1, read: 1 });

module.exports = mongoose.model('Message', messageSchema);
