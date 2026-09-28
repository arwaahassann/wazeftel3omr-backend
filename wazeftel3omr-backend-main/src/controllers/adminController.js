const mongoose = require('mongoose');
const { normalizePhoneInput } = require('../utils/accountIdentity');
const User = require('../models/User');
const Job = require('../models/Job');
const Application = require('../models/Application');
const Notification = require('../models/Notification');
const Report = require('../models/Report');
const Message = require('../models/Message');
const SavedJob = require('../models/SavedJob');
const AdminNotificationState = require('../models/AdminNotificationState');
const sendJobStatusEmail = require('../utils/sendJobStatusEmail');

// @desc    إحصائيات الداشبورد الشاملة
// @route   GET /api/admin/stats
// @access  Private (Admin)
const getDashboardStats = async (req, res, next) => {
  try {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const [totalUsers, totalEmployers, newUsersThisWeek, newEmployersThisWeek,
      totalJobs, activeJobs, reviewingJobs, closedJobs, rejectedJobs,
      totalApplications, newApplicationsThisWeek, recentUsers, recentJobs,
      recentApplications, recentReports] = await Promise.all([
      User.countDocuments({ role: { $in: ['job_seeker', 'employer'] } })
        .hint('role_1_createdAt_-1'),
      User.countDocuments({ role: 'employer' })
        .hint('role_1_createdAt_-1'),
      User.countDocuments({
        role: { $in: ['job_seeker', 'employer'] },
        createdAt: { $gte: oneWeekAgo },
      }).hint('role_1_createdAt_-1'),
      User.countDocuments({
        role: 'employer',
        createdAt: { $gte: oneWeekAgo },
      }).hint('role_1_createdAt_-1'),
      Job.countDocuments({}).hint('_id_'),
      Job.countDocuments({ status: 'active' }),
      Job.countDocuments({ status: 'reviewing' }),
      Job.countDocuments({ status: 'closed' }),
      Job.countDocuments({ status: 'rejected' }),
      Application.countDocuments({}).hint('_id_'),
      Application.countDocuments({ createdAt: { $gte: oneWeekAgo } })
        .hint('createdAt_-1__id_-1'),
      User.find({ role: { $in: ['job_seeker', 'employer'] } })
        .select('name email role company createdAt')
        .sort({ createdAt: -1, _id: -1 })
        .limit(5)
        .lean(),
      Job.find()
        .select('title company createdAt postedBy')
        .populate('postedBy', 'company')
        .sort({ createdAt: -1, _id: -1 })
        .limit(5)
        .lean(),
      Application.find()
        .select('createdAt user job')
        .populate('user', 'name')
        .populate('job', 'title company')
        .sort({ createdAt: -1, _id: -1 })
        .limit(5)
        .lean(),
      Report.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('user', 'name')
        .select('type subject createdAt user')
        .lean(),
    ]);

    const activities = [
      ...recentJobs.map((j) => ({
        id: 'job_' + j._id,
        type: 'job',
        text: `تم نشر وظيفه جديده بواسطه شركه ${j.postedBy?.company || j.company || 'المجد'}`,
        subText: j.title,
        date: j.createdAt,
      })),
      ...recentUsers.map((u) => ({
        id: 'user_' + u._id,
        type: 'user',
        text: u.role === 'employer' ? `تم تسجيل شركه جديده: ${u.company || u.name}` : `مستخدم جديد: ${u.name}`,
        subText: u.email,
        date: u.createdAt,
      })),
      ...recentApplications.map((a) => ({
        id: 'app_' + a._id,
        type: 'application',
        text: `تقدم ${a.user?.name || 'مستخدم'} علي وظيفه`,
        subText: a.job?.title || 'وظيفة',
        date: a.createdAt,
      })),
      ...recentReports.map((r) => ({
        id: 'report_' + r._id,
        type: 'report',
        text: r.type === 'suggestion'
          ? `مقترح جديد من ${r.user?.name || 'مستخدم'}`
          : `شكوى جديدة من ${r.user?.name || 'مستخدم'}`,
        subText: r.subject,
        date: r.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8);

    res.status(200).json({
      success: true,
      stats: {
        totalUsers,
        totalEmployers,
        totalJobs,
        totalApplications,
        activeJobs,
        reviewingJobs,
        closedJobs,
        rejectedJobs,
        thisWeek: {
          newUsers: newUsersThisWeek,
          newEmployers: newEmployersThisWeek,
          newApplications: newApplicationsThisWeek,
        },
      },
      activities,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    جلب جميع المستخدمين مع فلتر + بحث + pagination
// @route   GET /api/admin/users
// @access  Private (Admin)
const getAllUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, role, search, status } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    const filter = { role: { $ne: 'admin' } };
    if (role && role !== 'all') {
      filter.role = role;
    }
    if (status && status !== 'all') {
      filter.accountStatus = status;
    }
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: regex }, { email: regex }, { phone: regex }, { company: regex }];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('name email role phone company accountStatus createdAt avatar isVerified')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      count: users.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
      users,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    تحديث حالة حساب مستخدم
// @route   PUT /api/admin/users/:id/status
// @access  Private (Admin)
const updateUserStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const validStatuses = ['active', 'reviewing', 'suspended'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'حالة غير صالحة' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { accountStatus: status },
      { new: true, select: 'name email role accountStatus' }
    );

    if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

    res.status(200).json({ success: true, message: 'تم تحديث حالة المستخدم بنجاح', user });
  } catch (error) {
    next(error);
  }
};

// @desc    جلب الشركات مع فلترة وبحث وبايجنيشن
// @route   GET /api/admin/companies
// @access  Private (Admin)
const getAllCompanies = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search, status } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    const filter = { role: 'employer' };
    if (status && status !== 'all') {
      filter.accountStatus = status;
    }
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ company: regex }, { name: regex }, { email: regex }, { phone: regex }];
    }

    const [companies, total] = await Promise.all([
      User.find(filter)
        .select('name email company companyWebsite companyIndustry location phone accountStatus createdAt avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      count: companies.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
      companies,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    تحديث حالة الشركة
// @route   PUT /api/admin/companies/:id/status
// @access  Private (Admin)
const updateCompanyStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const validStatuses = ['active', 'reviewing', 'suspended'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'حالة غير صالحة' });
    }

    if (status === 'active') {
      const companyRecord = await User.findOne({ _id: req.params.id, role: 'employer' })
        .select('phone')
        .lean();
      if (!companyRecord) {
        return res.status(404).json({ success: false, message: 'الشركة غير موجودة' });
      }
      const phone = normalizePhoneInput(companyRecord.phone);
      const phoneDigits = phone.replace(/\D/g, '');
      if (!/^[+\d\s().-]+$/.test(phone) || phoneDigits.length < 8 || phoneDigits.length > 15) {
        return res.status(400).json({
          success: false,
          message: 'لا يمكن اعتماد الشركة قبل إضافة رقم التواصل الأساسي الصحيح في إعدادات حسابها',
        });
      }
    }

    const company = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'employer' },
      { accountStatus: status },
      { new: true, select: 'name email company accountStatus' }
    );

    if (!company) return res.status(404).json({ success: false, message: 'الشركة غير موجودة' });

    res.status(200).json({ success: true, message: 'تم تحديث حالة الشركة بنجاح', company });
  } catch (error) {
    next(error);
  }
};

