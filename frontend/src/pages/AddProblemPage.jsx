import React, { useState } from 'react';
import axios from 'axios';

const AddProblemPage = () => {
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        difficulty: 'Easy',
        testCases: [{ input: '', expectedOutput: '', meta: { types: '', returns: '' } }],
        functionSignatures: {
            javascript: '',
            python: '',
            java: '',
            cpp: ''
        },
        functionName: {
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
        const { name, value } = e.target;
        const newTestCases = [...formData.testCases];

        if (name.startsWith('meta.')) {
            const [parent, child] = name.split('.');
            newTestCases[index][parent][child] = value;
        } else {
            newTestCases[index][name] = value;
        }
        setFormData({ ...formData, testCases: newTestCases });
    };

    const handleSignatureChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, functionSignatures: { ...formData.functionSignatures, [name]: value } });
    };

    const handleFunctionNameChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, functionName: { ...formData.functionName, [name]: value } });
    };

    const addTestCase = () => {
        setFormData({ ...formData, testCases: [...formData.testCases, { input: '', expectedOutput: '', meta: { types: '', returns: '' } }] });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage('');

        const problemData = { ...formData };
        problemData.testCases = problemData.testCases.map(testCase => {
            const newTestCase = { ...testCase };
            if (newTestCase.meta.types) {
                newTestCase.meta.types = newTestCase.meta.types.split(',').map(type => type.trim());
            } else {
                delete newTestCase.meta.types; // Remove if empty
            }
            if (!newTestCase.meta.returns) {
                delete newTestCase.meta.returns; // Remove if empty
            }
            if (Object.keys(newTestCase.meta).length === 0) {
                delete newTestCase.meta; // Remove meta if empty
            }
            return newTestCase;
        });

        try {
            const res = await axios.post('/api/problems', problemData);
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
                        <input type="text" name="meta.types" placeholder="Input Types (comma-separated)" value={testCase.meta.types} onChange={(e) => handleTestCaseChange(index, e)} />
                        <input type="text" name="meta.returns" placeholder="Return Type" value={testCase.meta.returns} onChange={(e) => handleTestCaseChange(index, e)} />
                    </div>
                ))}
                <button type="button" onClick={addTestCase}>Add Test Case</button>

                <h3>Function Signatures</h3>
                <div>
                    <label>JavaScript Signature:</label>
                    <textarea name="javascript" value={formData.functionSignatures.javascript} onChange={handleSignatureChange} />
                    <label>JavaScript Function Name:</label>
                    <input type="text" name="javascript" value={formData.functionName.javascript} onChange={handleFunctionNameChange} placeholder="e.g., twoSum" />
                </div>
                <div>
                    <label>Python Signature:</label>
                    <textarea name="python" value={formData.functionSignatures.python} onChange={handleSignatureChange} />
                    <label>Python Function Name:</label>
                    <input type="text" name="python" value={formData.functionName.python} onChange={handleFunctionNameChange} placeholder="e.g., two_sum" />
                </div>
                <div>
                    <label>Java Signature:</label>
                    <textarea name="java" value={formData.functionSignatures.java} onChange={handleSignatureChange} />
                    <label>Java Function Name:</label>
                    <input type="text" name="java" value={formData.functionName.java} onChange={handleFunctionNameChange} placeholder="e.g., twoSum" />
                </div>
                <div>
                    <label>C++ Signature:</label>
                    <textarea name="cpp" value={formData.functionSignatures.cpp} onChange={handleSignatureChange} />
                    <label>C++ Function Name:</label>
                    <input type="text" name="cpp" value={formData.functionName.cpp} onChange={handleFunctionNameChange} placeholder="e.g., twoSum" />
                </div>

                <button type="submit">Create Problem</button>
            </form>
        </div>
    );
};

export default AddProblemPage;
