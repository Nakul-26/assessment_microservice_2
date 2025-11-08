import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';

const ProblemPage = () => {
    const { _id } = useParams();
    const [problem, setProblem] = useState(null);
    const [code, setCode] = useState('');
    const [selectedLanguage, setSelectedLanguage] = useState('javascript');
    const [submission, setSubmission] = useState(null);
    const intervalRef = useRef(null);

    useEffect(() => {
        const fetchProblem = async () => {
            try {
                const res = await axios.get(`/api/problems/${_id}`);
                const fetchedProblem = res.data;
                setProblem(fetchedProblem);
                if (fetchedProblem.functionDefinitions && fetchedProblem.functionDefinitions[selectedLanguage]) {
                    setCode(fetchedProblem.functionDefinitions[selectedLanguage].template);
                } else {
                    setCode('// Language not configured for this problem.');
                }
            } catch (err) {
                console.error(`❌ Error fetching problem ${_id}:`, err);
            }
        };
        fetchProblem();

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [_id, selectedLanguage]);

    useEffect(() => {
        if (problem && problem.functionDefinitions && problem.functionDefinitions[selectedLanguage]) {
            setCode(problem.functionDefinitions[selectedLanguage].template);
        } else if (problem) {
            const availableLangs = Object.keys(problem.functionDefinitions);
            if (availableLangs.length > 0) {
                setSelectedLanguage(availableLangs[0]);
                setCode(problem.functionDefinitions[availableLangs[0]].template);
            } else {
                setCode('// No function definitions available for this problem.');
            }
        }
    }, [selectedLanguage, problem]);

    const checkStatus = async (submissionId) => {
        try {
            const res = await axios.get(`/api/submissions/${submissionId}`);
            const currentSubmission = res.data;
            setSubmission(currentSubmission);

            if (currentSubmission.status === 'Success' || currentSubmission.status === 'Fail') {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        }
        catch (err) {
            console.error('❌ Error checking status:', err);
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    };

    const handleSubmit = async () => {
        if (intervalRef.current) {
            return;
        }

        const payload = {
            problemId: _id,
            code,
            language: selectedLanguage
        };

        try {
            setSubmission({ status: 'Submitting...', output: '' });
            const res = await axios.post(`/api/submit`, payload);
            const newSubmission = res.data;
            setSubmission(newSubmission);

            intervalRef.current = setInterval(() => {
                checkStatus(newSubmission._id);
            }, 2000);

        } catch (err) {
            console.error('❌ Error during submission:', err);
            setSubmission({ status: 'Error', output: 'An error occurred during submission.' });
        }
    };

    if (!problem) {
        return <div>Loading...</div>;
    }

    const availableLanguages = problem.functionDefinitions ? Object.keys(problem.functionDefinitions) : [];

    return (
        <div>
            <h2>{problem.title} <Link to={`/problems/${problem._id}/edit`}><button>Edit</button></Link></h2>
            <p>{problem.description}</p>
            
            {problem.expectedIoType && (
                <div>
                    <h4>I/O Specification:</h4>
                    {problem.expectedIoType.inputParameters?.length > 0 && (
                        <p>Input Parameters: {problem.expectedIoType.inputParameters.map(p => `${p.name}: ${p.type}`).join(', ')}</p>
                    )}
                    {problem.expectedIoType.outputType && (
                        <p>Return Type: {problem.expectedIoType.outputType}</p>
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
                {availableLanguages.map(lang => (
                    <option key={lang} value={lang}>{lang}</option>
                ))}
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