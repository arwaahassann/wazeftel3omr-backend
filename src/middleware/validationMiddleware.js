// =========================================================
// 🛡️ Backend Validation Middleware — وظيفة العمر
// التحقق الصارم والشامل من الحقول الإلزامية (Required Fields)
// مستقل عن الـ Frontend — الحماية والمنطق من الـ Server
// =========================================================

/**
 * دالة مساعدة: تُرجع 400 مع رسالة خطأ واضحة إذا كان الحقل فارغاً
 */
const missing = (res, field) =>
  res.status(400).json({
    success: false,
    message: `الحقل (${field}) إلزامي ولا يمكن تركه فارغاً`,
    field,
  });

/**
 * دالة مساعدة: تنظف النص من المسافات الزائدة وتتحقق من أنه غير فارغ
 */
const isBlank = (value) => !value || String(value).trim() === '';

/**
 * دالة مساعدة: يتحقق من صحة شكل البريد الإلكتروني
 */
/**
 * 🔒 التحقق الصارم من قوة كلمة المرور:
 * - 8 أحرف على الأقل
 * - حرف كبير واحد على الأقل (A-Z)
 * - حرف صغير واحد على الأقل (a-z)
 * - رقم واحد على الأقل (0-9)
 * - رمز خاص واحد على الأقل (!@#$%^&*...)
 */
const isStrongPassword = (pass) => {
  if (!pass || typeof pass !== 'string' || pass.length < 8) return false;
  const hasUpper = /[A-Z]/.test(pass);
  const hasLower = /[a-z]/.test(pass);
  const hasNumber = /[0-9]/.test(pass);
  const hasSpecial = /[^A-Za-z0-9]/.test(pass);
  return hasUpper && hasLower && hasNumber && hasSpecial;
};

const PASSWORD_RULE_MSG = 'كلمة المرور يجب أن تكون 8 أحرف على الأقل، وتحتوي على حرف كبير (A-Z)، وحرف صغير (a-z)، ورقم (0-9)، ورمز خاص (مثل: @$!%*?&#)';

// ─────────────────────────────────────────────────────────
// 1️⃣ التسجيل (Register) — registerUser
// الحقول الإلزامية: name, email, password, role, phone, jobTitle, company (للشركات)
// ─────────────────────────────────────────────────────────
const validateRegister = (req, res, next) => {
  const { name, email, password, role, company, phone, jobTitle } = req.body;

  if (isBlank(name))     return missing(res, 'الاسم الكامل');
  if (isBlank(email))    return missing(res, 'البريد الإلكتروني');
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'صيغة البريد الإلكتروني غير صحيحة' });
  }
  if (isBlank(password)) return missing(res, 'كلمة المرور');
  if (!isStrongPassword(password)) {
    return res.status(400).json({ success: false, message: PASSWORD_RULE_MSG });
  }
  if (isBlank(role) || !['job_seeker', 'employer'].includes(String(role).trim())) {
    return res.status(400).json({ success: false, message: 'نوع الحساب يجب أن يكون (job_seeker) أو (employer)' });
  }

  // إذا كان صاحب عمل (Employer)، يجب إدخال اسم الشركة
  if (role === 'employer' && isBlank(company)) {
    return missing(res, 'اسم الشركة (مطلوب لحسابات أصحاب العمل)');
  }

  next();
};


// ─────────────────────────────────────────────────────────
// 2️⃣ تسجيل الدخول (Login) — loginUser
// الحقول الإلزامية: email, password
// ─────────────────────────────────────────────────────────
const validateLogin = (req, res, next) => {
  const { email, password } = req.body;

  if (isBlank(email))    return missing(res, 'البريد الإلكتروني');
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'صيغة البريد الإلكتروني غير صحيحة' });
  }
  if (isBlank(password)) return missing(res, 'كلمة المرور');

  next();
};


// ─────────────────────────────────────────────────────────
// 3️⃣ إنشاء وظيفة جديدة (Create Job) — createJob
// الحقول الإلزامية: title, company, location, description, jobType, level, experience
// ─────────────────────────────────────────────────────────
const validateCreateJob = (req, res, next) => {
  const { title, company, location, description, jobType, level, experience } = req.body;

  if (isBlank(title))       return missing(res, 'عنوان الإعلان الوظيفي');
  if (String(title).trim().length < 3) {
    return res.status(400).json({ success: false, message: 'عنوان الوظيفة يجب أن يكون 3 أحرف على الأقل' });
  }
  if (isBlank(company))     return missing(res, 'اسم الشركة');
  if (isBlank(location))    return missing(res, 'موقع / مقر الوظيفة');
  if (isBlank(description)) return missing(res, 'وصف ومسؤوليات الوظيفة');
  if (String(description).trim().length < 15) {
    return res.status(400).json({ success: false, message: 'وصف الوظيفة يجب أن يكون 15 حرفاً على الأقل' });
  }
  if (isBlank(jobType))     return missing(res, 'نوع الدوام');
  if (isBlank(level))       return missing(res, 'المستوى المهني');
  if (isBlank(experience))  return missing(res, 'سنوات الخبرة المطلوبة');

  next();
};


