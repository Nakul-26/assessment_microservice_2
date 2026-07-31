
import mongoose from 'mongoose';
const { Schema } = mongoose;

const SubmissionSchema = new Schema({
    problemId: {
        type: Schema.Types.ObjectId,
        ref: 'Problem',
        required: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    assessmentId: {
        type: Schema.Types.ObjectId,
        ref: 'Assessment'
    },
    attemptId: {
        type: Schema.Types.ObjectId,
        ref: 'AssessmentAttempt'
    },
    collegeId: {
        type: Schema.Types.ObjectId,
        ref: 'College'
    },
    score: {
        type: Number,
        default: 0
    },
    code: {
        type: String,
        required: true
    },
    language: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['Pending', 'Running', 'Success', 'Fail', 'Error'],
        default: 'Pending'
    },
    output: {
        type: String
    },
    testResult: {
        type: Object // To store the structured result from the judge service
    },
    tests: {
        type: Array
    }
}, { timestamps: true });

// Optional: add an index for faster lookups by status
SubmissionSchema.index({ status: 1 });
SubmissionSchema.index({ userId: 1 });
SubmissionSchema.index({ assessmentId: 1 });
SubmissionSchema.index({ attemptId: 1 });
SubmissionSchema.index({ assessmentId: 1, userId: 1 });
SubmissionSchema.index({ collegeId: 1 });

export default mongoose.model('Submission', SubmissionSchema);