// @desc    جلب جميع الوظائف للأدمن مع فلترة وحالة وبحث
// @route   GET /api/admin/jobs
// @access  Private (Admin)
const getAdminAllJobs = async (req, res, next) => {
  try {
    const { cursor, search, status } = req.query;
    const limitNum = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));

    const filter = {};
    if (status && status !== 'all') {
      filter.status = status;
    }
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: regex }, { company: regex }, { location: regex }, { category: regex }];
    }

    if (cursor) {
      let decodedCursor;
      try {
        decodedCursor = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
      } catch {
        return res.status(400).json({ success: false, message: 'مؤشر صفحة الوظائف غير صالح' });
      }
      if (
        !decodedCursor
        || !mongoose.isValidObjectId(decodedCursor.id)
        || !Number.isFinite(new Date(decodedCursor.createdAt).getTime())
      ) {
        return res.status(400).json({ success: false, message: 'مؤشر صفحة الوظائف غير صالح' });
      }
      const cursorDate = new Date(decodedCursor.createdAt);
      const cursorId = new mongoose.Types.ObjectId(decodedCursor.id);
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [
            { createdAt: { $lt: cursorDate } },
            { createdAt: cursorDate, _id: { $lt: cursorId } },
          ],
        },
      ];
    }

    const jobs = await Job.find(filter)
      .select('title company location jobType createdAt status postedBy')
      .populate('postedBy', 'company')
      .sort({ createdAt: -1, _id: -1 })
      .limit(limitNum + 1)
      .lean();
    const hasMore = jobs.length > limitNum;
    if (hasMore) jobs.pop();
    const lastJob = jobs[jobs.length - 1];
    const nextCursor = hasMore && lastJob
      ? Buffer.from(JSON.stringify({
        createdAt: lastJob.createdAt,
        id: lastJob._id,
      })).toString('base64url')
      : null;

    res.status(200).json({
      success: true,
      count: jobs.length,
      jobs,
      hasMore,
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
};

const getAdminJobDetails = async (req, res, next) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate(
        'postedBy',
        'name email phone company companyWebsite companyIndustry location accountStatus avatar'
      )
      .lean();

    if (!job) {
      return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });
    }

    res.status(200).json({ success: true, job });
  } catch (error) {
    next(error);
  }
};

