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
                const res = await axios.get(`/api/problems/${id}`);
                setProblem(res.data);
                // Set initial code based on fetched problem's function signature for the selected language
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
    }, [id, selectedLanguage]);

    // Update code when selectedLanguage changes, using problem's function signatures
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
            const res = await axios.get(`/api/submissions/${submissionId}`);
            console.log('Status response:', res);
            const currentSubmission = res.data;
            console.log('Current submission status:', currentSubmission.status);
            console.log('Current submission output:', currentSubmission.output);
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
            console.log('Please wait for the current submission to complete.');
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
            const res = await axios.post(`/api/submit`, payload);
            
            console.log('Code submitted, response:', res);
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
            {problem.testCases && problem.testCases.length > 0 && problem.testCases[0].meta && (
                <div>
                    <h4>Type Hints:</h4>
                    {problem.testCases[0].meta.types && (
                        <p>Input Types: {problem.testCases[0].meta.types.join(', ')}</p>
                    )}
                    {problem.testCases[0].meta.returns && (
                        <p>Return Type: {problem.testCases[0].meta.returns}</p>
                    )}
                </div>
            )}
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