const { getCairoDate } = require('../utils/cairoDate');
const defaultSendEmail = require('../utils/sendStagingEmail');

const finalStatuses = ['accepted', 'rejected'];
const validStatuses = ['pending', 'reviewing', 'interview', ...finalStatuses];
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[character]);

const createMysqlStagingApplicationController = (
  applications,
  jobs,
  { sendEmail = defaultSendEmail } = {},
) => {
  const closeExpiredJobs = () => jobs.closeExpiredJobs(getCairoDate());

  const applyForJob = async (req, res, next) => {
    try {
      await closeExpiredJobs();
      let application;
      try {
        application = await applications.create({
          user: req.user,
          jobId: req.params.jobId,
          input: req.body || {},
        });
      } catch (error) {
        if (error.code === 'JOB_NOT_AVAILABLE') {
          return res.status(404).json({
            success: false,
            message: 'الوظيفة مغلقة أو غير متاحة للتقديم',
          });
        }
        if (error.code === 'JOB_OWNER_APPLY') {
          return res.status(400).json({
            success: false,
            message: 'لا يمكنك التقديم على وظيفة قمت بنشرها بنفسك',
          });
        }
        if (error.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({
            success: false,
            message: 'لقد قمت بالتقديم على هذه الوظيفة من قبل!',
          });
        }
        throw error;
      }

      let emailSent = false;
      const candidateEmail = String(application.email || '').trim();
      if (candidateEmail) {
        try {
          const job = await jobs.findOwnedById(req.params.jobId);
          const result = await sendEmail({
            email: candidateEmail,
            fromName: 'وظيفة العمر',
            subject: `تم استلام طلبك لوظيفة ${job.title}`,
            message: `مرحباً ${application.name || req.user.name}، تم استلام طلبك لوظيفة (${job.title}) لدى (${job.company || 'الشركة المُعلنة'}) وهو الآن قيد المراجعة. إذا كان ملفك مناسباً لمتطلبات الوظيفة، ستتواصل معك الشركة لتحديد موعد مقابلة. يمكنك متابعة حالة طلبك من حسابك على منصة وظيفة العمر.`,
            html: `
              <div dir="rtl" lang="ar">
                <h1>تم استلام طلب التقديم</h1>
                <p>مرحباً ${escapeHtml(application.name || req.user.name)}،</p>
                <p>تم استلام طلبك لوظيفة <strong>${escapeHtml(job.title)}</strong>
                  لدى <strong>${escapeHtml(job.company || 'الشركة المُعلنة')}</strong>، والطلب الآن قيد المراجعة.</p>
                <p>يمكنك متابعة حالة طلبك وإشعارات المقابلة من حسابك على منصة وظيفة العمر.</p>
              </div>`,
          });
          emailSent = result?.sent === true;
          if (!emailSent) {
            console.error('MySQL staging application confirmation email was not sent:', result?.reason || 'UNKNOWN_REASON');
          }
        } catch (error) {
          console.error('Failed to send MySQL staging application confirmation email:', error.message);
        }
      } else {
        console.error('MySQL staging application confirmation email was not sent: applicant email is missing');
      }

      const applicationResponse = { ...application };
      delete applicationResponse.cvUrl;
      return res.status(201).json({
        success: true,
        message: 'تم التقديم على الوظيفة بنجاح! نتمنى لك التوفيق 🎉',
        emailSent,
        application: applicationResponse,
      });
    } catch (error) {
      return next(error);
    }
  };

  const getMyApplications = async (req, res, next) => {
    try {
      const applicationsList = await applications.getApplicantApplications(req.user._id, req.query.status);
      return res.status(200).json({
        success: true,
        count: applicationsList.length,
        applications: applicationsList,
      });
    } catch (error) {
      return next(error);
    }
  };

  const getApplicationStats = async (req, res, next) => {
    try {
      const stats = await applications.getSeekerStats(req.user._id);
      return res.status(200).json({ success: true, stats });
    } catch (error) {
      return next(error);
    }
  };

  const updateApplicationStatus = async (req, res, next) => {
    try {
      const { status, notes, interviewDetails, decisionMessage } = req.body;
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'حالة طلب التوظيف غير صالحة.' });
      }
      const current = await applications.findById(req.params.id);
      if (!current) {
        return res.status(404).json({ success: false, message: 'طلب التوظيف غير موجود' });
      }
      const job = await jobs.findOwnedById(current.job);
      if (!job) {
        return res.status(404).json({ success: false, message: 'الوظيفة المرتبطة بطلب التوظيف لم تعد موجودة' });
      }
      if (req.user.role !== 'admin' && String(job.postedBy) !== String(req.user._id)) {
        return res.status(403).json({ success: false, message: 'غير مصرح لك بتحديث حالة هذا الطلب' });
      }

      const effectiveDetails = interviewDetails || current.interviewDetails || {};
      let notificationTitle;
      let notificationMessage;
      if (status === 'interview') {
        const formatText = effectiveDetails.format === 'online' ? 'عبر الإنترنت' : 'حضورياً بمقر الشركة';
        notificationTitle = `📅 دعوة لمقابلة عمل: ${job.title}`;
        notificationMessage = `دعوة لمقابلة عمل لوظيفة (${job.title}) لدى (${job.company}). الموعد: ${effectiveDetails.date || 'قريباً'} ${effectiveDetails.time ? `الساعة ${effectiveDetails.time}` : ''} - ${formatText}${effectiveDetails.location ? ` (${effectiveDetails.location})` : ''}${effectiveDetails.notes ? ` ملاحظات: ${effectiveDetails.notes}` : ''}`;
      } else if (status === 'accepted') {
        notificationTitle = `🎉 تم قبول طلبك: ${job.title}`;
        notificationMessage = decisionMessage
          || `تهانينا! تم قبول طلبك لوظيفة (${job.title}) لدى (${job.company}). ستتواصل معك الشركة لمناقشة الخطوات التالية.`;
      } else if (status === 'rejected') {
        notificationTitle = `تحديث بخصوص طلب وظيفة: ${job.title}`;
        notificationMessage = decisionMessage
          || `نشكرك على اهتمامك بوظيفة (${job.title}) لدى (${job.company}). نعتذر لعدم المضي في طلبك هذه المرة، ونتمنى لك التوفيق.`;
      } else if (status === 'reviewing') {
        notificationTitle = `طلبك قيد المراجعة: ${job.title}`;
        notificationMessage = `طلبك لوظيفة (${job.title}) لدى (${job.company}) قيد المراجعة حالياً.`;
      } else {
        notificationTitle = `تحديث طلب التقديم: ${job.title}`;
        notificationMessage = `تم تحديث حالة طلبك لوظيفة (${job.title}) لدى (${job.company}) إلى قيد الانتظار.`;
      }

      const outcome = await applications.updateStatus(
        req.params.id,
        req.user.role === 'admin' ? null : req.user._id,
        {
          status,
          notes,
          interviewDetails,
          decisionMessage,
          notificationTitle,
          notificationMessage,
          notificationType: status,
        },
      );
      if (outcome.error === 'NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'طلب التوظيف غير موجود' });
      }
      if (outcome.error === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'غير مصرح لك بتحديث حالة هذا الطلب' });
      }
      if (outcome.error === 'FINALIZED') {
        return res.status(409).json({
          success: false,
          message: 'تم اعتماد القرار النهائي لهذا المتقدم بالفعل، ولا يمكن تغييره.',
        });
      }
      if (outcome.error === 'BUSY') {
        return res.status(409).json({
          success: false,
          message: 'يوجد إجراء قيد التنفيذ لهذا المتقدم. حاولي مرة أخرى بعد لحظات.',
        });
      }

      const candidateEmail = outcome.candidateEmail;
      const emailAlreadySent = outcome.emailAlreadySent;
      let emailResult = emailAlreadySent
        ? { sent: true, sender: process.env.EMAIL_FROM || process.env.EMAIL_USER }
        : { sent: false, reason: 'SMTP_NOT_CONFIGURED' };
      if (!candidateEmail) {
        emailResult = { sent: false, reason: 'RECIPIENT_REJECTED' };
      } else if (!emailAlreadySent) {
        const detail = outcome.interviewDetails || {};
        const interviewHtml = status === 'interview'
          ? `<p>التاريخ: <strong>${escapeHtml(detail.date || 'قريباً')}</strong></p>
             <p>الوقت: <strong>${escapeHtml(detail.time || 'سيحدد لاحقاً')}</strong></p>
             <p>نوع المقابلة: <strong>${detail.format === 'online' ? 'عن بُعد' : 'حضورياً بمقر الشركة'}</strong></p>
             <p>المكان / الرابط: <strong>${escapeHtml(detail.location || 'سيتم تأكيده لاحقاً')}</strong></p>
             ${detail.notes ? `<p>${escapeHtml(detail.notes)}</p>` : ''}`
          : '';
        try {
          emailResult = await sendEmail({
            email: candidateEmail,
            fromName: 'وظيفة العمر',
            subject: notificationTitle,
            message: notificationMessage,
            html: `
              <div dir="rtl" lang="ar">
                <h1>${escapeHtml(notificationTitle)}</h1>
                <p>مرحباً ${escapeHtml(outcome.applicantName)}،</p>
                <p>${escapeHtml(notificationMessage)}</p>
                ${interviewHtml}
                <p>مع تحيات ${escapeHtml(outcome.companyName)}.</p>
              </div>`,
          });
          if (emailResult?.reason === 'NO_CREDENTIALS') {
            emailResult = { ...emailResult, reason: 'SMTP_NOT_CONFIGURED' };
          }
        } catch (error) {
          console.error('Failed to send MySQL staging application decision email:', error.message);
          emailResult = { sent: false, reason: 'DELIVERY_FAILED' };
        }
      }

      if (!emailResult?.sent) {
        await applications.completeStatusEmail(req.params.id, false);
        const messages = {
          SMTP_NOT_CONFIGURED: 'بيانات البريد المرسل الموجودة في إعدادات الخادم غير مكتملة.',
          RECIPIENT_REJECTED: 'لا يوجد بريد إلكتروني صالح للمتقدم.',
          DELIVERY_FAILED: 'تعذر إرسال البريد من حساب المنصة. تحققي من بيانات البريد في إعدادات الخادم ثم أعيدي المحاولة.',
        };
        return res.status(502).json({
          success: false,
          decisionRecorded: true,
          status,
          emailSent: false,
          notificationSent: outcome.notificationSent,
          message: `${messages[emailResult?.reason] || 'تعذر إرسال البريد الإلكتروني.'} تم تحديث الحالة وإرسال إشعار الباحث، ويمكن إعادة إرسال البريد من تفاصيل المتقدم.`,
        });
      }

      const updated = await applications.completeStatusEmail(req.params.id, true);
      return res.status(200).json({
        success: true,
        message: `تم الإرسال بنجاح.${finalStatuses.includes(status) ? ' لا يمكن تغيير القرار النهائي بعد ذلك.' : ''}`,
        emailSent: true,
        emailRecipient: candidateEmail,
        emailSender: emailResult.sender || process.env.EMAIL_FROM || process.env.EMAIL_USER,
        notificationSent: outcome.notificationSent,
        application: updated,
      });
    } catch (error) {
      return next(error);
    }
  };

  const getJobApplications = async (req, res, next) => {
    try {
      const job = await jobs.findOwnedById(req.params.jobId);
      if (!job) return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });
      if (String(job.postedBy) !== String(req.user._id) && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'غير مصرح لك' });
      }
      const results = await applications.getJobApplications(req.params.jobId);
      return res.status(200).json({ success: true, count: results.length, applications: results });
    } catch (error) {
      return next(error);
    }
  };

  const getEmployerApplicationDetails = async (req, res, next) => {
    try {
      const application = await applications.getEmployerApplicationDetails(req.params.id);
      if (!application) {
        return res.status(404).json({ success: false, message: 'طلب التقديم غير موجود' });
      }
      const jobOwnerId = application.job.postedBy?._id || application.job.postedBy;
      if (String(jobOwnerId) !== String(req.user._id) && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'غير مصرح لك' });
      }
      return res.status(200).json({ success: true, application });
    } catch (error) {
      return next(error);
    }
  };

  const getEmployerApplicantStats = async (req, res, next) => {
    try {
      const stats = await applications.getEmployerStats(req.user._id);
      return res.status(200).json({ success: true, stats });
    } catch (error) {
      return next(error);
    }
  };

  const getAllEmployerApplicants = async (req, res, next) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
      const summary = req.query.summary === 'true';
      const result = await applications.getEmployerApplications(req.user._id, {
        page,
        limit,
        status: req.query.status,
        summary,
      });
      return res.status(200).json({
        success: true,
        count: result.applications.length,
        ...(summary ? { total: result.total, interviewCount: result.interviewCount, activeJobsCount: result.activeJobsCount, page: 1, pages: Math.ceil(result.total / 8) || 1 } : {
          total: result.total,
          page,
          pages: Math.ceil(result.total / limit) || 1,
        }),
        applications: result.applications,
      });
    } catch (error) {
      return next(error);
    }
  };

  const getAdminAllApplications = async (req, res, next) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
      const result = await applications.getAdminApplicationList({
        page,
        limit,
        status: req.query.status,
        search: req.query.search,
      });
      return res.status(200).json({
        success: true,
        count: result.applications.length,
        total: result.total,
        page,
        pages: Math.ceil(result.total / limit) || 1,
        applications: result.applications,
      });
    } catch (error) {
      return next(error);
    }
  };

  const getAdminApplicationStats = async (req, res, next) => {
    try {
      const stats = await applications.getAdminStats();
      return res.status(200).json({ success: true, stats });
    } catch (error) {
      return next(error);
    }
  };

  const getAdminDashboardStats = async (req, res, next) => {
    try {
      const result = await applications.getDashboardStats();
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  return {
    applyForJob,
    getMyApplications,
    getApplicationStats,
    updateApplicationStatus,
    getJobApplications,
    getEmployerApplicationDetails,
    getAllEmployerApplicants,
    getEmployerApplicantStats,
    getAdminAllApplications,
    getAdminApplicationStats,
    getAdminDashboardStats,
  };
};

module.exports = { createMysqlStagingApplicationController };