// @desc    تحديث حالة وظيفة (قبول / رفض / قيد مراجعة / إغلاق)
// @route   PUT /api/admin/jobs/:id/status
// @access  Private (Admin)
const updateAdminJobStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const rejectionReason = typeof req.body.rejectionReason === 'string'
      ? req.body.rejectionReason.trim()
      : '';
    const validStatuses = ['active', 'closed', 'reviewing', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'حالة غير صالحة' });
    }
    if (rejectionReason.length > 500) {
      return res.status(400).json({ success: false, message: 'سبب الرفض لا يمكن أن يتجاوز 500 حرف' });
    }
    if (status !== 'rejected' && rejectionReason) {
      return res.status(400).json({ success: false, message: 'يمكن إرسال سبب الرفض عند رفض الإعلان فقط' });
    }

    const job = await Job.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!job) return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });

    let notifTitle = '';
    let notifMsg = '';
    if (status === 'active') {
      notifTitle = 'تهانينا! تمت الموافقة على نشر وظيفتك ✅';
      notifMsg = `تمت مراجعة وظيفتك "${job.title}" واعتمادها من قبل إدارة المنصة وأصبحت متاحة للتقديم الآن.`;
    } else if (status === 'rejected') {
      notifTitle = 'تحديث بخصوص إعلان الوظيفة ❌';
      notifMsg = `نعتذر، تم رفض إعلان الوظيفة "${job.title}". سبب الرفض: ${rejectionReason || 'لم يتم توضيح سبب الرفض.'}`;
    }

    if (notifTitle) {
      await Notification.create({
        user: job.postedBy,
        title: notifTitle,
        message: notifMsg,
        type: 'system',
        job: job._id,
      }).catch((error) => {
        console.error('Failed to create the job status notification:', error.message);
      });

      try {
        const employer = await User.findById(job.postedBy).select('email').lean();
        await sendJobStatusEmail({
          email: employer?.email,
          title: job.title,
          status,
          rejectionReason,
        });
      } catch (error) {
        console.error(`Failed to send job ${status} email:`, error.message);
      }
    }

    res.status(200).json({ success: true, message: 'تم تحديث حالة الوظيفة بنجاح', job });
  } catch (error) {
    next(error);
  }
};

// @desc    جلب جميع طلبات التقديم للأدمن
// @route   GET /api/admin/applications
// @access  Private (Admin)
const getAdminAllApplications = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (status && status !== 'all') {
      filter.status = status;
    }
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: regex }, { email: regex }, { phone: regex }];
    }

    const [applications, total] = await Promise.all([
      Application.find(filter)
        .select('-cvUrl')
        .populate('user', 'name email avatar phone')
        .populate('job', 'title company location')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Application.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      count: applications.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
      applications,
    });
  } catch (error) {
    next(error);
  }
};

