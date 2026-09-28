const mongoose = require('mongoose');

const savedJobSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// 🔒 يمنع اليوزر من حفظ نفس الوظيفة أكثر من مرة
savedJobSchema.index({ user: 1, job: 1 }, { unique: true });
// 🚀 فهرس سريع لجلب وظائف اليوزر المحفوظة
savedJobSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('SavedJob', savedJobSchema);
