import json
import sys
import traceback
import math

COMPARE_MODE = "{{COMPARE_MODE}}"  # STRUCTURAL, STRICT, APPROX, ORDER_INSENSITIVE, TEXT

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def normalize(value, visited=None, depth=0):
    if visited is None:
        visited = set()
    
    max_depth = 1000
    if depth > max_depth:
        return '[Max Depth Exceeded]'

    if value is None or not isinstance(value, object):
        return value

    if id(value) in visited:
        return '[Circular]'
    visited.add(id(value))

    if hasattr(value, 'val') and hasattr(value, 'next'): # Linked List
        nodes = []
        curr = value
        current_depth = 0
        while curr and current_depth < max_depth:
            nodes.append(curr.val)
            curr = curr.next
            current_depth += 1
        return {'__type': 'LinkedList', 'values': nodes}

    if hasattr(value, 'val') and (hasattr(value, 'left') or hasattr(value, 'right')): # Tree
        return {
            '__type': 'TreeNode',
            'val': value.val,
            'left': normalize(value.left, visited, depth + 1),
            'right': normalize(value.right, visited, depth + 1),
        }

    if isinstance(value, list):
        return [normalize(v, visited, depth + 1) for v in value]

    if isinstance(value, dict):
        obj = {}
        for key in sorted(value.keys()):
            obj[key] = normalize(value[key], visited, depth + 1)
        return obj
    
    # Fallback for other object types
    try:
        return str(value)
    except:
        return '[Unserializable]'


def normalize_text(value):
    if not isinstance(value, str):
        value = str(value)
    return ' '.join(value.strip().split())

def deep_equal(a, b, epsilon=1e-6):
    if COMPARE_MODE == 'STRICT':
        return a == b
    elif COMPARE_MODE == 'APPROX':
        if not (isinstance(a, (int, float)) and isinstance(b, (int, float))):
            return False
        return abs(a - b) < epsilon * max(1, abs(a), abs(b))
    elif COMPARE_MODE == 'TEXT':
        return normalize_text(a) == normalize_text(b)
    elif COMPARE_MODE == 'ORDER_INSENSITIVE':
        if not (isinstance(a, list) and isinstance(b, list) and len(a) == len(b)):
            return False
        # This is a simplified sort for demonstration.
        try:
            sorted_a = sorted(a)
            sorted_b = sorted(b)
            return deep_equal(sorted_a, sorted_b, epsilon)
        except TypeError: # For unorderable types
             return False
    # Default to STRUCTURAL
    return _structural_deep_equal(a, b, epsilon)

def _structural_deep_equal(a, b, epsilon):
    if a == b:
        return True

    if not isinstance(a, object) or a is None or not isinstance(b, object) or b is None:
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            return abs(a - b) < epsilon * max(1, abs(a), abs(b))
        return a == b

    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return False
        for x, y in zip(a, b):
            if not _structural_deep_equal(x, y, epsilon):
                return False
        return True

    if isinstance(a, dict) and isinstance(b, dict):
        keys_a = sorted(a.keys())
        keys_b = sorted(b.keys())
        if keys_a != keys_b:
            return False
        for key in keys_a:
            if not _structural_deep_equal(a[key], b[key], epsilon):
                return False
        return True
        
    return False

def diff_summary(actual, expected):
    # The `normalize` function should produce JSON-serializable output.
    def dumps(obj):
        return json.dumps(obj, indent=2)

    if isinstance(actual, list) and isinstance(expected, list):
        if len(actual) != len(expected):
            return f"Array length mismatch: expected {len(expected)}, got {len(actual)}"
        for i, (a, e) in enumerate(zip(actual, expected)):
            if not deep_equal(a, e):
                return f"Mismatch at index {i}: expected {dumps(e)}, got {dumps(a)}"
    if isinstance(actual, dict) and isinstance(expected, dict):
        keys_a = set(actual.keys())
        keys_b = set(expected.keys())
        if keys_a != keys_b:
            missing = keys_b - keys_a
            extra = keys_a - keys_b
            msg = []
            if missing: msg.append(f"Missing keys: {missing}")
            if extra: msg.append(f"Extra keys: {extra}")
            return '; '.join(msg)
        for key in keys_b:
            if not deep_equal(actual[key], expected[key]):
                return f"Mismatch at key '{key}': expected {dumps(expected[key])}, got {dumps(actual[key])}"
    return f"Values differ: expected {dumps(expected)}, got {dumps(actual)}"

def truncate_output(obj, max_len=2000):
    # After `normalize`, obj should be JSON serializable.
    s = json.dumps(obj)
    if len(s) > max_len:
        return s[:max_len] + '...(truncated)'
    return obj # Return original object if not truncated to preserve type for final json dump

def run_tests():
    try:
        from solution import {{FUNCTION_NAME}}
    except ImportError:
        print(json.dumps({"status": "error", "message": "Could not import {{FUNCTION_NAME}} from solution.py"}))
        return

    if not callable({{FUNCTION_NAME}}):
        print(json.dumps({"status": "error", "message": "{{FUNCTION_NAME}} is not a function"}))
        return

    try:
        test_cases_json = '''{{TESTS_JSON}}'''
        test_cases = json.loads(test_cases_json)
    except json.JSONDecodeError:
        print(json.dumps({"status": "error", "message": "Invalid JSON in test cases"}))
        return

    results = []
    for i, test_case in enumerate(test_cases):
        input_data = test_case['input']
        expected_output = test_case['expectedOutput']

        try:
            output = {{FUNCTION_NAME}}(*input_data[0])
            
            if output is None:
                 results.append({
                    "test": i + 1, 
                    "ok": False, 
                    "error": "Function returned None",
                    "expected": truncate_output(expected_output)
                })
                 continue

            normalized_output = normalize(output)
            normalized_expected = normalize(expected_output)

            is_correct = deep_equal(normalized_output, normalized_expected)
            result = {
                "test": i + 1,
                "ok": is_correct,
                "output": truncate_output(normalized_output),
                "expected": truncate_output(normalized_expected)
            }
            if not is_correct:
                result["diff"] = diff_summary(normalized_output, normalized_expected)
            results.append(result)

        except Exception as e:
            results.append({
                "test": i + 1, 
                "ok": False, 
                "error": str(e), 
                "traceback": traceback.format_exc(),
                "expected": truncate_output(expected_output)
            })

    summary = {
        "status": "finished",
        "passed": sum(1 for r in results if r.get("ok")),
        "total": len(results),
        "details": results
    }
    # Use a custom serializer for the final output to handle complex objects
    class CustomEncoder(json.JSONEncoder):
        def default(self, o):
            if isinstance(o, (ListNode, TreeNode)):
                return normalize(o)
            # Let the base class default method raise the TypeError
            return json.JSONEncoder.default(self, o)

    print(json.dumps(summary, cls=CustomEncoder))

if __name__ == "__main__":
    run_tests()