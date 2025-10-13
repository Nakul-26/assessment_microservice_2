import express from 'express';
import Problem from '../models/Problem.js';
import Submission from '../models/Submission.js';

const router = express.Router();

// List problems
router.get('/problems', async (req, res) => {
  const problems = await Problem.find({});
  res.json(problems);
});

// Get a single problem
router.get('/problems/:id', async (req, res) => {
  const problem = await Problem.findById(req.params.id);
  if (!problem) return res.status(404).json({ error: 'Not found' });
  res.json(problem);
});

// Create submission (very small example)
router.post('/submissions', async (req, res) => {
  const { problemId, code, language } = req.body;
  const submission = await Submission.create({ problem: problemId, code, language });
  res.status(201).json(submission);
});

export default router;
