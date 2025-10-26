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
    const [previewData, setPreviewData] = useState(null);
    const [showPreview, setShowPreview] = useState(false);
    const [clientErrors, setClientErrors] = useState([]);

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
        setClientErrors([]);
        // client-side validation
        const errs = [];
        if (!formData.title.trim()) errs.push('Title is required');
        if (!formData.description.trim()) errs.push('Description is required');
        formData.testCases.forEach((tc, i) => {
            if (!tc.input || !tc.input.trim()) errs.push(`Test case ${i+1}: input is required`);
            if (!tc.expectedOutput || !tc.expectedOutput.trim()) errs.push(`Test case ${i+1}: expected output is required`);
        });
        const hasFn = Object.values(formData.functionName).some(v => v && v.trim() !== '');
        if (!hasFn) errs.push('At least one function name (per-language) must be provided');
        if (errs.length) {
            setClientErrors(errs);
            return;
        }
        // Transform UI form into backend Problem schema
        const problemData = {
            title: formData.title,
            description: formData.description,
            difficulty: formData.difficulty,
            // Keep legacy maps for signatures and function names
            functionSignatures: formData.functionSignatures,
            functionName: formData.functionName,
        };

        // Build test cases in backend-friendly shape: InputRaw and ExpectedOutputRaw
        problemData.testCases = formData.testCases.map((tc, idx) => {
            const testCase = {
                id: idx + 1,
                type: 'sample',
                inputRaw: tc.input,
                expectedOutputRaw: tc.expectedOutput,
                isHidden: false,
            };
            // include meta if present (optional)
            if (tc.meta) {
                if (tc.meta.types) testCase.meta = { types: tc.meta.types.split(',').map(s => s.trim()) };
                if (tc.meta.returns) testCase.meta = { ...(testCase.meta || {}), returns: tc.meta.returns };
            }
            return testCase;
        });

        // Populate a minimal ExpectedIoType helpful for parsing; prefer the first test case meta if present
        const firstMeta = formData.testCases && formData.testCases[0] && formData.testCases[0].meta ? formData.testCases[0].meta : null;
        const inputParams = [];
        if (firstMeta && firstMeta.types) {
            firstMeta.types.split(',').forEach((typeStr, index) => {
                inputParams.push({ name: `arg${index}`, type: typeStr.trim() });
            });
        }
        problemData.expectedIoType = {
            inputParameters: inputParams,
            outputType: firstMeta && firstMeta.returns ? firstMeta.returns : '',
        };

        // Primary function signature: pick python then javascript as a hint for frontend/template
        const primaryLang = formData.functionSignatures.python ? 'python' : 'javascript';
        problemData.functionSignature = {
            language: primaryLang,
            template: formData.functionSignatures[primaryLang] || '',
        };

        try {
            const res = await axios.post('/api/problems', problemData);
            setMessage(res.data.message || 'Problem created');
            console.log('Problem created:', res.data.problem || res.data);
        } catch (err) {
            setMessage('Error creating problem: ' + (err.response && err.response.data ? JSON.stringify(err.response.data) : String(err)));
            console.error('Error creating problem:', err);
        }
    };

    const handlePreview = async () => {
        setMessage('');
        // build lightweight problem payload similar to what will be sent
        const problemPayload = {
            testCases: formData.testCases.map((tc, idx) => ({ id: idx+1, inputRaw: tc.input, expectedOutputRaw: tc.expectedOutput, isHidden: false })),
            functionName: formData.functionName,
            expectedIoType: (() => {
                const firstMeta = formData.testCases && formData.testCases[0] && formData.testCases[0].meta ? formData.testCases[0].meta : null;
                const inputParams = [];
                if (firstMeta && firstMeta.types) {
                    firstMeta.types.split(',').forEach((typeStr, index) => {
                        inputParams.push({ name: `arg${index}`, type: typeStr.trim() });
                    });
                }
                return {
                    inputParameters: inputParams,
                    outputType: firstMeta && firstMeta.returns ? firstMeta.returns : '',
                };
            })(),
        };
        // pick language to preview (use python if present, otherwise javascript)
        const language = formData.functionSignatures.python ? 'python' : 'javascript';
        try {
            const res = await axios.post('/api/problems/preview', { problem: problemPayload, language });
            setPreviewData(res.data);
            setShowPreview(true);
        } catch (err) {
            setMessage('Preview failed: ' + (err.response ? JSON.stringify(err.response.data) : String(err)));
        }
    };

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    return (
        <div>
            <h2>Add New Problem</h2>
            {clientErrors.length > 0 && (
                <div style={{background: '#ffecec', padding: '8px', borderRadius: 4, marginBottom: 12}}>
                    <strong>Fix the following before submitting:</strong>
                    <ul>
                        {clientErrors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                </div>
            )}
            <div style={{border: '1px solid #ddd', padding: '12px', marginBottom: '16px', borderRadius: '6px', background: '#fbfbfb'}}>
                <h4>How to add problems (quick guide)</h4>
                <ul>
                    <li>Provide test case <strong>Input</strong> and <strong>Expected Output</strong> as JSON or simple values (e.g. <code>[1,2,3]</code> or <code>9</code>).</li>
                    <li>Inputs may be <em>named</em> lines like <code>nums = [2,7,11,15]{'\n'}target = 9</code> or raw JSON (e.g. <code>{'{' }"nums": [2,7], "target": 9{'}'}</code>).</li>
                    <li>Set the <strong>Function Name</strong> for each language — the judge will call this function in the wrapper. For JavaScript export your function from the submission file (e.g. <code>module.exports = {'{'} twoSum {'}'}</code>), for Python define the function with the same name, for Java provide a public static method in the named class.</li>
                    <li>Optionally specify input types (comma-separated) and return type to help the judge parse inputs.</li>
                    <li>Examples: <em>Input</em>: <code>nums = [2,7,11,15]{'\n'}target = 9</code>, <em>Expected Output</em>: <code>[0,1]</code>.</li>
                </ul>
            </div>
            {message && <p>{message}</p>}
            {showPreview && previewData && (
                <div style={{position: 'fixed', left:0, top:0, right:0, bottom:0, background: 'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center'}} onClick={() => setShowPreview(false)}>
                    <div style={{width:'80%', height:'80%', background:'#fff', padding: 16, overflow:'auto'}} onClick={(e)=>e.stopPropagation()}>
                        <button onClick={() => setShowPreview(false)} style={{float:'right'}}>Close</button>
                        <h3>Wrapper Preview</h3>
                        <pre style={{whiteSpace:'pre-wrap', background:'#f4f4f4', padding:8}}>{previewData.wrapper}</pre>
                        <h3>Parsed Tests</h3>
                        <pre style={{whiteSpace:'pre-wrap', background:'#f4f4f4', padding:8}}>{JSON.stringify(previewData.tests, null, 2)}</pre>
                    </div>
                </div>
            )}
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
                        <textarea name="input" placeholder="Input (JSON or named assignments)" value={testCase.input} onChange={(e) => handleTestCaseChange(index, e)} required />
                        <textarea name="expectedOutput" placeholder="Expected Output (JSON or scalar)" value={testCase.expectedOutput} onChange={(e) => handleTestCaseChange(index, e)} required />
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

                <button type="button" onClick={handlePreview} style={{marginRight: '8px'}}>Preview</button>
                <button type="submit">Create Problem</button>
            </form>
        </div>
    );
};

export default AddProblemPage;
