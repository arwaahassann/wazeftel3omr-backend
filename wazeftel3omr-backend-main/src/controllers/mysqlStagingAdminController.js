const createMysqlStagingAdminController = (users) => {
  const searchAdminAccounts = async (req, res, next) => {
    try {
      const search = String(req.query.search || '').trim();
      if (search.length < 2) {
        return res.status(400).json({
          success: false,
          message: 'اكتب حرفين على الأقل للبحث عن الحساب',
        });
      }
      const results = await users.searchAdminAccounts(search);
      return res.status(200).json({
        success: true,
        count: results.length,
        users: results,
      });
    } catch (error) {
      return next(error);
    }
  };

  return { searchAdminAccounts };
};

module.exports = { createMysqlStagingAdminController };
