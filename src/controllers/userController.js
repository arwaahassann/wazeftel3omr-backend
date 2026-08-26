const User = require('../models/User');
const { isStrongPassword, PASSWORD_RULE_MSG } = require('../middleware/validationMiddleware');

// @desc    جلب بيانات الملف الشخصي للمستخدم الحالي
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }
    res.status(200).json({ success: true, user });
  } catch (error) {
    next(error);
  }
};

// @desc    تحديث بيانات الملف الشخصي
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = async (req, res, next) => {
  try {
    const { name, jobTitle, phone, location, bio, cvUrl, skills, experiences, avatar, company, companyWebsite, companyIndustry } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    if (name) user.name = name;
    if (jobTitle !== undefined) user.jobTitle = jobTitle;
    if (phone !== undefined) user.phone = phone;
    if (location !== undefined) user.location = location;
    if (bio !== undefined) user.bio = bio;
    if (cvUrl !== undefined) user.cvUrl = cvUrl;
    if (skills !== undefined) user.skills = skills;
    if (experiences !== undefined) user.experiences = experiences;
    if (avatar !== undefined) user.avatar = avatar;
    if (company !== undefined) user.company = company;
    if (companyWebsite !== undefined) user.companyWebsite = companyWebsite;
    if (companyIndustry !== undefined) user.companyIndustry = companyIndustry;

    await user.save();

    res.status(200).json({
      success: true,
      message: 'تم تحديث الملف الشخصي بنجاح',
      user: {
        id: user._id,
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        jobTitle: user.jobTitle,
        company: user.company || '',
        avatar: user.avatar || '',
        location: user.location || '',
        phone: user.phone || '',
        bio: user.bio || '',
        skills: user.skills || [],
        experiences: user.experiences || [],
        cvUrl: user.cvUrl || '',
        companyWebsite: user.companyWebsite || '',
        companyIndustry: user.companyIndustry || '',
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    تغيير كلمة المرور بأمان
// @route   PUT /api/users/change-password
// @access  Private
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'يرجى تزويد كلمة المرور الحالية وكلمة المرور الجديدة',
      });
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: PASSWORD_RULE_MSG,
      });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'كلمة المرور الجديدة وتأكيد كلمة المرور غير متطابقتين',
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: 'كلمة المرور الجديدة يجب أن تكون مختلفة عن كلمة المرور الحالية',
      });
    }

    const user = await User.findById(req.user._id).select('+password');

    // 1. التحقق من صحة كلمة المرور الحالية
    if (!(await user.matchPassword(currentPassword))) {
      return res.status(401).json({
        success: false,
        message: 'كلمة المرور الحالية غير صحيحة!',
      });
    }

    // 2. تحديث كلمة المرور بالجديدة (تشفير تلقائي بـ pre-save)
    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'تم تغيير كلمة المرور بنجاح! 🔒',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    حفظ / إلغاء حفظ وظيفة في المفضلة (Toggle)
// @route   POST /api/users/saved/:jobId
// @access  Private
const toggleSaveJob = async (req, res, next) => {
  try {
    const jobId = req.params.jobId;

    const Job = require('../models/Job');
    const jobExists = await Job.findById(jobId);
    if (!jobExists) {
      return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة أو تم حذفها' });
    }

    const user = await User.findById(req.user._id);
    const isSaved = user.savedJobs.some((id) => id.toString() === jobId);

    if (isSaved) {
      user.savedJobs = user.savedJobs.filter((id) => id.toString() !== jobId);
      await user.save();
      return res.status(200).json({ success: true, saved: false, message: 'تم إلغاء حفظ الوظيفة من المفضلة' });
    } else {
      user.savedJobs.push(jobId);
      await user.save();
      return res.status(200).json({ success: true, saved: true, message: 'تم حفظ الوظيفة في المفضلة بنجاح ❤️' });
    }
  } catch (error) {
    next(error);
  }
};

// @desc    جلب قائمة الوظائف المحفوظة (المفضلة)
// @route   GET /api/users/saved
// @access  Private
const getSavedJobs = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: 'savedJobs',
      match: { status: 'active' },
      select: 'title company logoUrl location jobType category salary createdAt description',
    });

    const validSavedJobs = (user.savedJobs || []).filter((job) => job !== null);

    res.status(200).json({
      success: true,
      count: validSavedJobs.length,
      savedJobs: validSavedJobs,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUserProfile,
  updateUserProfile,
  changePassword,
  toggleSaveJob,
  getSavedJobs,
};
