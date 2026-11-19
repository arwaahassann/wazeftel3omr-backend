const createMysqlStagingCommunicationController = (repository) => {
  const getMyNotifications = async (req, res, next) => {
    try {
      if (req.query.countOnly === 'true') {
        const unreadCount = await repository.getUnreadNotificationCount(req.user._id);
        return res.status(200).json({
          success: true,
          count: 0,
          unreadCount,
          notifications: [],
        });
      }
      const { notifications, unreadCount } = await repository.listNotifications(req.user._id);
      return res.status(200).json({
        success: true,
        count: notifications.length,
        unreadCount,
        notifications,
      });
    } catch (error) {
      return next(error);
    }
  };

  const markNotificationRead = async (req, res, next) => {
    try {
      const notification = await repository.markNotificationRead(req.user._id, req.params.id);
      if (!notification) {
        return res.status(404).json({ success: false, message: 'الإشعار غير موجود' });
      }
      return res.status(200).json({
        success: true,
        message: 'تم تحديد الإشعار كـ مقروء',
        notification,
      });
    } catch (error) {
      return next(error);
    }
  };

  const markAllNotificationsRead = async (req, res, next) => {
    try {
      await repository.markAllNotificationsRead(req.user._id);
      return res.status(200).json({
        success: true,
        message: 'تم تحديث جميع الإشعارات كـ مقروءة',
      });
    } catch (error) {
      return next(error);
    }
  };

  const deleteNotification = async (req, res, next) => {
    try {
      const deleted = await repository.deleteNotification(req.user._id, req.params.id);
      if (!deleted) {
        return res.status(404).json({ success: false, message: 'الإشعار غير موجود' });
      }
      return res.status(200).json({
        success: true,
        message: 'تم حذف الإشعار بنجاح',
      });
    } catch (error) {
      return next(error);
    }
  };

  const deleteMultipleNotifications = async (req, res, next) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'يرجى تحديد الإشعارات المراد حذفها',
        });
      }
      const deletedCount = await repository.deleteNotifications(req.user._id, ids);
      return res.status(200).json({
        success: true,
        message: `تم حذف ${deletedCount} إشعار بنجاح`,
        deletedCount,
      });
    } catch (error) {
      return next(error);
    }
  };

  const getApplicationMessages = async (req, res, next) => {
    try {
      const conversation = await repository.getConversation(req.params.applicationId);
      if (!conversation) {
        return res.status(404).json({ success: false, message: 'طلب التوظيف غير موجود' });
      }
      const currentUserId = req.user._id.toLowerCase();
      const isApplicant = conversation.applicantId.toLowerCase() === currentUserId;
      const isJobPoster = conversation.jobPosterId.toLowerCase() === currentUserId;
      const isAdmin = req.user.role === 'admin';
      if (!isApplicant && !isJobPoster && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'غير مصرح لك بالاطلاع على هذه المحادثة',
        });
      }

      const messages = await repository.listMessages(req.params.applicationId);
      await repository.markIncomingMessagesRead(req.params.applicationId, req.user._id);
      const resolvedCompany = conversation.jobCompany
        || conversation.posterCompany
        || conversation.posterName
        || 'الشركة';
      return res.status(200).json({
        success: true,
        count: messages.length,
        messages: messages.map((message) => ({
          _id: message._id,
          application: message.application,
          job: message.job,
          sender: {
            _id: message.senderId,
            name: message.senderName,
            email: message.senderEmail,
            role: message.senderUserRole,
            jobTitle: message.senderJobTitle,
            company: message.senderCompany,
            avatar: message.senderAvatar,
          },
          senderRole: message.senderRole,
          senderRole: message.senderRole,
          content: message.content,
          read: Boolean(message.isRead),
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
        })),
        chatDetails: {
          isApplicant,
          isJobPoster,
          job: {
            title: conversation.jobTitle || 'الوظيفة',
            company: resolvedCompany,
            logoUrl: conversation.posterAvatar || '',
            location: conversation.jobLocation || '',
          },
          applicant: {
            name: conversation.applicantName || conversation.applicantUserName || 'المتقدم',
            jobTitle: conversation.applicantJobTitle || '',
            avatar: conversation.applicantAvatar || '',
          },
        },
      });
    } catch (error) {
      return next(error);
    }
  };

  const sendMessage = async (req, res, next) => {
    try {
      const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
      if (!content) {
        return res.status(400).json({
          success: false,
          message: 'نص الرسالة لا يمكن أن يكون فارغاً',
        });
      }
      if (content.length > 2000) {
        return res.status(400).json({
          success: false,
          message: 'الرسالة لا تتجاوز 2000 حرف',
        });
      }
      const conversation = await repository.getConversation(req.params.applicationId);
      if (!conversation) {
        return res.status(404).json({ success: false, message: 'طلب التوظيف غير موجود' });
      }
      const currentUserId = req.user._id.toLowerCase();
      const isApplicant = conversation.applicantId.toLowerCase() === currentUserId;
      const isJobPoster = conversation.jobPosterId.toLowerCase() === currentUserId;
      const isAdmin = req.user.role === 'admin';
      if (!isApplicant && !isJobPoster && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'غير مصرح لك بإرسال رسائل في هذا الطلب',
        });
      }

      const senderRole = req.user.role || (isJobPoster ? 'employer' : 'job_seeker');
      const message = await repository.createMessage({
        applicationId: conversation.applicationId,
        jobId: conversation.jobId,
        senderId: req.user._id,
        senderRole,
        content,
      });

      let recipientId = null;
      let title = '';
      let notificationMessage = '';
      if (isApplicant) {
        recipientId = conversation.jobPosterId;
        const applicantName = conversation.applicantName || conversation.applicantUserName || req.user.name || 'المتقدم';
        title = `رسالة من ${applicantName} 💬`;
        notificationMessage = `وصلتك رسالة جديدة من المرشح (${applicantName}) بخصوص وظيفة "${conversation.jobTitle}": "${content.slice(0, 75)}${content.length > 75 ? '...' : ''}"`;
      } else if (isJobPoster) {
        recipientId = conversation.applicantId;
        const companyName = (
          conversation.jobCompany
          && !['الشركة الناشرة', 'شركة التوظيف', 'شركة', 'صاحب العمل'].includes(conversation.jobCompany)
        )
          ? conversation.jobCompany
          : (req.user.company || req.user.name || 'الشركة');
        title = `رسالة من ${companyName} 💬`;
        notificationMessage = `وصلتك رسالة جديدة من شركة "${companyName}" بخصوص وظيفة "${conversation.jobTitle}": "${content.slice(0, 75)}${content.length > 75 ? '...' : ''}"`;
      }
      if (recipientId) {
        try {
          await repository.createNotification({
            userId: recipientId,
            title,
            message: notificationMessage,
            type: 'message',
            jobId: conversation.jobId,
            applicationId: conversation.applicationId,
          });
        } catch (error) {
          console.error('Notification creation failed:', error.message);
        }
      }
      return res.status(201).json({ success: true, message });
    } catch (error) {
      return next(error);
    }
  };

  const createReport = async (req, res, next) => {
    try {
      const { type, subject, message, relatedJob } = req.body;
      if (!['complaint', 'suggestion'].includes(type)) {
        return res.status(400).json({ success: false, message: 'نوع البلاغ غير صالح' });
      }
      if (!subject || String(subject).trim().length < 3) {
        return res.status(400).json({
          success: false,
          message: 'العنوان يجب أن يكون 3 أحرف على الأقل',
        });
      }
      if (String(subject).trim().length > 120) {
        return res.status(400).json({ success: false, message: 'العنوان لا يتجاوز 120 حرفاً' });
      }
      if (!message || String(message).trim().length < 10) {
        return res.status(400).json({
          success: false,
          message: 'التفاصيل يجب أن تكون 10 أحرف على الأقل',
        });
      }
      if (String(message).trim().length > 2000) {
        return res.status(400).json({ success: false, message: 'التفاصيل لا تتجاوز 2000 حرف' });
      }
      const report = await repository.createReport({
        userId: req.user._id,
        type,
        subject: String(subject).trim(),
        message: String(message).trim(),
        relatedJobId: relatedJob || null,
      });
      return res.status(201).json({
        success: true,
        message: type === 'suggestion' ? 'تم إرسال مقترحك بنجاح' : 'تم إرسال شكواك بنجاح',
        report,
      });
    } catch (error) {
      return next(error);
    }
  };

  const getMyReports = async (req, res, next) => {
    try {
      const reports = await repository.listMyReports(req.user._id);
      return res.status(200).json({ success: true, count: reports.length, reports });
    } catch (error) {
      return next(error);
    }
  };

  const getAdminReports = async (req, res, next) => {
    try {
      const result = await repository.listAdminReports(req.query);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  const updateAdminReportStatus = async (req, res, next) => {
    try {
      const { status, adminReply } = req.body;
      if (!['pending', 'reviewing', 'resolved', 'rejected'].includes(status)) {
        return res.status(400).json({ success: false, message: 'حالة غير صالحة' });
      }
      if (adminReply !== undefined && adminReply !== null && typeof adminReply !== 'string') {
        return res.status(400).json({ success: false, message: 'صيغة رد الإدارة غير صالحة' });
      }
      if (typeof adminReply === 'string' && adminReply.trim().length > 1000) {
        return res.status(400).json({ success: false, message: 'رد الإدارة لا يتجاوز 1000 حرف' });
      }
      const report = await repository.updateAdminReportStatus(
        req.params.id,
        status,
        adminReply,
      );
      if (!report) {
        return res.status(404).json({ success: false, message: 'البلاغ غير موجود' });
      }
      return res.status(200).json({
        success: true,
        message: 'تم تحديث البلاغ بنجاح',
        report,
      });
    } catch (error) {
      return next(error);
    }
  };

  const getAdminNotifications = async (req, res, next) => {
    try {
      return res.status(200).json(await repository.getAdminNotifications(req.user._id));
    } catch (error) {
      return next(error);
    }
  };

  const getAdminNotificationCount = async (req, res, next) => {
    try {
      return res.status(200).json(await repository.getAdminNotificationCount(req.user._id));
    } catch (error) {
      return next(error);
    }
  };

  const updateAdminNotificationStates = async (req, res, next) => {
    try {
      const { keys, action } = req.body;
      const validKey = /^(company|job|report):[a-f\d]{24}$/i;
      if (
        !Array.isArray(keys)
        || keys.length === 0
        || keys.length > 200
        || !keys.every((key) => typeof key === 'string' && validKey.test(key))
      ) {
        return res.status(400).json({
          success: false,
          message: 'قائمة الإشعارات المحددة غير صالحة',
        });
      }
      if (!['read', 'unread', 'delete'].includes(action)) {
        return res.status(400).json({ success: false, message: 'الإجراء المطلوب غير صالح' });
      }
      const updatedCount = await repository.updateAdminNotificationStates(
        req.user._id,
        keys.map((key) => key.toLowerCase()),
        action,
      );
      return res.status(200).json({ success: true, updatedCount });
    } catch (error) {
      return next(error);
    }
  };

  return {
    getMyNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification,
    deleteMultipleNotifications,
    getApplicationMessages,
    sendMessage,
    createReport,
    getMyReports,
    getAdminReports,
    updateAdminReportStatus,
    getAdminNotifications,
    getAdminNotificationCount,
    updateAdminNotificationStates,
  };
};

module.exports = {
  createMysqlStagingCommunicationController,
};
