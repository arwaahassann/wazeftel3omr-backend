const bcrypt = require('bcryptjs');
const {
  isStrongPassword,
  PASSWORD_RULE_MSG,
} = require('../middleware/validationMiddleware');
const {
  getCompanyDocumentMetadata,
  validateCompanyDocument,
} = require('../utils/companyDocuments');
const { buildPhoneMatch, getRoleLabel, normalizePhoneInput } = require('../utils/accountIdentity');

const createMysqlStagingUserController = (users) => {
  const getUserProfile = async (req, res, next) => {
    try {
      const user = await users.findById(req.user._id);
      if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
      if (user.role === 'employer') {
        user.companyDocuments = {
          commercialRegister: getCompanyDocumentMetadata(user.companyDocuments?.commercialRegister),
          taxCard: getCompanyDocumentMetadata(user.companyDocuments?.taxCard),
        };
      }
      return res.status(200).json({ success: true, user });
    } catch (error) {
      return next(error);
    }
  };

  const updateUserProfile = async (req, res, next) => {
    try {
      const {
        name, jobTitle, phone, location, detailedAddress, bio, cvUrl, skills,
        experiences, avatar, company, companyWebsite, companyIndustry, email,
      } = req.body;
      const user = await users.findById(req.user._id);
      if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
      const normalizedEmail = email === undefined ? user.email : String(email).trim().toLowerCase();
      if (normalizedEmail !== String(user.email).toLowerCase()) {
        return res.status(400).json({
          success: false,
          message: 'لا يمكن تغيير البريد الإلكتروني من الإعدادات حاليًا. تم إبقاء البريد الحالي كما هو.',
        });
      }

      const normalizedPhone = phone === undefined ? user.phone : normalizePhoneInput(phone);
      if (user.role === 'employer') {
        const digits = normalizedPhone.replace(/\D/g, '');
        if (!/^[+\d\s().-]+$/.test(normalizedPhone) || digits.length < 8 || digits.length > 15) {
          return res.status(400).json({
            success: false,
            message: 'رقم التواصل الأساسي للشركة مطلوب ويجب أن يحتوي على 8 إلى 15 رقماً',
          });
        }
      }
      const phoneChanged = phone !== undefined && normalizedPhone !== normalizePhoneInput(user.phone);
      const phoneConflict = phoneChanged
        ? await users.findPhoneConflict(buildPhoneMatch(normalizedPhone), user.role, user._id)
        : null;
      if (phoneConflict) {
        return res.status(400).json({
          success: false,
          message: `رقم الهاتف مسجل بالفعل كـ (${getRoleLabel(phoneConflict.role)}). لا يمكن ربطه بحساب من نوع (${getRoleLabel(user.role)}). يرجى استخدام رقم آخر.`,
        });
      }

      const updates = {};
      if (name !== undefined) updates.name = name.trim();
      if (jobTitle !== undefined) updates.jobTitle = jobTitle.trim();
      if (phone !== undefined) updates.phone = normalizedPhone;
      if (location !== undefined) updates.location = location.trim();
      if (detailedAddress !== undefined) updates.detailedAddress = detailedAddress.trim();
      if (bio !== undefined) updates.bio = bio.trim();
      if (cvUrl !== undefined) updates.cvUrl = cvUrl;
      if (skills !== undefined) updates.skills = skills;
      if (experiences !== undefined) updates.experiences = experiences;
      if (avatar !== undefined) updates.avatar = avatar;
      if (company !== undefined) updates.company = company.trim();
      if (companyWebsite !== undefined) updates.companyWebsite = companyWebsite.trim();
      if (companyIndustry !== undefined) updates.companyIndustry = companyIndustry.trim();
      const updated = await users.updateProfile(user._id, updates);

      return res.status(200).json({
        success: true,
        message: 'تم تحديث الملف الشخصي بنجاح',
        user: {
          id: updated._id,
          _id: updated._id,
          name: updated.name,
          email: updated.email,
          role: updated.role,
          jobTitle: updated.jobTitle,
          company: updated.company || '',
          avatar: updated.avatar || '',
          location: updated.location || '',
          detailedAddress: updated.detailedAddress || '',
          phone: updated.phone || '',
          bio: updated.bio || '',
          skills: updated.skills || [],
          experiences: updated.experiences || [],
          cvUrl: updated.cvUrl || '',
          companyWebsite: updated.companyWebsite || '',
          companyIndustry: updated.companyIndustry || '',
        },
      });
    } catch (error) {
      return next(error);
    }
  };

  const uploadCompanyDocument = async (req, res, next) => {
    try {
      if (req.user.role !== 'employer') {
        return res.status(403).json({
          success: false,
          message: 'رفع مستندات الشركة متاح لحسابات الشركات فقط',
        });
      }
      const { documentType } = req.params;
      if (!['commercialRegister', 'taxCard'].includes(documentType)) {
        return res.status(400).json({ success: false, message: 'نوع المستند غير صالح' });
      }
      const result = validateCompanyDocument(req.body);
      if (result.error) {
        return res.status(400).json({ success: false, message: result.error });
      }
      await users.upsertCompanyDocument(req.user._id, documentType, result.document);
      return res.status(200).json({
        success: true,
        document: getCompanyDocumentMetadata(result.document),
      });
    } catch (error) {
      return next(error);
    }
  };

  const getCompanyDocument = async (req, res, next) => {
    try {
      if (req.user.role !== 'employer') {
        return res.status(403).json({
          success: false,
          message: 'مستندات الشركة متاحة لحسابات الشركات فقط',
        });
      }
      const { documentType } = req.params;
      if (!['commercialRegister', 'taxCard'].includes(documentType)) {
        return res.status(400).json({ success: false, message: 'نوع المستند غير صالح' });
      }
      const document = await users.getCompanyDocument(req.user._id, documentType);
      if (!document?.dataUrl) {
        return res.status(404).json({ success: false, message: 'المستند غير موجود' });
      }
      return res.status(200).json({ success: true, document });
    } catch (error) {
      return next(error);
    }
  };

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
        return res.status(400).json({ success: false, message: PASSWORD_RULE_MSG });
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
      const user = await users.findByEmail(req.user.email);
      const isHash = /^\$2[aby]\$/.test(user.password);
      const matches = isHash
        ? await bcrypt.compare(currentPassword, user.password)
        : user.password === currentPassword;
      if (!matches) {
        return res.status(401).json({ success: false, message: 'كلمة المرور الحالية غير صحيحة!' });
      }
      await users.updatePassword(user._id, newPassword);
      return res.status(200).json({
        success: true,
        message: 'تم تغيير كلمة المرور بنجاح! 🔒',
      });
    } catch (error) {
      return next(error);
    }
  };

  return {
    getUserProfile,
    updateUserProfile,
    uploadCompanyDocument,
    getCompanyDocument,
    changePassword,
  };
};

module.exports = { createMysqlStagingUserController };
