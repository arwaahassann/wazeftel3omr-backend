const Notification = require('../models/Notification');

// @desc    جلب إشعارات المستخدم الحالي مع تفاصيل الوظيفة والطلب والمقابلة
// @route   GET /api/notifications
// @access  Private
const getMyNotifications = async (req, res, next) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .populate('job', 'title company location logoUrl')
      .populate('application', '_id status job user')
      .sort({ createdAt: -1 });

    const unreadCount = notifications.filter((n) => !n.isRead).length;

    res.status(200).json({
      success: true,
      count: notifications.length,
      unreadCount,
      notifications,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    تحديد إشعار محدد كـ "مقروء"
// @route   PUT /api/notifications/:id/read
// @access  Private
const markAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: 'الإشعار غير موجود' });
    }

    notification.isRead = true;
    await notification.save();

    res.status(200).json({
      success: true,
      message: 'تم تحديد الإشعار كـ مقروء',
      notification,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    تحديد جميع إشعارات المستخدم كـ "مقروءة"
// @route   PUT /api/notifications/read-all
// @access  Private
const markAllAsRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { $set: { isRead: true } }
    );

    res.status(200).json({
      success: true,
      message: 'تم تحديث جميع الإشعارات كـ مقروءة',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    حذف إشعار محدد للمستخدم الحالي
// @route   DELETE /api/notifications/:id
// @access  Private
const deleteNotification = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: 'الإشعار غير موجود' });
    }

    res.status(200).json({
      success: true,
      message: 'تم حذف الإشعار بنجاح',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    حذف مجموعة إشعارات محددة (Bulk Delete)
// @route   POST /api/notifications/bulk-delete
// @access  Private
const deleteMultipleNotifications = async (req, res, next) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'يرجى تحديد الإشعارات المراد حذفها' });
    }

    const result = await Notification.deleteMany({
      _id: { $in: ids },
      user: req.user._id,
    });

    res.status(200).json({
      success: true,
      message: `تم حذف ${result.deletedCount} إشعار بنجاح`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteMultipleNotifications,
};
