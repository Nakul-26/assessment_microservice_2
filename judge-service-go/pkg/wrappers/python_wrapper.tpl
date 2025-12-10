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
    tests = json.loads('''{{.TESTS_JSON_STRING}}''') # inserted by wrapper generator, array of {"input": [...], "expected": ...}
    results = []
    for i, t in enumerate(tests):
        try:
            test_input = t.get("input", {})
            if isinstance(test_input, list):
                out = {{.FUNCTION_NAME}}(*test_input)
            else:
                out = {{.FUNCTION_NAME}}(**test_input)
            ok = out == t.get("expectedOutput")
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

if __name__ == "__main__":
    run_tests()
