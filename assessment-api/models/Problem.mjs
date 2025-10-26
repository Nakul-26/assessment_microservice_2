
import mongoose from 'mongoose';
const { Schema } = mongoose;

const InputParameterSchema = new Schema({
    name: { type: String, required: true },
    type: { type: String, required: true }
}, { _id: false });

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
            id: {
                type: Number,
                required: true
            },
            type: {
                type: String,
                required: true
            },
            input: {
                type: Schema.Types.Mixed,
                required: true
            },
            expectedOutput: {
                type: Schema.Types.Mixed,
                required: true
            },
            meta: {
                types: [String],
                returns: String
            },
            isHidden: {
                type: Boolean,
                default: false
            }
        }
    ],
    functionSignatures: {
        type: Map,
        of: String,
        required: true
    },
    functionName: {
        type: Map,
        of: String,
        required: true
    },
    functionSignature: {
        language: { type: String },
        template: { type: String }
    },
    expectedIoType: {
        inputParameters: [InputParameterSchema],
        outputType: { type: String }
    },

});

export default mongoose.model('Problem', ProblemSchema);
