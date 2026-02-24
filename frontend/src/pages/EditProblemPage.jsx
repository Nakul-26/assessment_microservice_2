import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';

const EditProblemPage = () => {
    const { _id } = useParams();
    const navigate = useNavigate();

    const [formData, setFormData] = useState({
        title: '',
        description: '',
        difficulty: 'Easy',
        tags: '',
        isPremium: false,
        testCases: [{ input: '[]', expectedOutput: '' }],
        functionDefinitions: {
            javascript: { name: '', template: '' },
            python: { name: '', template: '' },
            java: { name: '', template: '' },
            c: { name: '', template: '' },
            csharp: { name: '', template: '' }
        },
        expectedIoType: {
            functionName: '',
            inputParameters: [{ name: '', type: '' }],
            returnType: ''
        }
    });

    const [message, setMessage] = useState('');
    const [clientErrors, setClientErrors] = useState([]);

    useEffect(() => {
        const fetchProblem = async () => {
            try {
                const res = await api.get(`/api/problems/${_id}`);
                const problem = res.data;

                // Transform fetched data to match form state
                const transformedData = {
                    ...problem,
                    tags: problem.tags ? problem.tags.join(', ') : '',
                    testCases: problem.testCases.map(tc => ({
                        input: JSON.stringify(tc.input, null, 2),
                        expectedOutput: typeof tc.expectedOutput === 'object' ? JSON.stringify(tc.expectedOutput, null, 2) : String(tc.expectedOutput),
                    })),
                    functionDefinitions: problem.functionDefinitions || { javascript: { name: '', template: '' }, python: { name: '', template: '' }, java: { name: '', template: '' }, c: { name: '', template: '' }, csharp: { name: '', template: '' } },
                };

                setFormData(transformedData);
            } catch (err) {
                console.error('Error fetching problem:', err);
                setMessage('Error fetching problem for edit.');
            }
        };
        fetchProblem();
    }, [_id]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData({ ...formData, [name]: type === 'checkbox' ? checked : value });
    };

    const handleTestCaseChange = (index, e) => {
        const { name, value } = e.target;
        const newTestCases = [...formData.testCases];
        newTestCases[index][name] = value;
        setFormData({ ...formData, testCases: newTestCases });
    };

    const handleFunctionDefinitionChange = (lang, field, value) => {
        setFormData({
            ...formData,
            functionDefinitions: {
                ...formData.functionDefinitions,
                [lang]: {
                    ...formData.functionDefinitions[lang],
                    [field]: value
                }
            }
        });
    };
    
    const handleIoParamChange = (index, e) => {
        const { name, value } = e.target;
        const newParams = [...formData.expectedIoType.inputParameters];
        newParams[index][name] = value;
        setFormData({ ...formData, expectedIoType: { ...formData.expectedIoType, inputParameters: newParams } });
    };

    const addIoParam = () => {
        setFormData({ ...formData, expectedIoType: { ...formData.expectedIoType, inputParameters: [...formData.expectedIoType.inputParameters, { name: '', type: '' }] } });
    };

    const addTestCase = () => {
        setFormData({ ...formData, testCases: [...formData.testCases, { input: '[]', expectedOutput: '' }] });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage('');
        setClientErrors([]);

        const errs = [];
        if (!formData.title.trim()) errs.push('Title is required');
        // Add more validation as needed...

        if (errs.length) {
            setClientErrors(errs);
            return;
        }

        const problemData = {
            ...formData,
            tags: formData.tags.split(',').map(tag => tag.trim()).filter(tag => tag),
            testCases: formData.testCases.map(tc => {
                let expected;
                try {
                    expected = JSON.parse(tc.expectedOutput);
                } catch (e) {
                    expected = tc.expectedOutput;
                }
                return {
                    ...tc,
                    input: JSON.parse(tc.input),
                    expectedOutput: expected,
                };
            }),
        };

        try {
            await api.put(`/api/problems/${_id}`, problemData);
            setMessage('Problem updated successfully.');
            navigate(`/problems/${_id}`);
        } catch (err) {
            setMessage('Error updating problem: ' + (err.response?.data?.message || String(err)));
        }
    };

    return (
        <div className="container">
            <h2>Edit Problem</h2>
            {clientErrors.length > 0 && (
                <div className="problem-card" style={{background: '#ffecec', color: '#dc3545'}}>
                    <strong>Fix the following:</strong>
                    <ul>{clientErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </div>
            )}
            {message && <p>{message}</p>}

            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label>Title:</label>
                    <input type="text" name="title" value={formData.title} onChange={handleChange} required />
                </div>
                <div className="form-group">
                    <label>Description:</label>
                    <textarea name="description" value={formData.description} onChange={handleChange} required />
                </div>
                <div className="form-group">
                    <label>Difficulty:</label>
                    <select name="difficulty" value={formData.difficulty} onChange={handleChange}>
                        <option value="Easy">Easy</option>
                        <option value="Medium">Medium</option>
                        <option value="Hard">Hard</option>
                    </select>
                </div>
                <div className="form-group">
                    <label>Tags (comma-separated):</label>
                    <input type="text" name="tags" value={formData.tags} onChange={handleChange} />
                </div>
                <div className="form-group">
                    <label>
                        <input type="checkbox" name="isPremium" checked={formData.isPremium} onChange={handleChange} />
                        Is Premium?
                    </label>
                </div>

                <h3>Test Cases</h3>
                {formData.testCases.map((tc, i) => (
                    <div key={i} className="form-group problem-card">
                        <label>Test Case {i + 1}</label>
                        <textarea name="input" value={tc.input} onChange={(e) => handleTestCaseChange(i, e)} required />
                        <textarea name="expectedOutput" value={tc.expectedOutput} onChange={(e) => handleTestCaseChange(i, e)} required />
                    </div>
                ))}
                <button type="button" onClick={addTestCase} className="button">Add Test Case</button>

                <h3>Function Definitions</h3>
                {Object.keys(formData.functionDefinitions).map(lang => (
                    <div key={lang} className="form-group problem-card">
                        <h4>{lang.charAt(0).toUpperCase() + lang.slice(1)}</h4>
                        <input type="text" placeholder="Function Name" value={formData.functionDefinitions[lang]?.name || ''} onChange={e => handleFunctionDefinitionChange(lang, 'name', e.target.value)} />
                        <textarea placeholder="Function Template" value={formData.functionDefinitions[lang]?.template || ''} onChange={e => handleFunctionDefinitionChange(lang, 'template', e.target.value)} />
                    </div>
                ))}

                <h3>Expected I/O Types</h3>
                <div className="form-group problem-card">
                    <label>Function Name:</label>
                    <input type="text" placeholder="Function Name" value={formData.expectedIoType.functionName || ''} onChange={e => setFormData({...formData, expectedIoType: {...formData.expectedIoType, functionName: e.target.value}})} />
                </div>
                {formData.expectedIoType.inputParameters.map((param, index) => (
                    <div key={index} className="form-group problem-card">
                        <label>Input Parameter {index + 1}</label>
                        <input type="text" name="name" placeholder="Param Name" value={param.name} onChange={e => handleIoParamChange(index, e)} />
                        <input type="text" name="type" placeholder="Param Type" value={param.type} onChange={e => handleIoParamChange(index, e)} />
                    </div>
                ))}
                <button type="button" onClick={addIoParam} className="button">Add Input Parameter</button>
                <div className="form-group problem-card">
                    <label>Return Type:</label>
                    <input type="text" placeholder="Return Type" value={formData.expectedIoType.returnType || ''} onChange={e => setFormData({...formData, expectedIoType: {...formData.expectedIoType, returnType: e.target.value}})} />
                </div>
                
                <button type="submit" className="button mt-20">Update Problem</button>
            </form>
        </div>
    );
};

export default EditProblemPage;
