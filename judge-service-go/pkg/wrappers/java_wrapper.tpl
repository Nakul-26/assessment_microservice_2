import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.lang.reflect.Method;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Array;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;

// USER_CODE_MARKER

public class GeneratedTester {

    // DTOs that mirror the Go structs for clean JSON serialization
    static class TestResult {
        int test; // 0-based
        boolean ok;
        Object output;
        Object expected;
        String error;
        String stack;
        String stdout;
        String stderr;
        long durationMs;

        TestResult(int test) {
            this.test = test;
        }
    }

    static class SubmissionResult {
        String status = "finished";
        int passed = 0;
        int total = 0;
        List<TestResult> details = new ArrayList<>();
    }

    private static final Gson gson = new GsonBuilder().serializeNulls().create();

    // Extended deepEquals to handle primitive arrays too
    private static boolean deepEquals(Object a, Object b) {
        if (a == null && b == null) return true;
        if (a == null || b == null) return false;

        Class<?> ca = a.getClass();
        Class<?> cb = b.getClass();

        if (ca.isArray() && cb.isArray()) {
            // handle Object[] first
            if (a instanceof Object[] && b instanceof Object[]) {
                return Arrays.deepEquals((Object[]) a, (Object[]) b);
            }
            // common primitive arrays
            if (ca == int[].class && cb == int[].class) return Arrays.equals((int[]) a, (int[]) b);
            if (ca == long[].class && cb == long[].class) return Arrays.equals((long[]) a, (long[]) b);
            if (ca == double[].class && cb == double[].class) return Arrays.equals((double[]) a, (double[]) b);
            if (ca == float[].class && cb == float[].class) return Arrays.equals((float[]) a, (float[]) b);
            if (ca == boolean[].class && cb == boolean[].class) return Arrays.equals((boolean[]) a, (boolean[]) b);
            if (ca == short[].class && cb == short[].class) return Arrays.equals((short[]) a, (short[]) b);
            if (ca == byte[].class && cb == byte[].class) return Arrays.equals((byte[]) a, (byte[]) b);
            if (ca == char[].class && cb == char[].class) return Arrays.equals((char[]) a, (char[]) b);

            // fallback: try to box primitive arrays into Object[] and deep compare
            int lenA = Array.getLength(a);
            int lenB = Array.getLength(b);
            if (lenA != lenB) return false;
            for (int i = 0; i < lenA; i++) {
                Object va = Array.get(a, i);
                Object vb = Array.get(b, i);
                if (!deepEquals(va, vb)) return false;
            }
            return true;
        }

        // Fallback to Gson JSON equality for complex objects
        return gson.toJson(a).equals(gson.toJson(b));
    }

