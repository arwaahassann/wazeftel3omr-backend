const { normalizePhoneInput } = require('../utils/accountIdentity');
const { getCairoDate } = require('../utils/cairoDate');
const defaultSendJobStatusEmail = require('../utils/sendJobStatusEmail');

const hasValidCompanyPhone = (phone) => {
  const normalizedPhone = normalizePhoneInput(phone);
  const digits = normalizedPhone.replace(/\D/g, '');
  return /^[+\d\s().-]+$/.test(normalizedPhone)
    && digits.length >= 8
    && digits.length <= 15;
};

const createMysqlStagingJobController = (
  jobs,
  { sendJobStatusEmail = defaultSendJobStatusEmail } = {},
) => {
  const notify = async (data, errorMessage) => {
    try {
      await jobs.createNotification(data);
    } catch (error) {
      console.error(errorMessage, error.message);
    }
  };

  const closeExpiredJobs = () => jobs.closeExpiredJobs(getCairoDate());

  const getAllJobs = async (req, res, next) => {
    try {
      await closeExpiredJobs();
      const { search, location, jobType, category, level, sortBy = 'newest' } = req.query;
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 6));
      const { jobs: results, total } = await jobs.listPublic({
        search,
        location,
        jobType,
        category,
        level,
        sortBy,
        page,
        limit,
      });
      return res.status(200).json({
        success: true,
        count: results.length,
        total,
        page,
        pages: Math.ceil(total / limit) || 1,
        jobs: results,
      });
    } catch (error) {
      return next(error);
    }
  };

  const getJobById = async (req, res, next) => {
    try {
      await closeExpiredJobs();
      const job = await jobs.findPublicById(req.params.id);
      if (!job) return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });
      return res.status(200).json({ success: true, job });
    } catch (error) {
      return next(error);
    }
  };

  const createJob = async (req, res, next) => {
    try {
      if (req.user.role === 'employer') {
        if (!hasValidCompanyPhone(req.user.phone)) {
          return res.status(400).json({
            success: false,
            message: 'لن يتم إرسال إعلان الوظيفة للمراجعة قبل إضافة رقم التواصل الأساسي للشركة في إعدادات الحساب. سيظهر هذا الرقم لإدارة المنصة.',
          });
        }
        if (req.user.accountStatus !== 'active') {
          return res.status(403).json({
            success: false,
            message: 'حساب شركتك قيد المراجعة حالياً. يمكنك نشر الوظائف بعد موافقة إدارة المنصة على الشركة.',
          });
        }
      }

      const {
        title, company, location, jobType, category, description, requirements,
        salary, level, experience, qualifications, specialty, degree, workTime, closingDate,
      } = req.body;
      const job = await jobs.create({
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

      await notify({
        userId: req.user._id,
        jobId: job._id,
        title: req.user.role === 'admin' ? 'تم نشر وظيفتك بنجاح ✅' : 'تم استلام طلب نشر الوظيفة ⏳',
        message: req.user.role === 'admin'
          ? `تم نشر وظيفتك "${job.title}" وأصبحت متاحة للتقديم الآن.`
          : `تم استلام إعلان وظيفة "${job.title}". الوظيفة قيد المراجعة حالياً من قِبل إدارة المنصة وسيتم إشعارك فور اعتمادها.`,
        type: req.user.role === 'admin' ? 'system' : 'pending',
      }, 'Failed to notify the job poster from MySQL staging:');
      if (req.user.role === 'employer') {
        try {
          await sendJobStatusEmail({
            email: req.user.email,
            title: job.title,
            status: 'reviewing',
          });
        } catch (error) {
          console.error('Failed to send the MySQL staging job submission email:', error.message);
        }
      }

      return res.status(201).json({
        success: true,
        message: req.user.role === 'admin'
          ? 'تم إضافة الوظيفة بنجاح'
          : 'تم إرسال الوظيفة للمراجعة، سيتم تفعيلها بعد موافقة الإدارة',
        job,
      });
    } catch (error) {
      return next(error);
    }
  };

  const updateJob = async (req, res, next) => {
    try {
      const existing = await jobs.findOwnedById(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });
      if (existing.postedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'غير مصرح لك بتعديل هذه الوظيفة' });
      }
      if (req.user.role === 'employer' && !hasValidCompanyPhone(req.user.phone)) {
        return res.status(400).json({
          success: false,
          message: 'لن يتم إرسال إعلان الوظيفة للمراجعة قبل إضافة رقم التواصل الأساسي للشركة في إعدادات الحساب. سيظهر هذا الرقم لإدارة المنصة.',
        });
      }

      const fields = [
        'title', 'company', 'location', 'jobType', 'category', 'description',
        'requirements', 'salary', 'level', 'experience', 'qualifications',
        'specialty', 'degree', 'workTime', 'closingDate', 'status',
      ];
      const updates = Object.fromEntries(
        fields.filter((field) => req.body[field] !== undefined)
          .map((field) => [field, req.body[field]]),
      );
      if (req.user.role !== 'admin') updates.status = 'reviewing';

      const job = await jobs.update(req.params.id, updates);
      if (req.user.role !== 'admin') {
        await notify({
          userId: req.user._id,
          jobId: job._id,
          title: 'تم استلام تعديلات الوظيفة ⏳',
          message: `تم إرسال تعديلاتك على وظيفة "${job.title}" للمراجعة، وسيتم إعادة تفعيلها فور موافقة إدارة المنصة.`,
          type: 'pending',
        }, 'Failed to notify the job poster about the MySQL staging job update:');
      }
      return res.status(200).json({
        success: true,
        message: req.user.role === 'admin'
          ? 'تم تحديث الوظيفة بنجاح'
          : 'تم إرسال تعديلات الوظيفة للمراجعة بنجاح، وسيتم تفعيلها بعد موافقة الإدارة',
        job,
      });
    } catch (error) {
      return next(error);
    }
  };

  const deleteJob = async (req, res, next) => {
    try {
      const job = await jobs.findOwnedById(req.params.id);
      if (!job) return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });
      if (job.postedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'غير مصرح لك بحذف هذه الوظيفة' });
      }
      if (req.user.role !== 'admin') {
        const pending = await jobs.markDeletionPending(job._id);
        await notify({
          userId: req.user._id,
          jobId: job._id,
          title: 'طلب حذف وظيفة قيد المراجعة ⏳',
          message: `تم استلام طلبك لحذف وظيفة "${job.title}". لن يتم الحذف النهائي إلا بعد موافقة إدارة المنصة.`,
          type: 'pending',
        }, 'Failed to notify the job poster about the MySQL staging deletion request:');
        return res.status(200).json({
          success: true,
          message: 'تم إرسال طلب حذف الوظيفة لإدارة المنصة بنجاح، ولن يتم الحذف إلا بعد مراجعة وموافقة المشرف.',
          job: pending,
        });
      }

      await jobs.delete(job._id);
      return res.status(200).json({
        success: true,
        message: 'تم حذف الوظيفة وجميع البيانات المرتبطة بها بنجاح',
      });
    } catch (error) {
      return next(error);
    }
  };

  const getMyJobs = async (req, res, next) => {
    try {
      await closeExpiredJobs();
      const results = await jobs.listOwnedByUser(req.user._id);
      return res.status(200).json({ success: true, count: results.length, jobs: results });
    } catch (error) {
      return next(error);
    }
  };

  const expireJobsFromCron = async (req, res, next) => {
    try {
      const cronSecret = process.env.CRON_SECRET;
      if (!cronSecret) {
        return res.status(503).json({
          success: false,
          message: 'لم يتم إعداد CRON_SECRET لتشغيل الإغلاق التلقائي للوظائف',
        });
      }
      if (req.get('authorization') !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ success: false, message: 'غير مصرح' });
      }
      const result = await closeExpiredJobs();
      return res.status(200).json({ success: true, closedCount: result.modifiedCount });
    } catch (error) {
      return next(error);
    }
  };

  const toggleSaveJob = async (req, res, next) => {
    try {
      const job = await jobs.findPublicById(req.params.jobId);
      if (!job) {
        return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة أو تم حذفها' });
      }
      const saved = await jobs.toggleSavedJob(req.user._id, req.params.jobId);
      return res.status(200).json({
        success: true,
        saved,
        message: saved ? 'تم حفظ الوظيفة في المفضلة بنجاح ❤️' : 'تم إلغاء حفظ الوظيفة من المفضلة',
      });
    } catch (error) {
      return next(error);
    }
  };

  const getSavedJobs = async (req, res, next) => {
    try {
      await closeExpiredJobs();
      const savedJobs = await jobs.listSavedJobs(req.user._id);
      return res.status(200).json({ success: true, count: savedJobs.length, savedJobs });
    } catch (error) {
      return next(error);
    }
  };

  return {
    getAllJobs,
    getJobById,
    createJob,
    updateJob,
    deleteJob,
    getMyJobs,
    expireJobsFromCron,
    toggleSaveJob,
    getSavedJobs,
  };
};

module.exports = { createMysqlStagingJobController };
