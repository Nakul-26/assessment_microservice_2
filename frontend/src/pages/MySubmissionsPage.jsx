import React, { useEffect, useState } from "react";
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
        const res = await api.get("/api/submissions/me");
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
      const res = await api.get(`/api/submissions/${submissionId}`);
      setSelectedSubmission(res.data);
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
    <div className="container">
      <h2 className="mb-20">My Submissions</h2>
      {error && <p style={{ color: "#dc3545" }}>{error}</p>}

      {submissions.length === 0 ? (
        <p>No submissions yet.</p>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Problem</th>
                <th>Status</th>
                <th>Language</th>
                <th>Date</th>
                <th>View</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((submission) => (
                <tr key={submission._id}>
                  <td>{submission.problemId?.title || "Deleted/Unknown Problem"}</td>
                  <td>{submission.status}</td>
                  <td>{submission.language}</td>
                  <td>{new Date(submission.createdAt).toLocaleString()}</td>
                  <td>
                    <button
                      className="button"
                      onClick={() => handleViewSubmission(submission._id)}
                    >
                      {selectedSubmission?._id === submission._id ? "Hide" : "View"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedSubmission && (
        <div className="problem-card mt-20">
          <h3>Submission Details</h3>
          <p><strong>Status:</strong> {selectedSubmission.status}</p>
          <p><strong>Language:</strong> {selectedSubmission.language}</p>
          <p><strong>Submitted:</strong> {new Date(selectedSubmission.createdAt).toLocaleString()}</p>
          {selectedSubmission.output && (
            <>
              <h4>Output</h4>
              <SubmissionOutput output={selectedSubmission.output} />
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default MySubmissionsPage;