    // Attempt to coerce one argument to the given parameter type (handles boxed types & numeric conversions, arrays, lists to arrays)
    private static Object coerceArg(Object arg, Class<?> paramType) {
        if (arg == null) {
            if (paramType.isPrimitive()) {
                // default primitive values
                if (paramType == boolean.class) return false;
                if (paramType == byte.class) return (byte)0;
                if (paramType == short.class) return (short)0;
                if (paramType == int.class) return 0;
                if (paramType == long.class) return 0L;
                if (paramType == float.class) return 0f;
                if (paramType == double.class) return 0.0;
                if (paramType == char.class) return '\0';
            }
            return null;
        }

        // If already assignable, return as-is (handles boxed types)
        if (paramType.isAssignableFrom(arg.getClass())) return arg;

        // Handle numeric conversions (Gson commonly returns Double for numbers)
        if (arg instanceof Number) {
            Number n = (Number) arg;
            if (paramType == Integer.class || paramType == int.class) return n.intValue();
            if (paramType == Long.class || paramType == long.class) return n.longValue();
            if (paramType == Double.class || paramType == double.class) return n.doubleValue();
            if (paramType == Float.class || paramType == float.class) return n.floatValue();
            if (paramType == Short.class || paramType == short.class) return n.shortValue();
            if (paramType == Byte.class || paramType == byte.class) return n.byteValue();
        }

        // Strings: allow parsing into numeric types
        if (arg instanceof String) {
            String s = (String) arg;
            try {
                if (paramType == Integer.class || paramType == int.class) return Integer.parseInt(s);
                if (paramType == Long.class || paramType == long.class) return Long.parseLong(s);
                if (paramType == Double.class || paramType == double.class) return Double.parseDouble(s);
                if (paramType == Float.class || paramType == float.class) return Float.parseFloat(s);
                if (paramType == Boolean.class || paramType == boolean.class) return Boolean.parseBoolean(s);
            } catch (Exception e) {
                // fall through
            }
        }

        // Arrays: if param expects an array, try to convert from List or Object[]
        if (paramType.isArray()) {
            Class<?> elemType = paramType.getComponentType();
            if (arg instanceof List) {
                List<?> list = (List<?>) arg;
                Object arr = Array.newInstance(elemType, list.size());
                for (int i = 0; i < list.size(); i++) {
                    Object coerced = coerceArg(list.get(i), elemType);
                    Array.set(arr, i, coerced);
                }
                return arr;
            } else if (arg instanceof Object[]) {
                Object[] oa = (Object[]) arg;
                Object arr = Array.newInstance(elemType, oa.length);
                for (int i = 0; i < oa.length; i++) {
                    Array.set(arr, i, coerceArg(oa[i], elemType));
                }
                return arr;
            }
        }

        // If param expects Object, return arg
        if (paramType == Object.class) return arg;

        // Last resort: try to convert via string representation
        try {
            String s = arg.toString();
            if (paramType == String.class) return s;
        } catch (Exception ignored) {}

        // Cannot coerce: return original arg (may cause invocation error)
        return arg;
    }

    // Find the "best" method in Solution with the given name and args; tries exact matches, then coercion-capable matches.
    private static Method findBestMethod(String methodName, Object[] args) {
        Method[] methods = Solution.class.getDeclaredMethods();
        // First pass: exact parameter count and assignable types
        for (Method m : methods) {
            if (!m.getName().equals(methodName)) continue;
            Class<?>[] params = m.getParameterTypes();
            if (params.length != args.length) continue;
            boolean ok = true;
            for (int i = 0; i < params.length; i++) {
                if (args[i] == null) continue; // can't judge null
                if (!params[i].isAssignableFrom(args[i].getClass())) {
                    ok = false;
                    break;
                }
            }
            if (ok) return m;
        }
        // Second pass: same param count and coercion is possible (try coercing first arg types)
        for (Method m : methods) {
            if (!m.getName().equals(methodName)) continue;
            Class<?>[] params = m.getParameterTypes();
            if (params.length != args.length) continue;
            boolean coercible = true;
            for (int i = 0; i < params.length; i++) {
                // best-effort: we assume coerceArg may succeed for most pairs
                // skip check here; return method and attempt coercion during invocation
                // but prefer primitive vs Object distinctions: accept
            }
            if (coercible) return m;
        }
        // Third pass: find a single-parameter method that accepts Object[] or varargs
        for (Method m : methods) {
            if (!m.getName().equals(methodName)) continue;
            Class<?>[] params = m.getParameterTypes();
            if (params.length == 1 && (params[0] == Object[].class || params[0].isArray())) {
                return m;
            }
            // varargs handling can be done via isVarArgs but we'll let reflection handle it at invocation
        }
        return null;
    }