const getAdminAllReports = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status, type, search } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (status === 'open') {
      filter.status = { $in: ['pending', 'reviewing'] };
    } else if (status && status !== 'all') {
      filter.status = status;
    }
    if (type && type !== 'all') filter.type = type;
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ subject: regex }, { message: regex }];
    }

    const [reports, total, pendingCount, reviewingCount, resolvedCount] = await Promise.all([
      Report.find(filter)
        .populate('user', 'name email role phone avatar')
        .populate('relatedJob', 'title company')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Report.countDocuments(filter),
      Report.countDocuments({ status: { $in: ['pending', 'reviewing'] } }),
      Report.countDocuments({ status: 'reviewing' }),
      Report.countDocuments({ status: 'resolved' }),
    ]);

    res.status(200).json({
      success: true,
      count: reports.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
      stats: { pendingCount, reviewingCount, resolvedCount },
      reports,
    });
  } catch (error) {
    next(error);
  }
};

const updateAdminReportStatus = async (req, res, next) => {
  try {
    const { status, adminReply } = req.body;
    const validStatuses = ['pending', 'reviewing', 'resolved', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'حالة غير صالحة' });
    }

    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: 'البلاغ غير موجود' });

    report.status = status;
    if (typeof adminReply === 'string') {
      report.adminReply = adminReply.trim();
    }
    await report.save();

    if (status === 'resolved' || status === 'rejected') {
      const kind = report.type === 'suggestion' ? 'مقترحك' : 'شكواك';
      await Notification.create({
        user: report.user,
        title: status === 'resolved' ? `تم الرد على ${kind}` : `تحديث بخصوص ${kind}`,
        message: report.adminReply
          ? report.adminReply
          : (status === 'resolved'
            ? `تمت مراجعة ${kind} بعنوان "${report.subject}" من إدارة المنصة.`
            : `تم إغلاق ${kind} بعنوان "${report.subject}".`),
        type: 'system',
      }).catch((error) => console.error('Failed to notify the user about report status:', error.message));
    }

    res.status(200).json({ success: true, message: 'تم تحديث البلاغ بنجاح', report });
  } catch (error) {
    next(error);
  }
};

