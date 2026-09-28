const Application = require('../models/Application');
const Job = require('../models/Job');
const Notification = require('../models/Notification');
const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');
const withCompanyProfileLogo = require('../utils/withCompanyProfileLogo');

// @desc    التقديم على وظيفة جديدة
// @route   POST /api/applications/:jobId
// @access  Private (Job Seeker)
const applyForJob = async (req, res, next) => {
  try {
    const jobId = req.params.jobId;

    // 1. التأكد من وجود الوظيفة ومتاحة
    const job = await Job.findById(jobId);
    if (!job || job.status === 'closed') {
      return res.status(404).json({ success: false, message: 'الوظيفة مغلقة أو غير متاحة للتقديم' });
    }

    // 2. يمنع الناشر من التقديم على وظائفه الخاصة
    if (job.postedBy.toString() === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'لا يمكنك التقديم على وظيفة قمت بنشرها بنفسك' });
    }

    // 3. التقديم على الوظيفة
    const {
      name, email, phone, location, experience, skills, cvUrl,
      linkedinUrl, portfolioUrl, githubUrl, expectedSalary, availability, notes
    } = req.body || {};

    let profileCvUrl = '';
    if (!cvUrl) {
      const applicantProfile = await User.findById(req.user._id).select('cvUrl').lean();
      profileCvUrl = applicantProfile?.cvUrl || '';
    }

    const application = await Application.create({
      user: req.user._id,
      job: jobId,
      name: name || req.user.name,
      email: email || req.user.email,
      phone: phone || req.user.phone,
      location,
      experience,
      skills,
      cvUrl: cvUrl || profileCvUrl,
      linkedinUrl,
      portfolioUrl,
      githubUrl,
      expectedSalary,
      availability,
      notes,
    });

    // 🔔 1. إنشاء إشعار تلقائي لصاحب العمل بأن هناك متقدم جديد
    await Notification.create({
      user: job.postedBy,
      title: `طلب تقديم جديد: ${job.title} 👤`,
      message: `قام المتقدم (${name || req.user.name}) بالتقديم على وظيفتك (${job.title}). يمكنك مراجعة السيرة الذاتية والتواصل معه الآن.`,
      type: 'pending',
      job: jobId,
      application: application._id,
    }).catch((error) => console.error('Failed to notify the job poster:', error.message));

    // 🔔 2. إنشاء إشعار تأكيد للباحث عن عمل
    await Notification.create({
      user: req.user._id,
      title: `تم إرسال طلب التقديم: ${job.title} ✅`,
      message: `تم إرسال طلب تقديمك بنجاح لوظيفة (${job.title}) لدى (${job.company || 'الشركة المُعلنة'}). سيتم إشعارك فور مراجعة الطلب أو تحديد مقابلة.`,
      type: 'pending',
      job: jobId,
      application: application._id,
    }).catch((error) => console.error('Failed to notify the applicant:', error.message));

    let applicationEmailSent = false;
    const applicantEmail = String(application.email || '').trim();
    if (applicantEmail) {
      const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]);
      try {
        const emailResult = await sendEmail({
          email: applicantEmail,
          fromName: 'وظيفة العمر',
          subject: `تم استلام طلبك لوظيفة ${job.title}`,
          message: `مرحباً ${application.name || req.user.name}، تم استلام طلبك لوظيفة (${job.title}) لدى (${job.company || 'الشركة المُعلنة'}) وهو الآن قيد المراجعة. إذا كان ملفك مناسباً لمتطلبات الوظيفة، ستتواصل معك الشركة لتحديد موعد مقابلة. يمكنك متابعة حالة طلبك من حسابك على منصة وظيفة العمر.`,
          html: `
            <div dir="rtl" lang="ar" style="margin:0;background:#f1f5f9;padding:32px 14px;text-align:right;font-family:Tahoma,Arial,sans-serif;color:#334155">
              <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:30px">
                <h1 style="margin:0 0 20px;text-align:center;color:#1d3557;font-size:24px">تم استلام طلب التقديم</h1>
                <p style="font-size:15px;line-height:1.9">مرحباً ${escapeHtml(application.name || req.user.name)}،</p>
                <p style="font-size:15px;line-height:1.9">تم استلام طلبك لوظيفة <strong>${escapeHtml(job.title)}</strong> لدى <strong>${escapeHtml(job.company || 'الشركة المُعلنة')}</strong>، والطلب الآن قيد المراجعة.</p>
                <p style="font-size:15px;line-height:1.9">إذا كان ملفك مناسباً لمتطلبات الوظيفة، ستتواصل معك الشركة لتحديد موعد مقابلة. يمكنك متابعة حالة طلبك وإشعارات المقابلة من حسابك على منصة وظيفة العمر.</p>
                <hr style="margin:22px 0;border:0;border-top:1px solid #e2e8f0">
                <p style="margin:0;text-align:center;color:#94a3b8;font-size:12px">منصة وظيفة العمر — بوابتك لأفضل الفرص الوظيفية</p>
              </div>
            </div>
          `,
        });
        applicationEmailSent = emailResult.sent === true;
        if (!applicationEmailSent) {
          console.error('Application confirmation email was not sent:', emailResult.reason || 'UNKNOWN_REASON');
        }
      } catch (emailError) {
        console.error('Failed to send application confirmation email:', emailError.message);
      }
    } else {
      console.error('Application confirmation email was not sent: applicant email is missing');
    }

    const applicationResponse = application.toObject();
    delete applicationResponse.cvUrl;

    res.status(201).json({
      success: true,
      message: 'تم التقديم على الوظيفة بنجاح! نتمنى لك التوفيق 🎉',
      emailSent: applicationEmailSent,
      application: applicationResponse,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'لقد قمت بالتقديم على هذه الوظيفة من قبل!',
      });
    }
    next(error);
  }
};

