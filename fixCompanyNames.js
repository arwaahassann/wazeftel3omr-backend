const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const Job = require('./src/models/Job');
  const User = require('./src/models/User');
  const Notification = require('./src/models/Notification');

  const placeholders = ['الشركة الناشرة', 'شركة التوظيف', 'شركة', 'صاحب العمل', ''];
  const allJobs = await Job.find({}).populate('postedBy');
  console.log('Total jobs:', allJobs.length);

  for (const j of allJobs) {
    if (!j.company || placeholders.includes(j.company)) {
      const realName = j.postedBy?.company || j.postedBy?.name || 'وظيفة العمر';
      console.log(`Updating job "${j.title}" from "${j.company}" to "${realName}"`);
      j.company = realName;
      await j.save();
    }
  }

  // تحديث الإشعارات القديمة
  const notifs = await Notification.find({});
  console.log('Total notifications:', notifs.length);
  for (const n of notifs) {
    let changed = false;
    if (n.message && (n.message.includes('الشركة الناشرة') || n.message.includes('شركة التوظيف'))) {
      n.message = n.message.replace(/الشركة الناشرة/g, 'وظيفة العمر').replace(/شركة التوظيف/g, 'وظيفة العمر');
      changed = true;
    }
    if (n.title && (n.title.includes('الشركة الناشرة') || n.title.includes('شركة التوظيف'))) {
      n.title = n.title.replace(/الشركة الناشرة/g, 'وظيفة العمر').replace(/شركة التوظيف/g, 'وظيفة العمر');
      changed = true;
    }
    if (changed) {
      await n.save();
      console.log('Updated notification:', n._id);
    }
  }

  console.log('✅ ALL DATABASE RECORDS UPDATED SUCCESSFULLY!');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
