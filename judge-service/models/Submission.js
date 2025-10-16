
import mongoose from 'mongoose';
const { Schema } = mongoose;

const SubmissionSchema = new Schema({
    problem: {
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
        enum: ['Pending', 'Running', 'Success', 'Fail'],
        default: 'Pending'
    },
    output: {
        type: String
    }
});

export default mongoose.model('Submission', SubmissionSchema);
