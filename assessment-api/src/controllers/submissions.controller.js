import * as submissionsService from "../services/submissions.service.js";

export async function submitSolution(req, res, next) {
  const { problemId, code, language } = req.body;
  const userId = req.user && req.user.id;
  console.log(`Received submission for problem ID: ${problemId}`);
  console.log(`Code length: ${code.length} characters`);
  console.log(`Language: ${language}`);
  console.log(`Request bode:`, req.body);

  try {
    if (!userId) {
      return res.status(401).json({ msg: "Unauthorized" });
    }
    const result = await submissionsService.submitSolution({ problemId, code, language, userId });
    if (result.notFound) {
      return res.status(404).json({ msg: "Problem not found" });
    }
    res.status(202).json(result.submission);
  } catch (err) {
    if (err.status && err.body) {
      return res.status(err.status).json(err.body);
    }
    next(err);
  }
}

export async function getSubmissionById(req, res, next) {
  const { _id } = req.params;

  try {
    const result = await submissionsService.getSubmissionById(_id);
    if (result.notFound) {
      return res.status(404).json({ msg: "Submission not found" });
    }
    res.json(result.submission);
  } catch (err) {
    next(err);
  }
}