// @desc    حذف وظيفة نهائياً من قِبل المشرف (أو اعتماد طلب الحذف)
// @route   DELETE /api/admin/jobs/:id
// @access  Private (Admin)
const deleteAdminJob = async (req, res, next) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });

    const jobId = job._id;
    const relatedApplications = await Application.find({ job: jobId }).select('_id');
    const applicationIds = relatedApplications.map((a) => a._id);

    if (applicationIds.length > 0) {
      await Message.deleteMany({ application: { $in: applicationIds } });
    }
    await Notification.deleteMany({ job: jobId });
    await Application.deleteMany({ job: jobId });
    await SavedJob.deleteMany({ job: jobId });
    await job.deleteOne();

    // إشعار لصاحب العمل
    await Notification.create({
      user: job.postedBy,
      title: 'تم حذف الوظيفة من المنصة 🗑️',
      message: `تمت الموافقة على حذف وظيفة "${job.title}" وتمت إزالتها نهائياً من المنصة.`,
      type: 'system',
    }).catch((error) => console.error('Failed to notify the employer about job deletion:', error.message));

    res.status(200).json({
      success: true,
      message: 'تم حذف الوظيفة وكافة البيانات المرتبطة بها نهائياً بنجاح',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    جلب إشعارات الأدمن المقسمة حسب النوع
// @route   GET /api/admin/notifications
// @access  Private (Admin)
const getAdminNotifications = async (req, res, next) => {
  try {
    const limit = 8; // آخر 8 لكل قسم

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deletedKeys = await AdminNotificationState.distinct('notificationKey', {
      admin: req.user._id,
      isDeleted: true,
    });
    const deletedIdsByType = Object.fromEntries(['user', 'company', 'job', 'report'].map(type => [
      type,
      deletedKeys
        .filter(key => key.startsWith(`${type}:`))
        .map(key => key.slice(type.length + 1)),
    ]));
    const excludeDeleted = type => deletedIdsByType[type].length
      ? { _id: { $nin: deletedIdsByType[type] } }
      : {};
    const newUsersFilter = {
      role: 'job_seeker',
      createdAt: { $gte: weekAgo },
      ...excludeDeleted('user'),
    };
    const pendingJobFilter = {
      status: { $in: ['reviewing', 'deletion_pending'] },
      ...excludeDeleted('job'),
    };
    const pendingCompanyFilter = {
      role: 'employer',
      accountStatus: 'reviewing',
      ...excludeDeleted('company'),
    };
    const pendingReportFilter = {
      status: { $in: ['pending', 'reviewing', 'open'] },
      ...excludeDeleted('report'),
    };
    const [newUsers, newCompanies, pendingJobs, reports, recentAll, newUsersCount, pendingCompaniesCount, pendingJobsCount, pendingReportsCount] = await Promise.all([
      // مستخدمون جدد (آخر 7 أيام)
      User.find(newUsersFilter)
        .select('name email createdAt avatar')
        .sort({ createdAt: -1 }).limit(limit).lean(),

      // شركات تحتاج موافقة
      User.find(pendingCompanyFilter)
        .select('name email company accountStatus createdAt avatar')
        .sort({ createdAt: -1 }).limit(limit).lean(),

      // وظائف تنتظر الموافقة أو طلبات حذف
      Job.find(pendingJobFilter)
        .populate('postedBy', 'name company')
        .select('title company status createdAt postedBy')
        .sort({ createdAt: -1 }).limit(limit).lean(),

      // الشكاوي والمقترحات الجديدة
      Report.find(pendingReportFilter)
        .populate('user', 'name email')
        .select('type subject status createdAt user')
        .sort({ createdAt: -1 }).limit(limit).lean(),

      // آخر الأنشطة العامة (مزيج)
      (async () => {
        const [jobs, users, reps] = await Promise.all([
          Job.find(pendingJobFilter).sort({ createdAt: -1 }).limit(4).select('title status createdAt').lean(),
          User.find({
            role: { $ne: 'admin' },
            _id: { $nin: [...deletedIdsByType.user, ...deletedIdsByType.company] },
          }).sort({ createdAt: -1 }).limit(4).select('name role company createdAt').lean(),
          Report.find({ ...excludeDeleted('report') }).sort({ createdAt: -1 }).limit(4).select('subject type createdAt').lean(),
        ]);
        return [
          ...jobs.map(j => ({ type: 'job', entityId: j._id, searchText: j.title, status: j.status, text: j.status === 'deletion_pending' ? `طلب حذف وظيفة: ${j.title}` : `وظيفة تنتظر الموافقة: ${j.title}`, date: j.createdAt })),
          ...users.map(u => ({
            type: u.role === 'employer' ? 'company' : 'user',
            entityId: u._id,
            searchText: u.company || u.name,
            text: `${u.role === 'employer' ? 'شركة' : 'مستخدم'} جديد: ${u.company || u.name}`,
            date: u.createdAt,
          })),
          ...reps.map(r => ({ type: 'report', entityId: r._id, searchText: r.subject, text: `${r.type === 'complaint' ? 'شكوى' : 'مقترح'}: ${r.subject}`, date: r.createdAt })),
        ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, limit);
      })(),
      User.countDocuments(newUsersFilter),
      User.countDocuments(pendingCompanyFilter),
      Job.countDocuments(pendingJobFilter),
      Report.countDocuments(pendingReportFilter),
    ]);

    const notificationItems = [
      ...recentAll.map(item => ({ ...item, notificationType: item.type })),
      ...newUsers.map(item => ({ ...item, notificationType: 'user' })),
      ...newCompanies.map(item => ({ ...item, notificationType: 'company' })),
      ...pendingJobs.map(item => ({ ...item, notificationType: 'job' })),
      ...reports.map(item => ({ ...item, notificationType: 'report' })),
    ];
    const uniqueItems = [...new Map(notificationItems.map(item => [
      `${item.notificationType}:${item.entityId || item._id}`,
      { ...item, notificationKey: `${item.notificationType}:${item.entityId || item._id}` },
    ])).values()];
    const states = await AdminNotificationState.find({
      admin: req.user._id,
      notificationKey: { $in: uniqueItems.map(item => item.notificationKey) },
    }).select('notificationKey isRead isDeleted').lean();
    const stateByKey = new Map(states.map(state => [state.notificationKey, state]));
    const withState = item => {
      const state = stateByKey.get(item.notificationKey);
      return { ...item, isRead: state?.isRead || false, isDeleted: state?.isDeleted || false };
    };
    const visible = (items, fallbackType) => items.map(item => {
      const notificationType = item.notificationType || item.type || fallbackType;
      const entityId = item.entityId || item._id;
      return withState({
        ...item,
        notificationKey: `${notificationType}:${entityId}`,
      });
    }).filter(item => !item.isDeleted);
    const visibleRecentAll = visible(recentAll);
    const visibleUsers = visible(newUsers, 'user');
    const visibleCompanies = visible(newCompanies, 'company');
    const visibleJobs = visible(pendingJobs, 'job');
    const visibleReports = visible(reports, 'report');
    const totalPending = pendingCompaniesCount + pendingJobsCount + pendingReportsCount;

    res.status(200).json({
      success: true,
      totalPending,
      counts: {
        all: visibleRecentAll.length,
        users: newUsersCount,
        companies: pendingCompaniesCount,
        jobs: pendingJobsCount,
        reports: pendingReportsCount,
      },
      unreadCounts: {
        all: visibleRecentAll.filter(item => !item.isRead).length,
        users: visibleUsers.filter(item => !item.isRead).length,
        companies: visibleCompanies.filter(item => !item.isRead).length,
        jobs: visibleJobs.filter(item => !item.isRead).length,
        reports: visibleReports.filter(item => !item.isRead).length,
      },
      newUsers: visibleUsers,
      newCompanies: visibleCompanies,
      pendingJobs: visibleJobs,
      reports: visibleReports,
      recentAll: visibleRecentAll,
    });
  } catch (error) {
    next(error);
  }
};

const getAdminNotificationCount = async (req, res, next) => {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deletedKeys = await AdminNotificationState.distinct('notificationKey', {
      admin: req.user._id,
      isDeleted: true,
    });
    const deletedIdsByType = Object.fromEntries(['user', 'company', 'job', 'report'].map(type => [
      type,
      deletedKeys
        .filter(key => key.startsWith(`${type}:`))
        .map(key => key.slice(type.length + 1)),
    ]));
    const excludeDeleted = type => deletedIdsByType[type].length
      ? { _id: { $nin: deletedIdsByType[type] } }
      : {};

    const [newUsers, companies, jobs, reports] = await Promise.all([
      User.countDocuments({
        role: 'job_seeker',
        createdAt: { $gte: weekAgo },
        ...excludeDeleted('user'),
      }),
      User.countDocuments({
        role: 'employer',
        accountStatus: 'reviewing',
        ...excludeDeleted('company'),
      }),
      Job.countDocuments({
        status: { $in: ['reviewing', 'deletion_pending'] },
        ...excludeDeleted('job'),
      }),
      Report.countDocuments({
        status: { $in: ['pending', 'reviewing', 'open'] },
        ...excludeDeleted('report'),
      }),
    ]);

    res.status(200).json({
      success: true,
      totalPending: newUsers + companies + jobs + reports,
    });
  } catch (error) {
    next(error);
  }
};

const updateAdminNotificationStates = async (req, res, next) => {
  try {
    const { keys, action } = req.body;
    const allowedActions = ['read', 'unread', 'delete'];
    const validKey = /^(user|company|job|report):[a-f\d]{24}$/i;

    if (!Array.isArray(keys) || keys.length === 0 || keys.length > 200 || !keys.every(key => typeof key === 'string' && validKey.test(key))) {
      return res.status(400).json({ success: false, message: 'قائمة الإشعارات المحددة غير صالحة' });
    }
    if (!allowedActions.includes(action)) {
      return res.status(400).json({ success: false, message: 'الإجراء المطلوب غير صالح' });
    }

    const uniqueKeys = [...new Set(keys)];
    const update = action === 'delete'
      ? { isDeleted: true }
      : { isRead: action === 'read' };
    await AdminNotificationState.bulkWrite(uniqueKeys.map(notificationKey => ({
      updateOne: {
        filter: { admin: req.user._id, notificationKey },
        update: { $set: update, $setOnInsert: { admin: req.user._id, notificationKey } },
        upsert: true,
      },
    })));

    res.status(200).json({ success: true, updatedCount: uniqueKeys.length });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboardStats,
  getAllUsers,
  updateUserStatus,
  getAllCompanies,
  updateCompanyStatus,
  getAdminAllJobs,
  getAdminJobDetails,
  updateAdminJobStatus,
  deleteAdminJob,
  getAdminAllApplications,
  getAdminAllReports,
  updateAdminReportStatus,
  getAdminNotifications,
  getAdminNotificationCount,
  updateAdminNotificationStates,
};
