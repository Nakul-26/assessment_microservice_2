import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { assessments } from '../api';
import { getApiErrorMessage, validateAssessmentForm } from '../utils/assessmentForm';

const AddAssessmentPage = () => {
  const navigate = useNavigate();
  const [problems, setProblems] = useState([]);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    durationMinutes: 60,
    startTime: '',
    endTime: '',
    allowedLanguages: ['python', 'javascript', 'typescript', 'java', 'cpp', 'c', 'csharp', 'go', 'ruby', 'php', 'kotlin', 'rust'],
    problems: [],
    status: 'Draft'
  });
  const [selectedProblemId, setSelectedProblemId] = useState('');
  const [problemScore, setProblemScore] = useState(100);
  const [loadingProblems, setLoadingProblems] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchProblems = async () => {
      try {
        const res = await api.get('/api/v1/problems');
        setProblems(res.data);
      } catch (err) {
        setError(getApiErrorMessage(err, 'Failed to fetch problems'));
      } finally {
        setLoadingProblems(false);
      }
    };
    fetchProblems();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleLanguageToggle = (lang) => {
    const next = formData.allowedLanguages.includes(lang)
      ? formData.allowedLanguages.filter(l => l !== lang)
      : [...formData.allowedLanguages, lang];
    setFormData({ ...formData, allowedLanguages: next });
  };

  const addProblemToAssessment = () => {
    if (!selectedProblemId) return;
    if (formData.problems.some(p => p.problemId === selectedProblemId)) {
      alert('Problem already added');
      return;
    }

    const problem = problems.find(p => p._id === selectedProblemId);
    if (!problem || Number(problemScore) <= 0) {
      setError('Problem score must be greater than zero');
      return;
    }
    setError(null);
    setFormData({
      ...formData,
      problems: [...formData.problems, { 
        problemId: selectedProblemId, 
        title: problem.title, 
        maxScore: Number(problemScore)
      }]
    });
    setSelectedProblemId('');
  };

  const removeProblem = (id) => {
    setFormData({
      ...formData,
      problems: formData.problems.filter(p => p.problemId !== id)
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationErrors = validateAssessmentForm(formData);
    if (validationErrors.length > 0) {
      setError(validationErrors.join('. '));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // API expects problems: [{ problemId: id, maxScore: score }]
      const payload = {
        ...formData,
        problems: formData.problems.map(p => ({ problemId: p.problemId, maxScore: p.maxScore }))
      };
      await assessments.create(payload);
      navigate('/admin/assessments');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to create assessment'));
    } finally {
      setSaving(false);
    }
  };

  const totalScore = formData.problems.reduce((acc, p) => acc + Number(p.maxScore), 0);

  return (
    <div className="container assessment-page">
      <h2>Create New Assessment</h2>
      {error && <div className="error-box">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="problem-card" style={{ marginBottom: '20px' }}>
          <h3>Basic Information</h3>
          <div className="form-group">
            <label>Title:</label>
            <input type="text" name="title" value={formData.title} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>Description:</label>
            <textarea name="description" value={formData.description} onChange={handleChange} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
            <div className="form-group">
              <label>Duration (Minutes):</label>
              <input type="number" name="durationMinutes" value={formData.durationMinutes} onChange={handleChange} required min="1" />
            </div>
            <div className="form-group">
              <label>Start Time:</label>
              <input type="datetime-local" name="startTime" value={formData.startTime} onChange={handleChange} required />
            </div>
            <div className="form-group">
              <label>End Time:</label>
              <input type="datetime-local" name="endTime" value={formData.endTime} onChange={handleChange} required />
            </div>
          </div>
        </div>

          <div className="problem-card" style={{ marginBottom: '20px' }}>
          <h3>Allowed Languages</h3>
          <div className="allowed-langs">
            {['python', 'javascript', 'typescript', 'java', 'cpp', 'c', 'csharp', 'go', 'ruby', 'php', 'kotlin', 'rust'].map(lang => (
              <label key={lang} className="lang-label">
                <input 
                  type="checkbox" 
                  checked={formData.allowedLanguages.includes(lang)} 
                  onChange={() => handleLanguageToggle(lang)}
                />
                <span className="lang-text">{lang}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="problem-card" style={{ marginBottom: '20px' }}>
          <h3>Problems</h3>
            <div className="add-problem-row" style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '20px' }}>
            <div className="form-group" style={{ flex: 2, marginBottom: 0 }}>
              <label>Select Problem:</label>
              <select className="problem-select" value={selectedProblemId} onChange={(e) => setSelectedProblemId(e.target.value)}>
                <option value="">Choose a problem...</option>
                {loadingProblems && <option disabled>Loading problems...</option>}
                {problems.filter(p => !formData.problems.some(added => added.problemId === p._id)).map(p => (
                  <option key={p._id} value={p._id}>{p.title} ({p.difficulty})</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>Marks:</label>
              <input type="number" value={problemScore} onChange={(e) => setProblemScore(e.target.value)} min="1" />
            </div>
            <button type="button" className="button button-primary" onClick={addProblemToAssessment}>Add</button>
          </div>

          <table className="problem-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                  <th>Problem</th>
                  <th>Max Score</th>
                  <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {formData.problems.map((p) => (
                <tr key={p.problemId}>
                    <td>{p.title}</td>
                    <td>{p.maxScore}</td>
                    <td>
                    <button type="button" className="button button-outline" onClick={() => removeProblem(p.problemId)} style={{ padding: '6px 10px' }}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                  <td><strong>Total Score:</strong></td>
                  <td><strong>{totalScore}</strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="form-group">
          <label>Status:</label>
          <select name="status" value={formData.status} onChange={handleChange}>
            <option value="Draft">Draft</option>
            <option value="Published">Published</option>
          </select>
        </div>

        <div className="mt-20">
          <button type="submit" className="button button-primary" style={{ padding: '12px 36px' }} disabled={saving}>
            {saving ? 'Saving...' : 'Save Assessment'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AddAssessmentPage;
