import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CreditCard, AlertCircle, CheckCircle2, Lock } from 'lucide-react';
import { billing } from '../api';

const KNOWN_PLAN_IDS = ['free', 'pro'];

const BillingPage = ({ user }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [notice, setNotice] = useState(null);

  const isSuperadmin = user?.role === 'superadmin';
  const [colleges, setColleges] = useState([]);
  const [collegesLoading, setCollegesLoading] = useState(false);
  const [collegesError, setCollegesError] = useState(null);
  const [planEdits, setPlanEdits] = useState({});
  const [savingCollegeId, setSavingCollegeId] = useState(null);

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await billing.getStatus();
      setStatus(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load billing status.');
    } finally {
      setLoading(false);
    }
  };

  const fetchColleges = async () => {
    setCollegesLoading(true);
    setCollegesError(null);
    try {
      const res = await billing.listColleges();
      setColleges(res.data);
    } catch (err) {
      setCollegesError(err.response?.data?.message || 'Failed to load colleges.');
    } finally {
      setCollegesLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    if (isSuperadmin) fetchColleges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSetPlan = async (collegeId) => {
    const planId = planEdits[collegeId];
    if (!planId) return;
    setSavingCollegeId(collegeId);
    setCollegesError(null);
    try {
      await billing.setCollegePlan(collegeId, { planId });
      await fetchColleges();
    } catch (err) {
      setCollegesError(err.response?.data?.message || 'Failed to update plan.');
    } finally {
      setSavingCollegeId(null);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const result = params.get('billing');
    if (result === 'success') {
      setNotice({ type: 'success', message: 'Subscription updated — thanks!' });
      fetchStatus();
    } else if (result === 'cancel') {
      setNotice({ type: 'info', message: 'Checkout was canceled — no changes were made.' });
    }
    if (result) {
      navigate('/admin/billing', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const handleUpgrade = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await billing.createCheckout('pro');
      window.location.href = res.data.url;
    } catch (err) {
      setError(err.response?.data?.message || 'Could not start checkout.');
      setActionLoading(false);
    }
  };

  const handleManage = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await billing.createPortal();
      window.location.href = res.data.url;
    } catch (err) {
      setError(err.response?.data?.message || 'Could not open the billing portal.');
      setActionLoading(false);
    }
  };

  if (loading) return <div className="container">Loading billing status...</div>;

  return (
    <div className="container fade-in">
      <h2 className="flex-center gap-2" style={{ justifyContent: 'flex-start', marginBottom: '8px' }}>
        <CreditCard size={26} />
        Billing & Plan
      </h2>
      <p className="text-muted mb-6">Manage your college's subscription and see current usage against your plan.</p>

      {notice && (
        <div
          className="mb-6"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.9rem',
            fontWeight: 500,
            backgroundColor: notice.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(99, 102, 241, 0.1)',
            border: `1px solid ${notice.type === 'success' ? 'var(--success)' : 'var(--primary)'}`,
            color: notice.type === 'success' ? 'var(--success)' : 'var(--primary)'
          }}
        >
          <CheckCircle2 size={18} />
          <span>{notice.message}</span>
        </div>
      )}

      {error && (
        <div className="error-box mb-6 flex-center gap-2" style={{ justifyContent: 'flex-start' }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {status && (
        <>
          <div className="problem-card mb-6" style={{ padding: '24px' }}>
            <h3 style={{ marginBottom: '4px' }}>{status.label} Plan</h3>
            <p className="text-muted" style={{ marginBottom: '16px' }}>
              Subscription status: <strong>{status.subscriptionStatus}</strong>
              {status.currentPeriodEnd && (
                <> · renews {new Date(status.currentPeriodEnd).toLocaleDateString()}</>
              )}
            </p>

            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <div className="stat-card">
                <span className="label">Seats used</span>
                <span className="value">
                  {status.seatsUsed} / {Number.isFinite(status.seatLimit) ? status.seatLimit : '∞'}
                </span>
              </div>
              <div className="stat-card">
                <span className="label">Submissions this month</span>
                <span className="value">
                  {status.submissionsThisMonth} / {Number.isFinite(status.submissionQuotaPerMonth) ? status.submissionQuotaPerMonth : '∞'}
                </span>
              </div>
              <div className="stat-card">
                <span className="label">Premium problems</span>
                <span className="value flex-center gap-2" style={{ justifyContent: 'flex-start' }}>
                  {status.allowsPremiumProblems ? 'Unlocked' : (
                    <>
                      <Lock size={14} /> Locked
                    </>
                  )}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            {status.planId === 'free' ? (
              <button className="button" onClick={handleUpgrade} disabled={actionLoading}>
                {actionLoading ? 'Redirecting...' : 'Upgrade to Pro'}
              </button>
            ) : (
              <button className="button button-outline" onClick={handleManage} disabled={actionLoading}>
                {actionLoading ? 'Redirecting...' : 'Manage Billing'}
              </button>
            )}
          </div>
        </>
      )}

      {isSuperadmin && (
        <div className="problem-card mt-8" style={{ padding: '24px' }}>
          <h3 style={{ marginBottom: '4px' }}>Manual Plan Assignment</h3>
          <p className="text-muted" style={{ marginBottom: '16px' }}>
            Payments are currently collected offline (cash/UPI). Set a college's plan here once you've confirmed payment.
          </p>

          {collegesError && (
            <div className="error-box mb-6 flex-center gap-2" style={{ justifyContent: 'flex-start' }}>
              <AlertCircle size={18} />
              <span>{collegesError}</span>
            </div>
          )}

          {collegesLoading ? (
            <p className="text-muted">Loading colleges...</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>College</th>
                    <th>Plan</th>
                    <th>Status</th>
                    <th>Seats used</th>
                    <th>Set plan</th>
                  </tr>
                </thead>
                <tbody>
                  {colleges.map((college) => (
                    <tr key={college._id}>
                      <td>{college.name}</td>
                      <td>{college.planId}</td>
                      <td>{college.subscriptionStatus}</td>
                      <td>{college.seatsUsed}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <select
                            value={planEdits[college._id] ?? college.planId}
                            onChange={(e) => setPlanEdits((prev) => ({ ...prev, [college._id]: e.target.value }))}
                          >
                            {KNOWN_PLAN_IDS.map((planId) => (
                              <option key={planId} value={planId}>{planId}</option>
                            ))}
                          </select>
                          <button
                            className="button button-outline"
                            disabled={savingCollegeId === college._id}
                            onClick={() => handleSetPlan(college._id)}
                          >
                            {savingCollegeId === college._id ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BillingPage;
