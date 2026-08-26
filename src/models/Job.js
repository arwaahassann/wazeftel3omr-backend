const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'يرجى إدخال مسمى الوظيفة'],
      trim: true,
      maxlength: [100, 'مسمى الوظيفة لا يتجاوز 100 حرف'],
    },
    company: {
      type: String,
      required: [true, 'يرجى إدخال اسم الشركة'],
      trim: true,
      maxlength: [100, 'اسم الشركة لا يتجاوز 100 حرف'],
    },
    logoUrl: {
      type: String,
      default: '',
    },
    location: {
      type: String,
      required: [true, 'يرجى إدخال موقع العمل'],
      trim: true,
    },
    jobType: {
      type: String,
      default: 'دوام كامل',
    },
    category: {
      type: String,
      default: 'تطوير البرمجيات',
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'يرجى إدخال تفاصيل والوصف الوظيفي'],
      maxlength: [5000, 'وصف الوظيفة لا يتجاوز 5000 حرف'],
    },
    requirements: {
      type: [String],
      default: [],
    },
    salary: {
      type: String,
      default: 'قابل للمفاوضة',
    },
    level: {
      type: String,
      default: 'متوسط',
    },
    experience: {
      type: String,
      default: '1-3 سنوات',
    },
    qualifications: {
      type: String,
      default: 'بكالوريوس',
    },
    specialty: {
      type: String,
      default: 'تكنولوجيا المعلومات',
    },
    degree: {
      type: String,
      default: 'بكالوريوس',
    },
    workTime: {
      type: String,
      default: 'صباحي',
    },
    closingDate: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['active', 'closed'],
      default: 'active',
    },
    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

jobSchema.index({ title: 'text', company: 'text', description: 'text' });
jobSchema.index({ status: 1, createdAt: -1 }); // 🚀 أسرع index لاستعلام الوظائف النشطة
jobSchema.index({ postedBy: 1, createdAt: -1 }); // 🚀 لاستعلام وظائف صاحب العمل
jobSchema.index({ location: 1 });
jobSchema.index({ jobType: 1 });
jobSchema.index({ category: 1 });

module.exports = mongoose.model('Job', jobSchema);