    public static void main(String[] args) {
        SubmissionResult submissionResult = new SubmissionResult();
        // instantiate both a sample instance and support static methods
        Solution solution = null;
        try {
            solution = new Solution();
        } catch (Throwable t) {
            // if Solution has no accessible ctor, we'll still support static methods only
            solution = null;
        }

        // {{.TESTS_LITERAL}}
        {{.TESTS_LITERAL}}

        // {{.EXPECTED_LITERAL}}
        {{.EXPECTED_LITERAL}}

        submissionResult.total = tests.length;

        for (int i = 0; i < tests.length; i++) {
            TestResult testResult = new TestResult(i);
            Object[] inputArgs = tests[i];
            Object expectedOutput = expected[i];
            testResult.expected = expectedOutput;

            // Redirect stdout and stderr
            PrintStream originalOut = System.out;
            PrintStream originalErr = System.err;
            ByteArrayOutputStream stdoutBaos = new ByteArrayOutputStream();
            ByteArrayOutputStream stderrBaos = new ByteArrayOutputStream();
            System.setOut(new PrintStream(stdoutBaos));
            System.setErr(new PrintStream(stderrBaos));

            long startTime = System.nanoTime();

            try {
                Method userMethod = findBestMethod("{{.FUNCTION_NAME}}", inputArgs);
                if (userMethod == null) {
                    throw new NoSuchMethodException("Could not find method '{{.FUNCTION_NAME}}' suitable for provided inputs.");
                }

                userMethod.setAccessible(true); // Allow calling private methods
                Class<?>[] paramTypes = userMethod.getParameterTypes();
                Object[] invokeArgs;

                if (paramTypes.length == inputArgs.length) {
                    // coerce each arg to param type
                    invokeArgs = new Object[paramTypes.length];
                    for (int k = 0; k < paramTypes.length; k++) {
                        invokeArgs[k] = coerceArg(inputArgs[k], paramTypes[k]);
                    }
                } else if (paramTypes.length == 1 && paramTypes[0].isArray()) {
                    // single array parameter: convert inputArgs to array of component type
                    Class<?> elemType = paramTypes[0].getComponentType();
                    Object arr = Array.newInstance(elemType, inputArgs.length);
                    for (int k = 0; k < inputArgs.length; k++) {
                        Array.set(arr, k, coerceArg(inputArgs[k], elemType));
                    }
                    invokeArgs = new Object[] { arr };
                } else {
                    // fallback: pass the inputArgs as-is (works if method expects Object[])
                    invokeArgs = inputArgs;
                }

                Object targetInstance = null;
                if (!java.lang.reflect.Modifier.isStatic(userMethod.getModifiers())) {
                    // instance method needed
                    if (solution == null) {
                        // try to create instance dynamically
                        try {
                            solution = (Solution) Solution.class.getDeclaredConstructor().newInstance();
                        } catch (Throwable te) {
                            // cannot create instance
                            throw new IllegalStateException("Cannot construct Solution instance for invoking instance method.");
                        }
                    }
                    targetInstance = solution;
                }

                Object actualOutput = userMethod.invoke(targetInstance, invokeArgs);
                testResult.output = actualOutput;
                testResult.ok = deepEquals(actualOutput, expectedOutput);
                if (!testResult.ok) {
                    testResult.error = "Values differ"; // Basic diff message
                }

            } catch (InvocationTargetException ite) {
                testResult.ok = false;
                Throwable t = (ite.getCause() != null) ? ite.getCause() : ite;
                testResult.error = t.getClass().getName() + ": " + t.getMessage();
                StringWriter sw = new StringWriter();
                t.printStackTrace(new PrintWriter(sw));
                testResult.stack = sw.toString();
            } catch (Throwable t) {
                testResult.ok = false;
                testResult.error = t.getClass().getName() + ": " + t.getMessage();
                StringWriter sw = new StringWriter();
                t.printStackTrace(new PrintWriter(sw));
                testResult.stack = sw.toString();
            } finally {
                long endTime = System.nanoTime();
                testResult.durationMs = TimeUnit.NANOSECONDS.toMillis(endTime - startTime);

                // Restore streams and get captured content
                System.setOut(originalOut);
                System.setErr(originalErr);
                testResult.stdout = stdoutBaos.toString();
                testResult.stderr = stderrBaos.toString();

                if (testResult.ok) {
                    submissionResult.passed++;
                }
                submissionResult.details.add(testResult);
            }
        }

        System.out.println(gson.toJson(submissionResult));
    }
}