// ─────────────────────────────────────────────────────────
// 4️⃣ تعديل وظيفة (Update Job) — updateJob
// ─────────────────────────────────────────────────────────
const validateUpdateJob = (req, res, next) => {
  const { title, location, description, status } = req.body;

  if (title !== undefined && isBlank(title)) return missing(res, 'عنوان الوظيفة');
  if (location !== undefined && isBlank(location)) return missing(res, 'موقع الوظيفة');
  if (description !== undefined) {
    if (isBlank(description)) return missing(res, 'وصف الوظيفة');
    if (String(description).trim().length < 15) {
      return res.status(400).json({ success: false, message: 'وصف الوظيفة يجب أن يكون 15 حرفاً على الأقل' });
    }
  }

  if (status !== undefined && !['active', 'closed', 'draft'].includes(status)) {
    return res.status(400).json({ success: false, message: 'حالة الوظيفة يجب أن تكون (active / closed / draft)' });
  }

  next();
};


// ─────────────────────────────────────────────────────────
// 5️⃣ التقديم على وظيفة (Apply for Job) — applyForJob
// الحقول الإلزامية: name, email, phone, location, cvUrl
// ─────────────────────────────────────────────────────────
const validateApplyForJob = (req, res, next) => {
  const { name, email, phone, location, cvUrl, availability } = req.body;

  if (isBlank(name))  return missing(res, 'الاسم بالكامل');
  if (isBlank(email)) return missing(res, 'البريد الإلكتروني');
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'صيغة البريد الإلكتروني غير صحيحة' });
  }
  if (isBlank(phone)) return missing(res, 'رقم الهاتف');

  const phoneClean = String(phone).replace(/[\s\-\+\(\)]/g, '');
  if (!/^\d{8,15}$/.test(phoneClean)) {
    return res.status(400).json({ success: false, message: 'رقم الهاتف غير صحيح (يجب أن يحتوي على 8 إلى 15 رقماً)' });
  }

  if (isBlank(location)) return missing(res, 'العنوان / المحافظة');
  if (isBlank(cvUrl))    return missing(res, 'ملف السيرة الذاتية (CV)');

  next();
};


// ─────────────────────────────────────────────────────────
// 6️⃣ تحديث حالة الطلب (Update Application Status)
// ─────────────────────────────────────────────────────────
const VALID_STATUSES = ['pending', 'reviewing', 'interview', 'accepted', 'rejected'];

const validateUpdateStatus = (req, res, next) => {
  const { status } = req.body;

  if (isBlank(status)) return missing(res, 'حالة الطلب (status)');
  if (!VALID_STATUSES.includes(String(status).trim())) {
    return res.status(400).json({
      success: false,
      message: `حالة الطلب يجب أن تكون واحدة من: (${VALID_STATUSES.join(' / ')})`,
    });
  }

  next();
};


// ─────────────────────────────────────────────────────────
// 7️⃣ إعادة تعيين كلمة المرور بـ OTP — resetPasswordWithOtp
// ─────────────────────────────────────────────────────────
const validateResetPassword = (req, res, next) => {
  const { email, otp, newPassword } = req.body;

  if (isBlank(email))       return missing(res, 'البريد الإلكتروني');
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'صيغة البريد الإلكتروني غير صحيحة' });
  }
  if (isBlank(otp))         return missing(res, 'رمز التحقق (OTP)');
  if (isBlank(newPassword)) return missing(res, 'كلمة المرور الجديدة');
  if (!isStrongPassword(newPassword)) {
    return res.status(400).json({ success: false, message: PASSWORD_RULE_MSG });
  }

  next();
};


// ─────────────────────────────────────────────────────────
// 8️⃣ تحديث بيانات الملف الشخصي — updateProfile
// ─────────────────────────────────────────────────────────
const validateUpdateProfile = (req, res, next) => {
  const { email, phone, name, company } = req.body;

  if (name !== undefined && isBlank(name)) return missing(res, 'الاسم الكامل');

  if (email !== undefined) {
    if (isBlank(email)) return missing(res, 'البريد الإلكتروني');
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'صيغة البريد الإلكتروني غير صحيحة' });
    }
  }

  if (phone !== undefined && !isBlank(phone)) {
    const phoneClean = String(phone).replace(/[\s\-\+\(\)]/g, '');
    if (!/^\d{8,15}$/.test(phoneClean)) {
      return res.status(400).json({ success: false, message: 'رقم الهاتف غير صحيح (يجب أن يحتوي على 8 إلى 15 رقماً)' });
    }
  }

  next();
};

module.exports = {
  isStrongPassword,
  PASSWORD_RULE_MSG,
  validateRegister,
  validateLogin,
  validateCreateJob,
  validateUpdateJob,
  validateApplyForJob,
  validateUpdateStatus,
  validateResetPassword,
  validateUpdateProfile,
};
