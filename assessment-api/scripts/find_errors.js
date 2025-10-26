import mongoose from 'mongoose';
import SubmissionModel from '../models/Submission.mjs';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/assessment_db';

async function main(){
  await mongoose.connect(MONGO_URI);
  const errors = await SubmissionModel.find({ status: 'Error' }).lean();
  console.log('Found', errors.length, 'error submissions');
  for(const s of errors){
    console.log(JSON.stringify({ id: s._id.toString(), status: s.status, output: s.output }, null, 2));
  }
  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
