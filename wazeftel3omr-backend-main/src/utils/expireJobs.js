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

const expireJobs = async (date = new Date()) => Job.updateMany(
  {
    status: 'active',
    closingDate: { $type: 'string', $gt: '', $lt: getCairoDate(date) },
  },
  { $set: { status: 'closed' } }
);

module.exports = { expireJobs, getCairoDate };
