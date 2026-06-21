import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Download, Users, CheckCircle, Clock, AlertCircle, Search, RefreshCw, BarChart3, ChevronRight, FileSpreadsheet, MonitorOff, Copy, ClipboardPaste, Maximize, AlertTriangle, Trophy, Megaphone } from 'lucide-react';
import * as XLSX from 'xlsx';
import api, { assessments } from '../api';

const AssessmentResultsPage = () => {
  const { id } = useParams();
  const [assessment, setAssessment] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [announcementText, setAnnouncementText] = useState('');

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    
    try {
      const [assessmentRes, attendanceRes] = await Promise.all([
        assessments.get(id),
        assessments.getAttendance(id)
      ]);
      setAssessment(assessmentRes.data);
      setAttendance(attendanceRes.data);
    } catch (err) {
      setError(err.response?.data?.msg || 'Failed to fetch results');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  const handleSendAnnouncement = async () => {
    if (!announcementText.trim()) return;
    try {
      await api.post(`/api/v1/assessments/${id}/announcements`, { message: announcementText });
      setAnnouncementText('');
      fetchData(true);
    } catch (err) {
      alert(err.response?.data?.msg || 'Failed to send announcement');
    }
  };

  const handleRejudgeAssessment = async () => {
    if (!window.confirm("Are you sure you want to rejudge all submissions for this entire assessment? This will reset all student scores and queue them for evaluation. This action is irreversible.")) {
      return;
    }
    try {
      setRefreshing(true);
      await api.post(`/api/v1/admin/rejudge/assessment/${id}`);
      alert("Rejudging scheduled successfully for all submissions. Dashboard stats will refresh dynamically as tests complete.");
      fetchData(true);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to trigger rejudge");
    } finally {
      setRefreshing(false);
    }
  };

  const handleRejudgeProblem = async (problemId, problemTitle) => {
    if (!window.confirm(`Are you sure you want to rejudge all submissions for "${problemTitle}" in this assessment?`)) {
      return;
    }
    try {
      setRefreshing(true);
      await api.post(`/api/v1/admin/rejudge/problem/${problemId}?assessmentId=${id}`);
      alert(`Rejudging scheduled successfully for challenge: ${problemTitle}.`);
      fetchData(true);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to trigger rejudge");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const calculateRiskLevel = (a) => {
    let score = 0;
    if (a.tabSwitchCount > 5) score += 2;
    if (a.tabSwitchCount > 15) score += 3;
    if (a.copyCount > 10) score += 1;
    if (a.pasteCount > 5) score += 2;
    if (a.fullscreenExitCount > 0) score += 3;

    if (score >= 5) return 'High';
    if (score >= 2) return 'Medium';
    return 'Low';
  };

  const exportToExcel = () => {
    const data = attendance.map(a => {
      const timeUsed = a.submittedAt && a.startedAt
        ? Math.floor((new Date(a.submittedAt) - new Date(a.startedAt)) / 60000)
        : 'N/A';
      return {
        'Student Name': a.name,
        'Email': a.email,
        'Status': a.status,
        'Score': a.score,
        'Risk Level': calculateRiskLevel(a),
        'Tab Switches': a.tabSwitchCount || 0,
        'Copy Events': a.copyCount || 0,
        'Paste Events': a.pasteCount || 0,
        'Fullscreen Exits': a.fullscreenExitCount || 0,
        'Started At': a.startedAt ? new Date(a.startedAt).toLocaleString() : 'N/A',
        'Submitted At': a.submittedAt ? new Date(a.submittedAt).toLocaleString() : 'N/A',
        'Time Used (min)': timeUsed
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Assessment Results");
    
    // Auto-size columns
    const maxWidths = Object.keys(data[0] || {}).map(key => ({
      wch: Math.max(key.length, ...data.map(obj => String(obj[key]).length)) + 2
    }));
    ws['!cols'] = maxWidths;

    XLSX.writeFile(wb, `${assessment.title.replace(/\s+/g, '_')}_Results.xlsx`);
  };

  if (loading && !assessment) return <div className="container">Loading results dashboard...</div>;
  if (error) return <div className="container error-box">{error}</div>;

  const filteredAttendance = attendance.filter(a => {
    const name = a.name || '';
    const email = a.email || '';
    const matchesSearch = name.toLowerCase().includes(search.toLowerCase()) || email.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === '' || a.status === statusFilter;
    const matchesRisk = riskFilter === '' || calculateRiskLevel(a) === riskFilter;
    return matchesSearch && matchesStatus && matchesRisk;
  });

  const activeOrCompleted = attendance.filter(a => a.status !== 'Not Started');
  const completedAttempts = attendance.filter(a => a.status === 'Submitted' || a.status === 'TimedOut');
  
  const maxPossibleScore = assessment.problems?.reduce((acc, p) => acc + (p.maxScore || 100), 0) || 100;
  
  const stats = {
    total: attendance.length,
    started: activeOrCompleted.length,
    submitted: completedAttempts.length,
    avgScore: completedAttempts.length > 0
      ? (completedAttempts.reduce((acc, a) => acc + (a.score || 0), 0) / completedAttempts.length).toFixed(1)
      : 0,
    passRate: completedAttempts.length > 0
      ? ((completedAttempts.filter(a => (a.score || 0) >= (maxPossibleScore * 0.4)).length / completedAttempts.length) * 100).toFixed(0)
      : 0,
    highRisk: attendance.filter(a => calculateRiskLevel(a) === 'High').length
  };

  // Top Performers (Top 3)
  const topPerformers = [...attendance]
    .filter(a => a.status === 'Submitted' || a.status === 'TimedOut')
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 3);

  const getStatusTagClass = (status) => {
    switch (status) {
      case 'Submitted': return 'difficulty-easy';
      case 'Active': return 'difficulty-medium';
      case 'TimedOut': return 'difficulty-hard';
      case 'Not Started': return '';
      default: return '';
    }
  };

  const getRiskTagStyle = (risk) => {
    switch (risk) {
      case 'High': return { background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)', border: '1px solid rgba(239, 68, 68, 0.3)' };
      case 'Medium': return { background: 'rgba(245, 158, 11, 0.1)', color: 'var(--warning)', border: '1px solid rgba(245, 158, 11, 0.3)' };
      case 'Low': return { background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)', border: '1px solid rgba(16, 185, 129, 0.3)' };
      default: return {};
    }
  };

  return (
    <div className="container fade-in">
      <div className="flex-between mb-8">
        <div>
          <div className="flex-center gap-2 mb-2" style={{ justifyContent: 'flex-start' }}>
            <span className="tag" style={{ background: 'var(--primary-glow)', color: 'var(--primary)', fontWeight: '700' }}>
              {new Date() <= new Date(assessment.endTime) ? 'LIVE MONITORING' : 'FINAL RESULTS'}
            </span>
            <h1 style={{ margin: 0 }}>{assessment.title}</h1>
          </div>
          <p className="text-muted">Real-time attendance and performance tracking.</p>
        </div>
        <div className="flex-center gap-3">
          <button className="button button-outline" onClick={() => fetchData(true)} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
            Refresh
          </button>
          <button 
            className="button button-outline" 
            onClick={handleRejudgeAssessment} 
            disabled={refreshing}
            style={{ color: 'var(--warning)', borderColor: 'rgba(245, 158, 11, 0.4)' }}
          >
            <RefreshCw size={16} />
            Rejudge All
          </button>
          <button className="button button-primary" onClick={exportToExcel}>
            <FileSpreadsheet size={16} />
            Export to Excel
          </button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-4 gap-6 mb-8" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '24px' }}>
        <div className="problem-card" style={{ textAlign: 'center' }}>
          <div className="text-muted mb-2 flex-center gap-2" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: '700' }}>
            <Users size={14} /> Total Candidates
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '800' }}>{stats.total}</div>
        </div>
        <div className="problem-card" style={{ textAlign: 'center' }}>
          <div className="text-muted mb-2 flex-center gap-2" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: '700' }}>
            <Clock size={14} /> Participation
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--primary)' }}>
            {stats.started} <span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>/ {stats.total}</span>
          </div>
        </div>
        <div className="problem-card" style={{ textAlign: 'center' }}>
          <div className="text-muted mb-2 flex-center gap-2" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: '700' }}>
            <CheckCircle size={14} /> Submissions
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--success)' }}>{stats.submitted}</div>
        </div>
        <div className="problem-card" style={{ textAlign: 'center' }}>
          <div className="text-muted mb-2 flex-center gap-2" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: '700' }}>
            <BarChart3 size={14} /> Avg. Score
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '800' }}>{stats.avgScore} <span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>/ {maxPossibleScore}</span></div>
        </div>
      </div>

      {/* Insights Section */}
      <div className="grid grid-cols-3 gap-6 mb-8" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: '24px' }}>
        <div className="problem-card" style={{ borderLeft: '4px solid var(--warning)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="flex-between mb-4">
              <h3 className="flex-center gap-2" style={{ margin: 0 }}><AlertTriangle size={18} color="var(--warning)" /> Integrity Insights</h3>
              <span className="tag" style={getRiskTagStyle('High')}>{stats.highRisk} High Risk</span>
            </div>
            <p className="text-secondary mb-4" style={{ fontSize: '0.9rem' }}>
              {stats.highRisk > 0 
                ? `${stats.highRisk} student(s) flagged for highly suspicious activity. We recommend reviewing their detailed attempts.`
                : 'No students flagged for high-risk behavior. Academic integrity appears strong.'}
            </p>
          </div>
          <button 
            className="button button-outline" 
            style={{ padding: '6px 12px', fontSize: '0.85rem', width: 'fit-content' }}
            onClick={() => setRiskFilter('High')}
          >
            Filter High Risk
          </button>
        </div>

        <div className="problem-card" style={{ borderLeft: '4px solid var(--primary)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="flex-between mb-4">
              <h3 className="flex-center gap-2" style={{ margin: 0 }}><Trophy size={18} color="var(--primary)" /> Performance Insights</h3>
              <span className="tag difficulty-easy">{stats.passRate}% Pass Rate</span>
            </div>
            <p className="text-secondary mb-3" style={{ fontSize: '0.9rem' }}>
              Top Performers:
            </p>
            {topPerformers.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {topPerformers.map((p, idx) => (
                  <div key={p.studentId} className="flex-between" style={{ background: 'var(--bg)', padding: '8px 12px', borderRadius: 'var(--radius-sm)' }}>
                    <div className="flex-center gap-2">
                      <span style={{ color: 'var(--text-muted)', fontWeight: '600' }}>#{idx + 1}</span>
                      <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>{p.name}</span>
                    </div>
                    <span style={{ fontWeight: '700', color: 'var(--primary)' }}>{p.score} pts</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted" style={{ fontSize: '0.9rem' }}>No submissions yet.</p>
            )}
          </div>
        </div>

        <div className="problem-card" style={{ borderLeft: '4px solid var(--success)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="flex-between mb-4">
              <h3 className="flex-center gap-2" style={{ margin: 0 }}>
                <Megaphone size={18} color="var(--success)" /> Live Announcements
              </h3>
              <span className="tag" style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)' }}>
                {assessment.announcements?.length || 0} Sent
              </span>
            </div>
            
            <div style={{
              overflowY: 'auto',
              maxHeight: '140px',
              height: '140px',
              marginBottom: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px',
              background: 'var(--bg)'
            }}>
              {assessment.announcements && assessment.announcements.length > 0 ? (
                [...assessment.announcements].reverse().map((announce, idx) => (
                  <div key={idx} style={{ fontSize: '0.85rem', borderBottom: idx < assessment.announcements.length - 1 ? '1px solid var(--border)' : 'none', paddingBottom: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '2px' }}>
                      <span style={{ fontWeight: '700' }}>Broadcast</span>
                      <span>{new Date(announce.sentAt).toLocaleTimeString()}</span>
                    </div>
                    <div style={{ color: 'var(--text)', fontWeight: '500' }}>{announce.message}</div>
                  </div>
                ))
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  No announcements sent yet.
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <input 
              type="text" 
              placeholder="Send announcement..." 
              value={announcementText}
              onChange={(e) => setAnnouncementText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSendAnnouncement(); }}
              style={{ flex: 1, padding: '8px 12px', fontSize: '0.85rem', background: 'var(--bg)' }}
            />
            <button 
              className="button button-primary" 
              style={{ padding: '8px 16px', fontSize: '0.85rem' }}
              onClick={handleSendAnnouncement}
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Problems & Administrative Actions */}
      <div className="problem-card mb-8">
        <h3 className="mb-4">Assessment Challenges & Rejudge Control</h3>
        <p className="text-secondary mb-6" style={{ fontSize: '0.9rem' }}>
          Rejudge submissions if verification logic, correct answers, or templates were updated during the assessment window.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
          {assessment.problems?.map((p) => {
            const probId = p.problemId?._id || p.problemId;
            const probTitle = p.problemId?.title || 'Unknown Challenge';
            return (
              <div key={probId} className="flex-between" style={{ background: 'var(--bg)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <div>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '0.95rem', fontWeight: '700' }}>{probTitle}</h4>
                  <span className="text-muted" style={{ fontSize: '0.8rem' }}>Max Score: {p.maxScore || 100} pts</span>
                </div>
                <button
                  className="button button-outline"
                  onClick={() => handleRejudgeProblem(probId, probTitle)}
                  style={{ padding: '6px 12px', fontSize: '0.8rem', color: 'var(--warning)', borderColor: 'rgba(245, 158, 11, 0.3)' }}
                >
                  <RefreshCw size={14} style={{ marginRight: '4px' }} /> Rejudge Problem
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Attendance Table */}
      <div className="problem-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: '20px', alignItems: 'center', background: 'var(--surface-hover)' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Search students..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: '40px', background: 'var(--bg)' }}
            />
          </div>
          <select 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ width: '200px', background: 'var(--bg)' }}
          >
            <option value="">All Statuses</option>
            <option value="Not Started">Not Started</option>
            <option value="Active">Active</option>
            <option value="Submitted">Submitted</option>
            <option value="TimedOut">Timed Out</option>
          </select>
          <select 
            value={riskFilter} 
            onChange={(e) => setRiskFilter(e.target.value)}
            style={{ width: '150px', background: 'var(--bg)' }}
          >
            <option value="">All Risks</option>
            <option value="High">High Risk</option>
            <option value="Medium">Medium Risk</option>
            <option value="Low">Low Risk</option>
          </select>
        </div>

        <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Status</th>
                <th>Score</th>
                <th>Risk Level</th>
                <th>Security Metrics</th>
                <th>Timeline</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAttendance.map((a) => (
                <tr key={a.studentId}>
                  <td>
                    <div style={{ fontWeight: '600' }}>{a.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{a.email}</div>
                  </td>
                  <td>
                    <span className={`tag ${getStatusTagClass(a.status)}`} style={{ fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: '700' }}>
                      {a.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: a.score > 0 ? 'var(--text)' : 'var(--text-muted)' }}>
                      {a.score}
                    </div>
                  </td>
                  <td>
                    <span className="tag" style={{ ...getRiskTagStyle(calculateRiskLevel(a)), fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: '700' }}>
                      {calculateRiskLevel(a)}
                    </span>
                  </td>
                  <td>
                    <div className="flex-center gap-3" style={{ justifyContent: 'flex-start' }}>
                      <div className="flex-center gap-1" title="Tab Switches" style={{ color: a.tabSwitchCount > 5 ? 'var(--error)' : 'inherit' }}>
                        <MonitorOff size={14} /> <span style={{ fontSize: '0.85rem' }}>{a.tabSwitchCount}</span>
                      </div>
                      <div className="flex-center gap-1" title="Copies" style={{ color: a.copyCount > 10 ? 'var(--warning)' : 'inherit' }}>
                        <Copy size={14} /> <span style={{ fontSize: '0.85rem' }}>{a.copyCount}</span>
                      </div>
                      <div className="flex-center gap-1" title="Pastes" style={{ color: a.pasteCount > 5 ? 'var(--error)' : 'inherit' }}>
                        <ClipboardPaste size={14} /> <span style={{ fontSize: '0.85rem' }}>{a.pasteCount}</span>
                      </div>
                      <div className="flex-center gap-1" title="Fullscreen Exits" style={{ color: a.fullscreenExitCount > 0 ? 'var(--error)' : 'inherit' }}>
                        <Maximize size={14} /> <span style={{ fontSize: '0.85rem' }}>{a.fullscreenExitCount}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {a.startedAt ? (
                        <div className="flex-center gap-2" style={{ justifyContent: 'flex-start' }}>
                          <Clock size={12} /> {new Date(a.startedAt).toLocaleTimeString()} 
                          {a.submittedAt && (
                            <>
                              <ChevronRight size={12} /> 
                              {new Date(a.submittedAt).toLocaleTimeString()}
                            </>
                          )}
                        </div>
                      ) : '—'}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {a.attemptId ? (
                      <Link to={`/admin/assessment-attempt/${a.attemptId}`} className="button button-outline" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                        View Detailed Results
                      </Link>
                    ) : (
                      <span className="text-muted" style={{ fontSize: '0.8rem' }}>No attempt yet</span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredAttendance.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
                    No students match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AssessmentResultsPage;
