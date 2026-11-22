require('dotenv').config();
const mongoose = require('mongoose');
const Application = require('../src/models/Application');

const listOrphanedApplications = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not defined in environment variables');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const [summary] = await Application.aggregate([
    {
      $lookup: {
        from: 'jobs',
        localField: 'job',
        foreignField: '_id',
        as: 'existingJob',
      },
    },
    { $match: { existingJob: { $size: 0 } } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        uniqueApplications: {
          $addToSet: {
            user: { $ifNull: ['$user', '$_id'] },
            job: { $ifNull: ['$job', '$_id'] },
          },
        },
      },
    },
  ]);

  const count = summary?.count || 0;
  const uniqueCount = summary?.uniqueApplications?.length || 0;

  console.log(`Orphaned application records: ${count}`);
  console.log(`Unique orphaned applicant/job applications: ${uniqueCount}`);

  if (count > 0) {
    const samples = await Application.aggregate([
      {
        $lookup: {
          from: 'jobs',
          localField: 'job',
          foreignField: '_id',
          as: 'existingJob',
        },
      },
      { $match: { existingJob: { $size: 0 } } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $limit: 20 },
      {
        $project: {
          _id: 1,
          job: 1,
          user: 1,
          name: 1,
          email: 1,
          status: 1,
          createdAt: 1,
        },
      },
    ]);

    console.log('Sample orphaned applications:');
    console.log(JSON.stringify(samples, null, 2));
  }
};

listOrphanedApplications()
  .catch((error) => {
    console.error('Failed to list orphaned applications:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
