import React, { useEffect } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import ProblemListPage from './pages/ProblemListPage';
import ProblemPage from './pages/ProblemPage';
import AddProblemPage from './pages/AddProblemPage';
import './App.css';

function App() {
    useEffect(() => {
        console.log('App component mounted');
    }, []);

    return (
        <Router>
            <div className="App">
                <h1>Placement Assessment</h1>
                <nav>
                    <a href="/">All Problems</a> | <a href="/add-problem">Add Problem</a>
                </nav>
                <Routes>
                    <Route path="/" element={<ProblemListPage />} />
                    <Route path="/problems/:id" element={<ProblemPage />} />
                    <Route path="/add-problem" element={<AddProblemPage />} />
                </Routes>
            </div>
        </Router>
    );
}

export default App;