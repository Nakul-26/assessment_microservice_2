
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

const ProblemListPage = () => {
    const [problems, setProblems] = useState([]);

    useEffect(() => { 
        const fetchProblems = async () => {
            console.log('Fetching problems...');
            try {
                const base = 'https://bookish-space-barnacle-7vv5qx76q5pjcpjv4-3000.app.github.dev';
                console.log("base url:",base);
                const res = await axios.get(`${base}/api/problems`);
                setProblems(res.data);
                console.log('Problems fetched successfully:', res.data);
            } catch (err) {
                console.error('❌ Error fetching problems:', err);
            }
        };
        fetchProblems();
    }, []);

    return (
        <div>
            <h2>Problems</h2>
            <ul>
                {problems.map(problem => (
                    <li key={problem._id}>
                        <Link to={`/problems/${problem._id}`}>{problem.title}</Link> - {problem.difficulty}
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default ProblemListPage;
