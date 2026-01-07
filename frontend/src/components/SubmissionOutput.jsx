import React from 'react';

const SubmissionOutput = ({ output }) => {
    try {
        const parsed = JSON.parse(output);

        if (parsed && typeof parsed === 'object' && parsed.status && Array.isArray(parsed.details)) {
            return (
                <div className="submission-output">
                    <p><strong>Status:</strong> {parsed.status}</p>
                    <p><strong>Tests Passed:</strong> {parsed.passed} / {parsed.total}</p>
                    <hr />
                    {parsed.details.map(detail => (
                        <div key={detail.test} className={`test-case ${detail.ok ? 'passed' : 'failed'}`}>
                            <strong>Test {detail.test}: {detail.ok ? 'Passed' : 'Failed'}</strong>
                            {detail.output !== undefined && (
                                <p><strong>Output:</strong> <code>{JSON.stringify(detail.output)}</code></p>
                            )}
                            {detail.expected !== undefined && (
                                <p><strong>Expected:</strong> <code>{JSON.stringify(detail.expected)}</code></p>
                            )}
                            {detail.error !== undefined && (
                                <p><strong>Error:</strong> <code>{detail.error}</code></p>
                            )}
                        </div>
                    ))}
                </div>
            );
        }
        
        return <pre>{JSON.stringify(parsed, null, 2)}</pre>;

    } catch (e) {
        return <pre>{output}</pre>;
    }
};

export default SubmissionOutput;
