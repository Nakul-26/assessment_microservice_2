import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Route, Routes, Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Code2, BookOpen, Settings, PlusCircle, LogIn, Database, LogOut, LayoutDashboard, Users, AlertTriangle } from 'lucide-react';
import ProblemListPage from './pages/ProblemListPage';
import AssessmentListPage from './pages/AssessmentListPage';
import AssessmentManagementPage from './pages/AssessmentManagementPage';
import AddAssessmentPage from './pages/AddAssessmentPage';
import EditAssessmentPage from './pages/EditAssessmentPage';
import AssessmentDetailsPage from './pages/AssessmentDetailsPage';
import AssessmentPreviewPage from './pages/AssessmentPreviewPage';
import AssessmentWorkspace from './pages/AssessmentWorkspace';
import AssessmentResultPage from './pages/AssessmentResultPage';
import AssessmentResultsPage from './pages/AssessmentResultsPage';
import QuestionBankPage from './pages/QuestionBankPage';
import AddQuestionPage from './pages/AddQuestionPage';
import EditQuestionPage from './pages/EditQuestionPage';
import AssessmentAttemptDetailPage from './pages/AssessmentAttemptDetailPage';
import ProblemPage from './pages/ProblemPage';
import AddProblemPage from './pages/AddProblemPage';
import EditProblemPage from './pages/EditProblemPage';
import LoginPage from './pages/LoginPage';
import MySubmissionsPage from './pages/MySubmissionsPage';
import SystemDashboardPage from './pages/SystemDashboardPage';
import UserManagementPage from './pages/UserManagementPage';
import { setAuthToken, system } from './api';

