import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import fs from 'fs';
import path from 'path';

const ajv = new Ajv();
addFormats(ajv);

function loadSchema(schemaName) {
  const schemaPath = path.resolve(`../contracts/${schemaName}.schema.json`);
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  return schema;
}

export function validate(schemaName) {
  const schema = loadSchema(schemaName);
  const compiledSchema = ajv.compile(schema);

  return (req, res, next) => {
    if (req.body.expectedIoType && req.body.expectedIoType.inputParameters) {
      req.body.expectedIoType.inputParameters = req.body.expectedIoType.inputParameters.filter(p => p.name.trim() !== '');
    }
    if (!compiledSchema(req.body)) {
      return res.status(400).json({ errors: compiledSchema.errors });
    }
    next();
  };
}
