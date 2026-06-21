import AssessmentAttempt from "../../models/AssessmentAttempt.mjs";

export async function findAll(filter = {}, options = {}) {
  return AssessmentAttempt.find(filter, null, options).populate("studentId", "name email usn section");
}

export async function findById(id) {
  return AssessmentAttempt.findById(id).populate("studentId", "name email usn section").populate("assessmentId");
}

export async function findOne(filter) {
  return AssessmentAttempt.findOne(filter);
}

export async function findOnePopulated(filter) {
  return AssessmentAttempt.findOne(filter)
    .populate("studentId", "name email usn section")
    .populate("assessmentId");
}

export async function create(data) {
  const attempt = new AssessmentAttempt(data);
  return attempt.save();
}

export async function updateById(id, data) {
  return AssessmentAttempt.findByIdAndUpdate(id, data, { new: true, runValidators: true });
}
