import json
import sys
import traceback
import math
import time
import io
import os
import importlib
from contextlib import redirect_stdout, redirect_stderr

COMPARE_MODE = "{{COMPARE_MODE}}"  # STRUCTURAL, STRICT, APPROX, ORDER_INSENSITIVE, TEXT

# region Data Structure Definitions
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right
# endregion

# region Normalization and Comparison Logic
def normalize(value, visited=None, depth=0):
    if visited is None:
        visited = set()

    max_depth = 1000
    if depth > max_depth:
        return '[Max Depth Exceeded]'

    # Treat Python primitives and strings as-is
    if value is None or isinstance(value, (int, float, str, bool)):
        return value

    vid = id(value)
    if vid in visited:
        return '[Circular]'
    visited.add(vid)

    try:
        # Linked list: object with 'val' and 'next'
        if hasattr(value, 'val') and hasattr(value, 'next'):
            nodes = []
            curr = value
            current_depth = 0
            while curr and current_depth < max_depth:
                nodes.append(normalize(getattr(curr, 'val', None), visited, depth + 1))
                curr = getattr(curr, 'next', None)
                current_depth += 1
            return {'__type': 'LinkedList', 'values': nodes}

        # Tree node: object with 'val' and left/right
        if hasattr(value, 'val') and (hasattr(value, 'left') or hasattr(value, 'right')):
            return {
                '__type': 'TreeNode',
                'val': normalize(getattr(value, 'val', None), visited, depth + 1),
                'left': normalize(getattr(value, 'left', None), visited, depth + 1),
                'right': normalize(getattr(value, 'right', None), visited, depth + 1),
            }

        # lists / tuples
        if isinstance(value, (list, tuple)):
            return [normalize(v, visited, depth + 1) for v in value]

        # dicts
        if isinstance(value, dict):
            return {k: normalize(value[k], visited, depth + 1) for k in sorted(value.keys())}

        # fallback: try to convert to JSON-serializable primitives
        try:
            return str(value)
        except Exception:
            return '[Unserializable]'
    finally:
        # remove from visited so sibling branches don't get false circulars
        if vid in visited:
            visited.remove(vid)

def normalize_text(value):
    if not isinstance(value, str):
        value = str(value)
    return ' '.join(value.strip().split())

def _structural_deep_equal(a, b, epsilon):
    if a == b:
        return True

    # numeric approximate compare
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(float(a) - float(b)) < epsilon * max(1.0, abs(float(a)), abs(float(b)))

    # lists
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return False
        for x, y in zip(a, b):
            if not _structural_deep_equal(x, y, epsilon):
                return False
        return True

    # dicts
    if isinstance(a, dict) and isinstance(b, dict):
        keys_a = sorted(a.keys())
        keys_b = sorted(b.keys())
        if keys_a != keys_b:
            return False
        for k in keys_a:
            if not _structural_deep_equal(a[k], b[k], epsilon):
                return False
        return True

    # fallback
    return False

def deep_equal(a, b, epsilon=1e-6):
    if COMPARE_MODE == 'STRICT':
        return a == b
    elif COMPARE_MODE == 'APPROX':
        if not (isinstance(a, (int, float)) and isinstance(b, (int, float))):
            return False
        return abs(float(a) - float(b)) < epsilon * max(1.0, abs(float(a)), abs(float(b)))
    elif COMPARE_MODE == 'TEXT':
        return normalize_text(a) == normalize_text(b)
    elif COMPARE_MODE == 'ORDER_INSENSITIVE':
        if not (isinstance(a, list) and isinstance(b, list) and len(a) == len(b)):
            return False
        try:
            # Use JSON-serialized values as multiset keys
            def keyify(x): return json.dumps(x, sort_keys=True)
            a_counts = {}
            for item in a:
                a_counts[keyify(item)] = a_counts.get(keyify(item), 0) + 1
            b_counts = {}
            for item in b:
                b_counts[keyify(item)] = b_counts.get(keyify(item), 0) + 1
            return a_counts == b_counts
        except Exception:
            return False

    # default STRUCTURAL
    return _structural_deep_equal(a, b, epsilon)

