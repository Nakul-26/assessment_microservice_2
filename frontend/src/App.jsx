import React, { useEffect } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import ProblemListPage from './pages/ProblemListPage';
import ProblemPage from './pages/ProblemPage';
import AddProblemPage from './pages/AddProblemPage';
import EditProblemPage from './pages/EditProblemPage';


function App() {
    useEffect(() => {
        console.log('App component mounted');
    }, []);

    return (
        <Router>
            <div className="header">
                <h1>Placement Assessment</h1>
                <nav>
                    <a href="/">All Problems</a> | <a href="/add-problem">Add Problem</a>
                </nav>
            </div>
            <div className="container">
                <Routes>
                    <Route path="/" element={<ProblemListPage />} />
                    <Route path="/problems/:_id" element={<ProblemPage />} />
                    <Route path="/add-problem" element={<AddProblemPage />} />
                    <Route path="/problems/:_id/edit" element={<EditProblemPage />} />
                </Routes>
            </div>
        </Router>
    );
}

export default App;