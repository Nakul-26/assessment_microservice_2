const TYPE_REGEX = /^([a-z]+)(?:<(.+)>)?$/;

const VALID_KINDS = new Set([
  "number",
  "string",
  "boolean",
  "array",
  "matrix",
  "tree",
  "linkedlist",
  "graph",
  "void"
]);

const GENERIC_KINDS = new Set([
  "array",
  "matrix",
  "tree",
  "linkedlist",
  "graph"
]);

/**
 * Validates a type string against the platform's type grammar.
 * @param {string} typeStr 
 * @returns {boolean}
 */
export function isValidType(typeStr) {
  if (!typeStr || typeof typeStr !== 'string') return false;
  const s = typeStr.trim();
  if (!s) return false;

  const match = s.match(TYPE_REGEX);
  if (!match) return false;

  const kind = match[1];
  const inner = match[2];

  if (!VALID_KINDS.has(kind)) return false;

  if (GENERIC_KINDS.has(kind)) {
    if (!inner) return false;
    return isValidType(inner);
  } else {
    if (inner) return false;
  }

  return true;
}

/**
 * Maps the canonical type system to language-specific types.
 */
export function mapType(language, typeStr) {
  if (!typeStr) return 'void';
  const match = typeStr.trim().match(TYPE_REGEX);
  if (!match) return language === 'cpp' ? 'auto' : 'Object';

  const kind = match[1];
  const inner = match[2];

  const cppMap = {
    number: 'int',
    string: 'string',
    boolean: 'bool',
    void: 'void',
    array: (t) => `vector<${mapType('cpp', t)}>`,
    matrix: (t) => `vector<vector<${mapType('cpp', t)}>>`,
    tree: () => 'TreeNode*',
    linkedlist: () => 'ListNode*',
    graph: () => 'Node*',
  };

  const javaMap = {
    number: 'int',
    string: 'String',
    boolean: 'boolean',
    void: 'void',
    array: (t) => `${mapType('java', t)}[]`,
    matrix: (t) => `${mapType('java', t)}[][]`,
    tree: () => 'TreeNode',
    linkedlist: () => 'ListNode',
    graph: () => 'Node',
  };

  const csharpMap = {
    number: 'int',
    string: 'string',
    boolean: 'bool',
    void: 'void',
    array: (t) => `${mapType('csharp', t)}[]`,
    matrix: (t) => `${mapType('csharp', t)}[][]`,
    tree: () => 'TreeNode',
    linkedlist: () => 'ListNode',
    graph: () => 'Node',
  };

  const goMap = {
    number: 'int',
    string: 'string',
    boolean: 'bool',
    void: '',
    array: (t) => `[]${mapType('go', t)}`,
    matrix: (t) => `[][]${mapType('go', t)}`,
    tree: () => '*TreeNode',
    linkedlist: () => '*ListNode',
    graph: () => '*Node',
  };

  const tsMap = {
    number: 'number',
    string: 'string',
    boolean: 'boolean',
    void: 'void',
    array: (t) => `${mapType('typescript', t)}[]`,
    matrix: (t) => `${mapType('typescript', t)}[][]`,
    tree: () => 'TreeNode | null',
    linkedlist: () => 'ListNode | null',
    graph: () => 'Node | null',
  };

  const cMap = {
    number: 'int',
    string: 'const char*',
    boolean: 'bool',
    void: 'void',
    array: (t) => `${mapType('c', t)}*`,
    matrix: (t) => `${mapType('c', t)}**`,
    tree: () => 'struct TreeNode*',
    linkedlist: () => 'struct ListNode*',
    graph: () => 'struct Node*',
  };

  const kotlinMap = {
    number: 'Int',
    string: 'String',
    boolean: 'Boolean',
    void: 'Unit',
    array: (t) => `Array<${mapType('kotlin', t)}>`,
    matrix: (t) => `Array<Array<${mapType('kotlin', t)}>>`,
    tree: () => 'TreeNode?',
    linkedlist: () => 'ListNode?',
    graph: () => 'Node?',
  };

  const rustMap = {
    number: 'i32',
    string: 'String',
    boolean: 'bool',
    void: '()',
    array: (t) => `Vec<${mapType('rust', t)}>`,
    matrix: (t) => `Vec<Vec<${mapType('rust', t)}>>`,
    tree: () => 'Option<Rc<RefCell<TreeNode>>>',
    linkedlist: () => 'Option<Box<ListNode>>',
    graph: () => 'Option<Rc<RefCell<Node>>>',
  };

  const maps = {
    cpp: cppMap,
    java: javaMap,
    csharp: csharpMap,
    go: goMap,
    typescript: tsMap,
    c: cMap,
    kotlin: kotlinMap,
    rust: rustMap
  };

  const currentMap = maps[language];
  if (!currentMap) return 'auto';

  const mapped = currentMap[kind];
  if (typeof mapped === 'function') {
    return mapped(inner);
  }
  return mapped || (language === 'cpp' ? 'auto' : 'Object');
}

