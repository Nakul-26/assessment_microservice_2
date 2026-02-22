import Problem from "../../models/Problem.mjs";

export async function findAll(filter = {}, options = {}) {
  return Problem.find(filter, null, options);
}

export async function findAllWithoutTests(filter = {}, options = {}) {
  return Problem.find(filter, null, options).select("-testCases");
}

export async function findById(id) {
  return Problem.findById(id);
}

export async function create(data) {
  const problem = new Problem(data);
  return problem.save();
}

export async function deleteById(id) {
  return Problem.findByIdAndDelete(id);
}

export async function updateById(id, data) {
  return Problem.findByIdAndUpdate(id, data, { new: true, runValidators: true });
}
