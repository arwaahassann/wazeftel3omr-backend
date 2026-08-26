const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Job = require('../models/Job');
const User = require('../models/User');

dotenv.config({ path: '../../.env' });

const sampleJobs = [
  {
    title: 'مطور وجهات UI/UX',
    company: 'شركة التقنية المتقدمة',
    location: 'القاهرة، مصر',
    jobType: 'full-time',
    category: 'تصميم وبناء واجهات',
    description: 'نبحث عن مطور واجهات مستخدم محترف يجيد React و Tailwind CSS.',
    salary: '15,000 - 20,000 ج.م',
    requirements: ['React.js', 'Tailwind CSS', 'TypeScript'],
  },
  {
    title: 'مطور Backend - Node.js',
    company: 'حلول البرمجيات الرقمية',
    location: 'الرياض، السعودية',
    jobType: 'remote',
    category: 'تطوير البرمجيات',
    description: 'مطلوب مطور Node.js و MongoDB لبناء RESTful APIs آمنة وقابلة للتوسع.',
    salary: '8,000 - 12,000 ريال',
    requirements: ['Node.js', 'Express', 'MongoDB', 'JWT', 'Security'],
  },
  {
    title: 'مهندس جودة برمجيات QA',
    company: 'إبداع للحلول التكنولوجية',
    location: 'الإسكندرية، مصر',
    jobType: 'full-time',
    category: 'اختبار البرمجيات',
    description: 'مطلوب مهندس جودة لاختبار التطبيقات والتحقق من سلامة الأكواد قبل الإنتاج.',
    salary: '10,000 - 14,000 ج.م',
    requirements: ['Automation Testing', 'Postman', 'Cypress'],
  },
];

const seedDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/wazeft_el3omr');
    
    // إيجاد أو إنشاء مستخدم شركة افتراضي
    let admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      admin = await User.create({
        name: 'مدير النظام',
        email: 'admin@wazeftel3omr.com',
        password: 'AdminPassword123!',
        role: 'admin',
        jobTitle: 'مسؤول التوظيف',
      });
    }

    // مسح الوظائف القديمة وإضافة العينات الجديدة
    await Job.deleteMany({});
    const jobsWithAdmin = sampleJobs.map((j) => ({ ...j, postedBy: admin._id }));
    await Job.insertMany(jobsWithAdmin);

    console.log('✅ تم إضافة عينات الوظائف بنجاح في قاعدة البيانات!');
    process.exit();
  } catch (error) {
    console.error('❌ خطأ في السيتينج:', error.message);
    process.exit(1);
  }
};

seedDB();
