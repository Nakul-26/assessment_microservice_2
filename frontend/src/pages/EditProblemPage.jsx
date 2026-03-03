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
    functionName: '',
    parameters: [{ name: '', type: '' }],
    returnType: '',
    compareConfig: {
      mode: 'EXACT',
      floatTolerance: 0,
      orderInsensitive: false
    },
    testCases: [{ inputs: '[]', expected: '', isSample: true }]
  });

  const [message, setMessage] = useState('');
  const [clientErrors, setClientErrors] = useState([]);

  useEffect(() => {
    const fetchProblem = async () => {
      try {
        const res = await api.get(`/api/problems/${_id}`);
        const problem = res.data;

        const transformedData = {
          ...problem,
          tags: problem.tags ? problem.tags.join(', ') : '',
          parameters: Array.isArray(problem.parameters) && problem.parameters.length > 0
            ? problem.parameters
            : [{ name: '', type: '' }],
          compareConfig: {
            mode: problem.compareConfig?.mode || 'EXACT',
            floatTolerance: problem.compareConfig?.floatTolerance ?? 0,
            orderInsensitive: !!problem.compareConfig?.orderInsensitive
          },
          testCases: (problem.testCases || []).map((tc) => ({
            inputs: JSON.stringify(tc.inputs ?? [], null, 2),
            expected: typeof tc.expected === 'object' ? JSON.stringify(tc.expected, null, 2) : String(tc.expected ?? ''),
            isSample: typeof tc.isSample === 'boolean' ? tc.isSample : !tc.isHidden
          }))
        };

        setFormData(transformedData);
      } catch (err) {
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
    const { name, value, type, checked } = e.target;
    const next = [...formData.testCases];
    next[index][name] = type === 'checkbox' ? checked : value;
    setFormData({ ...formData, testCases: next });
  };

  const handleParamChange = (index, e) => {
    const { name, value } = e.target;
    const next = [...formData.parameters];
    next[index][name] = value;
    setFormData({ ...formData, parameters: next });
  };

  const addParameter = () => {
    setFormData({ ...formData, parameters: [...formData.parameters, { name: '', type: '' }] });
  };

  const addTestCase = () => {
    const nextIsSample = formData.testCases.length < 2;
    setFormData({
      ...formData,
      testCases: [...formData.testCases, { inputs: '[]', expected: '', isSample: nextIsSample }]
    });
  };

  const handleCompareConfigChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      compareConfig: {
        ...formData.compareConfig,
        [name]: type === 'checkbox' ? checked : value
      }
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    setClientErrors([]);

    const errs = [];
    if (!formData.title.trim()) errs.push('Title is required');
    if (!formData.description.trim()) errs.push('Description is required');
    if (!formData.functionName.trim()) errs.push('Function name is required');
    if (!formData.returnType.trim()) errs.push('Return type is required');

    const params = formData.parameters
      .map((p) => ({ name: String(p.name || '').trim(), type: String(p.type || '').trim() }))
      .filter((p) => p.name && p.type);

    if (params.length === 0) errs.push('At least one parameter is required');

    const parsedCases = formData.testCases.map((tc, i) => {
      let parsedInputs = [];
      let parsedExpected = tc.expected;
      try {
        parsedInputs = JSON.parse(tc.inputs);
      } catch {
        errs.push(`Test case ${i + 1}: inputs must be valid JSON array`);
      }
      if (!Array.isArray(parsedInputs)) {
        errs.push(`Test case ${i + 1}: inputs must be a JSON array`);
      }
      if (Array.isArray(parsedInputs) && parsedInputs.length !== params.length) {
        errs.push(`Test case ${i + 1}: inputs count must match parameters count (${params.length})`);
      }

      try {
        parsedExpected = JSON.parse(tc.expected);
      } catch {
        parsedExpected = tc.expected;
      }

      return {
        inputs: Array.isArray(parsedInputs) ? parsedInputs : [],
        expected: parsedExpected,
        isSample: !!tc.isSample
      };
    });

    if (errs.length > 0) {
      setClientErrors(errs);
      return;
    }

    const payload = {
      title: formData.title,
      description: formData.description,
      difficulty: formData.difficulty,
      functionName: formData.functionName.trim(),
      parameters: params,
      returnType: formData.returnType.trim(),
      compareConfig: {
        mode: formData.compareConfig.mode,
        floatTolerance: Number(formData.compareConfig.floatTolerance) || 0,
        orderInsensitive: !!formData.compareConfig.orderInsensitive
      },
      testCases: parsedCases,
      tags: formData.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      isPremium: !!formData.isPremium
    };

    try {
      await api.put(`/api/problems/${_id}`, payload);
      navigate(`/problems/${_id}`);
    } catch (err) {
      setMessage('Error updating problem: ' + (err.response?.data?.message || String(err)));
    }
  };

  return (
    <div className="container">
      <h2>Edit Problem</h2>
      {clientErrors.length > 0 && (
        <div className="problem-card" style={{ background: '#ffecec', color: '#dc3545' }}>
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
          <label>Function Name:</label>
          <input type="text" name="functionName" value={formData.functionName} onChange={handleChange} required />
        </div>
        <div className="form-group">
          <label>Return Type:</label>
          <input type="text" name="returnType" value={formData.returnType} onChange={handleChange} required />
        </div>

        <h3>Parameters</h3>
        {formData.parameters.map((p, i) => (
          <div key={i} className="form-group problem-card">
            <label>Parameter {i + 1}</label>
            <input type="text" name="name" placeholder="Name" value={p.name} onChange={(e) => handleParamChange(i, e)} />
            <input type="text" name="type" placeholder="Type" value={p.type} onChange={(e) => handleParamChange(i, e)} />
          </div>
        ))}
        <button type="button" onClick={addParameter} className="button">Add Parameter</button>

        <h3>Compare Config</h3>
        <div className="form-group problem-card">
          <label>Mode:</label>
          <select name="mode" value={formData.compareConfig.mode} onChange={handleCompareConfigChange}>
            <option value="EXACT">EXACT</option>
            <option value="STRUCTURAL">STRUCTURAL</option>
          </select>
          <label>Float Tolerance:</label>
          <input type="number" step="0.000001" name="floatTolerance" value={formData.compareConfig.floatTolerance} onChange={handleCompareConfigChange} />
          <label>
            <input type="checkbox" name="orderInsensitive" checked={!!formData.compareConfig.orderInsensitive} onChange={handleCompareConfigChange} />
            Order Insensitive Arrays
          </label>
        </div>

        <h3>Test Cases</h3>
        {formData.testCases.map((tc, i) => (
          <div key={i} className="form-group problem-card">
            <label>Test Case {i + 1}</label>
            <textarea name="inputs" value={tc.inputs} onChange={(e) => handleTestCaseChange(i, e)} required />
            <textarea name="expected" value={tc.expected} onChange={(e) => handleTestCaseChange(i, e)} required />
            <label>
              <input type="checkbox" name="isSample" checked={!!tc.isSample} onChange={(e) => handleTestCaseChange(i, e)} />
              Visible to students (sample)
            </label>
          </div>
        ))}
        <button type="button" onClick={addTestCase} className="button">Add Test Case</button>

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

        <button type="submit" className="button mt-20">Update Problem</button>
      </form>
    </div>
  );
};

export default EditProblemPage;
