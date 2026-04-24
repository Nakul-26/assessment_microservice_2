import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api';
import SubmissionOutput from '../components/SubmissionOutput';

const supportedLanguages = ['python', 'javascript', 'java', 'c', 'csharp'];

function buildTemplate(language, functionName, paramNames) {
  const params = paramNames.join(', ');

  if (language === 'python') {
    return `def ${functionName}(${params}):\n    # your code here\n    pass`;
  }
  if (language === 'javascript') {
    return `function ${functionName}(${params}) {\n  // your code here\n}`;
  }
  if (language === 'java') {
    return `class Solution {\n    public static Object ${functionName}(${paramNames.map((p) => `Object ${p}`).join(', ')}) {\n        // your code here\n        return null;\n    }\n}`;
  }
  if (language === 'c') {
    return `long ${functionName}(long *args, int argc) {\n    // your code here\n    return 0;\n}`;
  }
  return `public class UserSolution {\n    public object ${functionName}(${paramNames.map((p) => `object ${p}`).join(', ')}) {\n        // your code here\n        return null;\n    }\n}`;
}

const ProblemPage = () => {
  const { _id } = useParams();
  const [problem, setProblem] = useState(null);
  const [code, setCode] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('python');
  const [submission, setSubmission] = useState(null);
  const intervalRef = useRef(null);
  const isAuthed = !!localStorage.getItem('token');

  useEffect(() => {
    const fetchProblem = async () => {
      try {
        const res = await api.get(`/api/problems/${_id}`);
        const fetchedProblem = res.data;
        setProblem(fetchedProblem);

        const paramNames = (fetchedProblem.parameters || []).map((p) => p.name);
        setCode(buildTemplate(selectedLanguage, fetchedProblem.functionName || 'solution', paramNames));
      } catch (err) {
        console.error(`Error fetching problem ${_id}:`, err);
      }
    };
    fetchProblem();

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [_id, selectedLanguage]);

  const checkStatus = async (submissionId) => {
    try {
      const res = await api.get(`/api/submissions/${submissionId}`);
      const currentSubmission = res.data;
      setSubmission(currentSubmission);

      if (currentSubmission.status === 'Success' || currentSubmission.status === 'Fail' || currentSubmission.status === 'Error') {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    } catch (err) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const handleSubmit = async () => {
    if (!isAuthed) {
      setSubmission({ status: 'Unauthorized', output: 'Please log in to submit.' });
      return;
    }
    if (intervalRef.current) return;

    const payload = {
      problemId: _id,
      code,
      language: selectedLanguage
    };

    try {
      setSubmission({ status: 'Submitting...', output: '' });
      const res = await api.post('/api/submissions', payload);
      const newSubmission = res.data;
      setSubmission(newSubmission);

      intervalRef.current = setInterval(() => {
        checkStatus(newSubmission._id);
      }, 2000);
    } catch (err) {
      setSubmission({ status: 'Error', output: 'An error occurred during submission.' });
    }
  };

  if (!problem) {
    return <div className="container">Loading...</div>;
  }

  return (
    <div className="container">
      <div className="problem-card">
        <h2>{problem.title} <Link to={`/problems/${problem._id}/edit`} className="button">Edit</Link></h2>
        <p>{problem.description}</p>
        <p><strong>Function:</strong> {problem.functionName}</p>
        <p><strong>Return Type:</strong> {problem.returnType}</p>
        <p><strong>Parameters:</strong> {(problem.parameters || []).map((p) => `${p.name}: ${p.type}`).join(', ') || 'None'}</p>
      </div>

      <div className="form-group mt-20">
        <label htmlFor="code-editor">Code:</label>
        <textarea
          id="code-editor"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          rows="20"
          cols="75"
          disabled={submission && (submission.status === 'Pending' || submission.status === 'Running')}
        />
      </div>

      <div className="form-group">
        <label htmlFor="language-select">Language: </label>
        <select
          id="language-select"
          value={selectedLanguage}
          onChange={(e) => setSelectedLanguage(e.target.value)}
          disabled={submission && (submission.status === 'Pending' || submission.status === 'Running')}
        >
          {supportedLanguages.map((lang) => (
            <option key={lang} value={lang}>{lang}</option>
          ))}
        </select>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!isAuthed || (submission && (submission.status === 'Pending' || submission.status === 'Running'))}
        className="button"
      >
        {submission && (submission.status === 'Pending' || submission.status === 'Running') ? 'Judging...' : 'Submit'}
      </button>
      {!isAuthed && (
        <p className="mt-20">
          Please <Link to="/login">log in</Link> to submit solutions.
        </p>
      )}

      <h3 className="mt-20">Submission Status: {submission ? submission.status : 'Not submitted'}</h3>
      {submission && submission.output && (
        <>
          <h3>Result</h3>
          <SubmissionOutput output={submission.output} />
        </>
      )}
    </div>
  );
};

export default ProblemPage;
