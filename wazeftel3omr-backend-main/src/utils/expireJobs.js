const Job = require('../models/Job');

const getCairoDate = (date = new Date()) => {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const parts = Object.fromEntries(dateParts.map(({ type, value }) => [type, value]));

  return `${parts.year}-${parts.month}-${parts.day}`;
};

const expireJobs = async (date = new Date()) => {
  const thirtyDaysAgo = new Date(date.getTime() - 30 * 24 * 60 * 60 * 1000);
  return Job.updateMany(
    {
      status: 'active',
      $or: [
        { closingDate: { $type: 'string', $gt: '', $lt: getCairoDate(date) } },
        {
          $and: [
            {
              $or: [
                { closingDate: { $exists: false } },
                { closingDate: null },
                { closingDate: '' },
              ],
            },
            {
              $or: [
                { publishedAt: { $lte: thirtyDaysAgo } },
                { publishedAt: null, createdAt: { $lte: thirtyDaysAgo } },
              ],
            },
          ],
        },
      ],
    },
    { $set: { status: 'closed' } }
  );
};

module.exports = { expireJobs, getCairoDate };
