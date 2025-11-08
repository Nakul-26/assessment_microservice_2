
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

function ProblemListPage() {
  const [problems, setProblems] = useState([]);

  useEffect(() => {
    axios.get('/api/problems')
      .then(response => setProblems(response.data))
      .catch(error => console.error('Error fetching problems:', error));
  }, []);

  const handleDelete = (_id) => {
    axios.delete(`/api/problems/${_id}`)
      .then(() => {
        setProblems(problems.filter(problem => problem._id !== _id));
      })
      .catch(error => console.error('Error deleting problem:', error));
  };

  return (        <div>
            <h2>Problems</h2>
            <ul>
                {problems.map(problem => (
            <li key={problem._id}>
              <Link to={`/problems/${problem._id}`}>{problem.title}</Link>
              <Link to={`/problems/${problem._id}/edit`}><button>Edit</button></Link>
              <button onClick={() => handleDelete(problem._id)}>Delete</button>
            </li>
                ))}
            </ul>
        </div>
    );
};

export default ProblemListPage;
