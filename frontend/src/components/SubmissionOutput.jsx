import React from 'react';

const verdictClassMap = {
    Accepted: 'accepted',
    'Wrong Answer': 'wrong-answer',
    'Runtime Error': 'runtime-error',
    'Time Limit Exceeded': 'time-limit-exceeded'
};

function parseOutput(output) {
    if (typeof output !== 'string') {
        return output;
    }

    try {
        return JSON.parse(output);
    } catch {
        return null;
    }
}

function formatValue(value) {
    if (value === undefined) return null;
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

function normalizeDetail(detail = {}, index) {
    const passed = detail.passed ?? detail.ok ?? false;
    const testNumber = detail.test ?? detail.testIndex ?? index + 1;
    return {
        ...detail,
        passed,
        testNumber,
        timeMs: detail.timeMs ?? detail.elapsedMs ?? detail.durationMs ?? null,
        errorLabel: detail.errorType || detail.error || null
    };
}

const SubmissionOutput = ({ output }) => {
    const parsed = parseOutput(output);

    if (!parsed) {
        return <pre>{output}</pre>;
    }

    if (!(parsed && typeof parsed === 'object' && parsed.status && Array.isArray(parsed.details))) {
        return <pre>{JSON.stringify(parsed, null, 2)}</pre>;
    }

    const passedCount = parsed.passedCount ?? parsed.passed ?? 0;
    const totalCount = parsed.totalCount ?? parsed.total ?? parsed.details.length;
    const elapsedMs = parsed.elapsedMs ?? parsed.totalTimeMs ?? null;
    const normalizedDetails = parsed.details.map(normalizeDetail);
    const firstFailedTest = parsed.firstFailedTest && parsed.firstFailedTest > 0
        ? parsed.firstFailedTest
        : normalizedDetails.find((detail) => !detail.passed)?.testNumber ?? null;
    const verdictClass = verdictClassMap[parsed.status] || 'neutral';

    return (
        <div className="submission-output">
            <div className={`result-box ${verdictClass}`}>
                <div className="result-box__label">Verdict</div>
                <h3>{parsed.status}</h3>
            </div>

            <div className="result-summary">
                <div className="result-summary__item">
                    <span className="result-summary__label">Passed</span>
                    <strong>{passedCount} / {totalCount}</strong>
                </div>
                <div className="result-summary__item">
                    <span className="result-summary__label">Total Time</span>
                    <strong>{elapsedMs !== null ? `${elapsedMs} ms` : 'N/A'}</strong>
                </div>
                <div className="result-summary__item">
                    <span className="result-summary__label">First Failed Test</span>
                    <strong>{firstFailedTest ? `#${firstFailedTest}` : 'None'}</strong>
                </div>
            </div>

            <details className="result-details" open={normalizedDetails.some((detail) => !detail.passed)}>
                <summary>Per-test details</summary>
                <div className="result-details__list">
                    {normalizedDetails.map((detail) => (
                        <div key={detail.testNumber} className={`test-case ${detail.passed ? 'passed' : 'failed'}`}>
                            <div className="test-case__header">
                                <strong>Test {detail.testNumber}</strong>
                                <span>{detail.passed ? 'Passed' : 'Failed'}</span>
                                <span>{detail.timeMs !== null ? `${detail.timeMs} ms` : 'n/a'}</span>
                            </div>
                            {!detail.passed && detail.errorLabel && (
                                <div className="error-type">{detail.errorLabel}</div>
                            )}
                            {detail.output !== undefined && (
                                <p><strong>Output:</strong> <code>{formatValue(detail.output)}</code></p>
                            )}
                            {detail.expected !== undefined && (
                                <p><strong>Expected:</strong> <code>{formatValue(detail.expected)}</code></p>
                            )}
                            {detail.stderr !== undefined && (
                                <p><strong>Stderr:</strong> <code>{formatValue(detail.stderr)}</code></p>
                            )}
                        </div>
                    ))}
                </div>
            </details>
        </div>
    );
};

export default SubmissionOutput;
