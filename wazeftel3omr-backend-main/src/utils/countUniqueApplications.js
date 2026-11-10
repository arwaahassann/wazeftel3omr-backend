const Application = require('../models/Application');

const uniqueApplicationStages = (filter) => [
  { $match: filter },
  { $sort: { createdAt: -1, _id: -1 } },
  { $group: {
    _id: {
      user: { $ifNull: ['$user', '$_id'] },
      job: { $ifNull: ['$job', '$_id'] },
    },
    application: { $first: '$$ROOT' },
  } },
  { $replaceRoot: { newRoot: '$application' } },
];

const countUniqueApplications = async (filter = {}) => {
  const [result] = await Application.aggregate([
    ...uniqueApplicationStages(filter),
    { $count: 'count' },
  ]);
  return result?.count || 0;
};

const getUniqueApplicationIds = (filter = {}, skip = 0, limit = 10) => Application.aggregate([
  ...uniqueApplicationStages(filter),
  { $skip: skip },
  { $limit: limit },
  { $project: { _id: 1 } },
]);

module.exports = { countUniqueApplications, getUniqueApplicationIds };
