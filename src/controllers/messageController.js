const Message = require('../models/Message');
const Application = require('../models/Application');
const Job = require('../models/Job');
const Notification = require('../models/Notification');

// @desc    جلب جميع رسائل محادثة طلب معين مع بيانات ديناميكية كاملة للطرفين
// @route   GET /api/messages/:applicationId
// @access  Private (Candidate or Job Poster)
const getApplicationMessages = async (req, res, next) => {
  try {
    const { applicationId } = req.params;

    const application = await Application.findById(applicationId)
      .populate({
        path: 'job',
        select: 'title company logoUrl location postedBy',
        populate: { path: 'postedBy', select: 'name company' },
      })
      .populate('user', 'name email jobTitle location avatar');

    if (!application) {
      return res.status(404).json({ success: false, message: 'طلب التوظيف غير موجود' });
    }

    const job = application.job;
    const applicantId = application.user?._id ? application.user._id.toString() : application.user.toString();
    const isApplicant = applicantId === req.user._id.toString();
    const isJobPoster = job && job.postedBy && (
      (job.postedBy._id && job.postedBy._id.toString() === req.user._id.toString()) ||
      job.postedBy.toString() === req.user._id.toString()
    );
    const isAdmin = req.user.role === 'admin';

    if (!isApplicant && !isJobPoster && !isAdmin) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بالاطلاع على هذه المحادثة' });
    }

    const messages = await Message.find({ application: applicationId })
      .populate('sender', 'name email role jobTitle company avatar')
      .sort({ createdAt: 1 })
      .lean();

    // تحديد الرسائل الواردة كـ "مقروءة" للمستخدم الحالي
    const unreadIds = messages
      .filter((m) => !m.read && m.sender?._id?.toString() !== req.user._id.toString())
      .map((m) => m._id);

    if (unreadIds.length > 0) {
      await Message.updateMany({ _id: { $in: unreadIds } }, { $set: { read: true } });
    }

    // استخراج اسم الشركة الحقيقي بدقة تامة
    const resolvedCompany = job?.company || job?.postedBy?.company || job?.postedBy?.name || 'الشركة';

    res.status(200).json({
      success: true,
      count: messages.length,
      messages,
      chatDetails: {
        isApplicant,
        isJobPoster,
        job: {
          title: job?.title || 'الوظيفة',
          company: resolvedCompany,
          logoUrl: job?.logoUrl || '',
          location: job?.location || '',
        },
        applicant: {
          name: application.name || application.user?.name || 'المتقدم',
          jobTitle: application.user?.jobTitle || '',
          avatar: application.user?.avatar || '',
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    إرسال رسالة جديدة في محادثة طلب التوظيف + إرسال إشعار فوري للطرف الآخر
// @route   POST /api/messages/:applicationId
// @access  Private (Candidate or Job Poster)
const sendMessage = async (req, res, next) => {
  try {
    const { applicationId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'نص الرسالة لا يمكن أن يكون فارغاً' });
    }

    const application = await Application.findById(applicationId)
      .populate('job')
      .populate('user', 'name');

    if (!application) {
      return res.status(404).json({ success: false, message: 'طلب التوظيف غير موجود' });
    }

    const job = application.job;
    const applicantId = application.user?._id ? application.user._id.toString() : application.user.toString();
    const isApplicant = applicantId === req.user._id.toString();
    const isJobPoster = job && job.postedBy && job.postedBy.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isApplicant && !isJobPoster && !isAdmin) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بإرسال رسائل في هذا الطلب' });
    }

    const message = await Message.create({
      application: applicationId,
      job: job._id,
      sender: req.user._id,
      senderRole: req.user.role || (isJobPoster ? 'employer' : 'job_seeker'),
      content: content.trim(),
    });

    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'name email role jobTitle company avatar')
      .lean();

    // ✅ إرسال إشعار فوري للطرف الآخر
    try {
      let recipientId = null;
      let notifTitle = '';
      let notifMessage = '';

      if (isApplicant) {
        // الباحث أرسل → إشعار لناشر الوظيفة باسم الباحث الحقيقي والوظيفة
        recipientId = job.postedBy;
        const applicantName = application.name || application.user?.name || req.user.name || 'المتقدم';
        notifTitle = `رسالة من ${applicantName} 💬`;
        notifMessage = `وصلتك رسالة جديدة من المرشح (${applicantName}) بخصوص وظيفة "${job.title}": "${content.trim().substring(0, 75)}${content.trim().length > 75 ? '...' : ''}"`;
      } else if (isJobPoster) {
        // صاحب العمل أرسل → إشعار للباحث باسم الشركة الحقيقي والوظيفة
        recipientId = application.user?._id || application.user;
        const companyName = (job.company && !['الشركة الناشرة', 'شركة التوظيف', 'شركة', 'صاحب العمل'].includes(job.company))
          ? job.company
          : (req.user.company || req.user.name || 'الشركة');
        notifTitle = `رسالة من ${companyName} 💬`;
        notifMessage = `وصلتك رسالة جديدة من شركة "${companyName}" بخصوص وظيفة "${job.title}": "${content.trim().substring(0, 75)}${content.trim().length > 75 ? '...' : ''}"`;
      }

      if (recipientId) {
        await Notification.create({
          user: recipientId,
          title: notifTitle,
          message: notifMessage,
          type: 'message',
          job: job._id,
          application: applicationId,
        });
      }
    } catch (notifErr) {
      console.error('Notification creation failed:', notifErr.message);
    }

    res.status(201).json({ success: true, message: populatedMessage });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getApplicationMessages,
  sendMessage,
};
