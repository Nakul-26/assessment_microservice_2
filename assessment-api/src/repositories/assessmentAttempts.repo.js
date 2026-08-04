import AssessmentAttempt from "../../models/AssessmentAttempt.mjs";

export async function findAll(filter = {}, options = {}) {
  return AssessmentAttempt.find(filter, null, options).populate("studentId", "name email usn section");
}

// collegeId: pass a value to scope the lookup to that college (404s instead of leaking
// existence across tenants); pass null/undefined to skip scoping (superadmin/cross-tenant use).
export async function findById(id, collegeId) {
  const filter = collegeId ? { _id: id, collegeId } : { _id: id };
  return AssessmentAttempt.findOne(filter).populate("studentId", "name email usn section").populate("assessmentId");
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

export async function updateById(id, data, collegeId) {
  const filter = collegeId ? { _id: id, collegeId } : { _id: id };
  return AssessmentAttempt.findOneAndUpdate(filter, data, { new: true, runValidators: true });
}