// @desc    جلب جميع الطلبات الخاصة بالمستخدم الحالي مع إمكانية التصفية بحسب الحالة
// @route   GET /api/applications
// @access  Private (Job Seeker)
const getMyApplications = async (req, res, next) => {
  try {
    const { status } = req.query;
    let query = { user: req.user._id };

    if (status && status !== 'all') {
      query.status = status;
    }

    const rawApplications = await Application.find(query)
      .select('-cvUrl')
      .populate({
        path: 'job',
        select: 'title company location jobType category salary status postedBy',
        populate: { path: 'postedBy', select: 'avatar' },
      })
      .sort({ createdAt: -1 })
      .lean();

    // 🛡️ استبعاد أي طلبات تم حذف وظيفتها الأصلية
    const applications = rawApplications
      .filter((app) => app.job !== null)
      .map((app) => ({ ...app, job: withCompanyProfileLogo(app.job) }));

    res.status(200).json({
      success: true,
      count: applications.length,
      applications,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    جلب إحصائيات الطلبات للمستخدم (لإظهارها في شاشة الملف الشخصي)
// @route   GET /api/applications/stats
// @access  Private (Job Seeker)
const getApplicationStats = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const stats = await Application.aggregate([
      { $match: { user: userId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const formattedStats = {
      applications: 0,
      accepted: 0,
      interviews: 0,
      reviewing: 0,
      rejected: 0,
    };

    let total = 0;
    stats.forEach((item) => {
      total += item.count;
      if (item._id === 'accepted') formattedStats.accepted = item.count;
      if (item._id === 'interview') formattedStats.interviews = item.count;
      if (item._id === 'reviewing' || item._id === 'pending') formattedStats.reviewing += item.count;
      if (item._id === 'rejected') formattedStats.rejected = item.count;
    });

    formattedStats.applications = total;

    res.status(200).json({
      success: true,
      stats: formattedStats,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    تحديث حالة طلب وإرسال بريد وإشعار للباحث عن العمل
// @route   PUT /api/applications/:id/status
// @access  Private (Employer / Admin)
const updateApplicationStatus = async (req, res, next) => {
  let lockedApplicationId = null;
  try {
    const { status, notes, interviewDetails, decisionMessage } = req.body;
    const applicationId = req.params.id;
    const finalStatuses = ['accepted', 'rejected'];
    if (!['pending', 'reviewing', 'interview', ...finalStatuses].includes(status)) {
      return res.status(400).json({ success: false, message: 'حالة طلب التوظيف غير صالحة.' });
    }

    const application = await Application.findById(applicationId)
      .populate({ path: 'job', select: 'title company location postedBy' })
      .populate('user', 'name email');
    if (!application) {
      return res.status(404).json({ success: false, message: 'طلب التوظيف غير موجود' });
    }
    if (!application.job) {
      return res.status(404).json({ success: false, message: 'الوظيفة المرتبطة بطلب التوظيف لم تعد موجودة' });
    }

    const jobOwnerId = application.job.postedBy?._id || application.job.postedBy;
    if (req.user.role !== 'admin' && String(jobOwnerId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بتحديث حالة هذا الطلب' });
    }

    const currentStatusIsFinal = finalStatuses.includes(application.status);
    const isRetryingIncompleteFinalDecision = currentStatusIsFinal
      && status === application.status
      && (application.decisionEmailSent !== true || application.decisionNotificationSent !== true);
    if (currentStatusIsFinal && !isRetryingIncompleteFinalDecision) {
      return res.status(409).json({
        success: false,
        message: 'تم اعتماد القرار النهائي لهذا المتقدم بالفعل، ولا يمكن تغييره.',
      });
    }

    const candidateEmail = String(application.email || application.user?.email || '').trim();
    const staleLockBefore = new Date(Date.now() - 10 * 60 * 1000);
    const actionLock = await Application.findOneAndUpdate(
      {
        _id: applicationId,
        status: currentStatusIsFinal ? status : { $nin: finalStatuses },
        $and: [
          {
            $or: [
              { decisionProcessing: { $ne: true } },
              { decisionProcessingAt: { $lt: staleLockBefore } },
            ],
          },
          ...(currentStatusIsFinal
            ? [{
                $or: [
                  { decisionEmailSent: { $ne: true } },
                  { decisionNotificationSent: { $ne: true } },
                ],
              }]
            : []),
        ],
      },
      { $set: { decisionProcessing: true, decisionProcessingAt: new Date() } },
      { new: true },
    ).select('_id');

    if (!actionLock) {
      const latest = await Application.findById(applicationId)
        .select('status decisionEmailSent decisionNotificationSent');
      return res.status(409).json({
        success: false,
        message: finalStatuses.includes(latest?.status)
          && latest?.decisionEmailSent
          && latest?.decisionNotificationSent
          ? 'تم اعتماد القرار النهائي لهذا المتقدم بالفعل، ولا يمكن تغييره.'
          : 'يوجد إجراء قيد التنفيذ لهذا المتقدم. حاولي مرة أخرى بعد لحظات.',
      });
    }
    lockedApplicationId = applicationId;

    const jobTitle = application.job.title || 'الوظيفة';
    const companyName = application.job.company || 'الشركة';
    const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[character]);
    const effectiveInterviewDetails = interviewDetails || application.interviewDetails || {};
    const applicantName = application.name || application.user?.name || 'المتقدم';
    let notificationTitle;
    let notificationMessage;
    if (status === 'interview') {
      const formatText = effectiveInterviewDetails.format === 'online'
        ? 'عبر الإنترنت'
        : 'حضورياً بمقر الشركة';
      notificationTitle = `📅 دعوة لمقابلة عمل: ${jobTitle}`;
      notificationMessage = `دعوة لمقابلة عمل لوظيفة (${jobTitle}) لدى (${companyName}). الموعد: ${effectiveInterviewDetails.date || 'قريباً'} ${effectiveInterviewDetails.time ? `الساعة ${effectiveInterviewDetails.time}` : ''} - ${formatText}${effectiveInterviewDetails.location ? ` (${effectiveInterviewDetails.location})` : ''}${effectiveInterviewDetails.notes ? ` ملاحظات: ${effectiveInterviewDetails.notes}` : ''}`;
    } else if (status === 'accepted') {
      notificationTitle = `🎉 تم قبول طلبك: ${jobTitle}`;
      notificationMessage = decisionMessage || `تهانينا! تم قبول طلبك لوظيفة (${jobTitle}) لدى (${companyName}). ستتواصل معك الشركة لمناقشة الخطوات التالية.`;
    } else if (status === 'rejected') {
      notificationTitle = `تحديث بخصوص طلب وظيفة: ${jobTitle}`;
      notificationMessage = decisionMessage || `نشكرك على اهتمامك بوظيفة (${jobTitle}) لدى (${companyName}). نعتذر لعدم المضي في طلبك هذه المرة، ونتمنى لك التوفيق.`;
    } else if (status === 'reviewing') {
      notificationTitle = `طلبك قيد المراجعة: ${jobTitle}`;
      notificationMessage = `طلبك لوظيفة (${jobTitle}) لدى (${companyName}) قيد المراجعة حالياً.`;
    } else {
      notificationTitle = `تحديث طلب التقديم: ${jobTitle}`;
      notificationMessage = `تم تحديث حالة طلبك لوظيفة (${jobTitle}) لدى (${companyName}) إلى قيد الانتظار.`;
    }

    if (!isRetryingIncompleteFinalDecision) {
      application.decisionEmailSent = false;
      application.decisionNotificationSent = false;
    }
    application.status = status;
    if (notes !== undefined) application.notes = notes;
    if (interviewDetails !== undefined) application.interviewDetails = interviewDetails;
    if (decisionMessage !== undefined) application.decisionMessage = decisionMessage;
    application.decisionProcessing = true;
    application.decisionProcessingAt = new Date();
    await application.save();

    try {
      await Notification.findOneAndUpdate(
        { user: application.user?._id || application.user, application: application._id, type: status },
        {
          $set: {
            title: notificationTitle,
            message: notificationMessage,
            isRead: false,
            job: application.job._id,
            interviewDetails: effectiveInterviewDetails,
            decisionMessage: decisionMessage || '',
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
      );
    } catch (error) {
      console.error('Failed to create applicant decision notification:', error.message);
      application.decisionProcessing = false;
      application.decisionProcessingAt = null;
      await application.save();
      lockedApplicationId = null;
      return res.status(500).json({
        success: false,
        decisionRecorded: true,
        status,
        emailSent: application.decisionEmailSent === true,
        notificationSent: false,
        message: 'تم تحديث حالة المتقدم، لكن تعذر إنشاء الإشعار داخل المنصة. أعيدي إرسال القرار نفسه لإكمال الإشعار.',
      });
    }

    application.decisionNotificationSent = true;
    await application.save();

    let emailResult = application.decisionEmailSent
      ? { sent: true, sender: process.env.EMAIL_FROM || process.env.EMAIL_USER }
      : { sent: false, reason: 'SMTP_NOT_CONFIGURED' };
    if (!candidateEmail) {
      emailResult = { sent: false, reason: 'RECIPIENT_REJECTED' };
    } else if (!application.decisionEmailSent) {
      try {
        const emailOptions = {
          email: candidateEmail,
          fromName: 'وظيفة العمر',
          subject: notificationTitle,
          message: notificationMessage,
          html: status === 'interview'
              ? `
              <div dir="rtl" lang="ar" style="margin:0;background:#f1f5f9;padding:32px 14px;text-align:right;font-family:Tahoma,Arial,sans-serif;color:#334155">
                <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:24px;padding:34px 30px">
                  <h1 style="margin:0 0 22px;text-align:center;color:#1d3557;font-size:25px">💼 دعوة مقابلة عمل</h1>
                  <p style="margin:0 0 10px;font-size:17px;line-height:1.9">مرحباً ${escapeHtml(applicantName)}،</p>
                  <p style="margin:0 0 22px;font-size:15px;line-height:1.9">
                    يسعدنا دعوتك لإجراء مقابلة شخصية بخصوص وظيفة <strong>${escapeHtml(jobTitle)}</strong> لدى <strong>${escapeHtml(companyName)}</strong>.
                  </p>
                  <div style="padding:22px 24px;background:#eff6ff;border:2px solid #bfdbfe;border-radius:18px;color:#1e3a8a">
                    <h2 style="margin:0 0 16px;font-size:18px">تفاصيل موعد المقابلة:</h2>
                    <p style="margin:8px 0;font-size:15px">• التاريخ: <strong>${escapeHtml(effectiveInterviewDetails.date || 'قريباً')}</strong></p>
                    <p style="margin:8px 0;font-size:15px">• الوقت: <strong>${escapeHtml(effectiveInterviewDetails.time || 'سيحدد لاحقاً')}</strong></p>
                    <p style="margin:8px 0;font-size:15px">• نوع المقابلة: <strong>${effectiveInterviewDetails.format === 'online' ? 'عن بُعد' : 'حضورياً بمقر الشركة'}</strong></p>
                    <p style="margin:8px 0;font-size:15px">• المكان / رابط المقابلة: <strong>${escapeHtml(effectiveInterviewDetails.location || 'سيتم تأكيده لاحقاً')}</strong></p>
                    ${effectiveInterviewDetails.notes ? `<hr style="margin:18px 0;border:0;border-top:1px dashed #bfdbfe"><p style="margin:0;font-size:14px;line-height:1.8">${escapeHtml(effectiveInterviewDetails.notes)}</p>` : ''}
                  </div>
                  <p style="margin:24px 0 0;font-size:15px;line-height:1.9">نتمنى لك دوام التوفيق والنجاح!</p>
                  <hr style="margin:24px 0;border:0;border-top:1px solid #e2e8f0">
                  <p style="margin:0;text-align:center;color:#94a3b8;font-size:12px">منصة وظيفة العمر — بوابتك لأفضل الفرص الوظيفية</p>
                </div>
              </div>
              `
              : `
              <div dir="rtl" lang="ar" style="margin:0;background:#f1f5f9;padding:32px 14px;text-align:right;font-family:Tahoma,Arial,sans-serif;color:#334155">
                <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:24px;padding:34px 30px">
                  <h1 style="margin:0 0 22px;text-align:center;color:#1d3557;font-size:25px">${escapeHtml(notificationTitle)}</h1>
                  <p style="margin:0 0 10px;font-size:17px;line-height:1.9">مرحباً ${escapeHtml(applicantName)}،</p>
                  <p style="margin:0;font-size:15px;line-height:1.9">${escapeHtml(notificationMessage)}</p>
                  <p style="margin:24px 0 0;font-size:15px;line-height:1.9">مع تحيات ${escapeHtml(companyName)}.</p>
                  <hr style="margin:24px 0;border:0;border-top:1px solid #e2e8f0">
                  <p style="margin:0;text-align:center;color:#94a3b8;font-size:12px">منصة وظيفة العمر — بوابتك لأفضل الفرص الوظيفية</p>
                </div>
              </div>
              `,
        };
        emailResult = await sendEmail(emailOptions);
        if (emailResult.reason === 'NO_CREDENTIALS') {
          emailResult.reason = 'SMTP_NOT_CONFIGURED';
        }
      } catch (error) {
        console.error('Failed to send application decision email through platform SMTP:', error.message);
        emailResult = { sent: false, reason: 'DELIVERY_FAILED' };
      }
    }

    if (!emailResult.sent) {
      application.decisionProcessing = false;
      application.decisionProcessingAt = null;
      await application.save();
      lockedApplicationId = null;
      const emailFailureMessages = {
        SMTP_NOT_CONFIGURED: 'بيانات البريد المرسل الموجودة في إعدادات الخادم غير مكتملة.',
        RECIPIENT_REJECTED: 'لا يوجد بريد إلكتروني صالح للمتقدم.',
        DELIVERY_FAILED: 'تعذر إرسال البريد من حساب المنصة. تحققي من بيانات البريد في إعدادات الخادم ثم أعيدي المحاولة.',
      };
      return res.status(502).json({
        success: false,
        decisionRecorded: true,
        status,
        emailSent: application.decisionEmailSent === true,
        notificationSent: finalStatuses.includes(status)
          ? application.decisionNotificationSent === true
          : true,
        message: `${emailFailureMessages[emailResult.reason] || 'تعذر إرسال البريد الإلكتروني.'} تم تحديث الحالة وإرسال إشعار الباحث، ويمكن إعادة إرسال البريد من تفاصيل المتقدم.`,
      });
    }

    application.decisionEmailSent = true;
    application.decisionProcessing = false;
    application.decisionProcessingAt = null;
    await application.save();
    lockedApplicationId = null;

    return res.status(200).json({
      success: true,
      message: `تم الإرسال بنجاح.${finalStatuses.includes(status) ? ' لا يمكن تغيير القرار النهائي بعد ذلك.' : ''}`,
      emailSent: true,
      emailRecipient: candidateEmail,
      emailSender: emailResult.sender || process.env.EMAIL_FROM || process.env.EMAIL_USER,
      notificationSent: true,
      application,
    });
  } catch (error) {
    if (lockedApplicationId) {
      try {
        await Application.updateOne(
          { _id: lockedApplicationId },
          { $set: { decisionProcessing: false, decisionProcessingAt: null } },
        );
      } catch (lockError) {
        console.error('Failed to release application decision lock:', lockError.message);
      }
    }
    next(error);
  }
};
// @desc    جلب جميع الطلبات على وظيفة معينة (للـ Employer)
// @route   GET /api/applications/job/:jobId
// @access  Private (Employer)
const getJobApplications = async (req, res, next) => {
  try {
    const job = await Job.findById(req.params.jobId).select('_id postedBy').lean();
    if (!job) return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });
    if (job.postedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'غير مصرح لك' });
    }
    const applications = await Application.find({ job: req.params.jobId })
      .select('-cvUrl')
      .populate('user', 'name email jobTitle phone location skills avatar')
      .sort({ createdAt: -1 })
      .lean();
    res.status(200).json({ success: true, count: applications.length, applications });
  } catch (error) {
    next(error);
  }
};

const getEmployerApplicationDetails = async (req, res, next) => {
  try {
    const application = await Application.findById(req.params.id)
      .populate('user', 'name email jobTitle phone location skills cvUrl avatar')
      .populate('job', 'title company location description postedBy')
      .lean();

    if (!application || !application.job) {
      return res.status(404).json({ success: false, message: 'طلب التقديم غير موجود' });
    }

    const jobOwnerId = application.job.postedBy?._id || application.job.postedBy;
    if (jobOwnerId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'غير مصرح لك' });
    }

    res.status(200).json({ success: true, application });
  } catch (error) {
    next(error);
  }
};

// @desc    جلب جميع المتقدمين عبر كافة وظائف الـ Employer الحالي
// @route   GET /api/applications/employer/all
// @access  Private (Employer / Admin)
const getAllEmployerApplicants = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const myJobs = await Job.find({ postedBy: req.user._id }).select('_id').lean();
    const jobIds = myJobs.map((j) => j._id);

    const filter = { job: { $in: jobIds } };
    if (status && status !== 'all') {
      filter.status = status;
    }

    if (req.query.summary === 'true') {
      const [applications, total, interviewCount, activeJobsCount] = await Promise.all([
        Application.find(filter)
          .select('-cvUrl')
          .populate('user', 'name email jobTitle phone location skills avatar')
          .populate('job', 'title company location')
          .sort({ createdAt: -1 })
          .limit(8)
          .lean(),
        Application.countDocuments(filter),
        Application.countDocuments({ ...filter, status: 'interview' }),
        Job.countDocuments({
          postedBy: req.user._id,
          $or: [{ status: 'active' }, { status: { $exists: false } }],
        }),
      ]);

      return res.status(200).json({
        success: true,
        count: applications.length,
        total,
        interviewCount,
        activeJobsCount,
        page: 1,
        pages: Math.ceil(total / 8) || 1,
        applications,
      });
    }

    const [applications, total] = await Promise.all([
      Application.find(filter)
        .select('-cvUrl')
        .populate('user', 'name email jobTitle phone location skills avatar')
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

module.exports = {
  applyForJob,
  getMyApplications,
  getApplicationStats,
  updateApplicationStatus,
  getJobApplications,
  getEmployerApplicationDetails,
  getAllEmployerApplicants,
};
