
import mongoose from 'mongoose';
const { Schema } = mongoose;

const ParameterSchema = new Schema({
  name: { type: String, required: true },
  type: { type: String, required: true }
}, { _id: false });

const CompareConfigSchema = new Schema({
  mode: { type: String, enum: ['EXACT', 'STRUCTURAL'], default: 'EXACT' },
  floatTolerance: { type: Number, default: 0 },
  orderInsensitive: { type: Boolean, default: false }
}, { _id: false });

const ProblemSchema = new Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], required: true },
  functionName: { type: String, required: true },
  parameters: { type: [ParameterSchema], default: [] },
  returnType: { type: String, required: true },
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
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Problem', ProblemSchema);
