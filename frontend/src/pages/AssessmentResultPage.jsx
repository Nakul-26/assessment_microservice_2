import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { assessments } from '../api';

const AssessmentResultPage = () => {
  const { attemptId } = useParams();
  const [attempt, setAttempt] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [challengeReason, setChallengeReason] = useState('');
  const [submittingChallenge, setSubmittingChallenge] = useState(false);
  const [challengeError, setChallengeError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const attemptRes = await assessments.getAttempt(attemptId);
        setAttempt(attemptRes.data);

        const assessmentRes = await assessments.get(attemptRes.data.assessmentId._id || attemptRes.data.assessmentId);
        setAssessment(assessmentRes.data);

        const submissionsRes = await assessments.getAttemptSubmissions(attemptId);
        setSubmissions(submissionsRes.data);

      } catch (err) {
        setError(err.response?.data?.msg || 'Failed to load result');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [attemptId]);

  if (loading) return <div className="container">Loading results...</div>;
  if (error) return <div className="container error">{error}</div>;

  const getProblemResult = (problemId) => {
    const problemSubmissions = submissions.filter(s => {
      const sProblemId = s.problemId?._id || s.problemId;
      return String(sProblemId) === String(problemId);
    });
    const wasAccepted = problemSubmissions.some(s => s.status === 'Success');
    return wasAccepted ? 'Accepted' : (problemSubmissions.length > 0 ? 'Failed' : 'Not Attempted');
  };

  const handleRaiseChallenge = async (e) => {
    e.preventDefault();
    if (!challengeReason.trim()) return;

    setSubmittingChallenge(true);
    setChallengeError(null);

    try {
      const res = await assessments.raiseChallenge(attemptId, challengeReason.trim());
      setAttempt(res.data);
    } catch (err) {
      setChallengeError(err.response?.data?.msg || 'Failed to submit challenge');
    } finally {
      setSubmittingChallenge(false);
    }
  };

  const totalMaxScore = assessment.problems.reduce((acc, p) => acc + (p.maxScore || 100), 0);
  const timeTaken = attempt.submittedAt 
    ? Math.floor((new Date(attempt.submittedAt) - new Date(attempt.startedAt)) / 60000)
    : Math.floor((new Date() - new Date(attempt.startedAt)) / 60000);

  return (
    <div className="container">
      <h2>Assessment Result</h2>
      <div className="problem-card" style={{ textAlign: 'center', padding: '60px 24px' }}>
        <h1 style={{ fontSize: '5rem', margin: '0', color: 'var(--primary)', fontWeight: '800' }}>{attempt.score}</h1>
        <p style={{ fontSize: '1.5rem', color: 'var(--text-secondary)', fontWeight: '500' }}>out of {totalMaxScore} points</p>
        
        <div style={{ display: 'flex', justifyContent: 'center', gap: '40px', marginTop: '40px', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>Time Used</h3>
            <p style={{ fontSize: '1.25rem', fontWeight: '700' }}>{timeTaken} minutes</p>
          </div>
          <div>
            <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>Status</h3>
            <p style={{ fontSize: '1.25rem', fontWeight: '700', color: attempt.status === 'Submitted' ? 'var(--success)' : 'var(--warning)' }}>{attempt.status}</p>
          </div>
        </div>
      </div>

      <h3 className="mt-20">Problem Breakdown</h3>
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Problem</th>
              <th>Verdict</th>
              <th style={{ textAlign: 'right' }}>Score</th>
            </tr>
          </thead>
          <tbody>
            {assessment.problems.map((p, idx) => {
              const problemId = p.problemId?._id || p.problemId;
              const verdict = getProblemResult(problemId);
              const score = verdict === 'Accepted' ? (p.maxScore || 100) : 0;
              return (
                <tr key={problemId || idx}>
                  <td style={{ fontWeight: '600' }}>{p.problemId?.title || `Problem ${idx + 1}`}</td>
                  <td>
                    <span className={`tag ${verdict === 'Accepted' ? 'difficulty-easy' : (verdict === 'Failed' ? 'difficulty-hard' : '')}`}>
                      {verdict}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: '700' }}>{score} / {p.maxScore || 100}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Challenge/Appeal Section */}
      <div className="problem-card mt-20" style={{ padding: '24px', border: '1px solid var(--border)' }}>
        <h3 style={{ fontSize: '1.25rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-alert-triangle" style={{ color: 'var(--warning)' }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          Challenge / Appeal Score
        </h3>

        {(!attempt.challenge || attempt.challenge.status === 'None') ? (
          <form onSubmit={handleRaiseChallenge}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '12px', fontSize: '0.95rem' }}>
              If you believe your submission was evaluated incorrectly or you faced a technical issue (e.g., compile error with correct code, platform glitch), you can request faculty review. Provide a detailed explanation.
            </p>
            {challengeError && <div style={{ color: 'var(--error)', marginBottom: '12px', fontSize: '0.9rem', fontWeight: '500' }}>{challengeError}</div>}
            <textarea
              placeholder="Explain your case here (e.g., 'My time complexity is O(N) but tests failed due to...')"
              value={challengeReason}
              onChange={(e) => setChallengeReason(e.target.value)}
              rows={4}
              required
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--surface-hover)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                fontFamily: 'inherit',
                fontSize: '0.95rem',
                resize: 'vertical',
                marginBottom: '16px'
              }}
            />
            <button 
              type="submit" 
              className="button" 
              disabled={submittingChallenge || !challengeReason.trim()}
              style={{
                background: 'var(--primary-gradient)',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              {submittingChallenge ? 'Submitting Appeal...' : 'Submit Appeal'}
            </button>
          </form>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Status:</span>
              <span 
                className="tag" 
                style={{ 
                  backgroundColor: 
                    attempt.challenge.status === 'Raised' ? 'rgba(245, 158, 11, 0.15)' :
                    attempt.challenge.status === 'Accepted' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: 
                    attempt.challenge.status === 'Raised' ? 'var(--warning)' :
                    attempt.challenge.status === 'Accepted' ? 'var(--success)' : 'var(--error)',
                  border: `1px solid ${
                    attempt.challenge.status === 'Raised' ? 'rgba(245, 158, 11, 0.3)' :
                    attempt.challenge.status === 'Accepted' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'
                  }`,
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  padding: '4px 12px'
                }}
              >
                {attempt.challenge.status}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {attempt.challenge.raisedAt && `Raised on ${new Date(attempt.challenge.raisedAt).toLocaleString()}`}
              </span>
            </div>

            <div style={{ backgroundColor: 'var(--surface-hover)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', marginBottom: '16px' }}>
              <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>Your Reason</h4>
              <p style={{ fontSize: '0.95rem', whiteSpace: 'pre-wrap' }}>{attempt.challenge.reason}</p>
            </div>

            {attempt.challenge.status !== 'Raised' && (
              <div style={{ 
                backgroundColor: attempt.challenge.status === 'Accepted' ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)',
                padding: '16px', 
                borderRadius: 'var(--radius-md)', 
                border: `1px solid ${attempt.challenge.status === 'Accepted' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`
              }}>
                <h4 style={{ 
                  fontSize: '0.9rem', 
                  color: attempt.challenge.status === 'Accepted' ? 'var(--success)' : 'var(--error)', 
                  textTransform: 'uppercase', 
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  Faculty Response
                  <span style={{ color: 'var(--text-muted)', textTransform: 'none', fontSize: '0.8rem', fontWeight: 'normal', marginLeft: 'auto' }}>
                    {attempt.challenge.resolvedAt && new Date(attempt.challenge.resolvedAt).toLocaleString()}
                  </span>
                </h4>
                <p style={{ fontSize: '0.95rem', whiteSpace: 'pre-wrap', fontWeight: '500' }}>
                  {attempt.challenge.facultyComment || 'No comment provided by faculty.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop: '40px', textAlign: 'center' }}>
        <Link to="/assessments" className="button">Back to Assessments</Link>
      </div>
    </div>
  );
};

export default AssessmentResultPage;
