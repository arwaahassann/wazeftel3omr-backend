const Application = require('../models/Application');
const Job = require('../models/Job');
const Notification = require('../models/Notification');
const sendEmail = require('../utils/sendEmail');

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

    const application = await Application.create({
      user: req.user._id,
      job: jobId,
      name: name || req.user.name,
      email: email || req.user.email,
      phone: phone || req.user.phone,
      location,
      experience,
      skills,
      cvUrl: cvUrl || req.user.cvUrl || '',
      linkedinUrl,
      portfolioUrl,
      githubUrl,
      expectedSalary,
      availability,
      notes,
    });

    // 🔔 إنشاء إشعار تلقائي لصاحب العمل بأن هناك متقدم جديد
    await Notification.create({
      user: job.postedBy,
      title: `متقدم جديد: ${job.title} 👤`,
      message: `قام المتقدم (${req.user.name}) بالتقديم على وظيفتك (${job.title})`,
      type: 'pending',
      job: jobId,
      application: application._id,
    }).catch(() => {});

    res.status(201).json({
      success: true,
      message: 'تم التقديم على الوظيفة بنجاح! نتمنى لك التوفيق 🎉',
      application,
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
      .populate('job', 'title company logoUrl location jobType category salary status')
      .sort({ createdAt: -1 });

    // 🛡️ استبعاد أي طلبات تم حذف وظيفتها الأصلية
    const applications = rawApplications.filter((app) => app.job !== null);

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

// @desc    تحديث حالة طلب + تحديد تفاصيل المقابلة أو رسائل الرفض/القبول + إرسال بريد وإشعار
// @route   PUT /api/applications/:id/status
// @access  Private (Employer / Admin)
const updateApplicationStatus = async (req, res, next) => {
  try {
    const { status, notes, interviewDetails, decisionMessage } = req.body;
    const applicationId = req.params.id;

    const application = await Application.findById(applicationId).populate('job', 'title company location postedBy');

    if (!application) {
      return res.status(404).json({ success: false, message: 'طلب التوظيف غير موجود' });
    }

    // 🔒 حماية أمنية من الباك إند: التأكد من أن المستخدم الحالي هو صاحب الوظيفة المعلنة
    if (application.job.postedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بتحديث حالة هذا الطلب' });
    }

    application.status = status || application.status;
    if (notes) application.notes = notes;
    if (interviewDetails) application.interviewDetails = interviewDetails;
    if (decisionMessage) application.decisionMessage = decisionMessage;

    await application.save();

    const candidateEmail = application.email || (await Application.findById(applicationId).populate('user', 'email')).user?.email;
    const candidateName = application.name || 'المتقدم الكريم';
    const jobTitle = application.job?.title || 'الوظيفة';
    const companyName = application.job?.company || 'الشركة';

    let notificationMessage = '';
    let notificationType = status;

    // 1. دعوة لمقابلة (Interview)
    if (status === 'interview') {
      const { date, time, format, location: intLoc, notes: intNotes } = interviewDetails || {};
      const formatText = format === 'online' ? 'عبر الإنترنت (أونلاين)' : 'حضورياً بمقر الشركة';
      
      notificationMessage = `📅 دعوة لمقابلة عمل لوظيفة (${jobTitle}) لدى (${companyName}). الموعد: ${date || 'قريباً'} ${time ? `الساعة ${time}` : ''} - ${formatText} ${intLoc ? `(${intLoc})` : ''}`;

      // إرسال إيميل رسمي بتفاصيل المقابلة
      if (candidateEmail) {
        sendEmail({
          email: candidateEmail,
          subject: `دعوة لمقابلة عمل: ${jobTitle} لدى ${companyName} 💼`,
          html: `
            <div dir="rtl" style="font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; background-color: #f8fafc; padding: 30px 15px; text-align: right;">
              <div style="max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 18px; padding: 28px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
                <h2 style="color: #1D3557; margin-top: 0; font-size: 22px;">دعوة لمقابلة عمل 💼</h2>
                <p style="color: #334155; font-size: 15px; line-height: 1.6;">مرحباً <strong>${candidateName}</strong>،</p>
                <p style="color: #475569; font-size: 14px; line-height: 1.6;">
                  يسعدنا إبلاغك بأنه تم اختيارك لإجراء مقابلة عمل لوظيفة <strong>${jobTitle}</strong> لدى <strong>${companyName}</strong>.
                </p>
                
                <div style="background-color: #eff6ff; border: 1.5px solid #bfdbfe; border-radius: 12px; padding: 18px; margin: 20px 0;">
                  <h4 style="margin: 0 0 10px 0; color: #1e40af; font-size: 16px;">تفاصيل وموعد المقابلة:</h4>
                  <ul style="margin: 0; padding-right: 20px; color: #1e3a8a; font-size: 14px; line-height: 1.8;">
                    ${date ? `<li><strong>التاريخ:</strong> ${date}</li>` : ''}
                    ${time ? `<li><strong>الوقت:</strong> ${time}</li>` : ''}
                    <li><strong>نوع المقابلة:</strong> ${formatText}</li>
                    ${intLoc ? `<li><strong>المكان / الرابط:</strong> ${intLoc}</li>` : ''}
                  </ul>
                  ${intNotes ? `<p style="margin: 10px 0 0 0; color: #1e3a8a; font-size: 13px; border-top: 1px dashed #bfdbfe; padding-top: 8px;"><strong>ملاحظات إضافية:</strong> ${intNotes}</p>` : ''}
                </div>

                <p style="color: #475569; font-size: 13px; line-height: 1.6;">
                  نتمنى لك دوام التوفيق والنجاح!
                </p>
                <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 20px 0;" />
                <p style="color: #94a3b8; font-size: 11px; text-align: center;">منصة وظيفة العمر — بوابتك لأفضل الفرص الوظيفية</p>
              </div>
            </div>
          `,
        }).catch(() => {});
      }
    } 
    // 2. تم الرفض (Rejected) مع رسالة ذوقية
    else if (status === 'rejected') {
      const politeMessage = decisionMessage || `نشكرك على اهتمامك ووقتك في التقديم على وظيفة (${jobTitle}). نعتذر عن عدم المضي قدماً في طلبك في الوقت الحالي ونتمنى لك التوفيق في مسيرتك المهنية.`;
      notificationMessage = `رسالة من ${companyName} بخصوص طلب وظيفة (${jobTitle}): ${politeMessage}`;

      if (candidateEmail) {
        sendEmail({
          email: candidateEmail,
          subject: `تحديث بشأن طلب التوظيف: ${jobTitle} لدى ${companyName}`,
          html: `
            <div dir="rtl" style="font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; background-color: #f8fafc; padding: 30px 15px; text-align: right;">
              <div style="max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 18px; padding: 28px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
                <h2 style="color: #1D3557; margin-top: 0; font-size: 20px;">تحديث بخصوص طلب التوظيف</h2>
                <p style="color: #334155; font-size: 15px; line-height: 1.6;">مرحباً <strong>${candidateName}</strong>،</p>
                <p style="color: #475569; font-size: 14px; line-height: 1.7;">
                  ${politeMessage}
                </p>
                <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 20px 0;" />
                <p style="color: #94a3b8; font-size: 11px; text-align: center;">منصة وظيفة العمر — نتمنى لك كل التوفيق في فرصك القادمة</p>
              </div>
            </div>
          `,
        }).catch(() => {});
      }
    }
    // 3. تم القبول (Accepted)
    else if (status === 'accepted') {
      const welcomeMsg = decisionMessage || `تهانينا! يسعدنا إبلاغك بقبول طلبك لوظيفة (${jobTitle}) لدى ${companyName}. سنتواصل معك قريباً لاستكمال إجراءات التعاقد.`;
      notificationMessage = `🎉 ${welcomeMsg}`;

      if (candidateEmail) {
        sendEmail({
          email: candidateEmail,
          subject: `🎉 تهانينا! تم قبول طلبك لوظيفة ${jobTitle} لدى ${companyName}`,
          html: `
            <div dir="rtl" style="font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; background-color: #f8fafc; padding: 30px 15px; text-align: right;">
              <div style="max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 18px; padding: 28px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
                <h2 style="color: #16a34a; margin-top: 0; font-size: 22px;">🎉 تهانينا! تم قبولك في الوظيفة</h2>
                <p style="color: #334155; font-size: 15px; line-height: 1.6;">مرحباً <strong>${candidateName}</strong>،</p>
                <p style="color: #475569; font-size: 14px; line-height: 1.7;">
                  ${welcomeMsg}
                </p>
                <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 20px 0;" />
                <p style="color: #94a3b8; font-size: 11px; text-align: center;">منصة وظيفة العمر — بوابتك لأفضل الفرص الوظيفية</p>
              </div>
            </div>
          `,
        }).catch(() => {});
      }
    }
    // 4. قيد المراجعة (Reviewing)
    else if (status === 'reviewing') {
      notificationMessage = `طلبك قيد المراجعة حالياً لوظيفة (${jobTitle}) لدى ${companyName}`;
    }

    let notificationTitle = '';
    if (status === 'interview') notificationTitle = `📅 دعوة لمقابلة عمل: ${jobTitle}`;
    else if (status === 'accepted') notificationTitle = `🎉 تم قبول طلبك: ${jobTitle}`;
    else if (status === 'rejected') notificationTitle = `تحديث بخصوص طلب وظيفة: ${jobTitle}`;
    else if (status === 'reviewing') notificationTitle = `طلبك قيد المراجعة: ${jobTitle}`;

    if (notificationMessage) {
      await Notification.create({
        user: application.user,
        title: notificationTitle,
        message: notificationMessage,
        type: notificationType,
        job: application.job?._id,
        application: application._id,
        interviewDetails: interviewDetails || application.interviewDetails || {},
        decisionMessage: decisionMessage || application.decisionMessage || '',
      }).catch(() => {});
    }

    res.status(200).json({
      success: true,
      message: 'تم تحديث حالة الطلب وإرسال الإشعار والبريد للمتقدم بنجاح 🎉',
      application,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    جلب جميع الطلبات على وظيفة معينة (للـ Employer)
// @route   GET /api/applications/job/:jobId
// @access  Private (Employer)
const getJobApplications = async (req, res, next) => {
  try {
    const job = await Job.findById(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });
    if (job.postedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'غير مصرح لك' });
    }
    const applications = await Application.find({ job: req.params.jobId })
      .populate('user', 'name email jobTitle phone location skills cvUrl avatar')
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: applications.length, applications });
  } catch (error) {
    next(error);
  }
};

// @desc    جلب جميع المتقدمين عبر كافة وظائف الـ Employer الحالي
// @route   GET /api/applications/employer/all
// @access  Private (Employer / Admin)
const getAllEmployerApplicants = async (req, res, next) => {
  try {
    const myJobs = await Job.find({ postedBy: req.user._id }).select('_id');
    const jobIds = myJobs.map((j) => j._id);

    const applications = await Application.find({ job: { $in: jobIds } })
      .populate('user', 'name email jobTitle phone location skills cvUrl avatar')
      .populate('job', 'title company location')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: applications.length, applications });
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
  getAllEmployerApplicants,
};
