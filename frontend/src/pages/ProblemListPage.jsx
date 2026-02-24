
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

function ProblemListPage() {
  const [problems, setProblems] = useState([]);

  useEffect(() => {
    api.get('/api/problems')
      .then(response => setProblems(response.data))
      .catch(error => console.error('Error fetching problems:', error));
  }, []);

  const handleDelete = (_id) => {
    api.delete(`/api/problems/${_id}`)
      .then(() => {
        setProblems(problems.filter(problem => problem._id !== _id));
      })
      .catch(error => console.error('Error deleting problem:', error));
  };

  return (
    <div className="container">
      <h2 className="mb-20">Problems</h2>
      <Link to="/add-problem" className="button">Add New Problem</Link>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Difficulty</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {problems.map(problem => (
              <tr key={problem._id}>
                <td>
                  <Link to={`/problems/${problem._id}`}>{problem.title}</Link>
                </td>
                <td>{problem.difficulty}</td>
                <td>
                  <Link to={`/problems/${problem._id}/edit`} className="button">Edit</Link>
                  <button onClick={() => handleDelete(problem._id)} className="button button-danger">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ProblemListPage;
