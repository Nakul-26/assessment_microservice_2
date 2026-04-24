import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import fs from 'fs';
import path from 'path';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

function toReadablePath(instancePath = '') {
  if (!instancePath) return 'root';

  return instancePath
    .split('/')
    .filter(Boolean)
    .map((segment) => (/^\d+$/.test(segment) ? `[${segment}]` : segment))
    .reduce((path, segment) => {
      if (!path) return segment;
      return segment.startsWith('[') ? `${path}${segment}` : `${path}.${segment}`;
    }, '');
}

function formatAjvErrors(errors = []) {
  return errors.map((err) => {
    const path = toReadablePath(err.instancePath);

    if (err.keyword === 'required') {
      return `${path}: missing required field '${err.params.missingProperty}'`;
    }

    if (err.keyword === 'minItems') {
      return `${path}: must contain at least ${err.params.limit} item(s)`;
    }

    if (err.keyword === 'pattern') {
      return `${path}: invalid format`;
    }

    if (err.keyword === 'type') {
      const article = /^[aeiou]/i.test(err.params.type) ? 'an' : 'a';
      return `${path}: must be ${article} ${err.params.type}`;
    }

    return `${path}: ${err.message}`;
  });
}

function loadSchema(schemaName) {
  const schemaPath = path.resolve(`../contracts/${schemaName}.schema.json`);
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  return schema;
}

export function validate(schemaName) {
  const schema = loadSchema(schemaName);
  const compiledSchema = ajv.compile(schema);

  return (req, res, next) => {
    if (!compiledSchema(req.body)) {
      const errors = formatAjvErrors(compiledSchema.errors);
      return res.status(400).json({
        error: errors.join(', '),
        errors
      });
    }
    next();
  };
}
