
import mongoose from 'mongoose';
const { Schema } = mongoose;

const ProblemSchema = new Schema({
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    difficulty: {
        type: String,
        enum: ['Easy', 'Medium', 'Hard'],
        required: true
    },
    testCases: [
        {
            input: {
                type: Schema.Types.Mixed,
                required: true
            },
            expectedOutput: {
                type: Schema.Types.Mixed,
                required: true
            }
        }
    ],
    functionSignatures: {
        type: Map,
        of: String,
        default: {}
    },

});

export default mongoose.model('Problem', ProblemSchema);
