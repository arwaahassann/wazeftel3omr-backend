const Application = require('../models/Application');

const uniqueApplicationStages = (filter = {}) => {
  const pairFilter = Object.fromEntries(
    Object.entries(filter).filter(([field]) => field === 'user' || field === 'job')
  );
  const stages = [];

  if (Object.keys(pairFilter).length) stages.push({ $match: pairFilter });

  return [
    ...stages,
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $group: {
        _id: {
          user: { $ifNull: ['$user', '$_id'] },
          job: { $ifNull: ['$job', '$_id'] },
        },
        application: { $first: '$$ROOT' },
      },
    },
    { $replaceRoot: { newRoot: '$application' } },
    { $match: filter },
  ];
};

const countUniqueApplications = async (filter = {}) => {
  const [result] = await Application.aggregate([
    ...uniqueApplicationStages(filter),
    { $count: 'count' },
  ]);
  return result?.count || 0;
};

const getUniqueApplicationIds = (filter = {}, skip = 0, limit = 10) => {
  const stages = [
    ...uniqueApplicationStages(filter),
    { $sort: { createdAt: -1, _id: -1 } },
  ];

  if (skip > 0) stages.push({ $skip: skip });
  if (Number.isFinite(limit)) stages.push({ $limit: limit });
  stages.push({ $project: { _id: 1 } });

  return Application.aggregate(stages);
};

const getUniqueApplicationStats = (filter = {}, extraStages = []) => Application.aggregate([
  ...uniqueApplicationStages(filter),
  ...extraStages,
  { $group: { _id: '$status', count: { $sum: 1 } } },
]);

module.exports = {
  countUniqueApplications,
  getUniqueApplicationIds,
  getUniqueApplicationStats,
  uniqueApplicationStages,
};
