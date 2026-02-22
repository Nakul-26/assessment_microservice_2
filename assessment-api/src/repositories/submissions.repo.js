import Submission from "../../models/Submission.mjs";

export async function create(data) {
  const submission = new Submission(data);
  return submission.save();
}

export async function findById(id) {
  return Submission.findById(id);
}
