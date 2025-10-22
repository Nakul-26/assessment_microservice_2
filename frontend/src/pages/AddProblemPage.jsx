import React, { useState } from 'react';
import axios from 'axios';

const AddProblemPage = () => {
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        difficulty: 'Easy',
        testCases: [{ input: '', expectedOutput: '' }],
        functionSignatures: {
            javascript: '',
            python: '',
            java: '',
            cpp: ''
        }
    });
    const [message, setMessage] = useState('');

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
    };

    const handleTestCaseChange = (index, e) => {
        const newTestCases = [...formData.testCases];
        newTestCases[index][e.target.name] = e.target.value;
        setFormData({ ...formData, testCases: newTestCases });
    };

    const addTestCase = () => {
        setFormData({ ...formData, testCases: [...formData.testCases, { input: '', expectedOutput: '' }] });
    };

    const handleSignatureChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, functionSignatures: { ...formData.functionSignatures, [name]: value } });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage('');
        try {
            const res = await axios.post('/api/problems', formData);
            setMessage(res.data.message);
            console.log('Problem created:', res.data.problem);
        } catch (err) {
            setMessage('Error creating problem: ' + err.response.data);
            console.error('Error creating problem:', err);
        }
    };

    return (
        <div>
            <h2>Add New Problem</h2>
            {message && <p>{message}</p>}
            <form onSubmit={handleSubmit}>
                <div>
                    <label>Title:</label>
                    <input type="text" name="title" value={formData.title} onChange={handleChange} required />
                </div>
                <div>
                    <label>Description:</label>
                    <textarea name="description" value={formData.description} onChange={handleChange} required />
                </div>
                <div>
                    <label>Difficulty:</label>
                    <select name="difficulty" value={formData.difficulty} onChange={handleChange}>
                        <option value="Easy">Easy</option>
                        <option value="Medium">Medium</option>
                        <option value="Hard">Hard</option>
                    </select>
                </div>

                <h3>Test Cases</h3>
                {formData.testCases.map((testCase, index) => (
                    <div key={index}>
                        <textarea name="input" placeholder="Input (JSON)" value={testCase.input} onChange={(e) => handleTestCaseChange(index, e)} required />
                        <textarea name="expectedOutput" placeholder="Expected Output (JSON)" value={testCase.expectedOutput} onChange={(e) => handleTestCaseChange(index, e)} required />
                    </div>
                ))}
                <button type="button" onClick={addTestCase}>Add Test Case</button>

                <h3>Function Signatures</h3>
                <div>
                    <label>JavaScript:</label>
                    <textarea name="javascript" value={formData.functionSignatures.javascript} onChange={handleSignatureChange} />
                </div>
                <div>
                    <label>Python:</label>
                    <textarea name="python" value={formData.functionSignatures.python} onChange={handleSignatureChange} />
                </div>
                <div>
                    <label>Java:</label>
                    <textarea name="java" value={formData.functionSignatures.java} onChange={handleSignatureChange} />
                </div>
                <div>
                    <label>C++:</label>
                    <textarea name="cpp" value={formData.functionSignatures.cpp} onChange={handleSignatureChange} />
                </div>

                <button type="submit">Create Problem</button>
            </form>
        </div>
    );
};

export default AddProblemPage;
