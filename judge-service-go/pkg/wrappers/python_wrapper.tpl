import json
import sys
import traceback

# USER_CODE_MARKER

def deep_equal(a, b, epsilon=1e-9):
    if a == b:
        return True
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) < epsilon
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return False
        for x, y in zip(a, b):
            if not deep_equal(x, y, epsilon):
                return False
        return True
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a.keys()) != set(b.keys()):
            return False
        for k in a:
            if not deep_equal(a[k], b[k], epsilon):
                return False
        return True
    return False

def run_tests():
    try:
        from solution import {{FUNCTION_NAME}}
    except ImportError:
        print(json.dumps({"status": "error", "message": "Could not import {{FUNCTION_NAME}} from solution.py"}))
        return

    if not callable({{FUNCTION_NAME}}):
        print(json.dumps({"status": "error", "message": "{{FUNCTION_NAME}} is not a function"}))
        return

        test_cases_json = '''{{TESTS_JSON}}'''
        test_cases = json.loads(test_cases_json)
    results = []
    for i, test_case in enumerate(test_cases):
        
        input_data = test_case['input']
        expected_output = test_case['expectedOutput']

        try:
            output = {{FUNCTION_NAME}}(*input_data)
            is_correct = deep_equal(output, expected_output)
            results.append({"test": i + 1, "ok": is_correct, "output": output})
        except Exception as e:
            results.append({"test": i + 1, "ok": False, "error": str(e), "traceback": traceback.format_exc()})

    summary = {
        "status": "finished",
        "passed": sum(1 for r in results if r.get("ok")),
        "total": len(results),
        "details": results
    }
    print(json.dumps(summary))

if __name__ == "__main__":
    run_tests()
