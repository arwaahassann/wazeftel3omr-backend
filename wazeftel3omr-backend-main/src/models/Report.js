const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['complaint', 'suggestion'],
      required: true,
    },
    subject: {
      type: String,
      required: [true, 'يرجى إدخال عنوان البلاغ'],
      trim: true,
      maxlength: [120, 'العنوان لا يتجاوز 120 حرفاً'],
    },
    message: {
      type: String,
      required: [true, 'يرجى إدخال تفاصيل البلاغ'],
      trim: true,
      maxlength: [2000, 'التفاصيل لا تتجاوز 2000 حرف'],
    },
    relatedJob: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'reviewing', 'resolved', 'rejected'],
      default: 'pending',
    },
    adminReply: {
      type: String,
      default: '',
      maxlength: [1000, 'رد الإدارة لا يتجاوز 1000 حرف'],
    },
  },
  { timestamps: true }
);

reportSchema.index({ createdAt: -1 });
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
