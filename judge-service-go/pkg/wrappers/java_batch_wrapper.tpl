import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

public class Main {
    private static final Gson GSON = new Gson();

    public static void main(String[] args) {
        try {
            JsonArray tests = GSON.fromJson(
                decodePayload(args),
                JsonArray.class
            );
            if (tests == null) {
                throw new IllegalArgumentException("missing batched test payload");
            }

            for (int i = 0; i < tests.size(); i++) {
                JsonObject payload = tests.get(i).getAsJsonObject();
                JsonArray inputs = payload.getAsJsonArray("inputs");

                try {
                    Method method = resolveMethod(inputs == null ? 0 : inputs.size());
                    Object output = invoke(method, inputs);

                    JsonObject result = new JsonObject();
                    result.addProperty("test", i + 1);
                    result.add("output", GSON.toJsonTree(output));
                    System.out.println(GSON.toJson(result));
                } catch (InvocationTargetException err) {
                    Throwable cause = err.getCause() != null ? err.getCause() : err;
                    System.out.println(errorPayload(i + 1, cause));
                } catch (Throwable err) {
                    System.out.println(errorPayload(i + 1, err));
                }
            }
        } catch (Throwable err) {
            JsonObject fatal = new JsonObject();
            fatal.addProperty("fatal", stackTrace(err));
            System.out.println(GSON.toJson(fatal));
        }
    }

    private static String decodePayload(String[] args) {
        if (args.length == 0) {
            throw new IllegalArgumentException("missing input payload");
        }
        byte[] decoded = Base64.getDecoder().decode(args[0]);
        return new String(decoded, StandardCharsets.UTF_8);
    }

    private static Method resolveMethod(int argCount) throws NoSuchMethodException {
        for (Method method : Solution.class.getDeclaredMethods()) {
            if (method.getName().equals("{{FUNCTION_NAME}}") && method.getParameterCount() == argCount) {
                method.setAccessible(true);
                return method;
            }
        }
        throw new NoSuchMethodException("method {{FUNCTION_NAME}} with " + argCount + " arguments not found");
    }

    private static Object invoke(Method method, JsonArray inputs) throws InvocationTargetException, IllegalAccessException {
        Type[] parameterTypes = method.getGenericParameterTypes();
        Object[] args = new Object[parameterTypes.length];

        for (int i = 0; i < parameterTypes.length; i++) {
            JsonElement input = inputs != null && i < inputs.size() ? inputs.get(i) : JsonNull.INSTANCE;
            args[i] = GSON.fromJson(input, parameterTypes[i]);
        }

        Solution solution = new Solution();
        return method.invoke(solution, args);
    }

    private static String errorPayload(int test, Throwable err) {
        JsonObject result = new JsonObject();
        result.addProperty("test", test);
        result.addProperty("error", err.getClass().getSimpleName());
        result.addProperty("traceback", stackTrace(err));
        return GSON.toJson(result);
    }

    private static String stackTrace(Throwable err) {
        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        err.printStackTrace(pw);
        pw.flush();
        return sw.toString();
    }
}
