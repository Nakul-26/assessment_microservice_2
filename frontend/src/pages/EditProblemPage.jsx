import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { buildProblemPayload, collectErrorMessages } from '../utils/problemForm';

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

  const [apiError, setApiError] = useState('');
  const [apiErrors, setApiErrors] = useState([]);
  const [formErrors, setFormErrors] = useState({});

  const fieldError = (key) => formErrors[key];
  const fieldClassName = (key) => fieldError(key) ? 'input-error' : '';

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
        setApiError('Error fetching problem for edit.');
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
    setApiError('');
    setApiErrors([]);

    const { errors, payload } = buildProblemPayload(formData);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});

    try {
      await api.put(`/api/problems/${_id}`, payload);
      navigate(`/problems/${_id}`);
    } catch (err) {
      const data = err.response?.data;
      setApiError(data?.error || 'Failed to update problem');
      setApiErrors(Array.isArray(data?.errors) ? data.errors : []);
    }
  };

  return (
    <div className="container">
      <h2>Edit Problem</h2>
      {collectErrorMessages(formErrors).length > 0 && (
        <div className="error-box">
          <strong>Fix the following:</strong>
          <ul>{collectErrorMessages(formErrors).map((error, index) => <li key={index}>{error}</li>)}</ul>
        </div>
      )}
      {apiError && (
        <div className="error-box">
          <strong>Unable to update problem.</strong>
          <div>{apiError}</div>
          {apiErrors.length > 0 && (
            <ul>{apiErrors.map((error, index) => <li key={index}>{error}</li>)}</ul>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Title:</label>
          <input type="text" name="title" value={formData.title} onChange={handleChange} className={fieldClassName('title')} required />
          {fieldError('title') && <div className="error-text">{fieldError('title')}</div>}
        </div>
        <div className="form-group">
          <label>Description:</label>
          <textarea name="description" value={formData.description} onChange={handleChange} className={fieldClassName('description')} required />
          {fieldError('description') && <div className="error-text">{fieldError('description')}</div>}
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
          <input type="text" name="functionName" value={formData.functionName} onChange={handleChange} className={fieldClassName('functionName')} required />
          {fieldError('functionName') && <div className="error-text">{fieldError('functionName')}</div>}
        </div>
        <div className="form-group">
          <label>Return Type:</label>
          <input type="text" name="returnType" value={formData.returnType} onChange={handleChange} className={fieldClassName('returnType')} required />
          {fieldError('returnType') && <div className="error-text">{fieldError('returnType')}</div>}
        </div>

        <h3>Parameters</h3>
        {fieldError('parameters') && <div className="error-text mb-20">{fieldError('parameters')}</div>}
        {formData.parameters.map((p, i) => (
          <div key={i} className="form-group problem-card">
            <label>Parameter {i + 1}</label>
            <input
              type="text"
              name="name"
              placeholder="Name"
              value={p.name}
              onChange={(e) => handleParamChange(i, e)}
              className={fieldClassName(`parameters.${i}.name`)}
            />
            {fieldError(`parameters.${i}.name`) && <div className="error-text">{fieldError(`parameters.${i}.name`)}</div>}
            <input
              type="text"
              name="type"
              placeholder="Type"
              value={p.type}
              onChange={(e) => handleParamChange(i, e)}
              className={fieldClassName(`parameters.${i}.type`)}
            />
            {fieldError(`parameters.${i}.type`) && <div className="error-text">{fieldError(`parameters.${i}.type`)}</div>}
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
        <p className="form-hint">Mark the first 1-2 test cases as sample so students can see example inputs and outputs.</p>
        {fieldError('testCases') && <div className="error-text mb-20">{fieldError('testCases')}</div>}
        {formData.testCases.map((tc, i) => (
          <div key={i} className="form-group problem-card">
            <label>Test Case {i + 1}</label>
            <textarea
              name="inputs"
              value={tc.inputs}
              onChange={(e) => handleTestCaseChange(i, e)}
              className={fieldClassName(`testCases.${i}.inputs`) || fieldClassName(`testCases.${i}`)}
              required
            />
            {fieldError(`testCases.${i}.inputs`) && <div className="error-text">{fieldError(`testCases.${i}.inputs`)}</div>}
            {fieldError(`testCases.${i}`) && <div className="error-text">{fieldError(`testCases.${i}`)}</div>}
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
