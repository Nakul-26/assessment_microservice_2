import * as questionsRepo from "../repositories/questions.repo.js";
import { HttpError } from "../utils/httpError.js";

function parsePagination(query) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit || 50)));
  return { limit, skip: (page - 1) * limit };
}

function buildFilter(query = {}, user = null) {
  const filter = {};
  if (query.difficulty) filter.difficulty = query.difficulty;
  if (query.tag) {
    const tags = Array.isArray(query.tag) ? query.tag : String(query.tag).split(',').map(t => t.trim()).filter(Boolean);
    if (tags.length) filter.tags = { $in: tags };
  }
  if (query.search) filter.title = { $regex: query.search, $options: 'i' };
  if (query.collegeId) filter.collegeId = query.collegeId;

  // Visibility: faculty/admin should see their college & private authored questions
  if (user && (user.role === 'admin' || user.role === 'superadmin' || user.role === 'faculty')) {
    // no extra filter
  } else {
    // for non-privileged users, only Public questions
    filter.visibility = 'Public';
  }

  return filter;
}

export async function listQuestions(query = {}, user = null) {
  const filter = buildFilter(query, user);
  const options = parsePagination(query);
  const [questions, total] = await Promise.all([
    questionsRepo.findAll(filter, options),
    questionsRepo.count(filter)
  ]);

  const page = Math.max(1, Number(query.page || 1));
  const totalPages = Math.max(1, Math.ceil(total / options.limit));

  return { questions, total, page, totalPages };
}

export async function listTags(query = {}, user = null) {
  // Build filter similar to listQuestions but only for tags
  const filter = {};
  // If faculty, limit to their college
  if (user && user.role === 'faculty') {
    if (user.collegeId) filter.collegeId = user.collegeId;
  } else if (!user || (user && !(user.role === 'admin' || user.role === 'superadmin' || user.role === 'faculty'))) {
    // non-privileged users only see public tags
    filter.visibility = 'Public';
  }

  const tags = await questionsRepo.distinctTags(filter);
  // return sorted unique tags
  return (tags || []).sort();
}

export async function selectQuestions(payload = {}, user = null) {
  const { easy = 0, medium = 0, hard = 0, tags = [] } = payload || {};

  const toNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };

  const reqEasy = toNumber(easy);
  const reqMedium = toNumber(medium);
  const reqHard = toNumber(hard);

  if (reqEasy + reqMedium + reqHard === 0) {
    throw new Error('At least one question count must be provided');
  }

  const baseFilter = {};
  if (Array.isArray(tags) && tags.length) baseFilter.tags = { $in: tags };

  // Visibility / college scoping
  if (user && user.role === 'faculty') {
    if (user.collegeId) baseFilter.collegeId = user.collegeId;
  } else if (!user || (user && !(user.role === 'admin' || user.role === 'superadmin' || user.role === 'faculty'))) {
    baseFilter.visibility = 'Public';
  }

  const picked = [];
  const addUnique = (docs) => {
    const map = new Map(picked.map(d => [String(d._id), d]));
    for (const d of docs) {
      if (!map.has(String(d._id))) {
        map.set(String(d._id), d);
      }
    }
    // rebuild picked
    picked.length = 0;
    for (const v of map.values()) picked.push(v);
  };

  const results = [];
  if (reqEasy > 0) {
    const docs = await questionsRepo.sample({ ...baseFilter, difficulty: 'Easy' }, reqEasy);
    addUnique(docs);
  }
  if (reqMedium > 0) {
    const docs = await questionsRepo.sample({ ...baseFilter, difficulty: 'Medium' }, reqMedium);
    addUnique(docs);
  }
  if (reqHard > 0) {
    const docs = await questionsRepo.sample({ ...baseFilter, difficulty: 'Hard' }, reqHard);
    addUnique(docs);
  }

  return { questions: picked };
}


export async function getQuestionById(id, user = null) {
  const q = await questionsRepo.findById(id);
  if (!q) return null;

  if (q.visibility === 'Public') return q;
  if (!user) return null;
  if (user.role === 'superadmin' || user.role === 'admin') return q;
  if (user.role === 'faculty' && String(q.collegeId) === String(user.collegeId)) return q;
  if (String(q.author) === String(user._id)) return q;

  return null;
}

export async function createQuestion(payload, user) {
  if (!user) throw new HttpError(401, 'Unauthorized');
  const data = { ...payload };
  data.author = user._id;
  if (!data.collegeId && user.collegeId) data.collegeId = user.collegeId;

  // Basic validation
  if (!data.title || typeof data.title !== 'string') throw new HttpError(400, 'Title is required');
  return questionsRepo.create(data);
}

export async function updateQuestion(id, payload, user) {
  const q = await questionsRepo.findById(id);
  if (!q) throw new HttpError(404, 'Question not found');

  const isOwner = String(q.author) === String(user._id);
  const isPrivileged = user.role === 'admin' || user.role === 'superadmin';
  const isSameCollegeFaculty = user.role === 'faculty' && String(q.collegeId) === String(user.collegeId);

  if (!isOwner && !isPrivileged && !isSameCollegeFaculty) {
    throw new HttpError(403, 'Forbidden');
  }

  return questionsRepo.updateById(id, payload);
}

export async function deleteQuestion(id, user) {
  const q = await questionsRepo.findById(id);
  if (!q) throw new HttpError(404, 'Question not found');
  if (String(q.author) !== String(user._id) && !(user.role === 'admin' || user.role === 'superadmin')) {
    throw new HttpError(403, 'Forbidden');
  }
  return questionsRepo.deleteById(id);
}
