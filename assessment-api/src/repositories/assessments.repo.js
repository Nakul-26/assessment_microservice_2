import Assessment from "../../models/Assessment.mjs";

export async function findAll(filter = {}, options = {}) {
  return Assessment.find(filter, null, options).populate("createdBy", "name email");
}

// collegeId: pass a value to scope the lookup to that college (404s instead of leaking
// existence across tenants); pass null/undefined to skip scoping (superadmin/cross-tenant use).
export async function findById(id, collegeId) {
  const filter = collegeId ? { _id: id, collegeId } : { _id: id };
  return Assessment.findOne(filter).populate("createdBy", "name email").populate("problems.problemId", "title difficulty");
}

export async function create(data) {
  const assessment = new Assessment(data);
  return assessment.save();
}

export async function updateById(id, data, collegeId) {
  const filter = collegeId ? { _id: id, collegeId } : { _id: id };
  return Assessment.findOneAndUpdate(filter, data, { new: true, runValidators: true });
}

export async function deleteById(id, collegeId) {
  const filter = collegeId ? { _id: id, collegeId } : { _id: id };
  return Assessment.findOneAndDelete(filter);
}
