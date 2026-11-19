const validAccountStatuses = ['active', 'reviewing', 'suspended'];
const validJobStatuses = ['active', 'closed', 'reviewing', 'rejected'];

const createMysqlStagingAdminFeaturesController = (repository, options = {}) => {
  const getAllCompanies = async (req, res, next) => {
    try {
      const { companies, total, page, pages } = await repository.listCompanies(req.query);
      return res.status(200).json({ success: true, count: companies.length, total, page, pages, companies });
    } catch (error) {
      return next(error);
    }
  };

  const updateCompanyStatus = async (req, res, next) => {
    try {
      const { status } = req.body;
      if (!validAccountStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'حالة غير صالحة' });
      }
      const result = await repository.updateCompanyStatus(req.params.id, status);
      if (result.error === 'NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'الشركة غير موجودة' });
      }
      if (result.error === 'INVALID_PHONE') {
        return res.status(400).json({
          success: false,
          message: 'لا يمكن اعتماد الشركة قبل إضافة رقم التواصل الأساسي الصحيح في إعدادات حسابها',
        });
      }
      if (result.error === 'INCOMPLETE_COMPANY') {
        return res.status(400).json({
          success: false,
          message: 'لا يمكن اعتماد الشركة قبل استكمال العنوان التفصيلي ورفع السجل التجاري والبطاقة الضريبية',
        });
      }
      return res.status(200).json({
        success: true,
        message: 'تم تحديث حالة الشركة بنجاح',
        company: result.company,
      });
    } catch (error) {
      return next(error);
    }
  };

  const getAdminCompanyDocument = async (req, res, next) => {
    try {
      if (!['commercialRegister', 'taxCard'].includes(req.params.documentType)) {
        return res.status(400).json({ success: false, message: 'نوع المستند غير صالح' });
      }
      const document = await repository.getCompanyDocument(req.params.id, req.params.documentType);
      if (!document?.dataUrl) {
        return res.status(404).json({ success: false, message: 'مستند الشركة غير موجود' });
      }
      return res.status(200).json({ success: true, document });
    } catch (error) {
      return next(error);
    }
  };

  const getAdminSeekers = async (req, res, next) => {
    try {
      const { status } = req.query;
      if (status && status !== 'all' && !validAccountStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'حالة الباحث عن عمل غير صالحة' });
      }
      const { seekers, total, page, pages } = await repository.listSeekers(req.query);
      return res.status(200).json({ success: true, count: seekers.length, total, page, pages, seekers });
    } catch (error) {
      return next(error);
    }
  };

  const updateAdminSeekerStatus = async (req, res, next) => {
    try {
      const { status } = req.body;
      if (!validAccountStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'حالة الباحث عن عمل غير صالحة' });
      }
      const seeker = await repository.updateSeekerStatus(req.params.id, status);
      if (!seeker) {
        return res.status(404).json({ success: false, message: 'الباحث عن عمل غير موجود' });
      }
      return res.status(200).json({
        success: true,
        message: 'تم تحديث حالة الباحث عن عمل بنجاح',
        seeker,
      });
    } catch (error) {
      return next(error);
    }
  };

  const getAdminAllJobs = async (req, res, next) => {
    try {
      const result = await repository.listJobs(req.query);
      if (result.error === 'INVALID_CURSOR') {
        return res.status(400).json({ success: false, message: 'مؤشر صفحة الوظائف غير صالح' });
      }
      return res.status(200).json({
        success: true,
        count: result.jobs.length,
        jobs: result.jobs,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      });
    } catch (error) {
      return next(error);
    }
  };

  const getAdminJobDetails = async (req, res, next) => {
    try {
      const job = await repository.getJobDetails(req.params.id);
      if (!job) return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });
      return res.status(200).json({ success: true, job });
    } catch (error) {
      return next(error);
    }
  };

  const updateAdminJobStatus = async (req, res, next) => {
    try {
      const { status } = req.body;
      const rejectionReason = typeof req.body.rejectionReason === 'string'
        ? req.body.rejectionReason.trim()
        : '';
      if (!validJobStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'حالة غير صالحة' });
      }
      if (rejectionReason.length > 500) {
        return res.status(400).json({ success: false, message: 'سبب الرفض لا يمكن أن يتجاوز 500 حرف' });
      }
      if (status !== 'rejected' && rejectionReason) {
        return res.status(400).json({ success: false, message: 'يمكن إرسال سبب الرفض عند رفض الإعلان فقط' });
      }
      const job = await repository.updateJobStatus(req.params.id, status);
      if (!job) return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });

      if (status === 'active' || status === 'rejected') {
        const title = status === 'active'
          ? 'تهانينا! تمت الموافقة على نشر وظيفتك ✅'
          : 'تحديث بخصوص إعلان الوظيفة ❌';
        const message = status === 'active'
          ? `تمت مراجعة وظيفتك "${job.title}" واعتمادها من قبل إدارة المنصة وأصبحت متاحة للتقديم الآن.`
          : `نعتذر، تم رفض إعلان الوظيفة "${job.title}". سبب الرفض: ${rejectionReason || 'لم يتم توضيح سبب الرفض.'}`;
        try {
          await repository.createJobStatusNotification(job.postedBy?._id, job._id, title, message);
        } catch (error) {
          console.error('Failed to create the job status notification:', error.message);
        }
        try {
          await options.sendJobStatusEmail?.({
            email: await repository.getEmployerEmail(job.postedBy?._id),
            title: job.title,
            status,
            rejectionReason,
          });
        } catch (error) {
          console.error(`Failed to send job ${status} email:`, error.message);
        }
      }
      return res.status(200).json({ success: true, message: 'تم تحديث حالة الوظيفة بنجاح', job });
    } catch (error) {
      return next(error);
    }
  };

  const deleteAdminJob = async (req, res, next) => {
    try {
      const job = await repository.deleteJob(req.params.id);
      if (!job) return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });
      return res.status(200).json({
        success: true,
        message: 'تم حذف الوظيفة وكافة البيانات المرتبطة بها نهائياً بنجاح',
      });
    } catch (error) {
      return next(error);
    }
  };

  return {
    getAllCompanies,
    updateCompanyStatus,
    getAdminCompanyDocument,
    getAdminSeekers,
    updateAdminSeekerStatus,
    getAdminAllJobs,
    getAdminJobDetails,
    updateAdminJobStatus,
    deleteAdminJob,
  };
};

module.exports = { createMysqlStagingAdminFeaturesController };
