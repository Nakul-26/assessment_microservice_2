
import mongoose from 'mongoose';
import { isValidType } from '../src/utils/typeValidator.mjs';

const { Schema } = mongoose;

const ParameterSchema = new Schema({
  name: { type: String, required: true },
  type: { 
    type: String, 
    required: true,
    validate: {
      validator: isValidType,
      message: props => `${props.value} is not a valid platform type!`
    }
  }
}, { _id: false });

const CompareConfigSchema = new Schema({
  mode: { type: String, enum: ['EXACT', 'STRUCTURAL'], default: 'EXACT' },
  floatTolerance: { type: Number, default: 0 },
  orderInsensitive: { type: Boolean, default: false },
  requireDeepCopy: { type: Boolean, default: false }
}, { _id: false });

// ProblemType mirrors judge-service-go/pkg/models/problem_type.go: 'function' is the
// existing named-function model, 'stdin' is a full stdin/stdout program (the shape
// Arventiq's problems actually use — see docs/arventiq-integration/PLAN.md §2).
const isFunctionProblem = function () {
  return (this.problemType || 'function') !== 'stdin';
};

const ProblemSchema = new Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], required: true },
  problemType: { type: String, enum: ['function', 'stdin'], default: 'function' },
  // externalId maps a synced problem back to its source system's own identifier
  // (e.g. Arventiq's numeric question id) so Problem Sync can upsert by it.
  externalId: { type: String, unique: true, sparse: true },
  // Descriptive only, used by stdin problems (Arventiq's input_format/output_format).
  inputFormat: { type: String },
  outputFormat: { type: String },
  functionName: { type: String, required: isFunctionProblem },
  parameters: { type: [ParameterSchema], default: [] },
  returnType: {
    type: String,
    required: isFunctionProblem,
    validate: {
      validator: isValidType,
      message: props => `${props.value} is not a valid platform type!`
    }
  },
  timeLimitMs: { type: Number, default: 2000 },
  memoryLimitMb: { type: Number, default: 256 },
  compareConfig: { type: CompareConfigSchema, default: () => ({}) },

  testCases: [{
    inputs: { type: [Schema.Types.Mixed], required: true },
    expected: { type: Schema.Types.Mixed, required: true },
    isSample: { type: Boolean, default: false },
    isHidden: { type: Boolean, default: false }
  }],

  testsJSON: { type: String },

  tags: [String],
  isPremium: { type: Boolean, default: false },

  submissionCount: { type: Number, default: 0 },
  acceptedCount: { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Problem', ProblemSchema);
