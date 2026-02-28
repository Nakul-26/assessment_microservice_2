import Submission from "../../models/Submission.mjs";

export async function create(data) {
  const submission = new Submission(data);
  return submission.save();
}

export async function findById(id) {
  return Submission.findById(id);
}

export async function findByUserId(userId) {
  return Submission.find({ userId })
    .select("_id problemId language status createdAt updatedAt")
    .populate("problemId", "title")
    .sort({ createdAt: -1 });
}
