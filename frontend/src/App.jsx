import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Route, Routes, Link } from 'react-router-dom';
import ProblemListPage from './pages/ProblemListPage';
import ProblemPage from './pages/ProblemPage';
import AddProblemPage from './pages/AddProblemPage';
import EditProblemPage from './pages/EditProblemPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import MySubmissionsPage from './pages/MySubmissionsPage';
import { setAuthToken } from './api';


function App() {
    useEffect(() => {
        console.log('App component mounted');
    }, []);

    const [user, setUser] = useState(() => {
        const raw = localStorage.getItem('user');
        return raw ? JSON.parse(raw) : null;
    });

    useEffect(() => {
        const syncAuth = () => {
            const raw = localStorage.getItem('user');
            setUser(raw ? JSON.parse(raw) : null);
        };
        window.addEventListener('auth-change', syncAuth);
        window.addEventListener('storage', syncAuth);
        return () => {
            window.removeEventListener('auth-change', syncAuth);
            window.removeEventListener('storage', syncAuth);
        };
    }, []);

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setAuthToken(null);
        setUser(null);
        window.dispatchEvent(new Event('auth-change'));
    };

    const canCreateProblem = user && (user.role === 'admin' || user.role === 'faculty');

    return (
        <Router>
            <div className="header">
                <h1>Placement Assessment</h1>
                <nav>
                    <Link to="/">All Problems</Link>
                    {canCreateProblem && (
                        <span> | <Link to="/add-problem">Add Problem</Link></span>
                    )}
                    {!user && (
                        <span> | <Link to="/login">Login</Link></span>
                    )}
                    {!user && (
                        <span> | <Link to="/register">Register</Link></span>
                    )}
                    {user && (
                        <span> | <Link to="/my-submissions">My Submissions</Link></span>
                    )}
                    {user && (
                        <span> | <button className="button" onClick={handleLogout}>Logout</button></span>
                    )}
                </nav>
            </div>
            <div className="container">
                <Routes>
                    <Route path="/" element={<ProblemListPage />} />
                    <Route path="/problems/:_id" element={<ProblemPage />} />
                    <Route path="/add-problem" element={<AddProblemPage />} />
                    <Route path="/problems/:_id/edit" element={<EditProblemPage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="/my-submissions" element={<MySubmissionsPage />} />
                </Routes>
            </div>
        </Router>
    );
}

export default App;
