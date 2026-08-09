import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api, { assessments } from '../api';
import { getApiErrorMessage, validateAssessmentForm } from '../utils/assessmentForm';

const LANGS = ['python', 'javascript', 'typescript', 'java', 'cpp', 'c', 'csharp', 'go', 'ruby', 'php', 'kotlin', 'rust'];

const EditAssessmentPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [problems, setProblems] = useState([]);
  const [formData, setFormData] = useState(null);
  const [selectedProblemId, setSelectedProblemId] = useState('');
  const [problemScore, setProblemScore] = useState(100);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [assessmentRes, problemsRes] = await Promise.all([
          assessments.get(id),
          api.get('/api/v1/problems')
        ]);
        
        const assessmentData = assessmentRes.data;
        const formatDate = (date) => {
          const d = new Date(date);
          return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        };

        setFormData({
          title: assessmentData.title,
          description: assessmentData.description,
          durationMinutes: assessmentData.durationMinutes,
          startTime: formatDate(assessmentData.startTime),
          endTime: formatDate(assessmentData.endTime),
          allowedLanguages: assessmentData.allowedLanguages || [],
          problems: assessmentData.problems.map(p => ({
            problemId: p.problemId._id || p.problemId,
            title: p.problemId.title || 'Unknown',
            maxScore: p.maxScore
          })),
          status: assessmentData.status
        });
        setProblems(problemsRes.data || []);
      } catch (err) {
        setError(err.response?.data?.msg || 'Failed to fetch assessment data');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const toggleLanguage = (lang) => {
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
        maxScore: Number(problemScore) || 0
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

  const updateProblemScore = (problemId, newScore) => {
    setFormData({
      ...formData,
      problems: formData.problems.map(p => p.problemId === problemId ? { ...p, maxScore: Number(newScore) || 0 } : p)
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
      const payload = {
        ...formData,
        problems: formData.problems.map(p => ({ problemId: p.problemId, maxScore: p.maxScore }))
      };
      await assessments.update(id, payload);
      navigate('/admin/assessments');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to update assessment'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="container">Loading assessment data...</div>;
  if (error && !formData) return <div className="container error-box">{error}</div>;

  const totalScore = formData.problems.reduce((acc, p) => acc + Number(p.maxScore), 0);

  return (
    <div className="container">
      <div className="flex-between mb-6">
        <div>
          <h2 style={{ margin: 0 }}>Edit Assessment</h2>
          <div className="text-muted">Update assessment details, allowed languages and included problems.</div>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="button button-outline" onClick={() => navigate('/admin/assessments')}>Cancel</button>
          <button form="edit-assessment-form" type="submit" className="button button-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <form id="edit-assessment-form" onSubmit={handleSubmit}>
        {error && <div className="error-box mb-6">{error}</div>}
        <div className="problem-card mb-6">
          <h3>Basic Information</h3>

          <div className="form-group">
            <label>Title</label>
            <input type="text" name="title" value={formData.title} onChange={handleChange} required />
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea name="description" value={formData.description} onChange={handleChange} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <div className="form-group">
              <label>Duration (minutes)</label>
              <input type="number" name="durationMinutes" value={formData.durationMinutes} onChange={handleChange} min={1} />
            </div>

            <div className="form-group">
              <label>Start time</label>
              <input type="datetime-local" name="startTime" value={formData.startTime} onChange={handleChange} />
            </div>

            <div className="form-group">
              <label>End time</label>
              <input type="datetime-local" name="endTime" value={formData.endTime} onChange={handleChange} />
            </div>
          </div>
        </div>

        <div className="problem-card mb-6">
          <h3>Allowed Languages</h3>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {LANGS.map(lang => {
              const active = formData.allowedLanguages.includes(lang);
              return (
                <button
                  key={lang}
                  type="button"
                  onClick={() => toggleLanguage(lang)}
                  className={active ? 'button' : 'button button-outline'}
                  style={{ textTransform: 'capitalize', padding: '8px 12px' }}
                >{lang}</button>
              );
            })}
          </div>
        </div>

        <div className="problem-card mb-6">
          <h3>Problems</h3>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '18px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: '6px' }}>Select problem</label>
              <select value={selectedProblemId} onChange={(e) => setSelectedProblemId(e.target.value)} style={{ width: '100%' }}>
                <option value="">Choose a problem...</option>
                {problems.filter(p => !formData.problems.some(added => added.problemId === p._id)).map(p => (
                  <option key={p._id} value={p._id}>{p.title} — {p.difficulty}</option>
                ))}
              </select>
            </div>

            <div style={{ width: 140 }}>
              <label style={{ display: 'block', marginBottom: '6px' }}>Marks</label>
              <input type="number" value={problemScore} onChange={(e) => setProblemScore(e.target.value)} min={1} />
            </div>

            <div>
              <button type="button" className="button button-primary" onClick={addProblemToAssessment}>Add</button>
            </div>
          </div>

          <div className="problem-card-grid">
            {formData.problems.map(p => (
              <div key={p.problemId} className="problem-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{p.title}</div>
                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>{/* could show tags/difficulty if available */}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input type="number" value={p.maxScore} onChange={(e) => updateProblemScore(p.problemId, e.target.value)} style={{ width: 90 }} min={1} />
                    <button type="button" className="button button-outline" onClick={() => removeProblem(p.problemId)}>Remove</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
            <div className="text-muted">Total problems: {formData.problems.length}</div>
            <div style={{ fontWeight: 700 }}>Total Score: {totalScore}</div>
          </div>
        </div>

        <div className="problem-card mb-6" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px' }}>Status</label>
            <select name="status" value={formData.status} onChange={handleChange}>
              <option value="Draft">Draft</option>
              <option value="Published">Published</option>
              <option value="Completed">Completed</option>
            </select>
            <div className="text-muted" style={{ fontSize: '0.85rem', marginTop: '8px' }}>Use the Save button at the top to update this assessment.</div>
          </div>
        </div>
      </form>
    </div>
  );
};

export default EditAssessmentPage;