def diff_summary(actual, expected):
    def dumps(obj):
        try:
            return json.dumps(obj, indent=2, sort_keys=True)
        except Exception:
            return str(obj)

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
            missing = sorted(list(keys_b - keys_a))
            extra = sorted(list(keys_a - keys_b))
            parts = []
            if missing: parts.append(f"Missing keys: {missing}")
            if extra: parts.append(f"Extra keys: {extra}")
            return '; '.join(parts)
        for key in sorted(list(keys_b)):
            if not deep_equal(actual.get(key), expected.get(key)):
                return f"Mismatch at key '{key}': expected {dumps(expected.get(key))}, got {dumps(actual.get(key))}"

    return f"Values differ: expected {dumps(expected)}, got {dumps(actual)}"

def truncate_output(obj, max_len=2000):
    try:
        s = json.dumps(obj, default=str)
    except Exception:
        try:
            s = str(obj)
        except Exception:
            s = '[Unserializable]'
    if len(s) > max_len:
        return s[:max_len] + '...(truncated)'
    return s
# endregion

def load_test_cases():
    """Prefer environment variable TESTS_JSON (safer). If not present, try raw template injection fallback."""
    env = os.environ.get('TESTS_JSON')
    if env:
        try:
            return json.loads(env)
        except Exception:
            # fallthrough to try other option
            pass

    # Fallback: generator may choose to inject raw JSON here in a placeholder TESTS_JSON_RAW.
    # If your generator uses raw injection, ensure it's valid JSON (no quotes).
    try:
        raw = '''{{TESTS_JSON}}'''
        if raw and raw.strip():
            return json.loads(raw)
    except Exception:
        pass

    return None

def run_tests():
    # Try to import the user's solution module
    try:
        spec = importlib.util.find_spec('solution')
        if spec is None:
            # try plain import (some judge systems put solution.py directly on path)
            import solution  # type: ignore
        else:
            import solution  # type: ignore
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Could not import solution module: {e}"}))
        return

    func_name = "{{FUNCTION_NAME}}"
    func = getattr(solution, func_name, None)
    if func is None or not callable(func):
        print(json.dumps({"status": "error", "message": f"Could not find callable '{func_name}' in solution.py"}))
        return

    test_cases = load_test_cases()
    if test_cases is None:
        print(json.dumps({"status": "error", "message": "TESTS_JSON not provided or invalid"}))
        return

    # Safety limits
    MAX_TESTS = 5000
    if not isinstance(test_cases, list) or len(test_cases) > MAX_TESTS:
        print(json.dumps({"status": "error", "message": "Invalid or too many test cases"}))
        return

    submission_result = {
        "status": "finished",
        "passed": 0,
        "total": len(test_cases),
        "details": []
    }

    for i, test_case in enumerate(test_cases):
        input_data = test_case.get('input', [])
        expected_output = test_case.get('expectedOutput')

        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()

        start_time = time.perf_counter()
        output = None
        error_msg = None
        tb_str = None
        ok = False

        try:
            with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                # call the function. We assume input_data is an array of positional args.
                output = func(*input_data)

            # If user returned None while expected not None -> treat as possible error (but still allow)
            if output is None and expected_output is not None:
                error_msg = "Function returned None"
            else:
                normalized_output = normalize(output)
                normalized_expected = normalize(expected_output)
                ok = deep_equal(normalized_output, normalized_expected)
                if not ok:
                    error_msg = diff_summary(normalized_output, normalized_expected)
                output = normalized_output

        except Exception:
            tb_str = traceback.format_exc()
            error_msg = str(sys.exc_info()[1])

        duration_ms = (time.perf_counter() - start_time) * 1000.0

        detail = {
            "test": i,  # 0-based index
            "ok": ok,
            "output": truncate_output(output),
            "expected": truncate_output(normalize(expected_output)),
            "error": error_msg,
            "traceback": tb_str,
            "stdout": truncate_output(stdout_capture.getvalue(), 2000),
            "stderr": truncate_output(stderr_capture.getvalue(), 2000),
            "durationMs": duration_ms
        }
        submission_result["details"].append(detail)
        if ok:
            submission_result["passed"] += 1

    # Use default serializer with fallback for ListNode/TreeNode using normalize
    class _Encoder(json.JSONEncoder):
        def default(self, o):
            if isinstance(o, (ListNode, TreeNode)):
                return normalize(o)
            try:
                return super().default(o)
            except Exception:
                return str(o)

    print(json.dumps(submission_result, cls=_Encoder))

if __name__ == "__main__":
    run_tests()
