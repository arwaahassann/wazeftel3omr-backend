const Job = require('../models/Job');
const Application = require('../models/Application');

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
        .populate('postedBy', 'name email company')
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
      jobs,
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
    const job = await Job.findById(req.params.id).populate('postedBy', 'name email company');

    if (!job) {
      return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });
    }

    res.status(200).json({ success: true, job });
  } catch (error) {
    next(error);
  }
};

// @desc    إنشاء وظيفة جديدة
// @route   POST /api/jobs
// @access  Private (Employer / Admin)
const createJob = async (req, res, next) => {
  try {
    const {
      title, company, logoUrl, location, jobType, category, description,
      requirements, salary, level, experience, qualifications, specialty,
      degree, workTime, closingDate,
    } = req.body;

    const job = await Job.create({
      title,
      company,
      logoUrl,
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
      status: 'active',
    });

    res.status(201).json({
      success: true,
      message: 'تم إضافة الوظيفة بنجاح',
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

    const {
      title, company, logoUrl, location, jobType, category, description,
      requirements, salary, level, experience, qualifications, specialty,
      degree, workTime, closingDate, status,
    } = req.body;

    const updates = {
      title, company, logoUrl, location, jobType, category, description,
      requirements, salary, level, experience, qualifications, specialty,
      degree, workTime, closingDate, status,
    };

    Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);

    job = await Job.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      message: 'تم تحديث الوظيفة بنجاح',
      job,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    حذف وظيفة
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

    await job.deleteOne();

    res.status(200).json({
      success: true,
      message: 'تم حذف الوظيفة بنجاح',
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
