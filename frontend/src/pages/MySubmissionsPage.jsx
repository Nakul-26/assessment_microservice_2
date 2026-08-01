import React, { useEffect, useState } from "react";
import { Code2, ChevronDown, ChevronUp, Calendar, AlertCircle } from "lucide-react";
import api from "../api";
import SubmissionOutput from "../components/SubmissionOutput";

const MySubmissionsPage = () => {
  const [submissions, setSubmissions] = useState([]);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchMySubmissions = async () => {
      try {
        const res = await api.get("/api/v1/submissions/my");
        setSubmissions(res.data || []);
      } catch (err) {
        const msg =
          err.response?.data?.message ||
          err.response?.data?.msg ||
          err.message ||
          "Failed to fetch submissions";
        setError(msg);
      } finally {
        setLoading(false);
      }
    };

    fetchMySubmissions();
  }, []);

  const handleViewSubmission = async (submissionId) => {
    if (selectedSubmission && selectedSubmission._id === submissionId) {
      setSelectedSubmission(null);
      return;
    }

    try {
      const res = await api.get(`/api/v1/submissions/${submissionId}`);
      setSelectedSubmission(res.data);
      // Scroll to details on mobile/small screens if needed
      setTimeout(() => {
        document.getElementById('submission-details')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        err.response?.data?.msg ||
        err.message ||
        "Failed to fetch submission details";
      setError(msg);
    }
  };

  if (loading) {
    return <div className="container">Loading your submissions...</div>;
  }

  return (
    <div className="container fade-in">
      <div className="mb-8">
        <h1 className="mb-2">My Submissions</h1>
        <p className="text-muted">Review your past coding solutions and execution results.</p>
      </div>
      
      {error && (
        <div className="error-box mb-8 flex-center gap-2" style={{ justifyContent: 'flex-start' }}>
          <AlertCircle size={18} /> {error}
        </div>
      )}

      {submissions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px', background: 'var(--surface)', borderRadius: 'var(--radius-xl)', border: '1px dashed var(--border)' }}>
          <Code2 size={48} className="text-muted mb-4" style={{ margin: '0 auto' }} />
          <p className="text-muted" style={{ fontSize: '1.1rem' }}>You haven't made any submissions yet.</p>
        </div>
      ) : (
        <div className="table-container mb-8">
          <table className="table">
            <thead>
              <tr>
                <th>Problem</th>
                <th>Status</th>
                <th>Language</th>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((submission) => (
                <tr key={submission._id} style={{ background: selectedSubmission?._id === submission._id ? 'var(--surface-hover)' : 'transparent' }}>
                  <td style={{ fontWeight: '500' }}>{submission.problemId?.title || "Deleted/Unknown Problem"}</td>
                  <td>
                    <span className={`tag ${submission.status === 'Success' || submission.status === 'Accepted' ? 'difficulty-easy' : (['Fail', 'Error', 'Time Limit Exceeded', 'Runtime Error', 'Wrong Answer'].includes(submission.status) ? 'difficulty-hard' : 'difficulty-medium')}`}>
                      {submission.status}
                    </span>
                  </td>
                  <td style={{ textTransform: 'capitalize', color: 'var(--text-secondary)' }}>{submission.language}</td>
                  <td className="text-muted" style={{ fontSize: '0.85rem' }}>
                    <div className="flex-center gap-2" style={{ justifyContent: 'flex-start' }}>
                      <Calendar size={14} />
                      {new Date(submission.createdAt).toLocaleString()}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className={`button ${selectedSubmission?._id === submission._id ? '' : 'button-outline'}`}
                      onClick={() => handleViewSubmission(submission._id)}
                      style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                    >
                      {selectedSubmission?._id === submission._id ? (
                        <>Hide Details <ChevronUp size={14} /></>
                      ) : (
                        <>View Details <ChevronDown size={14} /></>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedSubmission && (
        <div id="submission-details" className="problem-card fade-in" style={{ borderColor: 'var(--primary)' }}>
          <div className="flex-between mb-6">
            <h3 style={{ margin: 0 }}>Submission Details</h3>
            <span className={`tag ${selectedSubmission.status === 'Success' || selectedSubmission.status === 'Accepted' ? 'difficulty-easy' : (['Fail', 'Error', 'Time Limit Exceeded', 'Runtime Error', 'Wrong Answer'].includes(selectedSubmission.status) ? 'difficulty-hard' : 'difficulty-medium')}`} style={{ fontSize: '0.9rem', padding: '6px 16px' }}>
              {selectedSubmission.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-8" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <div style={{ padding: '16px', background: 'var(--bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <div className="text-muted mb-1" style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: '700' }}>Language</div>
              <div style={{ fontSize: '1.1rem', fontWeight: '600', textTransform: 'capitalize' }}>{selectedSubmission.language}</div>
            </div>
            <div style={{ padding: '16px', background: 'var(--bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <div className="text-muted mb-1" style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: '700' }}>Submitted On</div>
              <div style={{ fontSize: '1.1rem', fontWeight: '600' }}>{new Date(selectedSubmission.createdAt).toLocaleString()}</div>
            </div>
          </div>
          
          <h4 className="mb-4">Submitted Code</h4>
          <pre className="mb-8" style={{ 
            background: '#1e1e1e',
            color: '#d4d4d4',
            padding: '24px', 
            borderRadius: 'var(--radius-md)', 
            border: '1px solid var(--border)',
            overflowX: 'auto',
            fontFamily: "'Fira Code', monospace",
            fontSize: '14px',
            lineHeight: '1.6',
            margin: 0
          }}>
            {selectedSubmission.code}
          </pre>

          {selectedSubmission.output && (
            <div className="mt-8 pt-8" style={{ borderTop: '1px solid var(--border)' }}>
              <h4 className="mb-4">Execution Output</h4>
              <SubmissionOutput output={selectedSubmission.output} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MySubmissionsPage;
