const mongoose = require('mongoose');

const applicationSchema = new mongoose.Schema(
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
    status: {
      type: String,
      enum: ['pending', 'reviewing', 'interview', 'accepted', 'rejected'],
      default: 'pending',
    },
    name: { type: String },
    email: { type: String },
    phone: { type: String },
    location: { type: String },
    experience: { type: String },
    skills: { type: String },
    cvUrl: { type: String },
    linkedinUrl: { type: String, default: '' },
    portfolioUrl: { type: String, default: '' },
    githubUrl: { type: String, default: '' },
    expectedSalary: { type: String, default: '' },
    availability: { type: String, default: 'فوري' },
    notes: {
      type: String,
      default: '',
    },
    // تفاصيل المقابلة المحددة من صاحب العمل
    interviewDetails: {
      date: { type: String, default: '' },
      time: { type: String, default: '' },
      format: { type: String, default: 'in_person' }, // in_person | online
      location: { type: String, default: '' }, // عنوان أو رابط Meet/Zoom
      notes: { type: String, default: '' },
    },
    // رسالة القرار المخصصة (سواء شكر/اعتذار أو ترحيب بالقبول)
    decisionMessage: {
      type: String,
      default: '',
    },
    appliedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// 🔒 حماية: يمنع المتقدم من التقديم على نفس الوظيفة مرتين
applicationSchema.index({ user: 1, job: 1 }, { unique: true });
applicationSchema.index({ user: 1, createdAt: -1 });
applicationSchema.index({ job: 1, status: 1 });
applicationSchema.index({ job: 1, createdAt: -1 });

module.exports = mongoose.model('Application', applicationSchema);
