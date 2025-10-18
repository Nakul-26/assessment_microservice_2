import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

const ProblemPage = () => {
    const { id } = useParams();
    const [problem, setProblem] = useState(null);
    const [code, setCode] = useState('');
    const [selectedLanguage, setSelectedLanguage] = useState('javascript');
    const [submission, setSubmission] = useState(null);
    const intervalRef = useRef(null);

    useEffect(() => {
        const fetchProblem = async () => {
            console.log(`Fetching problem with id: ${id}`);
            try {
                    const base = 'https://bookish-space-barnacle-7vv5qx76q5pjcpjv4-3000.app.github.dev';
                    const res = await axios.get(`${base}/api/problems/${id}`);
                setProblem(res.data);
                // Set initial code based on fetched problem's boilerplate for the selected language
                if (res.data.functionSignatures && res.data.functionSignatures[selectedLanguage]) {
                    setCode(res.data.functionSignatures[selectedLanguage]);
                } else {
                    setCode('// Write your code here'); // Fallback boilerplate
                }
                console.log('Problem fetched successfully:', res.data);
            } catch (err) {
                console.error(`❌ Error fetching problem ${id}:`, err);
            }
        };
        fetchProblem();

        // Cleanup interval on component unmount
        return () => {
            if (intervalRef.current) {
                console.log('Clearing submission status polling interval');
                clearInterval(intervalRef.current);
            }
        };
    }, [id]);

    // Update code when selectedLanguage changes, using problem's boilerplates
    useEffect(() => {
        if (problem && problem.functionSignatures && problem.functionSignatures[selectedLanguage]) {
            setCode(problem.functionSignatures[selectedLanguage]);
        } else if (problem) {
            setCode('// Write your code here'); // Fallback boilerplate if no specific boilerplate for language
        }
    }, [selectedLanguage, problem]);

    const checkStatus = async (submissionId) => {
        console.log(`Checking status for submission: ${submissionId}`);
        try {
                const base = 'https://bookish-space-barnacle-7vv5qx76q5pjcpjv4-3000.app.github.dev';
                const res = await axios.get(`${base}/api/submissions/${submissionId}`);
            const currentSubmission = res.data;
            setSubmission(currentSubmission);
            console.log('Submission status updated:', currentSubmission);

            if (currentSubmission.status === 'Success' || currentSubmission.status === 'Fail') {
                console.log('Polling stopped for submission:', submissionId);
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        } catch (err) {
            console.error('❌ Error checking status:', err);
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    };

    const handleSubmit = async () => {
        if (intervalRef.current) {
            console.warn('Submission already in progress.');
            return;
        }

        const payload = {
            problemId: id,
            code,
            language: selectedLanguage
        };

        try {
            console.log('Submitting code...', payload);
            setSubmission({ status: 'Submitting...', output: '' });
                const base = 'https://bookish-space-barnacle-7vv5qx76q5pjcpjv4-3000.app.github.dev';
                const res = await axios.post(`${base}/api/submit`, payload);
            const newSubmission = res.data;
            setSubmission(newSubmission);
            console.log('Submission successful:', newSubmission);

            // Start polling
            console.log('Starting polling for submission:', newSubmission._id);
            intervalRef.current = setInterval(() => {
                checkStatus(newSubmission._id);
            }, 2000);

        } catch (err) {
            console.error('❌ Error submitting code:', err);
            setSubmission({ status: 'Error', output: 'An error occurred during submission.' });
        }
    };

    if (!problem) {
        return <div>Loading...</div>;
    }

    return (
        <div>
            <h2>{problem.title}</h2>
            <p>{problem.description}</p>
            <textarea 
                value={code} 
                onChange={(e) => setCode(e.target.value)} 
                rows="20"
                cols="75"
                disabled={submission && (submission.status === 'Pending' || submission.status === 'Running')}
            />
            <br />
            <label htmlFor="language-select">Language: </label>
            <select 
                id="language-select" 
                value={selectedLanguage} 
                onChange={(e) => setSelectedLanguage(e.target.value)}
                disabled={submission && (submission.status === 'Pending' || submission.status === 'Running')}
            >
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
                <option value="java">Java</option>
                <option value="cpp">C++</option>
            </select>
            <br />
            <button 
                onClick={handleSubmit} 
                disabled={submission && (submission.status === 'Pending' || submission.status === 'Running')}
            >
                {submission && (submission.status === 'Pending' || submission.status === 'Running') ? 'Judging...' : 'Submit'}
            </button>
            <h3>Status: {submission ? submission.status : 'Not submitted'}</h3>
            {submission && submission.output && (
                <>
                    <h3>Output:</h3>
                    <pre>{submission.output}</pre>
                </>
            )}
        </div>
    );
};

export default ProblemPage;