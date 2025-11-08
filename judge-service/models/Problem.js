
import mongoose from 'mongoose';
const { Schema } = mongoose;

const InputParameterSchema = new Schema({
  name: { type: String, required: true },
  type: { type: String, required: true }
});

const ProblemSchema = new Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], required: true },

  testCases: [{
    input: { type: [Schema.Types.Mixed], required: true },
    expectedOutput: { type: Schema.Types.Mixed, required: true },
    isHidden: { type: Boolean, default: false }
  }],

  functionDefinitions: {
    type: Map,
    of: new Schema({
      name: { type: String, required: true },
      template: { type: String, required: true }
    }),
    required: true
  },

  expectedIoType: {
    inputParameters: [InputParameterSchema],
    outputType: { type: String }
  },

  tags: [String],
  isPremium: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Problem', ProblemSchema);
