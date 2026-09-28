const Job = require('../models/Job');
const Application = require('../models/Application');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const SavedJob = require('../models/SavedJob');
const User = require('../models/User');
const { normalizePhoneInput } = require('../utils/accountIdentity');
const sendJobStatusEmail = require('../utils/sendJobStatusEmail');
const withCompanyProfileLogo = require('../utils/withCompanyProfileLogo');

const hasValidCompanyPhone = (phone) => {
  const normalizedPhone = normalizePhoneInput(phone);
  const phoneDigits = normalizedPhone.replace(/\D/g, '');
  return /^[+\d\s().-]+$/.test(normalizedPhone)
    && phoneDigits.length >= 8
    && phoneDigits.length <= 15;
};

const requireEmployerPhone = async (userId, res) => {
  const employer = await User.findById(userId).select('phone').lean();
  if (!employer || !hasValidCompanyPhone(employer.phone)) {
    res.status(400).json({
      success: false,
      message: 'لن يتم إرسال إعلان الوظيفة للمراجعة قبل إضافة رقم التواصل الأساسي للشركة في إعدادات الحساب. سيظهر هذا الرقم لإدارة المنصة.',
    });
    return false;
  }
  return true;
};

// @desc    جلب جميع الوظائف مع التصفية المتقدمة والبحث والترتيب والـ Pagination فائق السرعة
// @route   GET /api/jobs
// @access  Public
const getAllJobs = async (req, res, next) => {
  try {
    const { search, location, jobType, category, level, sortBy = 'newest', page = 1, limit = 6 } = req.query;
    let query = { status: 'active' };

    // 1. تصفية حسب البحث النصي المشترك
    if (search) {
      const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { title: searchRegex },
        { company: searchRegex },
        { category: searchRegex },
        { description: searchRegex },
      ];
    }

    // 2. تصفية حسب الموقع / المحافظة
    if (location && location !== 'all') {
      query.location = { $regex: location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    // 3. تصفية حسب نوع الدوام
    if (jobType && jobType !== 'all') {
      query.jobType = jobType;
    }

    // 4. تصفية حسب المستوى المهني
    if (level && level !== 'all') {
      query.level = level;
    }

    // 5. تصفية حسب المجال / التصنيف
    if (category && category !== 'all') {
      query.category = { $regex: category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    // 6. الترتيب (Sorting)
    let sortOption = { createdAt: -1 }; // الافتراضي: الأحدث نشراً
    if (sortBy === 'oldest') {
      sortOption = { createdAt: 1 };
    } else if (sortBy === 'salary_high') {
      sortOption = { salary: -1, createdAt: -1 };
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 6));
    const skip = (pageNum - 1) * limitNum;

    // استعلام مفهرس فائق السرعة عبر lean() و skip/limit في نفس الوقت
    const [jobs, total] = await Promise.all([
      Job.find(query)
        .select('title company location jobType category level createdAt postedBy')
        .populate('postedBy', 'name company avatar')
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Job.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limitNum) || 1;

    res.status(200).json({
      success: true,
      count: jobs.length,
      total,
      page: pageNum,
      pages: totalPages,
      jobs: jobs.map(withCompanyProfileLogo),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    جلب تفاصيل وظيفة واحدة بواسطة الـ ID
// @route   GET /api/jobs/:id
// @access  Public
const getJobById = async (req, res, next) => {
  try {
    const job = await Job.findById(req.params.id)
      .select('-logoUrl')
      .populate('postedBy', 'name email company avatar');

    if (!job) {
      return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });
    }

    res.status(200).json({
      success: true,
      job: withCompanyProfileLogo(job),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    إنشاء وظيفة جديدة
// @route   POST /api/jobs
// @access  Private (Employer / Admin)
const createJob = async (req, res, next) => {
  try {
    if (req.user.role === 'employer' && !(await requireEmployerPhone(req.user._id, res))) {
      return;
    }

    if (req.user.role === 'employer' && req.user.accountStatus !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'حساب شركتك قيد المراجعة حالياً. يمكنك نشر الوظائف بعد موافقة إدارة المنصة على الشركة.',
      });
    }

    const {
      title, company, location, jobType, category, description,
      requirements, salary, level, experience, qualifications, specialty,
      degree, workTime, closingDate,
    } = req.body;

    const job = await Job.create({
      title,
      company,
      location,
      jobType,
      category,
      description,
      requirements,
      salary,
      level,
      experience,
      qualifications,
      specialty,
      degree,
      workTime,
      closingDate,
      postedBy: req.user._id,
      status: req.user.role === 'admin' ? 'active' : 'reviewing',
    });

    // 🔔 إشعار لصاحب العمل بتأكيد استلام طلب الوظيفة
    await Notification.create({
      user: req.user._id,
      title: req.user.role === 'admin' ? 'تم نشر وظيفتك بنجاح ✅' : 'تم استلام طلب نشر الوظيفة ⏳',
      message: req.user.role === 'admin'
        ? `تم نشر وظيفتك "${job.title}" وأصبحت متاحة للتقديم الآن.`
        : `تم استلام إعلان وظيفة "${job.title}". الوظيفة قيد المراجعة حالياً من قِبل إدارة المنصة وسيتم إشعارك فور اعتمادها.`,
      type: req.user.role === 'admin' ? 'system' : 'pending',
      job: job._id,
    }).catch((error) => console.error('Failed to notify the job poster:', error.message));

    if (req.user.role === 'employer') {
      try {
        await sendJobStatusEmail({
          email: req.user.email,
          title: job.title,
          status: 'reviewing',
        });
      } catch (error) {
        console.error('Failed to send the job submission email:', error.message);
      }
    }

    res.status(201).json({
      success: true,
      message: req.user.role === 'admin' ? 'تم إضافة الوظيفة بنجاح' : 'تم إرسال الوظيفة للمراجعة، سيتم تفعيلها بعد موافقة الإدارة',
      job,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    تعديل وظيفة
// @route   PUT /api/jobs/:id
// @access  Private (Employer / Admin)
const updateJob = async (req, res, next) => {
  try {
    let job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });
    }

    if (job.postedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح لك بتعديل هذه الوظيفة',
      });
    }

    if (req.user.role === 'employer' && !(await requireEmployerPhone(req.user._id, res))) {
      return;
    }

    const {
      title, company, location, jobType, category, description,
      requirements, salary, level, experience, qualifications, specialty,
      degree, workTime, closingDate, status,
    } = req.body;

    const updates = {
      title, company, location, jobType, category, description,
      requirements, salary, level, experience, qualifications, specialty,
      degree, workTime, closingDate, status,
    };

    // 🔒 إذا كان المعدل ليس أدمن: التعديل يتطلب موافقة الإدارة وتعود الوظيفة قيد المراجعة
    if (req.user.role !== 'admin') {
      updates.status = 'reviewing';
    }

    Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);

    job = await Job.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    if (req.user.role !== 'admin') {
      await Notification.create({
        user: req.user._id,
        title: 'تم استلام تعديلات الوظيفة ⏳',
        message: `تم إرسال تعديلاتك على وظيفة "${job.title}" للمراجعة، وسيتم إعادة تفعيلها فور موافقة إدارة المنصة.`,
        type: 'pending',
        job: job._id,
      }).catch((error) => console.error('Failed to notify the job poster about the update:', error.message));
    }

    res.status(200).json({
      success: true,
      message: req.user.role === 'admin'
        ? 'تم تحديث الوظيفة بنجاح'
        : 'تم إرسال تعديلات الوظيفة للمراجعة بنجاح، وسيتم تفعيلها بعد موافقة الإدارة',
      job,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    حذف وظيفة (يتطلب موافقة الأدمن لغير المشرف)
// @route   DELETE /api/jobs/:id
// @access  Private (Employer / Admin)
const deleteJob = async (req, res, next) => {
  try {
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });
    }

    if (job.postedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح لك بحذف هذه الوظيفة',
      });
    }

    // 🛡️ إذا كان الطالب صاحب العمل (وليس أدمن): إرسال طلب حذف للمراجعة ولا يُحذف مباشرة
    if (req.user.role !== 'admin') {
      job.status = 'deletion_pending';
      job.deletionRequested = true;
      await job.save();

      await Notification.create({
        user: req.user._id,
        title: 'طلب حذف وظيفة قيد المراجعة ⏳',
        message: `تم استلام طلبك لحذف وظيفة "${job.title}". لن يتم الحذف النهائي إلا بعد موافقة إدارة المنصة.`,
        type: 'pending',
        job: job._id,
      }).catch((error) => console.error('Failed to notify the job poster about the deletion request:', error.message));

      return res.status(200).json({
        success: true,
        message: 'تم إرسال طلب حذف الوظيفة لإدارة المنصة بنجاح، ولن يتم الحذف إلا بعد مراجعة وموافقة المشرف.',
        job,
      });
    }

    // 🗑️ Cascade Delete — للمشرف العام فقط: حذف نهائي مباشر
    const jobId = job._id;

    // 1. جلب IDs كل الـ Applications المرتبطة بالوظيفة
    const relatedApplications = await Application.find({ job: jobId }).select('_id');
    const applicationIds = relatedApplications.map((a) => a._id);

    // 2. حذف الرسائل المرتبطة بهذه الـ Applications
    if (applicationIds.length > 0) {
      await Message.deleteMany({ application: { $in: applicationIds } });
    }

    // 3. حذف الإشعارات المرتبطة بالوظيفة
    await Notification.deleteMany({ job: jobId });

    // 4. حذف طلبات التقديم على الوظيفة
    await Application.deleteMany({ job: jobId });

    // 5. حذف سجلات المفضلة المرتبطة بالوظيفة
    await SavedJob.deleteMany({ job: jobId });

    // 6. أخيراً حذف الوظيفة نفسها
    await job.deleteOne();

    res.status(200).json({
      success: true,
      message: 'تم حذف الوظيفة وجميع البيانات المرتبطة بها بنجاح',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    جلب الوظائف التي نشرها الـ Employer الحالي مع حساب عدد المتقدمين ديناميكياً
// @route   GET /api/jobs/mine
// @access  Private (Employer)
const getMyJobs = async (req, res, next) => {
  try {
    const jobs = await Job.find({ postedBy: req.user._id }).lean().sort({ createdAt: -1 });

    const jobIds = jobs.map((j) => j._id);

    const applicantCounts = await Application.aggregate([
      { $match: { job: { $in: jobIds } } },
      { $group: { _id: '$job', count: { $sum: 1 } } },
    ]);

    const countMap = {};
    applicantCounts.forEach((item) => {
      countMap[item._id.toString()] = item.count;
    });

    const jobsWithCounts = jobs.map((job) => ({
      ...job,
      applicantsCount: countMap[job._id.toString()] || 0,
    }));

    res.status(200).json({ success: true, count: jobsWithCounts.length, jobs: jobsWithCounts });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllJobs,
  getJobById,
  createJob,
  updateJob,
  deleteJob,
  getMyJobs,
};