function AppContent() {
    const navigate = useNavigate();
    const location = useLocation();
    const [user, setUser] = useState(() => {
        try {
            const raw = localStorage.getItem('user');
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    });

    const [banner, setBanner] = useState(null);

    const fetchBanner = async () => {
        try {
            const res = await system.getBanner();
            if (res.data && res.data.active) {
                setBanner(res.data);
            } else {
                setBanner(null);
            }
        } catch (err) {
            console.error("Failed to fetch system banner", err);
        }
    };

    useEffect(() => {
        fetchBanner();
        const interval = setInterval(fetchBanner, 30000);
        window.addEventListener("refresh-banner", fetchBanner);
        return () => {
            clearInterval(interval);
            window.removeEventListener("refresh-banner", fetchBanner);
        };
    }, []);

    useEffect(() => {
        const syncAuth = () => {
            try {
                const raw = localStorage.getItem('user');
                const newUser = raw ? JSON.parse(raw) : null;
                
                // If the user was logged in but now isn't (e.g. token expired), 
                // and we are on a protected route, redirect to login.
                if (user && !newUser) {
                    const protectedRoutes = ['/add-problem', '/my-submissions', '/assessments', '/assessment-attempt', '/admin'];
                    if (protectedRoutes.some(path => window.location.pathname.startsWith(path))) {
                        navigate('/login');
                    }
                }
                
                setUser(newUser);
            } catch {
                setUser(null);
            }
        };

        const handleStorage = (e) => {
            if (e.key === 'user' || e.key === 'token' || e.key === null) {
                syncAuth();
            }
        };

        window.addEventListener('auth-change', syncAuth);
        window.addEventListener('storage', handleStorage);

        return () => {
            window.removeEventListener('auth-change', syncAuth);
            window.removeEventListener('storage', handleStorage);
        };
    }, [user, navigate]);

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setAuthToken(null);
        setUser(null);
        window.dispatchEvent(new Event('auth-change'));
        navigate('/login');
    };

    const canCreateProblem = user && (user.role === 'admin' || user.role === 'faculty' || user.role === 'superadmin');

    const NavLink = ({ to, children, icon: Icon }) => {
        const isActive = location.pathname === to;
        return (
            <Link to={to} className={isActive ? 'active' : ''} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {Icon && <Icon size={18} />}
                <span>{children}</span>
            </Link>
        );
    };

    const isAssessmentRoute = location.pathname.includes('/assessment-attempt/') && !location.pathname.includes('/result');

    useEffect(() => {
        // Global handler to prevent scrolling over number inputs from changing their values
        const handleWheel = () => {
            if (document.activeElement.type === 'number') {
                document.activeElement.blur();
            }
        };
        window.addEventListener('wheel', handleWheel);
        return () => window.removeEventListener('wheel', handleWheel);
    }, []);

    const RequireAuth = ({ children }) => user ? children : <Navigate to="/login" replace />;
    const RequireRole = ({ roles, children }) => user && roles.includes(user.role)
        ? children
        : <Navigate to={user ? "/" : "/login"} replace />;
    const RequireStudent = ({ children }) => <RequireRole roles={['student']}>{children}</RequireRole>;
    const RequireStaff = ({ children }) => <RequireRole roles={['admin', 'faculty', 'superadmin']}>{children}</RequireRole>;

    return (
        <>
            {banner && (
                <div className={`system-incident-banner banner-${banner.type}`} style={{
                    backgroundColor: banner.type === 'error' ? 'var(--error)' : banner.type === 'warning' ? 'var(--warning)' : 'var(--primary)',
                    color: '#fff',
                    padding: '10px 20px',
                    textAlign: 'center',
                    fontWeight: 'bold',
                    fontSize: '0.95rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '10px',
                    zIndex: 9999,
                    position: 'relative',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    borderBottom: '1px solid rgba(255,255,255,0.1)'
                }}>
                    <AlertTriangle size={18} />
                    <span>{banner.message}</span>
                </div>
            )}
            <div className="header">
                <h1>
                    <Code2 size={28} />
                    <span>Placement Assessment</span>
                </h1>
                {!isAssessmentRoute && (
                <nav>
                    <div className="nav-links">
                        <NavLink to="/" icon={BookOpen}>Problems</NavLink>
                        {user && <NavLink to="/assessments" icon={LayoutDashboard}>Assessments</NavLink>}
                        {canCreateProblem && (
                            <NavLink to="/admin/assessments" icon={Settings}>Manage</NavLink>
                        )}
                        {canCreateProblem && (
                            <NavLink to="/admin/users" icon={Users}>Users</NavLink>
                        )}
                        {canCreateProblem && (
                            <NavLink to="/admin/system" icon={Database}>System</NavLink>
                        )}
                        {canCreateProblem && (
                            <NavLink to="/add-problem" icon={PlusCircle}>Add Problem</NavLink>
                        )}
                        {!user && (
                            <NavLink to="/login" icon={LogIn}>Login</NavLink>
                        )}
                        {user && (
                            <NavLink to="/my-submissions" icon={Code2}>My Submissions</NavLink>
                        )}
                    </div>
                    {user && (
                        <button className="button button-outline logout-btn" onClick={handleLogout} style={{ padding: '6px 12px', fontSize: '0.85rem' }}>
                            <LogOut size={16} />
                            <span>Logout</span>
                        </button>
                    )}
                </nav>
                )}
            </div>
            <Routes>
                <Route path="/" element={<ProblemListPage user={user} />} />
                <Route path="/assessments" element={user ? <AssessmentListPage user={user} /> : <Navigate to="/login" replace />} />
                <Route path="/questions" element={user ? <QuestionBankPage user={user} /> : <Navigate to="/login" replace />} />
                <Route path="/questions/add" element={user ? <AddQuestionPage user={user} /> : <Navigate to="/login" replace />} />
                <Route path="/questions/:id/edit" element={user ? <EditQuestionPage user={user} /> : <Navigate to="/login" replace />} />
                <Route path="/assessments/:id" element={<RequireAuth><AssessmentDetailsPage user={user} /></RequireAuth>} />
                <Route path="/assessment-attempt/:attemptId" element={<RequireStudent><AssessmentWorkspace user={user} /></RequireStudent>} />
                <Route path="/assessment-attempt/:attemptId/result" element={<RequireStudent><AssessmentResultPage user={user} /></RequireStudent>} />
                
                {/* Admin/Faculty Routes */}
                <Route path="/admin/assessments" element={<RequireStaff><AssessmentManagementPage /></RequireStaff>} />
                <Route path="/admin/assessments/add" element={<RequireStaff><AddAssessmentPage /></RequireStaff>} />
                <Route path="/admin/assessments/:id/edit" element={<RequireStaff><EditAssessmentPage /></RequireStaff>} />
                <Route path="/admin/assessments/:id/preview" element={<RequireStaff><AssessmentPreviewPage /></RequireStaff>} />
                <Route path="/admin/assessments/:id/results" element={<RequireStaff><AssessmentResultsPage /></RequireStaff>} />
                <Route path="/admin/assessment-attempt/:attemptId" element={<RequireStaff><AssessmentAttemptDetailPage /></RequireStaff>} />
                <Route path="/admin/system" element={<RequireStaff><SystemDashboardPage /></RequireStaff>} />
                <Route path="/admin/users" element={<RequireStaff><UserManagementPage /></RequireStaff>} />

                <Route path="/problems/:_id" element={<ProblemPage user={user} />} />
                <Route path="/add-problem" element={<RequireStaff><AddProblemPage /></RequireStaff>} />
                <Route path="/problems/:_id/edit" element={<RequireStaff><EditProblemPage /></RequireStaff>} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/my-submissions" element={<RequireAuth><MySubmissionsPage /></RequireAuth>} />
            </Routes>
        </>
    );
}

function App() {
    return (
        <Router>
            <AppContent />
        </Router>
    );
}

export default App;
