const User = require('../models/User');
const SavedJob = require('../models/SavedJob');
const { isStrongPassword, PASSWORD_RULE_MSG } = require('../middleware/validationMiddleware');
const { getRoleLabel, buildPhoneMatch, normalizePhoneInput } = require('../utils/accountIdentity');
const withCompanyProfileLogo = require('../utils/withCompanyProfileLogo');

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
    const { name, jobTitle, phone, location, bio, cvUrl, skills, experiences, avatar, company, companyWebsite, companyIndustry, email } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    const normalizedEmail = email === undefined ? user.email : String(email).trim().toLowerCase();
    if (normalizedEmail !== String(user.email).toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: 'لا يمكن تغيير البريد الإلكتروني من الإعدادات حاليًا. تم إبقاء البريد الحالي كما هو.',
      });
    }

    const normalizedPhone = phone === undefined ? user.phone : normalizePhoneInput(phone);
    if (user.role === 'employer') {
      const phoneDigits = normalizedPhone.replace(/\D/g, '');
      if (
        !/^[+\d\s().-]+$/.test(normalizedPhone)
        || phoneDigits.length < 8
        || phoneDigits.length > 15
      ) {
        return res.status(400).json({
          success: false,
          message: 'رقم التواصل الأساسي للشركة مطلوب ويجب أن يحتوي على 8 إلى 15 رقماً',
        });
      }
    }
    const phoneChanged = phone !== undefined
      && normalizedPhone !== normalizePhoneInput(user.phone);
    const phoneMatch = phoneChanged ? buildPhoneMatch(normalizedPhone) : null;
    if (phoneMatch) {
      const phoneConflict = await User.findOne({
        _id: { $ne: user._id },
        phone: phoneMatch,
        role: { $ne: user.role },
      }).select('role').lean();

      if (phoneConflict) {
        return res.status(400).json({
          success: false,
          message: `رقم الهاتف مسجل بالفعل كـ (${getRoleLabel(phoneConflict.role)}). لا يمكن ربطه بحساب من نوع (${getRoleLabel(user.role)}). يرجى استخدام رقم آخر.`,
        });
      }
    }

    if (name !== undefined) user.name = name.trim();
    if (jobTitle !== undefined) user.jobTitle = jobTitle.trim();
    if (phone !== undefined) user.phone = normalizedPhone;
    if (location !== undefined) user.location = location.trim();
    if (bio !== undefined) user.bio = bio.trim();
    if (cvUrl !== undefined) user.cvUrl = cvUrl;
    if (skills !== undefined) user.skills = skills;
    if (experiences !== undefined) user.experiences = experiences;
    if (avatar !== undefined) user.avatar = avatar;
    if (company !== undefined) user.company = company.trim();
    if (companyWebsite !== undefined) user.companyWebsite = companyWebsite.trim();
    if (companyIndustry !== undefined) user.companyIndustry = companyIndustry.trim();

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
    const userId = req.user._id;

    const Job = require('../models/Job');
    const jobExists = await Job.findById(jobId);
    if (!jobExists) {
      return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة أو تم حذفها' });
    }

    // تحقق من وجود السجل في collection المنفصل
    const existing = await SavedJob.findOne({ user: userId, job: jobId });

    if (existing) {
      // إلغاء الحفظ
      await existing.deleteOne();
      return res.status(200).json({ success: true, saved: false, message: 'تم إلغاء حفظ الوظيفة من المفضلة' });
    } else {
      // حفظ الوظيفة
      await SavedJob.create({ user: userId, job: jobId });
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
    const userId = req.user._id;

    const savedRecords = await SavedJob.find({ user: userId })
      .populate({
        path: 'job',
        match: { status: 'active' },
        select: 'title company location jobType category salary createdAt description postedBy',
        populate: { path: 'postedBy', select: 'avatar' },
      })
      .sort({ createdAt: -1 })
      .lean();

    // استبعاد الوظائف المحذوفة أو المغلقة (populate بيرجع null لو مش موجودة)
    const validSavedJobs = savedRecords
      .filter((record) => record.job !== null)
      .map((record) => withCompanyProfileLogo(record.job));

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
