# wrapper injected by judge (do not expose to users)
import json, sys, traceback

# --- Security: Restrict dangerous modules and built-ins ---
# Remove dangerous modules from sys.modules and globals()
for module_name in [
    'os', 'subprocess', 'shutil', 'socket', 'urllib', 'requests',
    'pathlib', 'glob', 'tempfile', 'mmap', 'fcntl', 'resource', 'signal',
    'ctypes', 'gc', 'inspect', 'site', 'distutils', 'setuptools', 'pip'
]:
    if module_name in sys.modules:
        del sys.modules[module_name]
    if module_name in globals():
        del globals()[module_name]

# Restrict built-in functions
restricted_builtins = ['__import__', 'eval', 'exec', 'compile', 'open', 'file', 'input']
for builtin_name in restricted_builtins:
    if hasattr(__builtins__, builtin_name):
        delattr(__builtins__, builtin_name)

# --- user code will be inserted above this block ---
# USER_CODE_MARKER

def run_tests():
    tests = {{TESTS_JSON}}  # inserted by wrapper generator, array of {"input": [...], "expected": ...}
    results = []
    for i, t in enumerate(tests):
        try:
            out = {{FUNCTION_NAME}}(**t.get("input", {}))
            ok = compare_outputs(out, t.get("expectedOutput"))
            results.append({"test": i+1, "ok": ok, "output": out})
        except Exception as e:
            tb = traceback.format_exc()
            results.append({"test": i+1, "ok": False, "error": str(e), "traceback": tb})
    summary = {
        "status": "finished",
        "passed": sum(1 for r in results if r.get("ok")),
        "total": len(results),
        "details": results
    }
    print(json.dumps(summary))
    sys.stdout.flush()

def compare_outputs(a, b, float_tol=1e-9):
    # Exact match
    if a == b:
        return True
    # numbers with tolerance
    try:
        import numbers
        if isinstance(a, numbers.Number) and isinstance(b, numbers.Number):
            return abs(a - b) <= float_tol
    except Exception:
        pass
    # lists: unordered primitive comparison
    if isinstance(a, list) and isinstance(b, list):
        try:
            # primitive elements
            if all(not isinstance(x, (list, dict)) for x in a) and all(not isinstance(x, (list, dict)) for x in b):
                return sorted(a) == sorted(b)
        except Exception:
            pass
        # ordered deep compare fallback
        if len(a) != len(b):
            return False
        for x, y in zip(a, b):
            if not compare_outputs(x, y, float_tol):
                return False
        return True
    # dicts: deep compare
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a.keys()) != set(b.keys()):
            return False
        for k in a:
            if not compare_outputs(a[k], b[k], float_tol):
                return False
        return True
    return False

if __name__ == "__main__":
    run_tests()
