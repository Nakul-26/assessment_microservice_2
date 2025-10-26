
import mongoose from 'mongoose';
const { Schema } = mongoose;

const SubmissionSchema = new Schema({
    problemId: {
        type: Schema.Types.ObjectId,
        ref: 'Problem',
        required: true
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
    }
}, { timestamps: true });

// Optional: add an index for faster lookups by status
SubmissionSchema.index({ status: 1 });

// Add userId virtual if needed later
SubmissionSchema.add({ userId: { type: Schema.Types.ObjectId, ref: 'User', required: false } });

export default mongoose.model('Submission', SubmissionSchema);
