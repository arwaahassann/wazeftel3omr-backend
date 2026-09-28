const withCompanyProfileLogo = (job) => {
  if (!job) return job;

  const jobData = typeof job.toObject === 'function' ? job.toObject() : job;
  const profileAvatar = jobData.postedBy && typeof jobData.postedBy === 'object'
    ? jobData.postedBy.avatar
    : '';

  return {
    ...jobData,
    logoUrl: profileAvatar || '',
  };
};

module.exports = withCompanyProfileLogo;
