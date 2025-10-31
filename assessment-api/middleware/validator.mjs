import Ajv from 'ajv';
import fs from 'fs';
import path from 'path';

const ajv = new Ajv();

function loadSchema(schemaName) {
  const schemaPath = path.resolve(`../contracts/${schemaName}.schema.json`);
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  return schema;
}

export function validate(schemaName) {
  const schema = loadSchema(schemaName);
  const validate = ajv.compile(schema);

  return (req, res, next) => {
    if (!validate(req.body)) {
      return res.status(400).json({ errors: validate.errors });
    }
    next();
  };
}
